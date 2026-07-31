// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import type { AnalyticsEventV1 } from '../../src/analytics/contracts.js'
import { llmCompletedFixture } from '../../src/analytics/contracts.js'
import { PseudonymSchema } from '../../src/analytics/controlled-types.js'
import { deriveCollectionRefKey, setEligibilityState } from '../../src/analytics/governance/collection-store.js'
import { deriveBackfillSourceRef } from '../../src/analytics/jobs/backfill-decisions.js'
import { routeFutureCanonicalDecision, runBackfillJob } from '../../src/analytics/jobs/backfill.js'
import { runReconciliation } from '../../src/analytics/jobs/reconcile.js'
import {
  closeEpoch,
  incrementEpochSourceCounter,
  markEpochStale,
  openEpoch,
} from '../../src/analytics/storage/epoch-store.js'
import { insertCanonicalEventRow } from '../../src/analytics/storage/event-store.js'
import type { LlmUsageEventRow } from '../../src/db/llm-usage-events-schema.js'
import * as schema from '../../src/db/schema.js'
import type { ToolCallEventRow } from '../../src/db/tool-call-events-schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const isLlmDayRow = (row: { sourceTable: string; utcDay: string }): boolean =>
  row.sourceTable === 'llm_usage_events' && row.utcDay === DAY

const firstRefKeyOf = (rows: readonly { sourceRefKey: string }[]): string => rows[0]?.sourceRefKey ?? ''

const KEY = Buffer.alloc(32, 4)
const BASE_MS = 1_700_000_000_000
const DAY = '2023-11-14'
const DAY_MS = 86_400_000
const ACTIVE_GENERATION = 'gen-1'

const llmRow = (over: Partial<LlmUsageEventRow>): LlmUsageEventRow => ({
  eventId: 'llm-x',
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
  eventId: 'tool-x',
  turnId: 'turn-1',
  occurredAt: BASE_MS,
  storageContextId: 'sc-1',
  contextType: 'dm',
  chatUserId: 'user-1',
  model: 'model-x',
  modelRole: 'main',
  toolName: 'create_task',
  toolCallId: 'call-1',
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

const makeEvent = (eventId: string, occurredAtMs: number): AnalyticsEventV1 => ({
  ...llmCompletedFixture,
  event: {
    ...llmCompletedFixture.event,
    id: PseudonymSchema.parse(eventId),
    occurred_at_ms: occurredAtMs,
    attribution_quality: 'backfill_snapshot',
  },
})

const insertEvent = (
  db: Db,
  input: { eventId: string; generation?: string; epochId: string; occurredAtMs?: number },
): string => {
  const event = makeEvent(input.eventId, input.occurredAtMs ?? BASE_MS)
  const result = insertCanonicalEventRow(db, {
    storageGeneration: input.generation ?? ACTIVE_GENERATION,
    processEpochId: input.epochId,
    sourceRefKey: event.event.id,
    sourceKind: 'live',
    expiresAtMs: event.event.occurred_at_ms + DAY_MS,
    event,
  })
  return result.eventId
}

const insertSink = (db: Db, sinkVersionId: string): void => {
  db.insert(schema.analyticsSinks)
    .values({
      sinkVersionId,
      logicalSinkId: `logical-${sinkVersionId}`,
      version: 1,
      kind: 'webhook',
      state: 'disabled',
      payloadSchemaVersion: 1,
      egressMode: 'pseudonymous',
      endpointCiphertext: 'ct-endpoint',
      secretCiphertext: 'ct-secret',
      configFingerprint: `fp-${sinkVersionId}`,
      createdAtMs: BASE_MS,
    })
    .run()
}

const insertDelivery = (db: Db, eventId: string, sinkVersionId: string, state: string): void => {
  db.insert(schema.analyticsDeliveries)
    .values({
      eventId,
      sinkVersionId,
      grantKey: 'grant-1',
      grantKeyVersion: 'v1',
      grantGeneration: 1,
      state,
      attempts: 0,
      nextAttemptAtMs: BASE_MS,
      payloadSchemaVersion: 1,
    })
    .run()
}

const seedDurableFixture = (db: Db): void => {
  for (const row of [
    llmRow({ eventId: 'llm-a' }),
    llmRow({ eventId: 'llm-b', error: 'boom' }),
    llmRow({ eventId: 'llm-c', modelRole: 'huge' }),
  ]) {
    db.insert(schema.llmUsageEvents).values(row).run()
  }
  runBackfillJob(
    {
      source: 'llm',
      batchSize: 100,
      dryRun: false,
      resume: false,
      cutoffMs: 0,
      key: KEY,
      keyVersion: 'v1',
      nowMs: BASE_MS + DAY_MS,
    },
    { getDrizzleDb: () => db },
  )
  db.insert(schema.llmUsageEvents)
    .values(llmRow({ eventId: 'llm-canonical' }))
    .run()
  db.insert(schema.llmUsageEvents)
    .values(llmRow({ eventId: 'llm-ineligible' }))
    .run()

  db.insert(schema.analyticsProcessEpochs)
    .values({ epochId: 'epoch-bf', state: 'open', startedAtMs: BASE_MS - 1000 })
    .run()
  const refKey = deriveCollectionRefKey({
    key: KEY,
    keyVersion: 'v1',
    platformInstanceId: 'pi-1',
    platformUserId: 'user-42',
  })
  const { generation } = setEligibilityState(
    { refKey, keyVersion: 'v1', state: 'allow', policyVersion: 1, nowMs: BASE_MS },
    { getDrizzleDb: () => db },
  )
  const canonical = routeFutureCanonicalDecision(
    {
      event: makeEvent('v1.p-canonical-bf', BASE_MS),
      collectionRef: { refKey, keyVersion: 'v1', generation },
      processEpochId: 'epoch-bf',
      runId: 'backfill-v1:llm_usage_events',
      sourceTable: 'llm_usage_events',
      sourceRefKey: deriveBackfillSourceRef({
        key: KEY,
        keyVersion: 'v1',
        sourceTable: 'llm_usage_events',
        sourceEventId: 'llm-canonical',
        decisionName: 'canonical:llm_completed',
      }),
      consentCutoffMs: 0,
    },
    { getDrizzleDb: () => db },
  )
  expect(canonical).toBe('inserted')
  setEligibilityState(
    { refKey, keyVersion: 'v1', state: 'deny', policyVersion: 1, nowMs: BASE_MS + 1 },
    { getDrizzleDb: () => db },
  )
  const denied = routeFutureCanonicalDecision(
    {
      event: makeEvent('v1.p-ineligible-bf', BASE_MS),
      collectionRef: { refKey, keyVersion: 'v1', generation },
      processEpochId: 'epoch-bf',
      runId: 'backfill-v1:llm_usage_events',
      sourceTable: 'llm_usage_events',
      sourceRefKey: deriveBackfillSourceRef({
        key: KEY,
        keyVersion: 'v1',
        sourceTable: 'llm_usage_events',
        sourceEventId: 'llm-ineligible',
        decisionName: 'canonical:llm_completed',
      }),
      consentCutoffMs: 0,
    },
    { getDrizzleDb: () => db },
  )
  expect(denied).toBe('not_eligible')
  closeEpoch({ epochId: 'epoch-bf', closedAtMs: BASE_MS + 1000 }, { getDrizzleDb: () => db })
}

describe('durable usage reconciliation', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
  })

  test('durable-source equation holds exactly across all four decision kinds', () => {
    seedDurableFixture(db)
    const report = runReconciliation({ nowMs: BASE_MS + DAY_MS, apply: false }, { getDrizzleDb: () => db })
    expect(report.status).toBe('reconciled')
    expect(report.durableUsage.unexplainedDeltaTotal).toBe(0)
    const day = report.durableUsage.perSourceDay.find(isLlmDayRow)
    expect(day).toEqual({
      sourceTable: 'llm_usage_events',
      utcDay: DAY,
      usageRows: 5,
      canonical: 1,
      rejected: 1,
      ineligible: 1,
      aggregateOnly: 2,
      unexplainedDelta: 0,
    })
    expect(report.durableUsage.breakdowns.perModelRole['main']).toBe(4)
  })

  test('rerunning a denied-canonical decision records nothing new and the equation still closes', () => {
    seedDurableFixture(db)
    const before = db.select().from(schema.analyticsBackfillAggregateContributions).all().length
    const refKey = deriveCollectionRefKey({
      key: KEY,
      keyVersion: 'v1',
      platformInstanceId: 'pi-1',
      platformUserId: 'user-42',
    })
    const rerun = routeFutureCanonicalDecision(
      {
        event: makeEvent('v1.p-ineligible-bf', BASE_MS),
        collectionRef: { refKey, keyVersion: 'v1', generation: 1 },
        processEpochId: 'epoch-bf',
        runId: 'backfill-v1:llm_usage_events',
        sourceTable: 'llm_usage_events',
        sourceRefKey: deriveBackfillSourceRef({
          key: KEY,
          keyVersion: 'v1',
          sourceTable: 'llm_usage_events',
          sourceEventId: 'llm-ineligible',
          decisionName: 'canonical:llm_completed',
        }),
        consentCutoffMs: 0,
      },
      { getDrizzleDb: () => db },
    )
    expect(rerun).toBe('already_mapped')
    expect(db.select().from(schema.analyticsBackfillAggregateContributions).all()).toHaveLength(before)
    const report = runReconciliation({ nowMs: BASE_MS + DAY_MS, apply: false }, { getDrizzleDb: () => db })
    expect(report.status).toBe('reconciled')
    expect(report.durableUsage.unexplainedDeltaTotal).toBe(0)
  })

  test('losing a provenance row produces an unexplained delta', () => {
    seedDurableFixture(db)
    const contributions = db.select().from(schema.analyticsBackfillAggregateContributions).all()
    expect(contributions.length).toBeGreaterThan(0)
    const sourceRefKey = firstRefKeyOf(contributions)
    db.delete(schema.analyticsBackfillAggregateContributions)
      .where(eq(schema.analyticsBackfillAggregateContributions.sourceRefKey, sourceRefKey))
      .run()
    const report = runReconciliation({ nowMs: BASE_MS + DAY_MS, apply: false }, { getDrizzleDb: () => db })
    expect(report.status).toBe('delta')
    expect(report.durableUsage.unexplainedDeltaTotal).toBe(1)
  })

  test('tool rows reconcile with per-domain breakdown', () => {
    db.insert(schema.toolCallEvents)
      .values(toolRow({ eventId: 'tool-a' }))
      .run()
    db.insert(schema.toolCallEvents)
      .values(toolRow({ eventId: 'tool-b', success: 0 }))
      .run()
    runBackfillJob(
      {
        source: 'tool',
        batchSize: 100,
        dryRun: false,
        resume: false,
        cutoffMs: 0,
        key: KEY,
        keyVersion: 'v1',
        nowMs: BASE_MS + DAY_MS,
      },
      { getDrizzleDb: () => db },
    )
    const report = runReconciliation({ nowMs: BASE_MS + DAY_MS, apply: false }, { getDrizzleDb: () => db })
    expect(report.durableUsage.unexplainedDeltaTotal).toBe(0)
    expect(report.durableUsage.breakdowns.perToolDomain['task']).toBe(2)
  })
})

describe('live epoch reconciliation', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
  })

  const seedClosedCompleteEpoch = (database: Db, epochId: string): void => {
    openEpoch({ epochId, startedAtMs: BASE_MS - 1000 }, { getDrizzleDb: () => database })
    for (const [disposition, value] of [
      ['opportunity', 2],
      ['canonical', 1],
      ['aggregate_only', 1],
    ] as const) {
      incrementEpochSourceCounter(
        { epochId, utcDay: DAY, sourceFamily: 'llm', disposition, value },
        { getDrizzleDb: () => database },
      )
    }
    insertEvent(database, { eventId: 'v1.p-live-ok', epochId })
    database
      .insert(schema.analyticsAggregateEpochContributions)
      .values({
        epochId,
        aggregateCellKey: `${DAY}|cell|llm_completed`,
        measureKind: 'counter',
        counterDelta: 1,
        sampleCountDelta: 0,
        sumDelta: 0,
        fixedBucketCountsDeltaJson: '[]',
      })
      .run()
    closeEpoch({ epochId, closedAtMs: BASE_MS + 1000 }, { getDrizzleDb: () => database })
  }

  test('clean closed epoch reconciles to zero and stays publishable', () => {
    seedClosedCompleteEpoch(db, 'epoch-clean')
    const report = runReconciliation({ nowMs: BASE_MS + DAY_MS, apply: false }, { getDrizzleDb: () => db })
    expect(report.status).toBe('reconciled')
    const epoch = report.liveEpochs.find((row) => row.epochId === 'epoch-clean')
    expect(epoch?.status).toBe('publishable')
    expect(epoch?.unexplainedDelta).toBe(0)
  })

  test('closed epoch with imbalanced dispositions is a delta, not a gap', () => {
    openEpoch({ epochId: 'epoch-imbalanced', startedAtMs: BASE_MS - 1000 }, { getDrizzleDb: () => db })
    incrementEpochSourceCounter(
      { epochId: 'epoch-imbalanced', utcDay: DAY, sourceFamily: 'llm', disposition: 'opportunity', value: 2 },
      { getDrizzleDb: () => db },
    )
    incrementEpochSourceCounter(
      { epochId: 'epoch-imbalanced', utcDay: DAY, sourceFamily: 'llm', disposition: 'canonical', value: 1 },
      { getDrizzleDb: () => db },
    )
    insertEvent(db, { eventId: 'v1.p-live-partial', epochId: 'epoch-imbalanced' })
    closeEpoch({ epochId: 'epoch-imbalanced', closedAtMs: BASE_MS + 1000 }, { getDrizzleDb: () => db })
    const report = runReconciliation({ nowMs: BASE_MS + DAY_MS, apply: false }, { getDrizzleDb: () => db })
    expect(report.status).toBe('delta')
    const epoch = report.liveEpochs.find((row) => row.epochId === 'epoch-imbalanced')
    expect(epoch?.status).toBe('delta')
  })

  test('canonical terms ignore shadow and retired generations', () => {
    openEpoch({ epochId: 'epoch-shadow', startedAtMs: BASE_MS - 1000 }, { getDrizzleDb: () => db })
    incrementEpochSourceCounter(
      { epochId: 'epoch-shadow', utcDay: DAY, sourceFamily: 'llm', disposition: 'opportunity', value: 1 },
      { getDrizzleDb: () => db },
    )
    incrementEpochSourceCounter(
      { epochId: 'epoch-shadow', utcDay: DAY, sourceFamily: 'llm', disposition: 'canonical', value: 1 },
      { getDrizzleDb: () => db },
    )
    insertEvent(db, { eventId: 'v1.p-live-shadow', epochId: 'epoch-shadow', generation: 'gen-shadow' })
    closeEpoch({ epochId: 'epoch-shadow', closedAtMs: BASE_MS + 1000 }, { getDrizzleDb: () => db })
    const report = runReconciliation({ nowMs: BASE_MS + DAY_MS, apply: false }, { getDrizzleDb: () => db })
    const epoch = report.liveEpochs.find((row) => row.epochId === 'epoch-shadow')
    expect(epoch?.status).toBe('delta')
  })

  test('closed epoch with unconserved aggregate contributions is a delta', () => {
    openEpoch({ epochId: 'epoch-agg', startedAtMs: BASE_MS - 1000 }, { getDrizzleDb: () => db })
    incrementEpochSourceCounter(
      { epochId: 'epoch-agg', utcDay: DAY, sourceFamily: 'llm', disposition: 'opportunity', value: 1 },
      { getDrizzleDb: () => db },
    )
    incrementEpochSourceCounter(
      { epochId: 'epoch-agg', utcDay: DAY, sourceFamily: 'llm', disposition: 'aggregate_only', value: 1 },
      { getDrizzleDb: () => db },
    )
    db.insert(schema.analyticsAggregateEpochContributions)
      .values({
        epochId: 'epoch-agg',
        aggregateCellKey: `${DAY}|cell|llm_completed`,
        measureKind: 'counter',
        counterDelta: 2,
        sampleCountDelta: 0,
        sumDelta: 0,
        fixedBucketCountsDeltaJson: '[]',
      })
      .run()
    closeEpoch({ epochId: 'epoch-agg', closedAtMs: BASE_MS + 1000 }, { getDrizzleDb: () => db })
    const report = runReconciliation({ nowMs: BASE_MS + DAY_MS, apply: false }, { getDrizzleDb: () => db })
    const epoch = report.liveEpochs.find((row) => row.epochId === 'epoch-agg')
    expect(epoch?.status).toBe('delta')
  })

  const seedFinalizedBucket = (database: Db, utcDay: string): void => {
    database
      .insert(schema.analyticsDailyCounters)
      .values({
        utcDay,
        definitionVersion: 1,
        platform: 'telegram',
        contextType: 'dm',
        actorRole: 'admin',
        taskProvider: 'none',
        appVersion: '6.10.0',
        metric: 'llm_completed',
        value: 3,
        finalized: true,
        partialDay: false,
        restartGapDetected: false,
        lateEventCount: 0,
        reconciliationStatus: 'complete_epoch',
        disclosureScope: 'local_only',
        contributorBasis: 'eligible_actor',
        contributorCount: 2,
        threshold: null,
      })
      .run()
  }

  const bucketRow = (database: Db, utcDay: string): typeof schema.analyticsDailyCounters.$inferSelect | undefined =>
    database.select().from(schema.analyticsDailyCounters).where(eq(schema.analyticsDailyCounters.utcDay, utcDay)).get()

  test('unclean restart marks intersecting buckets unreconciled_restart_gap and overturns finalized', () => {
    seedFinalizedBucket(db, DAY)
    openEpoch({ epochId: 'epoch-crash', startedAtMs: BASE_MS - 1000 }, { getDrizzleDb: () => db })
    markEpochStale({ epochId: 'epoch-crash', staleAtMs: BASE_MS + 1000 }, { getDrizzleDb: () => db })
    const report = runReconciliation({ nowMs: BASE_MS + DAY_MS, apply: true }, { getDrizzleDb: () => db })
    expect(report.status).toBe('gap')
    const epoch = report.liveEpochs.find((row) => row.epochId === 'epoch-crash')
    expect(epoch?.status).toBe('unreconciled_restart_gap')
    expect(epoch?.publishableTotal).toBeNull()
    const bucket = bucketRow(db, DAY)
    expect(bucket?.finalized).toBe(false)
    expect(bucket?.restartGapDetected).toBe(true)
    expect(bucket?.reconciliationStatus).toBe('unreconciled_restart_gap')
    expect(bucket?.contributorCount).toBeNull()
  })

  test('open epoch is also a restart gap window', () => {
    seedFinalizedBucket(db, DAY)
    openEpoch({ epochId: 'epoch-open', startedAtMs: BASE_MS - 1000 }, { getDrizzleDb: () => db })
    const report = runReconciliation({ nowMs: BASE_MS + 1000, apply: true }, { getDrizzleDb: () => db })
    expect(report.status).toBe('gap')
    expect(bucketRow(db, DAY)?.reconciliationStatus).toBe('unreconciled_restart_gap')
  })

  test('crash across the UTC boundary suppresses both days while clean prior epoch stays publishable', () => {
    seedFinalizedBucket(db, DAY)
    seedFinalizedBucket(db, '2023-11-15')
    seedClosedCompleteEpoch(db, 'epoch-clean')
    openEpoch({ epochId: 'epoch-midnight', startedAtMs: BASE_MS + 4_600_000 }, { getDrizzleDb: () => db })
    markEpochStale({ epochId: 'epoch-midnight', staleAtMs: BASE_MS + 8_200_000 }, { getDrizzleDb: () => db })
    const report = runReconciliation({ nowMs: BASE_MS + 2 * DAY_MS, apply: true }, { getDrizzleDb: () => db })
    expect(report.status).toBe('gap')
    const midnight = report.liveEpochs.find((row) => row.epochId === 'epoch-midnight')
    expect(midnight?.status).toBe('unreconciled_restart_gap')
    expect(midnight?.gapDays).toEqual([DAY, '2023-11-15'])
    expect(bucketRow(db, DAY)?.reconciliationStatus).toBe('unreconciled_restart_gap')
    expect(bucketRow(db, '2023-11-15')?.reconciliationStatus).toBe('unreconciled_restart_gap')
    expect(report.liveEpochs.find((row) => row.epochId === 'epoch-clean')?.status).toBe('publishable')
  })
})

describe('delivery reconciliation', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
    openEpoch({ epochId: 'epoch-delivery', startedAtMs: BASE_MS - 1000 }, { getDrizzleDb: () => db })
  })

  test('unique pairs conserve across all states incl. sending and ambiguous; shadow excluded', () => {
    const active1 = insertEvent(db, { eventId: 'v1.p-del-1', epochId: 'epoch-delivery' })
    const active2 = insertEvent(db, { eventId: 'v1.p-del-2', epochId: 'epoch-delivery' })
    const shadow = insertEvent(db, { eventId: 'v1.p-del-3', epochId: 'epoch-delivery', generation: 'gen-shadow' })
    for (const sink of ['sv-1', 'sv-2', 'sv-3']) insertSink(db, sink)
    insertDelivery(db, active1, 'sv-1', 'pending')
    insertDelivery(db, active1, 'sv-2', 'sending')
    insertDelivery(db, active1, 'sv-3', 'ambiguous')
    insertDelivery(db, active2, 'sv-1', 'delivered')
    insertDelivery(db, active2, 'sv-2', 'dead')
    insertDelivery(db, active2, 'sv-3', 'leased')
    insertDelivery(db, shadow, 'sv-1', 'pending')
    const report = runReconciliation({ nowMs: BASE_MS + DAY_MS, apply: false }, { getDrizzleDb: () => db })
    expect(report.delivery.conserved).toBe(true)
    expect(report.delivery.total).toBe(6)
    expect(report.delivery.uniquePairs).toBe(6)
    expect(report.delivery.byState).toEqual({
      pending: 1,
      sending: 1,
      ambiguous: 1,
      delivered: 1,
      dead: 1,
      leased: 1,
    })
    expect(report.delivery.excludedNonActiveGeneration).toBe(1)
  })
})
