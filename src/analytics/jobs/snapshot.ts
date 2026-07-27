// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { and, eq, isNull } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsRekeyRuns, analyticsSnapshotPublications } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { resolveActive } from '../governance/generation-store.js'
import {
  getPublication,
  stageRekeySnapshotPublication,
  stageSnapshotPublication,
} from '../governance/snapshot-publication-store.js'
import type { RekeyCutoverFence } from '../rekey/cutover-fence.js'
import { runReconciliation } from './reconcile.js'
import { copyCuratedRows } from './snapshot-copy.js'
import type { SnapshotCopyResult } from './snapshot-copy.js'
import { collectSnapshotCanaries, scanSnapshotOutput } from './snapshot-scan.js'
import { createSnapshotSchema, SNAPSHOT_MODEL_VERSIONS } from './snapshot-schema.js'
import type { SnapshotMode } from './snapshot-schema.js'
import { assertSnapshotOutputPath, verifySnapshotFile } from './snapshot-verify.js'
import type { SnapshotMeta } from './snapshot-verify.js'

export { assertSnapshotOutputPath, verifySnapshotFile } from './snapshot-verify.js'
export type { SnapshotMeta } from './snapshot-verify.js'

const log = logger.child({ scope: 'analytics:jobs:snapshot' })

export type SnapshotFailurePoint = 'after_source_read' | 'after_schema' | 'during_insert'

export type SnapshotPublishDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  fence: RekeyCutoverFence
  nowMs: () => number
  snapshotId?: () => string
  injectFailure?: (point: SnapshotFailurePoint) => void
}>

export type SnapshotPublishInput = Readonly<{
  outputPath: string
  mode?: SnapshotMode
  replace?: boolean
  transitionRunId?: string
}>

export type SnapshotPublishResult = Readonly<{
  snapshotId: string
  path: string
  storageGeneration: string
  sourceHighWater: string
  sourceRowCount: number
  rowCounts: Readonly<Record<string, number>>
  reconciliationStatus: string
  pathHash: string
}>

const resolveGeneration = (
  input: SnapshotPublishInput,
  deps: SnapshotPublishDeps,
): { generation: string; release: () => void } => {
  if (input.transitionRunId !== undefined) {
    const active = resolveActive({ getDrizzleDb: deps.getDrizzleDb })
    const run = deps
      .getDrizzleDb()
      .select()
      .from(analyticsRekeyRuns)
      .where(eq(analyticsRekeyRuns.runId, input.transitionRunId))
      .get()
    if (run === undefined) throw new Error('transition run not found')
    if (run.status === 'completed' || run.status === 'aborted') throw new Error('transition run is terminal')
    if (run.targetGeneration !== active.generation) {
      throw new Error('rekey publication token requires the post-swap active generation')
    }
    return { generation: active.generation, release: () => undefined }
  }
  const admission = deps.fence.admit('snapshot')
  if (admission === null) throw new Error('snapshot staging refused: the cutover fence is held')
  try {
    const active = resolveActive({ getDrizzleDb: deps.getDrizzleDb })
    return { generation: active.generation, release: admission.release }
  } catch (error) {
    admission.release()
    throw error
  }
}

const insertMeta = (publishDb: Database, meta: SnapshotMeta): void => {
  publishDb
    .prepare(
      `INSERT INTO snapshot_meta (
         singleton_id, snapshot_id, created_at_ms, storage_generation, source_high_water,
         source_row_count, curated_row_counts_json, model_versions_json, reconciliation_status, snapshot_mode
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      meta.snapshotId,
      meta.createdAtMs,
      meta.storageGeneration,
      meta.sourceHighWater,
      meta.sourceRowCount,
      JSON.stringify(meta.curatedRowCounts),
      JSON.stringify(meta.modelVersions),
      meta.reconciliationStatus,
      meta.snapshotMode,
    )
}

const invalidateStagedRow = (snapshotId: string, deps: SnapshotPublishDeps, nowMs: number): void => {
  deps
    .getDrizzleDb()
    .update(analyticsSnapshotPublications)
    .set({ state: 'invalidated', invalidatedAt: nowMs })
    .where(eq(analyticsSnapshotPublications.snapshotId, snapshotId))
    .run()
}

/**
 * An ordinary staged row that was never promoted is an orphan: it was never
 * verified by a consumer, so a fresh publish invalidates it before claiming
 * the single staged slot (its file is reconciled by the consumer at startup).
 */
const invalidateOrphanedOrdinaryStage = (deps: SnapshotPublishDeps, nowMs: number): void => {
  const orphans = deps
    .getDrizzleDb()
    .select({ snapshotId: analyticsSnapshotPublications.snapshotId })
    .from(analyticsSnapshotPublications)
    .where(
      and(eq(analyticsSnapshotPublications.state, 'staged'), isNull(analyticsSnapshotPublications.transitionRunId)),
    )
    .all()
  for (const orphan of orphans) {
    log.warn('invalidating an orphaned ordinary staged publication before restaging')
    invalidateStagedRow(orphan.snapshotId, deps, nowMs)
  }
}

const buildStagingFile = (
  stagingPath: string,
  input: SnapshotPublishInput,
  generation: string,
  reconciliationStatus: string,
  deps: SnapshotPublishDeps,
): { copy: SnapshotCopyResult; snapshotId: string } => {
  const mode = input.mode ?? 'pseudonymous'
  const snapshotId = deps.snapshotId?.() ?? `snap-${deps.nowMs().toString(36)}-${randomUUID().slice(0, 8)}`
  writeFileSync(stagingPath, '', { mode: 0o600 })
  const publishDb = new Database(stagingPath)
  let copy: SnapshotCopyResult | null = null
  try {
    createSnapshotSchema(publishDb, mode)
    deps.injectFailure?.('after_schema')
    copy = deps.getDrizzleDb().transaction((tx) =>
      copyCuratedRows(tx, publishDb, {
        generation,
        nowMs: deps.nowMs(),
        mode,
        hooks: { afterEventsInsert: () => deps.injectFailure?.('during_insert') },
      }),
    )
    deps.injectFailure?.('after_source_read')
    insertMeta(publishDb, {
      snapshotId,
      createdAtMs: deps.nowMs(),
      storageGeneration: generation,
      sourceHighWater: copy.sourceHighWater,
      sourceRowCount: copy.sourceRowCount,
      curatedRowCounts: copy.rowCounts,
      modelVersions: SNAPSHOT_MODEL_VERSIONS,
      reconciliationStatus,
      snapshotMode: mode,
    })
    publishDb.run('VACUUM')
  } finally {
    publishDb.close()
  }
  if (copy === null) throw new Error('snapshot staging produced no rows')
  return { copy, snapshotId }
}

const scanStagingFile = (stagingPath: string, deps: SnapshotPublishDeps): void => {
  const scannedDb = new Database(stagingPath, { readonly: true })
  try {
    scanSnapshotOutput(scannedDb, collectSnapshotCanaries(deps.getDrizzleDb()))
  } finally {
    scannedDb.close()
  }
}

const stagePublicationRow = (
  input: SnapshotPublishInput,
  staged: Readonly<{ snapshotId: string; storageGeneration: string; pathHash: string; sourceHighWater: string }>,
  deps: SnapshotPublishDeps,
): void => {
  if (input.transitionRunId === undefined) {
    invalidateOrphanedOrdinaryStage(deps, deps.nowMs())
    stageSnapshotPublication({ ...staged, nowMs: deps.nowMs() }, { getDrizzleDb: deps.getDrizzleDb })
    return
  }
  stageRekeySnapshotPublication(
    { ...staged, transitionRunId: input.transitionRunId, nowMs: deps.nowMs() },
    { getDrizzleDb: deps.getDrizzleDb },
  )
}

const assertReplaceable = (input: SnapshotPublishInput): void => {
  if (existsSync(input.outputPath) && input.replace !== true) {
    throw new Error('snapshot output exists; pass replace to overwrite a previously valid snapshot')
  }
}

const renameStagedIntoPlace = (
  stagingPath: string,
  outputPath: string,
  snapshotId: string,
  deps: SnapshotPublishDeps,
): void => {
  try {
    renameSync(stagingPath, outputPath)
  } catch (error) {
    invalidateStagedRow(snapshotId, deps, deps.nowMs())
    throw error
  }
}

/**
 * Fresh-empty allowlisted snapshot publication. Reads the resolved active
 * generation in one consistent transaction under a cutover-fence admission,
 * builds a mode-0600 staging file, byte/schema/freelist-scans it, marks it
 * read-only, records a staged publication row, and atomically renames it into
 * place. Staging files are removed in `finally` on success and failure.
 */
export const publishAnalyticsSnapshot = (
  input: SnapshotPublishInput,
  deps: SnapshotPublishDeps,
): SnapshotPublishResult => {
  const dbPath = deps.getDrizzleDb().$client.filename
  assertSnapshotOutputPath(input.outputPath, typeof dbPath === 'string' && dbPath.length > 0 ? dbPath : null)
  const { generation, release } = resolveGeneration(input, deps)
  const stagingPath = `${input.outputPath}.staging-${randomUUID()}`
  let snapshotId: string | null = null
  let stagedRowWritten = false
  try {
    mkdirSync(dirname(input.outputPath), { recursive: true })
    const reconciliation = runReconciliation({ nowMs: deps.nowMs(), apply: false }, deps)
    const built = buildStagingFile(stagingPath, input, generation, reconciliation.status, deps)
    snapshotId = built.snapshotId
    scanStagingFile(stagingPath, deps)
    chmodSync(stagingPath, 0o444)
    const pathHash = createHash('sha256').update(readFileSync(stagingPath)).digest('hex')
    assertReplaceable(input)
    stagePublicationRow(
      input,
      { snapshotId, storageGeneration: generation, pathHash, sourceHighWater: built.copy.sourceHighWater },
      deps,
    )
    stagedRowWritten = true
    renameStagedIntoPlace(stagingPath, input.outputPath, snapshotId, deps)
    verifySnapshotFile(input.outputPath, { snapshotId, storageGeneration: generation })
    const publication = getPublication(snapshotId, { getDrizzleDb: deps.getDrizzleDb })
    if (publication === null || publication.state !== 'staged') {
      throw new Error('staged publication row is missing after rename')
    }
    log.info({ snapshotMode: input.mode ?? 'pseudonymous' }, 'snapshot staged and verified')
    return {
      snapshotId,
      path: input.outputPath,
      storageGeneration: generation,
      sourceHighWater: built.copy.sourceHighWater,
      sourceRowCount: built.copy.sourceRowCount,
      rowCounts: built.copy.rowCounts,
      reconciliationStatus: reconciliation.status,
      pathHash,
    }
  } finally {
    if (existsSync(stagingPath)) {
      if (stagedRowWritten && snapshotId !== null) invalidateStagedRow(snapshotId, deps, deps.nowMs())
      rmSync(stagingPath, { force: true })
    }
    release()
  }
}
