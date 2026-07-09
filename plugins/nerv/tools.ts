// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { asNumber, asObject, asString, callNerv, NOT_CONFIGURED, optionalString, readNervConfig } from './client.js'
import type { HttpFetch } from './client.js'
import {
  clearActive,
  deriveTitle,
  getActiveTaskId,
  isTerminal,
  listRecords,
  readRecord,
  setActive,
  writeRecord,
} from './history.js'
import type { TaskRecord } from './history.js'
import { createCodingTaskSchema, emptySchema, taskRefSchema } from './schemas.js'

type AdminConfigReader = { get(key: string): string | undefined }
type KvStore = {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
  list(prefix?: string): Array<{ key: string; value: string }>
}
export type RuntimeContext = {
  storageContextId: string
  adminConfig: AdminConfigReader
  kv: KvStore
  codingRepos: {
    list(): { name: string; baseBranch: string }[]
    get(name: string): {
      name: string
      repoUrl: string
      baseBranch: string
      permissionPreset: string
      additionalEgressDomains?: string[]
    } | null
  }
}
type ToolExecute = (input: unknown, runtimeContext: RuntimeContext, options: unknown) => Promise<unknown>
export type Tool = { name: string; description: string; inputSchema: unknown; execute: ToolExecute }

export function taskIdOf(result: unknown): string | null {
  const row = asObject(result)
  const id = row['taskId']
  return typeof id === 'string' && id.length > 0 ? id : null
}

export function deriveProjectPath(repoUrl: string): string | null {
  try {
    const path = new URL(repoUrl).pathname
      .replace(/^\/+/u, '')
      .replace(/\/+$/u, '')
      .replace(/\.git$/u, '')
    return path.length > 0 ? path : null
  } catch {
    return null
  }
}

// A positive "is GitLab" host check would false-refuse self-hosted GitLab (arbitrary host),
// so refuse only hosts that are definitely a different forge. github.com is the one that matters
// today; everything else (gitlab.com + self-hosted) passes through for nerv/magi to validate.
export function isDefinitelyNotGitlab(repoUrl: string): boolean {
  try {
    return new URL(repoUrl).host === 'github.com'
  } catch {
    return true
  }
}

export function resolveProjectNames(args: Record<string, unknown>): string[] {
  const names: string[] = []
  const single = optionalString(args, 'project')
  if (single !== undefined) names.push(single)
  const many = args['projects']
  if (Array.isArray(many)) {
    for (const n of many) if (typeof n === 'string' && n.length > 0) names.push(n)
  }
  return names
}

type ResolvedRepos =
  | { error: string; message: string }
  | { repos: { projectPath: string }[]; names: string[]; targetBranch: string | undefined }

function resolveRepos(runtimeContext: RuntimeContext, names: string[]): ResolvedRepos {
  const repos: { projectPath: string }[] = []
  const resolvedNames: string[] = []
  let targetBranch: string | undefined
  for (const name of names) {
    const repo = runtimeContext.codingRepos.get(name)
    if (repo === null)
      return { error: 'not_found', message: `No repository named "${name}". Add it in settings → Repositories.` }
    if (isDefinitelyNotGitlab(repo.repoUrl))
      return { error: 'not_configured', message: `nerv supervises GitLab MRs; "${name}" is on GitHub.` }
    const projectPath = deriveProjectPath(repo.repoUrl)
    if (projectPath === null)
      return { error: 'invalid_input', message: `Could not derive a project path from "${name}".` }
    repos.push({ projectPath })
    resolvedNames.push(name)
    targetBranch ??= repo.baseBranch
  }
  return { repos, names: resolvedNames, targetBranch }
}

// Refuse to open a second task on a thread while an earlier one is still running.
function activeTaskConflict(runtimeContext: RuntimeContext): { error: string; message: string } | null {
  const activeId = getActiveTaskId(runtimeContext.kv, runtimeContext.storageContextId)
  if (activeId === null) return null
  const active = readRecord(runtimeContext.kv, activeId)
  if (active === null || isTerminal(active.status)) return null
  return {
    error: 'conflict',
    message: 'A coding task is already running in this thread — cancel it or wait for it to finish.',
  }
}

function buildCreateTaskBody(
  args: Record<string, unknown>,
  prompt: string,
  storageContextId: string,
  resolved: { repos: { projectPath: string }[]; targetBranch: string | undefined },
): Record<string, unknown> {
  const kind = optionalString(args, 'kind')
  const costBudgetUsd = asNumber(args, 'costBudgetUsd')
  return {
    ...(kind === undefined ? {} : { kind }),
    prompt,
    repos: resolved.repos,
    contextRef: { contextId: storageContextId },
    source: 'chat',
    ...(resolved.targetBranch === undefined ? {} : { targetBranch: resolved.targetBranch }),
    ...(costBudgetUsd === null ? {} : { costBudgetUsd }),
  }
}

function recordCreatedTask(
  runtimeContext: RuntimeContext,
  result: unknown,
  prompt: string,
  resolved: { names: string[] },
): void {
  const taskId = taskIdOf(result)
  if (taskId === null) return
  const record: TaskRecord = {
    taskId,
    storageContextId: runtimeContext.storageContextId,
    title: deriveTitle(prompt),
    repos: resolved.names,
    createdAt: new Date().toISOString(),
  }
  writeRecord(runtimeContext.kv, taskId, record)
  setActive(runtimeContext.kv, runtimeContext.storageContextId, taskId)
}

export function createCodingTaskTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'create_coding_task',
    description:
      'Create a long-running, supervised coding task on nerv for a configured GitLab project: it opens/updates ' +
      'a merge request and watches it until CI is green, iterating on review comments. Pass project (or projects ' +
      'for multi-repo) + prompt. Only one task can run per chat thread at a time.',
    inputSchema: createCodingTaskSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readNervConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const prompt = asString(args, 'prompt')
      if (prompt === null) return { error: 'invalid_input', message: 'prompt is required' }
      const names = resolveProjectNames(args)
      if (names.length === 0) return { error: 'invalid_input', message: 'project (or projects) is required' }

      const conflict = activeTaskConflict(runtimeContext)
      if (conflict !== null) return conflict

      const resolved = resolveRepos(runtimeContext, names)
      if ('error' in resolved) return resolved

      const body = buildCreateTaskBody(args, prompt, runtimeContext.storageContextId, resolved)
      const result = await callNerv(httpFetch, cfg, 'POST', '/tasks', body)
      recordCreatedTask(runtimeContext, result, prompt, resolved)
      return result
    },
  }
}

// Merge nerv's live task doc onto the local record (status/mrUrl/usageUsd) and free the thread
// pointer when the task has reached a terminal status.
function refreshFromTaskDoc(runtimeContext: RuntimeContext, taskId: string, doc: unknown): void {
  const row = asObject(doc)
  const status = optionalString(row, 'status')
  const mrUrl = optionalString(row, 'mrUrl')
  const usageUsd = asNumber(row, 'usageUsd')
  const record = readRecord(runtimeContext.kv, taskId)
  if (record !== null) {
    writeRecord(runtimeContext.kv, taskId, {
      ...record,
      ...(status === undefined ? {} : { status }),
      ...(mrUrl === undefined ? {} : { mrUrl }),
      ...(usageUsd === null ? {} : { usageUsd }),
    })
  }
  if (isTerminal(status) && getActiveTaskId(runtimeContext.kv, runtimeContext.storageContextId) === taskId)
    clearActive(runtimeContext.kv, runtimeContext.storageContextId)
}

export function codingTaskStatusTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'coding_task_status',
    description:
      'Get the status of a supervised coding task (status, merge-request link, cost). Defaults to this thread’s ' +
      'current task; pass taskId to target a specific one.',
    inputSchema: taskRefSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readNervConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const taskId =
        asString(asObject(input), 'taskId') ?? getActiveTaskId(runtimeContext.kv, runtimeContext.storageContextId)
      if (taskId === null) return { error: 'not_found', message: 'No coding task is running in this thread.' }
      const result = await callNerv(httpFetch, cfg, 'GET', `/tasks/${encodeURIComponent(taskId)}`)
      if (asObject(result)['error'] === undefined) refreshFromTaskDoc(runtimeContext, taskId, result)
      return result
    },
  }
}

export function listCodingTasksTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'list_coding_tasks',
    description: 'List supervised coding tasks created from this chat group, with their latest status and cost.',
    inputSchema: emptySchema,
    execute: async (_input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readNervConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const records = listRecords(runtimeContext.kv)
      // Unbounded Promise.all over the group's (small) record set: plugin code cannot import
      // p-limit (bare-module imports are rejected by discovery) and a hand-rolled worker pool
      // trips oxlint's no-await-in-loop; this matches acp's answer_permission fan-out precedent.
      const enriched = await Promise.all(
        records.map(async (record): Promise<unknown> => {
          const doc = await callNerv(httpFetch, cfg, 'GET', `/tasks/${encodeURIComponent(record.taskId)}`)
          const row = asObject(doc)
          if (row['error'] !== undefined)
            return {
              taskId: record.taskId,
              title: record.title,
              repos: record.repos,
              status: record.status ?? 'unknown',
            }
          refreshFromTaskDoc(runtimeContext, record.taskId, doc)
          return {
            taskId: record.taskId,
            title: record.title,
            repos: record.repos,
            status: optionalString(row, 'status') ?? record.status,
            ...(optionalString(row, 'mrUrl') === undefined ? {} : { mrUrl: optionalString(row, 'mrUrl') }),
            ...(asNumber(row, 'usageUsd') === null ? {} : { usageUsd: asNumber(row, 'usageUsd') }),
          }
        }),
      )
      return enriched
    },
  }
}
