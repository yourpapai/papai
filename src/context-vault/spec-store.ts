// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import {
  contextVaultFiles,
  contextVaultIndexerState,
  contextVaultSpecs,
  type ContextVaultFileRow,
} from '../db/context-vault-schema.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { logger } from '../logger.js'
import {
  aggregateSpec,
  reduceFileText,
  type AggregateFileInput,
  type ReducedFileArtifacts,
  type ReducedSpec,
} from './reducer.js'
import { enqueueSpecSummarization, type EnqueueSummarizationInput, type SummarizerFileInput } from './summarizer.js'

const log = logger.child({ scope: 'context-vault:spec-store' })

export interface PushFileInput {
  path: string
  kind: string
  hash: string
  mtime: number
  text?: string
}

export interface ApplyPushInput {
  repo: string
  changeName: string
  files: PushFileInput[]
  deletions: string[]
}

export interface ApplyPushResult {
  specId: string
  changedPaths: string[]
  deletedPaths: string[]
}

export interface ApplyPushDeps {
  enqueueSummarization: (input: EnqueueSummarizationInput) => void
}

const defaultApplyPushDeps: ApplyPushDeps = {
  enqueueSummarization: (input) => {
    enqueueSpecSummarization(input)
  },
}

const specIdOf = (repo: string, changeName: string): string => `${repo}:${changeName}`

const listFiles = (configContextId: string, specId: string): ContextVaultFileRow[] =>
  getDrizzleDb()
    .select()
    .from(contextVaultFiles)
    .where(and(eq(contextVaultFiles.configContextId, configContextId), eq(contextVaultFiles.specId, specId)))
    .all()

const computeSourceHash = (files: readonly ContextVaultFileRow[]): string => {
  const digest = createHash('sha256')
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    digest.update(`${f.path}${f.hash}\n`)
  }
  return digest.digest('hex')
}

const upsertSpec = (configContextId: string, input: ApplyPushInput, specId: string, reduced: ReducedSpec): void => {
  const files = listFiles(configContextId, specId)
  const mtime = files.reduce((max, f) => Math.max(max, f.mtime), 0)
  const sourceHash = computeSourceHash(files)
  const outline = JSON.stringify(reduced.outline)
  const existing = getDrizzleDb()
    .select({ id: contextVaultSpecs.id })
    .from(contextVaultSpecs)
    .where(and(eq(contextVaultSpecs.configContextId, configContextId), eq(contextVaultSpecs.id, specId)))
    .get()
  if (existing === undefined) {
    getDrizzleDb()
      .insert(contextVaultSpecs)
      .values({
        configContextId,
        id: specId,
        repo: input.repo,
        changeName: input.changeName,
        oneLine: '',
        outline,
        stage: reduced.stage,
        progressPct: reduced.progressPct,
        mtime,
        sourceHash,
      })
      .run()
    return
  }
  getDrizzleDb()
    .update(contextVaultSpecs)
    .set({ outline, stage: reduced.stage, progressPct: reduced.progressPct, mtime, sourceHash })
    .where(and(eq(contextVaultSpecs.configContextId, configContextId), eq(contextVaultSpecs.id, specId)))
    .run()
}

const deleteSpecShell = (configContextId: string, specId: string): void => {
  getDrizzleDb()
    .delete(contextVaultSpecs)
    .where(and(eq(contextVaultSpecs.configContextId, configContextId), eq(contextVaultSpecs.id, specId)))
    .run()
}

const touchIndexerState = (configContextId: string): void => {
  getDrizzleDb()
    .insert(contextVaultIndexerState)
    .values({ configContextId, lastPushAt: Date.now() })
    .onConflictDoUpdate({
      target: contextVaultIndexerState.configContextId,
      set: { lastPushAt: Date.now() },
    })
    .run()
}

const applyFile = (configContextId: string, specId: string, file: PushFileInput, exists: boolean): void => {
  const artifacts = artifactsOf(file)
  if (!exists) {
    getDrizzleDb()
      .insert(contextVaultFiles)
      .values({
        configContextId,
        specId,
        path: file.path,
        kind: file.kind,
        hash: file.hash,
        mtime: file.mtime,
        ...artifacts,
      })
      .run()
    return
  }
  getDrizzleDb()
    .update(contextVaultFiles)
    .set({ kind: file.kind, hash: file.hash, mtime: file.mtime, ...artifacts })
    .where(
      and(
        eq(contextVaultFiles.configContextId, configContextId),
        eq(contextVaultFiles.specId, specId),
        eq(contextVaultFiles.path, file.path),
      ),
    )
    .run()
}

const deleteFile = (configContextId: string, specId: string, path: string): void => {
  getDrizzleDb()
    .delete(contextVaultFiles)
    .where(
      and(
        eq(contextVaultFiles.configContextId, configContextId),
        eq(contextVaultFiles.specId, specId),
        eq(contextVaultFiles.path, path),
      ),
    )
    .run()
}

interface StoredArtifacts {
  outline: string | null
  tasksTicked: number | null
  tasksTotal: number | null
}

const artifactsOf = (file: PushFileInput): StoredArtifacts => {
  if (file.text === undefined) return { outline: null, tasksTicked: null, tasksTotal: null }
  const reduced: ReducedFileArtifacts = reduceFileText(file.kind, file.text)
  return { outline: JSON.stringify(reduced.outline), tasksTicked: reduced.ticked, tasksTotal: reduced.total }
}

const parseStoredOutline = (raw: string | null): string[] | null => {
  if (raw === null) return null
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) return null
  return parsed.filter((h): h is string => typeof h === 'string')
}

const toAggregateFile = (row: ContextVaultFileRow): AggregateFileInput => ({
  path: row.path,
  kind: row.kind,
  outline: parseStoredOutline(row.outline),
  ticked: row.tasksTicked,
  total: row.tasksTotal,
})

const buildAggregateInput = (
  input: ApplyPushInput,
  remaining: readonly ContextVaultFileRow[],
): AggregateFileInput[] => {
  const byPath = new Map(remaining.map((f) => [f.path, f]))
  const leftovers = new Set(byPath.keys())
  const files: AggregateFileInput[] = []
  for (const f of input.files) {
    const row = byPath.get(f.path)
    if (row === undefined) continue
    leftovers.delete(f.path)
    files.push(toAggregateFile(row))
  }
  for (const path of [...leftovers].sort((a, b) => a.localeCompare(b))) {
    const row = byPath.get(path)
    if (row !== undefined) files.push(toAggregateFile(row))
  }
  return files
}

const maybeEnqueueSummarization = (
  configContextId: string,
  specId: string,
  input: ApplyPushInput,
  changedFiles: readonly SummarizerFileInput[],
  deletedPaths: readonly string[],
  deps: ApplyPushDeps,
): void => {
  if (changedFiles.length === 0 && deletedPaths.length === 0) return
  deps.enqueueSummarization({ configContextId, specId, changeName: input.changeName, changedFiles, deletedPaths })
}

export function applyPush(
  configContextId: string,
  input: ApplyPushInput,
  deps: Partial<ApplyPushDeps> = {},
): ApplyPushResult {
  const mergedDeps: ApplyPushDeps = { ...defaultApplyPushDeps, ...deps }
  const specId = specIdOf(input.repo, input.changeName)
  const existingByPath = new Map(listFiles(configContextId, specId).map((f) => [f.path, f]))

  const changedPaths: string[] = []
  const changedFiles: SummarizerFileInput[] = []
  for (const file of input.files) {
    const existing = existingByPath.get(file.path)
    if (existing !== undefined && existing.hash === file.hash) continue
    applyFile(configContextId, specId, file, existing !== undefined)
    changedPaths.push(file.path)
    changedFiles.push({ path: file.path, kind: file.kind, text: file.text })
  }

  const deletedPaths: string[] = []
  for (const path of input.deletions) {
    if (!existingByPath.has(path)) continue
    deleteFile(configContextId, specId, path)
    deletedPaths.push(path)
  }

  const remaining = listFiles(configContextId, specId)
  if (remaining.length === 0) {
    deleteSpecShell(configContextId, specId)
  } else {
    const reduced = aggregateSpec({ changeName: input.changeName, files: buildAggregateInput(input, remaining) })
    upsertSpec(configContextId, input, specId, reduced)
  }
  touchIndexerState(configContextId)

  maybeEnqueueSummarization(configContextId, specId, input, changedFiles, deletedPaths, mergedDeps)

  log.info(
    { configContextId, specId, changed: changedPaths.length, deleted: deletedPaths.length },
    'Context vault push applied',
  )
  return { specId, changedPaths, deletedPaths }
}
