// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  asObject,
  asPositiveInt,
  asString,
  callMagi,
  NOT_CONFIGURED,
  optionalString,
  readMagiConfig,
} from './client.js'
import type { HttpFetch } from './client.js'
import {
  answerPermissionSchema,
  emptySchema,
  finishSessionSchema,
  listSessionsSchema,
  reviewPrSchema,
  sessionIdSchema,
  startSessionSchema,
} from './schemas.js'

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
  codingSecrets: { resolve(): Record<string, string> | null; resolveForgeToken(): string | null }
  codingRepos: {
    list(): { name: string; baseBranch: string }[]
    get(name: string): { name: string; repoUrl: string; baseBranch: string; permissionPreset: string } | null
  }
}
type ToolExecute = (input: unknown, runtimeContext: RuntimeContext, options: unknown) => Promise<unknown>
export type Tool = { name: string; description: string; inputSchema: unknown; execute: ToolExecute }

const DEFAULT_AGENT = 'claude-code-acp'
const SESSION_FILTERS = ['new', 'active', 'waiting', 'review', 'done']
const DEFAULT_FINISH_MESSAGE = 'Apply changes from magi coding session'

export function sessionIdOf(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const map: Map<string, unknown> = new Map(Object.entries(result))
  const id = map.get('id')
  return typeof id === 'string' && id.length > 0 ? id : null
}

export function getTool(name: string, description: string, path: string, httpFetch: HttpFetch | undefined): Tool {
  return {
    name,
    description,
    inputSchema: emptySchema,
    execute: (_input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return Promise.resolve(NOT_CONFIGURED)
      return callMagi(httpFetch, cfg, 'GET', path)
    },
  }
}

type RepoEntry = { name: string; repoUrl: string; baseBranch: string; permissionPreset: string }

function buildProjectSpec(repo: RepoEntry): {
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: string
} {
  return {
    name: repo.name,
    repoUrl: repo.repoUrl,
    baseBranch: repo.baseBranch,
    permissionPreset: repo.permissionPreset,
  }
}

export function listProjectsTool(): Tool {
  return {
    name: 'list_projects',
    description: 'List coding projects configured in your repository catalogue.',
    inputSchema: emptySchema,
    execute: (_input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      return Promise.resolve(runtimeContext.codingRepos.list())
    },
  }
}

export function startSessionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'start_session',
    description: 'Start a sandboxed coding-agent session on a configured project.',
    inputSchema: startSessionSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const project = asString(args, 'project')
      const prompt = asString(args, 'prompt')
      if (project === null || prompt === null)
        return { error: 'invalid_input', message: 'project and prompt are required' }
      const repo = runtimeContext.codingRepos.get(project)
      if (repo === null)
        return {
          error: 'not_found',
          message: `No repository named "${project}". Add it in settings → Repositories.`,
        }
      const secrets = runtimeContext.codingSecrets.resolve()
      if (secrets === null)
        return {
          error: 'not_configured',
          message: 'Set up your AI provider key in settings → Coding sessions before starting a session.',
        }
      const forgeToken = runtimeContext.codingSecrets.resolveForgeToken()
      const agent = optionalString(args, 'agent') ?? DEFAULT_AGENT
      const projectSpec = buildProjectSpec(repo)
      const result = await callMagi(httpFetch, cfg, 'POST', '/sessions', {
        project,
        agent,
        contextId: runtimeContext.storageContextId,
        prompt,
        secrets,
        ...(forgeToken === null ? {} : { forgeToken }),
        projectSpec,
      })
      const id = sessionIdOf(result)
      if (id !== null) runtimeContext.kv.set(`session:${id}`, '1')
      return result
    },
  }
}

export function listSessionsTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'list_sessions',
    description: 'List coding sessions started from this chat (filter: new|active|waiting|review|done).',
    inputSchema: listSessionsSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const filter = optionalString(asObject(input), 'filter') ?? 'active'
      if (!SESSION_FILTERS.includes(filter))
        return { error: 'invalid_input', message: `filter must be one of ${SESSION_FILTERS.join(', ')}` }
      const result = await callMagi(httpFetch, cfg, 'GET', `/sessions?filter=${encodeURIComponent(filter)}`)
      if (!Array.isArray(result)) return result
      const known = new Set(runtimeContext.kv.list('session:').map((row): string => row.key.slice('session:'.length)))
      return result.filter((s): boolean => {
        const id = sessionIdOf(s)
        return id !== null && known.has(id)
      })
    },
  }
}

export function sessionStatusTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'session_status',
    description: 'Get the status and metadata of a coding session.',
    inputSchema: sessionIdSchema,
    execute: (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return Promise.resolve(NOT_CONFIGURED)
      const sessionId = asString(asObject(input), 'sessionId')
      if (sessionId === null) return Promise.resolve({ error: 'invalid_input', message: 'sessionId is required' })
      return callMagi(httpFetch, cfg, 'GET', `/sessions/${encodeURIComponent(sessionId)}`)
    },
  }
}

export function finishSessionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'finish_session',
    description: 'Finish a session: commit + push the branch, or open a PR.',
    inputSchema: finishSessionSchema,
    execute: (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return Promise.resolve(NOT_CONFIGURED)
      const forgeToken = runtimeContext.codingSecrets.resolveForgeToken()
      if (forgeToken === null)
        return Promise.resolve({
          error: 'not_configured',
          message: 'Connect a code host in settings → Coding sessions before pushing or opening a PR.',
        })
      const args = asObject(input)
      const sessionId = asString(args, 'sessionId')
      const action = asString(args, 'action')
      if (sessionId === null || (action !== 'push' && action !== 'pr'))
        return Promise.resolve({ error: 'invalid_input', message: 'sessionId and action (push|pr) are required' })
      const bodyFields: Record<string, string | undefined> = {
        message: optionalString(args, 'message') ?? DEFAULT_FINISH_MESSAGE,
        action,
        title: optionalString(args, 'title'),
        body: optionalString(args, 'body'),
      }
      const payload = {
        ...Object.fromEntries(Object.entries(bodyFields).filter(([, v]) => v !== undefined)),
        forgeToken,
      }
      return callMagi(httpFetch, cfg, 'POST', `/sessions/${encodeURIComponent(sessionId)}/finish`, payload)
    },
  }
}

export function cancelSessionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'cancel_session',
    description: 'Cancel a running coding session and tear down its sandbox.',
    inputSchema: sessionIdSchema,
    execute: (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return Promise.resolve(NOT_CONFIGURED)
      const sessionId = asString(asObject(input), 'sessionId')
      if (sessionId === null) return Promise.resolve({ error: 'invalid_input', message: 'sessionId is required' })
      return callMagi(httpFetch, cfg, 'POST', `/sessions/${encodeURIComponent(sessionId)}/cancel`)
    },
  }
}

export function answerPermissionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'answer_permission',
    description: 'Answer a coding agent pending permission request (allow or deny).',
    inputSchema: answerPermissionSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const sessionId = asString(args, 'sessionId')
      const decision = asString(args, 'decision')
      if (sessionId === null || (decision !== 'allow' && decision !== 'deny'))
        return { error: 'invalid_input', message: 'sessionId and decision (allow|deny) are required' }
      const pending = await callMagi(httpFetch, cfg, 'GET', `/sessions/${encodeURIComponent(sessionId)}/permissions`)
      if (!Array.isArray(pending)) return pending
      const toolCallIds = pending
        .map((p): string | null => asString(asObject(p), 'toolCallId'))
        .filter((id): id is string => id !== null)
      if (toolCallIds.length === 0) return { resolved: 0, message: 'no pending permission requests' }
      await Promise.all(
        toolCallIds.map(
          (toolCallId): Promise<unknown> =>
            callMagi(httpFetch, cfg, 'POST', `/sessions/${encodeURIComponent(sessionId)}/permission`, {
              toolCallId,
              decision,
            }),
        ),
      )
      return { resolved: toolCallIds.length, decision }
    },
  }
}

export function reviewPrTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'review_pr',
    description: 'Start a review session for an open pull/merge request; findings are posted as inline comments.',
    inputSchema: reviewPrSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const project = asString(args, 'project')
      const prNumber = asPositiveInt(args, 'prNumber')
      if (project === null || prNumber === null)
        return { error: 'invalid_input', message: 'project and a positive prNumber are required' }
      const repo = runtimeContext.codingRepos.get(project)
      if (repo === null)
        return {
          error: 'not_found',
          message: `No repository named "${project}". Add it in settings → Repositories.`,
        }
      const secrets = runtimeContext.codingSecrets.resolve()
      if (secrets === null)
        return {
          error: 'not_configured',
          message: 'Set up your AI provider key in settings → Coding sessions before starting a review.',
        }
      const forgeToken = runtimeContext.codingSecrets.resolveForgeToken()
      if (forgeToken === null)
        return {
          error: 'not_configured',
          message: 'Connect a code host in settings → Coding sessions before pushing or opening a PR.',
        }
      const projectSpec = buildProjectSpec(repo)
      const result = await callMagi(httpFetch, cfg, 'POST', '/reviews', {
        project,
        prNumber,
        contextId: runtimeContext.storageContextId,
        secrets,
        forgeToken,
        projectSpec,
      })
      const id = sessionIdOf(result)
      if (id !== null) runtimeContext.kv.set(`session:${id}`, '1')
      return result
    },
  }
}
