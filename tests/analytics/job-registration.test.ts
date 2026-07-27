// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import type { AnalyticsEventV1 } from '../../src/analytics/contracts.js'
import { AnalyticsEventV1Schema } from '../../src/analytics/contracts.js'
import { KeyVersionSchema } from '../../src/analytics/controlled-types.js'
import { insertEligibleCanonicalEvent } from '../../src/analytics/governance/collection-serialization.js'
import { deriveCollectionRefKey, setEligibilityState } from '../../src/analytics/governance/collection-store.js'
import type { CollectionEligibilityRef } from '../../src/analytics/governance/eligibility.js'
import type { EffectiveLanes } from '../../src/analytics/governance/policy-store.js'
import { TAXONOMY_VERSION } from '../../src/analytics/intent/taxonomy.js'
import {
  ANALYTICS_JOB_NAMES,
  ANALYTICS_JOB_SPECS,
  createAnalyticsJobHandlers,
  DERIVE_WINDOW_MS,
  HIGHWATER_BATCH_SIZE,
  INTENT_PAGE_LIMIT,
  registerAnalyticsJobs,
  unregisterAnalyticsJobs,
} from '../../src/analytics/jobs/register.js'
import type {
  AnalyticsJobDeps,
  AnalyticsJobKeyMaterial,
  AnalyticsJobRunnerOverrides,
  AnalyticsJobSpec,
} from '../../src/analytics/jobs/register.js'
import { createRetentionBarrier, runExpirySweep } from '../../src/analytics/jobs/retention.js'
import { createRekeyCutoverFence } from '../../src/analytics/rekey/cutover-fence.js'
import { openEpoch } from '../../src/analytics/storage/epoch-store.js'
import type { LlmUsageEventRow } from '../../src/db/llm-usage-events-schema.js'
import * as schema from '../../src/db/schema.js'
import { createScheduler } from '../../src/utils/scheduler.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const KEY = Buffer.alloc(32, 7)
const NOW = Date.UTC(2023, 10, 14, 12, 0, 0, 0)
const EPOCH_ID = 'epoch-registration-1'

const OFF_LANES: EffectiveLanes = {
  killSwitchActive: true,
  localMode: 'off',
  externalAggregateEnabled: false,
  externalPseudonymousEnabled: false,
}

const AGGREGATE_LANES: EffectiveLanes = {
  killSwitchActive: false,
  localMode: 'local_aggregate',
  externalAggregateEnabled: false,
  externalPseudonymousEnabled: false,
}

const PSEUDONYMOUS_LANES: EffectiveLanes = {
  killSwitchActive: false,
  localMode: 'local_pseudonymous',
  externalAggregateEnabled: false,
  externalPseudonymousEnabled: false,
}

const EXTERNAL_LANES: EffectiveLanes = {
  killSwitchActive: false,
  localMode: 'local_aggregate',
  externalAggregateEnabled: true,
  externalPseudonymousEnabled: false,
}

const specCadence = (spec: AnalyticsJobSpec): number | string => ('intervalMs' in spec ? spec.intervalMs : spec.cron)

const makeDeps = (db: Db, over?: Partial<AnalyticsJobDeps>): AnalyticsJobDeps => ({
  nowMs: (): number => NOW,
  getDrizzleDb: (): Db => db,
  lanes: (): EffectiveLanes => OFF_LANES,
  observer: (): null => null,
  openEpochId: (): string | null => EPOCH_ID,
  keyMaterial: (): AnalyticsJobKeyMaterial | null => ({ key: KEY, keyVersion: KeyVersionSchema.parse('v1') }),
  snapshotPath: (): string | null => null,
  ...over,
})

const overrideSpies = (): { overrides: AnalyticsJobRunnerOverrides; calls: string[] } => {
  const calls: string[] = []
  const record = (name: string) => (): void => {
    calls.push(name)
  }
  return {
    calls,
    overrides: {
      flush: record('flush'),
      highwater: record('highwater'),
      intent: record('intent'),
      derive: record('derive'),
      delivery: record('delivery'),
      reconcile: record('reconcile'),
      snapshot: record('snapshot'),
      expiryPurge: record('expiryPurge'),
      censorMaturity: record('censorMaturity'),
    },
  }
}

const seedCutoverRun = (db: Db): void => {
  db.insert(schema.analyticsRekeyRuns)
    .values({
      runId: 'run-cutover-1',
      sourceGeneration: 'gen-1',
      targetGeneration: 'gen-2',
      fromVersions: JSON.stringify(['v1']),
      toVersions: JSON.stringify(['v2']),
      sourceHighWater: 'hw-1',
      phase: 'cutover',
      subphase: null,
      planHash: 'plan-hash-1',
      status: 'running',
      createdAt: NOW - 1000,
      updatedAt: NOW - 1000,
    })
    .run()
}

let llmSeq = 0
const llmRow = (over: Partial<LlmUsageEventRow>): LlmUsageEventRow => ({
  eventId: `llm-${llmSeq++}`,
  occurredAt: NOW - 60_000,
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

const allowRef = (db: Db): CollectionEligibilityRef => {
  const refKey = deriveCollectionRefKey({
    key: KEY,
    keyVersion: 'v1',
    platformInstanceId: 'pi-1',
    platformUserId: 'user-42',
  })
  const { generation } = setEligibilityState(
    { refKey, keyVersion: 'v1', state: 'allow', policyVersion: 3, nowMs: NOW },
    { getDrizzleDb: () => db },
  )
  return { refKey, keyVersion: 'v1', generation }
}

const TURN_COMPLETED_PROPS = {
  outcome: 'ok',
  duration_ms: 900,
  step_count: 3,
  tool_call_count: 2,
  reply_count: '1',
  finish_reason: 'tool_calls',
  clarification: false,
  live_status_used: false,
} as const

const turnEnvelope = (idSuffix: string, turnKey: string): AnalyticsEventV1 =>
  AnalyticsEventV1Schema.parse({
    schema: { name: 'papai.analytics.event', version: 1 },
    event: {
      id: `v1.p-${idSuffix}`,
      name: 'turn_completed',
      version: 1,
      occurred_at_ms: NOW - 60_000,
      ingested_at_ms: NOW - 59_000,
      source: 'live',
      attribution_quality: 'native',
    },
    app: { version: '6.10.0', deployment_key: 'v1.p-deploy' },
    identity: {
      key_version: 'v1',
      platform: 'mattermost',
      platform_instance_key: 'v1.p-platform',
      actor_key: 'v1.p-actor',
      context_key: 'v1.p-context',
      thread_key: 'v1.p-thread',
      task_instance_key: 'v1.p-task-instance',
    },
    context: { context_type: 'group', actor_role: 'admin', task_provider: 'kaneo', invocation_mode: 'command' },
    correlation: { conversation_key: 'v1.p-conversation', turn_key: turnKey, session_key: 'v1.p-session' },
    governance: {
      purpose: 'product_analytics',
      collection_tier: 'pseudonymous',
      policy_version: 3,
      eligibility: 'allowed',
    },
    privacy: { max_class: 'C1' },
    props: TURN_COMPLETED_PROPS,
  })

describe('analytics job registration', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
    llmSeq = 0
  })

  test('registers exactly the nine bounded jobs with exact names and cadences', () => {
    expect(ANALYTICS_JOB_NAMES).toEqual([
      'analytics-aggregate-flush',
      'analytics-usage-highwater',
      'analytics-intent-scan',
      'analytics-derive',
      'analytics-delivery',
      'analytics-reconcile',
      'analytics-snapshot',
      'analytics-expiry-purge',
      'analytics-censor-maturity',
    ])
    expect(ANALYTICS_JOB_SPECS.map((spec) => [spec.name, specCadence(spec)])).toEqual([
      ['analytics-aggregate-flush', 60_000],
      ['analytics-usage-highwater', 300_000],
      ['analytics-intent-scan', 300_000],
      ['analytics-derive', 300_000],
      ['analytics-delivery', 60_000],
      ['analytics-reconcile', 3_600_000],
      ['analytics-snapshot', 3_600_000],
      ['analytics-expiry-purge', 60_000],
      ['analytics-censor-maturity', '15 1 * * *'],
    ])
    const scheduler = createScheduler()
    const deps = makeDeps(db)
    registerAnalyticsJobs(scheduler, deps)
    for (const name of ANALYTICS_JOB_NAMES) expect(scheduler.hasTask(name)).toBe(true)
    unregisterAnalyticsJobs(scheduler)
    for (const name of ANALYTICS_JOB_NAMES) expect(scheduler.hasTask(name)).toBe(false)
  })

  test('re-registration across runtime restarts never duplicates jobs', () => {
    const scheduler = createScheduler()
    const deps = makeDeps(db)
    registerAnalyticsJobs(scheduler, deps)
    registerAnalyticsJobs(scheduler, deps)
    expect(ANALYTICS_JOB_NAMES.filter((name) => scheduler.hasTask(name))).toHaveLength(ANALYTICS_JOB_NAMES.length)
    unregisterAnalyticsJobs(scheduler)
    registerAnalyticsJobs(scheduler, deps)
    for (const name of ANALYTICS_JOB_NAMES) expect(scheduler.hasTask(name)).toBe(true)
    unregisterAnalyticsJobs(scheduler)
  })

  test('kill switch and mode gates are checked at job entry before any actor read', async () => {
    const { overrides, calls } = overrideSpies()
    const deps = makeDeps(db, { overrides, snapshotPath: () => '/tmp/papai-registration-snap.db' })
    const handlers = createAnalyticsJobHandlers(deps)
    for (const handler of Object.values(handlers)) await handler()
    expect(calls).toEqual(['expiryPurge'])
  })

  test('pseudonymous and external gates select exactly their job classes', async () => {
    const { overrides, calls } = overrideSpies()
    const deps = makeDeps(db, { overrides, lanes: () => PSEUDONYMOUS_LANES })
    const handlers = createAnalyticsJobHandlers(deps)
    await handlers['analytics-intent-scan']()
    await handlers['analytics-derive']()
    await handlers['analytics-delivery']()
    await handlers['analytics-censor-maturity']()
    expect(calls).toEqual(['intent', 'derive', 'censorMaturity'])

    const external = overrideSpies()
    const externalHandlers = createAnalyticsJobHandlers(
      makeDeps(db, { overrides: external.overrides, lanes: () => EXTERNAL_LANES }),
    )
    await externalHandlers['analytics-delivery']()
    await externalHandlers['analytics-intent-scan']()
    expect(external.calls).toEqual(['delivery'])
  })

  test('a mode change while a job is queued exits before reading actor data or sending', async () => {
    let lanes = PSEUDONYMOUS_LANES
    const { overrides, calls } = overrideSpies()
    const scheduler = createScheduler()
    registerAnalyticsJobs(scheduler, makeDeps(db, { overrides, lanes: () => lanes }))
    lanes = OFF_LANES
    const handlers = createAnalyticsJobHandlers(makeDeps(db, { overrides, lanes: () => lanes }))
    await handlers['analytics-intent-scan']()
    await handlers['analytics-derive']()
    await handlers['analytics-delivery']()
    await handlers['analytics-censor-maturity']()
    expect(calls).toEqual([])
    unregisterAnalyticsJobs(scheduler)
  })

  test('a held cutover fence blocks every mutable job class without writes', async () => {
    openEpoch({ epochId: EPOCH_ID, startedAtMs: NOW - 120_000 }, { getDrizzleDb: () => db })
    db.insert(schema.llmUsageEvents).values(llmRow({})).run()
    const ref = allowRef(db)
    const seeded = insertEligibleCanonicalEvent(
      { event: turnEnvelope('tc-fence', 'v1.p-turn-fence'), processEpochId: EPOCH_ID, collectionRef: ref },
      { getDrizzleDb: () => db },
    )
    expect(seeded.status).toBe('inserted')
    const eventsBefore = db.select().from(schema.analyticsEvents).all().length
    seedCutoverRun(db)
    const fence = createRekeyCutoverFence({ getDrizzleDb: () => db })

    const deps = makeDeps(db, {
      fence,
      lanes: () => ({
        killSwitchActive: false,
        localMode: 'local_pseudonymous',
        externalAggregateEnabled: true,
        externalPseudonymousEnabled: true,
      }),
      snapshotPath: () => '/tmp/papai-fence-snap.db',
    })
    const handlers = createAnalyticsJobHandlers(deps)
    await handlers['analytics-intent-scan']()
    await handlers['analytics-derive']()
    await handlers['analytics-usage-highwater']()
    await handlers['analytics-expiry-purge']()
    await handlers['analytics-censor-maturity']()
    await handlers['analytics-reconcile']()
    expect(() => handlers['analytics-snapshot']()).toThrow('cutover fence')

    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(eventsBefore)
    expect(db.select().from(schema.analyticsBackfillRuns).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsDailyCounters).all()).toHaveLength(0)
    expect(fence.outstanding()).toEqual({ intent: 0, derive: 0, backfill: 0, retention: 0, delivery: 0, snapshot: 0 })
  })

  test('bounded page sizes and windows are declared constants', () => {
    expect(HIGHWATER_BATCH_SIZE).toBe(500)
    expect(INTENT_PAGE_LIMIT).toBe(200)
    expect(DERIVE_WINDOW_MS).toBe(15 * 60_000)
  })

  test('overdue expiry purge completes before readers and computes the next dynamic wake', async () => {
    const order: string[] = []
    const barrier = createRetentionBarrier({ getDrizzleDb: () => db })
    expect(() => barrier.assertReadersAllowed()).toThrow()
    db.insert(schema.llmUsageEvents).values(llmRow({})).run()
    const result = barrier.purgeExpiredBeforeStart({ nowMs: NOW })
    order.push('purge')
    barrier.assertReadersAllowed()
    order.push('readers')
    expect(order).toEqual(['purge', 'readers'])
    expect(result.eventsRemoved).toBe(0)

    const sweep = runExpirySweep({ nowMs: NOW }, { getDrizzleDb: () => db })
    expect(sweep.status).toBe('purged')
    expect(sweep.nextWakeMs).toBeLessThanOrEqual(NOW + 60_000)
    expect(sweep.nextWakeMs).toBeGreaterThanOrEqual(NOW)

    const handlers = createAnalyticsJobHandlers(makeDeps(db, { lanes: () => AGGREGATE_LANES }))
    await handlers['analytics-expiry-purge']()
  })

  test('usage high-water tick decides a late embedding row aggregate-only once and advances the checkpoint', async () => {
    db.insert(schema.llmUsageEvents)
      .values(llmRow({ eventId: 'llm-main-1' }))
      .run()
    const deps = makeDeps(db, { lanes: () => AGGREGATE_LANES })
    const handlers = createAnalyticsJobHandlers(deps)

    await handlers['analytics-usage-highwater']()
    const firstRun = db
      .select()
      .from(schema.analyticsBackfillRuns)
      .where(eq(schema.analyticsBackfillRuns.runId, 'backfill-v1:llm_usage_events'))
      .get()
    expect(firstRun?.status).toBe('completed')
    assert(firstRun !== undefined)
    const firstHighWater = firstRun.highWaterRowKey

    db.insert(schema.llmUsageEvents)
      .values(llmRow({ eventId: 'llm-embed-late', modelRole: 'embedding', turnId: null, occurredAt: NOW - 30_000 }))
      .run()
    await handlers['analytics-usage-highwater']()

    const embeddingCounters = db
      .select()
      .from(schema.analyticsDailyCounters)
      .all()
      .filter((row) => row.utcDay === '2023-11-14')
    const totalEmbeddingIncrements = embeddingCounters.reduce((sum, row) => sum + row.value, 0)
    expect(totalEmbeddingIncrements).toBe(2)

    const secondRun = db
      .select()
      .from(schema.analyticsBackfillRuns)
      .where(eq(schema.analyticsBackfillRuns.runId, 'backfill-v1:llm_usage_events'))
      .get()
    expect(secondRun?.status).toBe('completed')
    expect(secondRun?.highWaterRowKey).not.toBe(firstHighWater)

    await handlers['analytics-usage-highwater']()
    const afterThird = db.select().from(schema.analyticsDailyCounters).all()
    expect(afterThird.reduce((sum, row) => sum + row.value, 0)).toBe(totalEmbeddingIncrements)
  })

  test('intent scan fills exactly one (turn_key,taxonomy_version) row and stays idempotent', async () => {
    openEpoch({ epochId: EPOCH_ID, startedAtMs: NOW - 120_000 }, { getDrizzleDb: () => db })
    const ref = allowRef(db)
    const inserted = insertEligibleCanonicalEvent(
      { event: turnEnvelope('tc-reg', 'v1.p-turn-reg'), processEpochId: EPOCH_ID, collectionRef: ref },
      { getDrizzleDb: () => db },
    )
    expect(inserted.status).toBe('inserted')

    const handlers = createAnalyticsJobHandlers(makeDeps(db, { lanes: () => PSEUDONYMOUS_LANES }))
    await handlers['analytics-intent-scan']()

    const rows = db
      .select()
      .from(schema.analyticsEvents)
      .where(eq(schema.analyticsEvents.eventName, 'intent_classified'))
      .all()
    expect(rows).toHaveLength(1)
    const first = rows[0]
    assert(first !== undefined)
    expect(first.turnKey).toBe('v1.p-turn-reg')
    const props = z.looseObject({ taxonomy: z.string() }).parse(JSON.parse(first.propsJson))
    expect(props.taxonomy).toBe(TAXONOMY_VERSION)

    await handlers['analytics-intent-scan']()
    expect(
      db.select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventName, 'intent_classified')).all(),
    ).toHaveLength(1)
  })
})
