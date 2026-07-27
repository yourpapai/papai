// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import type { LlmUsageEventRow } from '../../db/llm-usage-events-schema.js'
import { analyticsBackfillRuns } from '../../db/schema.js'
import type { ToolCallEventRow } from '../../db/tool-call-events-schema.js'
import { logger } from '../../logger.js'
import type { RekeyCutoverFence } from '../rekey/cutover-fence.js'
import { completeBackfillRun, createBackfillRun, failBackfillRun } from '../storage/backfill-provenance-store.js'
import { applyBackfillDecision } from './backfill-apply.js'
import { routeFutureCanonicalDecision } from './backfill-canonical.js'
import {
  controlledModelRoleOf,
  decideLlmBackfillRow,
  decideToolBackfillRow,
  LLM_SOURCE_TABLE,
  TOOL_SOURCE_TABLE,
} from './backfill-decisions.js'
import type { BackfillDecision, BackfillSourceTable } from './backfill-decisions.js'
import { computeBound, formatHighWaterKey, hashHighWaterKey, readLlmBatch, readToolBatch } from './backfill-readers.js'
import type { BatchQuery, RowKey } from './backfill-readers.js'
import { rollbackBackfillRun } from './backfill-rollback.js'

export { routeFutureCanonicalDecision, rollbackBackfillRun, applyBackfillDecision }
export type { BackfillApplyContext } from './backfill-apply.js'
export type { FutureCanonicalInput, FutureCanonicalResult } from './backfill-canonical.js'
export type { RollbackResult } from './backfill-rollback.js'
export { hashHighWaterKey }

const log = logger.child({ scope: 'analytics:jobs:backfill' })

type Db = ReturnType<typeof defaultGetDrizzleDb>

export type BackfillSource = 'llm' | 'tool' | 'all'

export type BackfillJobInput = Readonly<{
  source: BackfillSource
  batchSize: number
  dryRun: boolean
  resume: boolean
  cutoffMs: number
  key: Buffer
  keyVersion: string
  nowMs: number
  runIdPrefix?: string
}>

export type BackfillDecisionCounts = Readonly<{
  canonical: number
  aggregateOnly: number
  ineligible: number
  rejected: number
}>

export type BackfillRunSummary = Readonly<{
  runId: string
  sourceTable: string
  status: 'dry_run' | 'completed' | 'failed' | 'requires_resume' | 'empty'
  highWaterKeyHash: string | null
  scanned: number
  decisions: BackfillDecisionCounts
  applied: number
  skipped: number
  byModelRole: Readonly<Record<string, number>>
}>

export type BackfillJobResult = Readonly<{ runs: readonly BackfillRunSummary[] }>

export type BackfillJobDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  fence?: RekeyCutoverFence
  hooks?: Readonly<{ afterBatch?: () => void }>
}>

type MutableCounts = {
  scanned: number
  canonical: number
  aggregateOnly: number
  ineligible: number
  rejected: number
  applied: number
  skipped: number
  byModelRole: Record<string, number>
}

const zeroCounts = (): MutableCounts => ({
  scanned: 0,
  canonical: 0,
  aggregateOnly: 0,
  ineligible: 0,
  rejected: 0,
  applied: 0,
  skipped: 0,
  byModelRole: {},
})

const recordDecision = (
  counts: MutableCounts,
  row: LlmUsageEventRow | ToolCallEventRow,
  decision: BackfillDecision,
): void => {
  if (decision.kind === 'canonical') counts.canonical += 1
  if (decision.kind === 'aggregate_only') {
    counts.aggregateOnly += 1
    const role = controlledModelRoleOf(row.modelRole)
    if (role !== null) counts.byModelRole[role] = (counts.byModelRole[role] ?? 0) + 1
  }
  if (decision.kind === 'ineligible') counts.ineligible += 1
  if (decision.kind === 'rejected') counts.rejected += 1
}

const toRunSummary = (
  runId: string,
  sourceTable: string,
  status: BackfillRunSummary['status'],
  highWaterKeyHash: string | null,
  counts: MutableCounts,
): BackfillRunSummary => ({
  runId,
  sourceTable,
  status,
  highWaterKeyHash,
  scanned: counts.scanned,
  decisions: {
    canonical: counts.canonical,
    aggregateOnly: counts.aggregateOnly,
    ineligible: counts.ineligible,
    rejected: counts.rejected,
  },
  applied: counts.applied,
  skipped: counts.skipped,
  byModelRole: counts.byModelRole,
})

const scanSource = <Row extends LlmUsageEventRow | ToolCallEventRow>(
  db: Db,
  input: BackfillJobInput,
  table: BackfillSourceTable,
  read: (db: Db, query: BatchQuery) => Row[],
  decide: (row: Row) => BackfillDecision,
  bound: RowKey,
  apply: boolean,
  runId: string,
  deps: BackfillJobDeps,
): MutableCounts => {
  const counts = zeroCounts()
  let cursor: RowKey | null = null
  for (;;) {
    const batch = read(db, { cutoffMs: input.cutoffMs, bound, cursor, limit: input.batchSize })
    if (batch.length === 0) break
    for (const row of batch) {
      counts.scanned += 1
      const decision = decide(row)
      recordDecision(counts, row, decision)
      if (apply) {
        const outcome = applyBackfillDecision(
          db,
          { runId, sourceTable: table, key: input.key, keyVersion: input.keyVersion },
          row,
          decision,
        )
        if (outcome === 'applied') counts.applied += 1
        else counts.skipped += 1
      }
      cursor = { occurredAt: row.occurredAt, eventId: row.eventId }
    }
    if (apply) deps.hooks?.afterBatch?.()
  }
  return counts
}

const scanForTable = (
  db: Db,
  input: BackfillJobInput,
  table: BackfillSourceTable,
  bound: RowKey,
  apply: boolean,
  runId: string,
  deps: BackfillJobDeps,
): MutableCounts =>
  table === LLM_SOURCE_TABLE
    ? scanSource(db, input, table, readLlmBatch, decideLlmBackfillRow, bound, apply, runId, deps)
    : scanSource(db, input, table, readToolBatch, decideToolBackfillRow, bound, apply, runId, deps)

const reopenRun = (db: Db, input: BackfillJobInput, runId: string, highWaterRowKey: string): void => {
  db.update(analyticsBackfillRuns)
    .set({
      status: 'running',
      highWaterRowKey,
      policyCutoffMs: input.cutoffMs,
      startedAtMs: input.nowMs,
      completedAtMs: null,
      failedAtMs: null,
    })
    .where(eq(analyticsBackfillRuns.runId, runId))
    .run()
}

const prepareRunRow = (
  db: Db,
  deps: BackfillJobDeps,
  input: BackfillJobInput,
  table: BackfillSourceTable,
  runId: string,
  highWater: string,
): 'ready' | 'requires_resume' => {
  const existing = db.select().from(analyticsBackfillRuns).where(eq(analyticsBackfillRuns.runId, runId)).get()
  if (existing !== undefined && existing.status !== 'completed' && !input.resume) {
    log.warn({ runId, status: existing.status }, 'backfill run requires explicit resume')
    return 'requires_resume'
  }
  if (existing === undefined) {
    createBackfillRun(
      {
        runId,
        sourceTable: table,
        highWaterRowKey: highWater,
        policyCutoffMs: input.cutoffMs,
        startedAtMs: input.nowMs,
      },
      { getDrizzleDb: deps.getDrizzleDb },
    )
    return 'ready'
  }
  reopenRun(db, input, runId, highWater)
  return 'ready'
}

const processSource = (
  input: BackfillJobInput,
  table: BackfillSourceTable,
  deps: BackfillJobDeps,
): BackfillRunSummary => {
  const db = deps.getDrizzleDb()
  const runId = `${input.runIdPrefix ?? 'backfill-v1'}:${table}`
  const bound = computeBound(db, table, input.cutoffMs)
  if (bound === null) return toRunSummary(runId, table, 'empty', null, zeroCounts())
  const highWater = formatHighWaterKey(bound, table, input.key, input.keyVersion)
  const highWaterKeyHash = hashHighWaterKey(highWater)
  if (input.dryRun) {
    return toRunSummary(
      runId,
      table,
      'dry_run',
      highWaterKeyHash,
      scanForTable(db, input, table, bound, false, runId, deps),
    )
  }
  if (prepareRunRow(db, deps, input, table, runId, highWater) === 'requires_resume') {
    return toRunSummary(runId, table, 'requires_resume', highWaterKeyHash, zeroCounts())
  }
  try {
    const counts = scanForTable(db, input, table, bound, true, runId, deps)
    completeBackfillRun(
      { runId, completedAtMs: input.nowMs, eventCount: counts.canonical, aggregateCount: counts.applied },
      { getDrizzleDb: deps.getDrizzleDb },
    )
    log.info({ runId, sourceTable: table, scanned: counts.scanned, applied: counts.applied }, 'backfill run completed')
    return toRunSummary(runId, table, 'completed', highWaterKeyHash, counts)
  } catch (error) {
    failBackfillRun({ runId, failedAtMs: input.nowMs }, { getDrizzleDb: deps.getDrizzleDb })
    log.warn({ runId, err: error instanceof Error ? error.message : String(error) }, 'backfill run failed')
    return toRunSummary(runId, table, 'failed', highWaterKeyHash, zeroCounts())
  }
}

export const runBackfillJob = (
  input: BackfillJobInput,
  deps: BackfillJobDeps = { getDrizzleDb: defaultGetDrizzleDb },
): BackfillJobResult => {
  const admission = input.dryRun ? null : deps.fence?.admit('backfill')
  if (!input.dryRun && deps.fence !== undefined && admission === null) {
    log.warn('backfill job skipped: the cutover fence is held')
    return { runs: [] }
  }
  try {
    const tables: BackfillSourceTable[] =
      input.source === 'all'
        ? [LLM_SOURCE_TABLE, TOOL_SOURCE_TABLE]
        : input.source === 'llm'
          ? [LLM_SOURCE_TABLE]
          : [TOOL_SOURCE_TABLE]
    return { runs: tables.map((table) => processSource(input, table, deps)) }
  } finally {
    admission?.release()
  }
}
