// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { AnalyticsEventV1 } from '../../src/analytics/contracts.js'
import { KeyVersionSchema, VersionStringSchema } from '../../src/analytics/controlled-types.js'
import { deriveCollectionRefKey, setEligibilityState } from '../../src/analytics/governance/collection-store.js'
import type { CollectionEligibilityRef } from '../../src/analytics/governance/eligibility.js'
import {
  decideLlmBackfillRow,
  decideToolBackfillRow,
  deriveBackfillSourceRef,
  LLM_SOURCE_TABLE,
} from '../../src/analytics/jobs/backfill-decisions.js'
import {
  applyBackfillDecision,
  rollbackBackfillRun,
  routeFutureCanonicalDecision,
  runBackfillJob,
} from '../../src/analytics/jobs/backfill.js'
import type { BackfillJobInput, FutureCanonicalInput } from '../../src/analytics/jobs/backfill.js'
import { normalize } from '../../src/analytics/normalizer.js'
import type { NormalizerEnv } from '../../src/analytics/normalizer.js'
import type { AnalyticsSourceContext } from '../../src/analytics/source-facts.js'
import { incrementCounter } from '../../src/analytics/storage/aggregate-store.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import type { LlmUsageEventRow } from '../../src/db/llm-usage-events-schema.js'
import * as schema from '../../src/db/schema.js'
import type { ToolCallEventRow } from '../../src/db/tool-call-events-schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const KEY = Buffer.alloc(32, 9)
const BASE_MS = 1_700_000_000_000
const DAY = '2023-11-14'

const ALL_DIMS = { platform: 'all', actorRole: 'all', taskProvider: 'all', appVersion: 'all' } as const

const backfillQuality = {
  finalized: false,
  partialDay: false,
  restartGapDetected: false,
  lateEventCount: 0,
  reconciliationStatus: 'complete_epoch' as const,
  disclosureScope: 'local_only',
  contributorBasis: 'not_required',
  contributorCount: null,
  threshold: null,
}

const counterCell = (
  contextType: 'dm' | 'group',
  metric: string,
): {
  utcDay: string
  definitionVersion: number
  contextType: string
  metric: string
  platform: string
  actorRole: string
  taskProvider: string
  appVersion: string
} => ({
  utcDay: DAY,
  definitionVersion: 1,
  contextType,
  metric,
  ...ALL_DIMS,
})

const counterValue = (db: Db, contextType: 'dm' | 'group', metric: string): number => {
  const cell = counterCell(contextType, metric)
  const match = db
    .select()
    .from(schema.analyticsDailyCounters)
    .all()
    .find(
      (r) =>
        r.utcDay === cell.utcDay &&
        r.contextType === cell.contextType &&
        r.metric === cell.metric &&
        r.platform === cell.platform &&
        r.actorRole === cell.actorRole &&
        r.taskProvider === cell.taskProvider &&
        r.appVersion === cell.appVersion,
    )
  return match?.value ?? 0
}

let llmSeq = 0
let toolSeq = 0

const llmRow = (over: Partial<LlmUsageEventRow>): LlmUsageEventRow => ({
  eventId: `llm-${llmSeq++}`,
  occurredAt: BASE_MS,
  turnId: 'turn-1',
  storageContextId: 'sc-1',
  contextType: 'dm',
  chatUserId: 'user-1',
  model: 'model-x',
  modelRole: 'main',
  inputTokens: 10,
  outputTokens: 20,
  stepCount: 1,
  toolCallCount: 0,
  messageCount: 1,
  finishReason: 'stop',
  durationMs: 100,
  responseId: null,
  error: null,
  forwardedAt: null,
  forwardAttempts: 0,
  forwardError: null,
  ...over,
})

const toolRow = (over: Partial<ToolCallEventRow>): ToolCallEventRow => ({
  eventId: `tool-${toolSeq++}`,
  turnId: 'turn-1',
  occurredAt: BASE_MS,
  storageContextId: 'sc-1',
  contextType: 'dm',
  chatUserId: 'user-1',
  model: 'model-x',
  modelRole: 'main',
  toolName: 'create_task',
  toolCallId: `call-${toolSeq}`,
  success: 1,
  durationMs: 50,
  errorType: null,
  errorCode: null,
  retryable: null,
  recovered: null,
  argsBytes: 10,
  resultBytes: 20,
  responseId: null,
  forwardedAt: null,
  forwardAttempts: 0,
  forwardError: null,
  ...over,
})

const LLM_FIXTURES = (): LlmUsageEventRow[] => [
  llmRow({ modelRole: 'main', error: null }),
  llmRow({ modelRole: 'main', error: 'provider boom', finishReason: null }),
  llmRow({ modelRole: 'small', error: null }),
  llmRow({ modelRole: 'small', error: 'distill boom' }),
  llmRow({ modelRole: 'embedding', turnId: null, error: null }),
  llmRow({ modelRole: 'embedding', turnId: null, error: 'embed boom', inputTokens: null }),
  llmRow({ modelRole: 'huge' }),
  llmRow({ durationMs: -1 }),
  llmRow({ storageContextId: '' }),
]

const TOOL_FIXTURES = (): ToolCallEventRow[] => [
  toolRow({}),
  toolRow({ success: 0, errorType: 'validation', errorCode: 'E1', retryable: 0, recovered: 0 }),
  toolRow({ success: 0, errorType: null, errorCode: null }),
  toolRow({ success: 0, errorType: 'rate_limit', retryable: 1, recovered: 0 }),
  toolRow({ success: 0, errorType: 'timeout', retryable: 0, recovered: 1 }),
  toolRow({ contextType: 'channel' }),
  toolRow({ success: 7 }),
]

const seedUsage = (db: Db): void => {
  for (const row of LLM_FIXTURES()) db.insert(schema.llmUsageEvents).values(row).run()
  for (const row of TOOL_FIXTURES()) db.insert(schema.toolCallEvents).values(row).run()
}

const jobInput = (over?: Partial<BackfillJobInput>): BackfillJobInput => ({
  source: 'all',
  batchSize: 100,
  dryRun: false,
  resume: false,
  cutoffMs: 0,
  key: KEY,
  keyVersion: 'v1',
  nowMs: BASE_MS + 86_400_000,
  ...over,
})

const countsOf = (
  db: Db,
): {
  runs: number
  events: number
  counters: number
  contributions: number
  eventMaps: number
  rejections: number
} => ({
  runs: db.select().from(schema.analyticsBackfillRuns).all().length,
  events: db.select().from(schema.analyticsEvents).all().length,
  counters: db.select().from(schema.analyticsDailyCounters).all().length,
  contributions: db.select().from(schema.analyticsBackfillAggregateContributions).all().length,
  eventMaps: db.select().from(schema.analyticsBackfillEventMap).all().length,
  rejections: db.select().from(schema.analyticsNormalizationRejections).all().length,
})

const insertLateEmbeddingRowOnce = (db: Db, state: { inserted: boolean }): void => {
  if (state.inserted) return
  state.inserted = true
  db.insert(schema.llmUsageEvents)
    .values(llmRow({ eventId: 'llm-late', occurredAt: BASE_MS + 60_000, modelRole: 'embedding', turnId: null }))
    .run()
}

const crashOnBatch = (state: { batches: number }, limit: number): (() => void) => {
  return () => {
    state.batches += 1
    if (state.batches === limit) throw new Error('simulated crash')
  }
}

describe('backfill decisions', () => {
  test('valid llm rows decide aggregate_only with terminal metric', () => {
    const success = decideLlmBackfillRow(llmRow({ error: null }))
    expect(success).toEqual({
      kind: 'aggregate_only',
      increments: [{ kind: 'counter', metric: 'llm_completed', delta: 1 }],
    })
    const failure = decideLlmBackfillRow(llmRow({ error: 'boom' }))
    expect(failure).toEqual({
      kind: 'aggregate_only',
      increments: [{ kind: 'counter', metric: 'llm_failed', delta: 1 }],
    })
    const embedding = decideLlmBackfillRow(llmRow({ modelRole: 'embedding', turnId: null }))
    expect(embedding.kind).toBe('aggregate_only')
  })

  test('invalid llm rows reject with exact controlled reasons', () => {
    expect(decideLlmBackfillRow(llmRow({ modelRole: 'huge' }))).toEqual({ kind: 'rejected', reason: 'unknown_enum' })
    expect(decideLlmBackfillRow(llmRow({ contextType: 'channel' }))).toEqual({
      kind: 'rejected',
      reason: 'unknown_enum',
    })
    expect(decideLlmBackfillRow(llmRow({ durationMs: -1 }))).toEqual({ kind: 'rejected', reason: 'invalid_value' })
    expect(decideLlmBackfillRow(llmRow({ inputTokens: -3 }))).toEqual({ kind: 'rejected', reason: 'invalid_value' })
    expect(decideLlmBackfillRow(llmRow({ occurredAt: -1 }))).toEqual({ kind: 'rejected', reason: 'invalid_value' })
    expect(decideLlmBackfillRow(llmRow({ storageContextId: '' }))).toEqual({
      kind: 'rejected',
      reason: 'missing_context',
    })
    expect(decideLlmBackfillRow(llmRow({ chatUserId: '' }))).toEqual({ kind: 'rejected', reason: 'missing_context' })
  })

  test('tool rows decide by persisted outcome incl. retry/recovery classification', () => {
    expect(decideToolBackfillRow(toolRow({}))).toEqual({
      kind: 'aggregate_only',
      increments: [{ kind: 'counter', metric: 'tool_semantic_success', delta: 1 }],
    })
    for (const variant of [
      { success: 0, errorType: 'validation', retryable: 0, recovered: 0 },
      { success: 0, errorType: null },
      { success: 0, errorType: 'rate_limit', retryable: 1, recovered: 0 },
      { success: 0, errorType: 'timeout', retryable: 0, recovered: 1 },
    ]) {
      expect(decideToolBackfillRow(toolRow(variant))).toEqual({
        kind: 'aggregate_only',
        increments: [{ kind: 'counter', metric: 'tool_failed', delta: 1 }],
      })
    }
  })

  test('invalid tool rows reject with exact controlled reasons', () => {
    expect(decideToolBackfillRow(toolRow({ contextType: 'channel' }))).toEqual({
      kind: 'rejected',
      reason: 'unknown_enum',
    })
    expect(decideToolBackfillRow(toolRow({ occurredAt: -5 }))).toEqual({ kind: 'rejected', reason: 'invalid_value' })
    expect(decideToolBackfillRow(toolRow({ success: 7 }))).toEqual({ kind: 'rejected', reason: 'invalid_value' })
    expect(decideToolBackfillRow(toolRow({ toolCallId: '' }))).toEqual({ kind: 'rejected', reason: 'missing_context' })
  })

  test('source reference is a keyed HMAC of table, event id, and decision name', () => {
    const a = deriveBackfillSourceRef({
      key: KEY,
      keyVersion: 'v1',
      sourceTable: 'llm_usage_events',
      sourceEventId: 'llm-0',
      decisionName: 'llm_completed',
    })
    expect(a).toMatch(/^v1\.[-_A-Za-z0-9]+$/u)
    expect(a).not.toContain('llm-0')
    const b = deriveBackfillSourceRef({
      key: KEY,
      keyVersion: 'v1',
      sourceTable: 'llm_usage_events',
      sourceEventId: 'llm-0',
      decisionName: 'llm_failed',
    })
    expect(b).not.toBe(a)
  })
})

describe('backfill job', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
    llmSeq = 0
    toolSeq = 0
  })

  test('dry-run counts sources and decisions without any writes', () => {
    seedUsage(db)
    const result = runBackfillJob(jobInput({ dryRun: true }), { getDrizzleDb: () => db })
    expect(result.runs).toHaveLength(2)
    const llm = result.runs.find((r) => r.sourceTable === 'llm_usage_events')
    const tool = result.runs.find((r) => r.sourceTable === 'tool_call_events')
    expect(llm?.status).toBe('dry_run')
    expect(llm?.scanned).toBe(9)
    expect(llm?.decisions).toEqual({ canonical: 0, aggregateOnly: 6, ineligible: 0, rejected: 3 })
    expect(llm?.byModelRole).toEqual({ main: 2, small: 2, embedding: 2 })
    expect(tool?.scanned).toBe(7)
    expect(tool?.decisions).toEqual({ canonical: 0, aggregateOnly: 5, ineligible: 0, rejected: 2 })
    expect(countsOf(db)).toEqual({ runs: 0, events: 0, counters: 0, contributions: 0, eventMaps: 0, rejections: 0 })
  })

  test('apply writes closed aggregate counters, rejections, and provenance only', () => {
    seedUsage(db)
    const result = runBackfillJob(jobInput(), { getDrizzleDb: () => db })
    for (const run of result.runs) expect(run.status).toBe('completed')
    expect(counterValue(db, 'dm', 'llm_completed')).toBe(3)
    expect(counterValue(db, 'dm', 'llm_failed')).toBe(3)
    expect(counterValue(db, 'dm', 'tool_semantic_success')).toBe(1)
    expect(counterValue(db, 'dm', 'tool_failed')).toBe(4)
    const dims = db.select().from(schema.analyticsDailyCounters).all()
    for (const row of dims) {
      expect(row.platform).toBe('all')
      expect(row.actorRole).toBe('all')
      expect(row.taskProvider).toBe('all')
      expect(row.appVersion).toBe('all')
      expect(['dm', 'group']).toContain(row.contextType)
    }
    const rejections = db.select().from(schema.analyticsNormalizationRejections).all()
    const byReason = new Map(rejections.map((r) => [`${r.sourceEventType}:${r.reason}`, r.count]))
    expect(byReason.get('llm_usage_event:unknown_enum')).toBe(1)
    expect(byReason.get('llm_usage_event:invalid_value')).toBe(1)
    expect(byReason.get('llm_usage_event:missing_context')).toBe(1)
    expect(byReason.get('tool_call_event:unknown_enum')).toBe(1)
    expect(byReason.get('tool_call_event:invalid_value')).toBe(1)
    const counts = countsOf(db)
    expect(counts.contributions).toBe(16)
    expect(counts.events).toBe(0)
    expect(counts.eventMaps).toBe(0)
    expect(counts.runs).toBe(2)
    const runs = db.select().from(schema.analyticsBackfillRuns).all()
    for (const run of runs) {
      expect(run.status).toBe('completed')
      expect(run.highWaterRowKey.length).toBeGreaterThan(0)
    }
  })

  test('current rows never create canonical events or invented unknown fields', () => {
    seedUsage(db)
    const result = runBackfillJob(jobInput(), { getDrizzleDb: () => db })
    for (const run of result.runs) {
      expect(run.decisions.canonical).toBe(0)
      expect(run.decisions.ineligible).toBe(0)
    }
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(0)
    const counters = db.select().from(schema.analyticsDailyCounters).all()
    for (const row of counters) {
      expect(row.platform).not.toBe('unknown')
      expect(row.actorRole).not.toBe('unknown')
      expect(row.taskProvider).not.toBe('unknown')
      expect(row.appVersion).not.toBe('unknown')
    }
  })

  test('keyset pagination in small batches yields identical totals', () => {
    seedUsage(db)
    const result = runBackfillJob(jobInput({ batchSize: 2 }), { getDrizzleDb: () => db })
    const llm = result.runs.find((r) => r.sourceTable === 'llm_usage_events')
    expect(llm?.scanned).toBe(9)
    expect(llm?.decisions.aggregateOnly).toBe(6)
    expect(counterValue(db, 'dm', 'llm_completed')).toBe(3)
    expect(countsOf(db).contributions).toBe(16)
  })

  test('interrupt after committed batches then resume yields identical decisions and no extras', () => {
    seedUsage(db)
    const state = { batches: 0 }
    const crashing = runBackfillJob(jobInput({ source: 'llm', batchSize: 1 }), {
      getDrizzleDb: () => db,
      hooks: { afterBatch: crashOnBatch(state, 2) },
    })
    expect(crashing.runs[0]?.status).toBe('failed')
    const partial = countsOf(db).contributions
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(9)

    const resumed = runBackfillJob(jobInput({ source: 'llm', batchSize: 1, resume: true }), { getDrizzleDb: () => db })
    expect(resumed.runs[0]?.status).toBe('completed')
    expect(resumed.runs[0]?.decisions).toEqual({ canonical: 0, aggregateOnly: 6, ineligible: 0, rejected: 3 })
    expect(counterValue(db, 'dm', 'llm_completed')).toBe(3)
    expect(counterValue(db, 'dm', 'llm_failed')).toBe(3)
    expect(countsOf(db).contributions).toBe(9)

    const rerun = runBackfillJob(jobInput({ source: 'llm', batchSize: 1 }), { getDrizzleDb: () => db })
    expect(rerun.runs[0]?.status).toBe('completed')
    expect(rerun.runs[0]?.applied).toBe(0)
    expect(rerun.runs[0]?.skipped).toBe(9)
    expect(countsOf(db).contributions).toBe(9)
    expect(counterValue(db, 'dm', 'llm_completed')).toBe(3)
  })

  test('running run requires explicit resume', () => {
    seedUsage(db)
    const state = { batches: 0 }
    runBackfillJob(jobInput({ source: 'llm', batchSize: 1 }), {
      getDrizzleDb: () => db,
      hooks: { afterBatch: crashOnBatch(state, 1) },
    })
    const refused = runBackfillJob(jobInput({ source: 'llm' }), { getDrizzleDb: () => db })
    expect(refused.runs[0]?.status).toBe('requires_resume')
    expect(refused.runs[0]?.applied).toBe(0)
  })

  test('high-water bound keeps run finite under concurrent live writes; next run observes later rows', () => {
    seedUsage(db)
    const state = { inserted: false }
    const first = runBackfillJob(jobInput({ source: 'llm', batchSize: 1 }), {
      getDrizzleDb: () => db,
      hooks: {
        afterBatch: () => insertLateEmbeddingRowOnce(db, state),
      },
    })
    expect(first.runs[0]?.status).toBe('completed')
    expect(first.runs[0]?.scanned).toBe(9)

    const incremental = runBackfillJob(jobInput({ source: 'llm' }), { getDrizzleDb: () => db })
    expect(incremental.runs[0]?.applied).toBe(1)
    expect(incremental.runs[0]?.skipped).toBe(9)
    expect(counterValue(db, 'dm', 'llm_completed')).toBe(4)

    const stable = runBackfillJob(jobInput({ source: 'llm' }), { getDrizzleDb: () => db })
    expect(stable.runs[0]?.applied).toBe(0)
    expect(stable.runs[0]?.skipped).toBe(10)
    expect(counterValue(db, 'dm', 'llm_completed')).toBe(4)
  })

  test('overlapping run applies nothing: contribution map belongs to the first applying run', () => {
    seedUsage(db)
    runBackfillJob(jobInput({ source: 'llm' }), { getDrizzleDb: () => db })
    const second = runBackfillJob(jobInput({ source: 'llm', runIdPrefix: 'backfill-v2' }), { getDrizzleDb: () => db })
    expect(second.runs[0]?.applied).toBe(0)
    expect(second.runs[0]?.skipped).toBe(9)
    const contributions = db.select().from(schema.analyticsBackfillAggregateContributions).all()
    expect(contributions).toHaveLength(9)
    for (const row of contributions) expect(row.runId).toBe('backfill-v1:llm_usage_events')
  })

  test('rollback removes exactly the run deltas and leaves pre-existing and live rows', () => {
    seedUsage(db)
    incrementCounter(
      { ...counterCell('dm', 'llm_completed'), delta: 5, ...backfillQuality },
      { getDrizzleDb: () => db },
    )
    runBackfillJob(jobInput({ source: 'llm' }), { getDrizzleDb: () => db })
    expect(counterValue(db, 'dm', 'llm_completed')).toBe(8)
    incrementCounter(
      { ...counterCell('dm', 'llm_completed'), delta: 2, ...backfillQuality },
      { getDrizzleDb: () => db },
    )

    const removed = rollbackBackfillRun({ runId: 'backfill-v1:llm_usage_events' }, { getDrizzleDb: () => db })
    expect(removed.removedContributions).toBe(9)
    expect(counterValue(db, 'dm', 'llm_completed')).toBe(7)
    expect(counterValue(db, 'dm', 'llm_failed')).toBe(0)
    expect(countsOf(db)).toEqual({ runs: 0, events: 0, counters: 1, contributions: 0, eventMaps: 0, rejections: 0 })

    const rerun = runBackfillJob(jobInput({ source: 'llm' }), { getDrizzleDb: () => db })
    expect(rerun.runs[0]?.applied).toBe(9)
    expect(counterValue(db, 'dm', 'llm_completed')).toBe(10)
  })

  test('non-consent approval cutoff excludes older rows entirely', () => {
    db.insert(schema.llmUsageEvents)
      .values(llmRow({ eventId: 'llm-old', occurredAt: BASE_MS - 10_000 }))
      .run()
    db.insert(schema.llmUsageEvents)
      .values(llmRow({ eventId: 'llm-new', occurredAt: BASE_MS + 10_000 }))
      .run()
    const result = runBackfillJob(jobInput({ source: 'llm', cutoffMs: BASE_MS }), { getDrizzleDb: () => db })
    expect(result.runs[0]?.scanned).toBe(1)
    expect(result.runs[0]?.decisions.aggregateOnly).toBe(1)
    const run = db.select().from(schema.analyticsBackfillRuns).all()[0]
    expect(run?.policyCutoffMs).toBe(BASE_MS)
  })

  test('persisted high-water key carries no raw source event id; resume decisions stay identical', () => {
    const seeded = LLM_FIXTURES()
    for (const row of seeded) db.insert(schema.llmUsageEvents).values(row).run()
    const first = runBackfillJob(jobInput({ source: 'llm' }), { getDrizzleDb: () => db })
    expect(first.runs[0]?.status).toBe('completed')
    const run = db.select().from(schema.analyticsBackfillRuns).all()[0]
    expect(run?.highWaterRowKey).toMatch(/^\d+:v1\.[-_A-Za-z0-9]+$/u)
    for (const row of seeded) expect(run?.highWaterRowKey).not.toContain(row.eventId)

    const resumed = runBackfillJob(jobInput({ source: 'llm', resume: true }), { getDrizzleDb: () => db })
    expect(resumed.runs[0]?.status).toBe('completed')
    expect(resumed.runs[0]?.decisions).toEqual(first.runs[0]?.decisions)
    expect(resumed.runs[0]?.applied).toBe(0)
    expect(resumed.runs[0]?.skipped).toBe(9)
  })

  test('ineligible decision writes exactly one provenance contribution and rerun skips it', () => {
    db.insert(schema.analyticsBackfillRuns)
      .values({
        runId: 'backfill-v1:llm_usage_events',
        sourceTable: 'llm_usage_events',
        highWaterRowKey: `${BASE_MS}:v1.hw`,
        policyCutoffMs: 0,
        status: 'running',
        startedAtMs: BASE_MS,
      })
      .run()
    const ctx = {
      runId: 'backfill-v1:llm_usage_events',
      sourceTable: LLM_SOURCE_TABLE,
      key: KEY,
      keyVersion: 'v1',
    } as const
    const decision = { kind: 'ineligible' as const, reason: 'preference_denied' as const }
    const row = llmRow({ eventId: 'llm-denied' })
    expect(applyBackfillDecision(db, ctx, row, decision)).toBe('applied')
    expect(applyBackfillDecision(db, ctx, row, decision)).toBe('skipped')
    const contributions = db.select().from(schema.analyticsBackfillAggregateContributions).all()
    expect(contributions).toHaveLength(1)
    expect(contributions[0]?.metric).toBe('ineligible:preference_denied')
    expect(contributions[0]?.delta).toBe(0)
    expect(countsOf(db).rejections).toBe(0)
  })
})

describe('future canonical branch', () => {
  let db: Db

  const env: NormalizerEnv = {
    hmacKey: KEY,
    keyVersion: KeyVersionSchema.parse('v1'),
    installId: 'install-uuid-1',
    appVersion: VersionStringSchema.parse('6.10.0'),
    policyVersion: 1,
    ingestedAtMs: BASE_MS + 500,
  }

  const memberSource: AnalyticsSourceContext = {
    platform: 'telegram',
    platformInstanceId: 'pi-1',
    chatUserId: 'user-42',
    nativeContextId: 'user-42',
    storageContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
    configContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
    contextType: 'dm',
    actorRole: 'member',
    taskInstanceId: null,
    taskProvider: 'none',
    invocationMode: 'normal',
    rawTurnId: 'turn-raw-1',
  }

  const futureEvent = (sourceEventId: string): AnalyticsEventV1 => {
    const result = normalize(
      {
        version: 1,
        type: 'llm_completed',
        sourceEventId,
        occurredAtMs: BASE_MS,
        source: memberSource,
        rawAttemptId: 'attempt-1',
        modelId: 'model-x',
        providerBinding: 'openai',
        modelRole: 'main',
        durationMs: 100,
        timeToFirstTokenMs: 50,
        inputTokens: 10,
        outputTokens: 20,
        stepCount: 1,
        finishReason: 'stop',
      },
      env,
    )
    if (result.status !== 'ok') throw new Error('fixture event must normalize')
    return {
      ...result.event,
      event: { ...result.event.event, source: 'backfill', attribution_quality: 'backfill_snapshot' },
    }
  }

  const allowRef = (database: Db): CollectionEligibilityRef => {
    const refKey = deriveCollectionRefKey({
      key: KEY,
      keyVersion: 'v1',
      platformInstanceId: 'pi-1',
      platformUserId: 'user-42',
    })
    const { generation } = setEligibilityState(
      { refKey, keyVersion: 'v1', state: 'allow', policyVersion: 1, nowMs: BASE_MS },
      { getDrizzleDb: () => database },
    )
    return { refKey, keyVersion: 'v1', generation }
  }

  const seedRun = (database: Db): void => {
    database
      .insert(schema.analyticsProcessEpochs)
      .values({ epochId: 'epoch-bf', state: 'open', startedAtMs: BASE_MS - 1000 })
      .run()
    database
      .insert(schema.analyticsBackfillRuns)
      .values({
        runId: 'backfill-v1:llm_usage_events',
        sourceTable: 'llm_usage_events',
        highWaterRowKey: `${BASE_MS}:llm-0`,
        policyCutoffMs: 0,
        status: 'running',
        startedAtMs: BASE_MS,
      })
      .run()
  }

  const canonicalInput = (database: Db, sourceEventId: string, cutoff = 0): FutureCanonicalInput => ({
    event: futureEvent(sourceEventId),
    collectionRef: allowRef(database),
    processEpochId: 'epoch-bf',
    runId: 'backfill-v1:llm_usage_events',
    sourceTable: LLM_SOURCE_TABLE,
    sourceRefKey: deriveBackfillSourceRef({
      key: KEY,
      keyVersion: 'v1',
      sourceTable: 'llm_usage_events',
      sourceEventId,
      decisionName: 'canonical:llm_completed',
    }),
    consentCutoffMs: cutoff,
  })

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
    seedRun(db)
  })

  test('routes through the fenced insertion and records the run map atomically', () => {
    const input = canonicalInput(db, 'llm-0')
    expect(routeFutureCanonicalDecision(input, { getDrizzleDb: () => db })).toBe('inserted')
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(1)
    const maps = db.select().from(schema.analyticsBackfillEventMap).all()
    expect(maps).toHaveLength(1)
    expect(maps[0]?.sourceRefKey).toBe(input.sourceRefKey)

    expect(routeFutureCanonicalDecision(canonicalInput(db, 'llm-0'), { getDrizzleDb: () => db })).toBe('already_mapped')
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(1)
  })

  test('deny-after-read before insert writes no canonical event and exactly one ineligible contribution', () => {
    const input = canonicalInput(db, 'llm-0')
    setEligibilityState(
      { refKey: input.collectionRef.refKey, keyVersion: 'v1', state: 'deny', policyVersion: 1, nowMs: BASE_MS + 1 },
      { getDrizzleDb: () => db },
    )
    expect(routeFutureCanonicalDecision(input, { getDrizzleDb: () => db })).toBe('not_eligible')
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsBackfillEventMap).all()).toHaveLength(0)
    const contributions = db.select().from(schema.analyticsBackfillAggregateContributions).all()
    expect(contributions).toHaveLength(1)
    expect(contributions[0]?.metric).toBe('ineligible:preference_denied')
    expect(contributions[0]?.sourceRefKey).toBe(input.sourceRefKey)
    expect(contributions[0]?.aggregateCellKey).toBe(`${DAY}|llm_usage_events|ineligible`)

    expect(routeFutureCanonicalDecision(canonicalInput(db, 'llm-0'), { getDrizzleDb: () => db })).toBe('already_mapped')
    expect(db.select().from(schema.analyticsBackfillAggregateContributions).all()).toHaveLength(1)
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(0)
  })

  test('pre-eligibility rows are never reconstructed', () => {
    const input = canonicalInput(db, 'llm-0', BASE_MS + 1)
    expect(routeFutureCanonicalDecision(input, { getDrizzleDb: () => db })).toBe('pre_eligibility')
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsBackfillEventMap).all()).toHaveLength(0)
  })

  test('rollback removes mapped canonical events created by the run', () => {
    routeFutureCanonicalDecision(canonicalInput(db, 'llm-0'), { getDrizzleDb: () => db })
    const removed = rollbackBackfillRun({ runId: 'backfill-v1:llm_usage_events' }, { getDrizzleDb: () => db })
    expect(removed.removedEvents).toBe(1)
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsBackfillEventMap).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsBackfillRuns).all()).toHaveLength(0)
  })
})
