// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { eq } from 'drizzle-orm'

import { KeyVersionSchema, VersionStringSchema } from '../../src/analytics/controlled-types.js'
import type { EligibilityDecision } from '../../src/analytics/governance/eligibility.js'
import type { NormalizerEnv } from '../../src/analytics/normalizer.js'
import { createProcessEpochCoordinator } from '../../src/analytics/process-epoch.js'
import type { ProcessEpochCoordinatorDeps } from '../../src/analytics/process-epoch.js'
import { createAnalyticsObserver } from '../../src/analytics/runtime.js'
import type { AnalyticsRuntimeDeps } from '../../src/analytics/runtime.js'
import { createRecordingHealth, createRecordingSinks } from '../../src/analytics/runtime.testing.js'
import type { AnalyticsSourceContext, ChatMessageAcceptedFact } from '../../src/analytics/source-facts.js'
import { getActiveAnalyticsRuntime, startAnalytics, stopAnalytics } from '../../src/analytics/start-analytics.js'
import { incrementEpochSourceCounter } from '../../src/analytics/storage/epoch-source-counters.js'
import { getEpochState, getOpenEpoch, openEpoch } from '../../src/analytics/storage/epoch-store.js'
import { initAnalyticsRuntime, stopAnalyticsRuntime } from '../../src/analytics/subscriber.js'
import { createTurnContextRegistry } from '../../src/analytics/turn-context.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import * as schema from '../../src/db/schema.js'
import { subscribeCountForTest } from '../../src/debug/event-bus.js'
import { mockLogger, restoreFetch, setMockFetch, setupTestDb } from '../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const DAY1 = '2023-11-14'
const DAY2 = '2023-11-15'
const DAY1_LATE = Date.UTC(2023, 10, 14, 23, 0, 0, 0)
const DAY2_EARLY = Date.UTC(2023, 10, 15, 1, 0, 0, 0)

const seedCounterRow = (db: Db, utcDay: string, contributorCount: number | null): void => {
  db.insert(schema.analyticsDailyCounters)
    .values({
      utcDay,
      definitionVersion: 1,
      platform: 'telegram',
      contextType: 'dm',
      actorRole: 'member',
      taskProvider: 'none',
      appVersion: '6.10.0',
      metric: 'auth_granted',
      value: 3,
      finalized: true,
      partialDay: false,
      restartGapDetected: false,
      lateEventCount: 0,
      reconciliationStatus: 'complete_epoch',
      disclosureScope: 'local_only',
      contributorBasis: 'eligible_actor',
      contributorCount,
      threshold: null,
    })
    .run()
}

const bucketRowFor = (
  db: Db,
  utcDay: string,
): { reconciliationStatus: string; finalized: boolean; contributorCount: number | null } => {
  const row = db
    .select({
      reconciliationStatus: schema.analyticsDailyCounters.reconciliationStatus,
      finalized: schema.analyticsDailyCounters.finalized,
      contributorCount: schema.analyticsDailyCounters.contributorCount,
    })
    .from(schema.analyticsDailyCounters)
    .where(eq(schema.analyticsDailyCounters.utcDay, utcDay))
    .get()
  if (row === undefined) throw new Error(`no counter row for ${utcDay}`)
  return row
}

const makeCoordinator = (
  db: Db,
  overrides: Partial<ProcessEpochCoordinatorDeps> = {},
): ReturnType<typeof createProcessEpochCoordinator> =>
  createProcessEpochCoordinator({
    getDrizzleDb: () => db,
    nowMs: () => DAY2_EARLY,
    newEpochId: () => 'epoch-lifecycle-new',
    ...overrides,
  })

const normalizerEnv: NormalizerEnv = {
  hmacKey: Buffer.alloc(32, 7),
  keyVersion: KeyVersionSchema.parse('v1'),
  installId: 'install-lifecycle-1',
  appVersion: VersionStringSchema.parse('6.10.0'),
  policyVersion: 3,
  ingestedAtMs: 1_700_000_000_500,
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

const messageFact = (ordinal: number): ChatMessageAcceptedFact => ({
  version: 1,
  type: 'chat_message_accepted',
  sourceEventId: `se-lifecycle-${ordinal}`,
  occurredAtMs: 1_700_000_000_000 + ordinal,
  source: memberSource,
  inputCount: 1,
  inputLengthChars: 200,
  attachmentCount: 0,
  isCommand: false,
  command: 'none',
})

const aggregateDecision: EligibilityDecision = {
  allowed: true,
  lane: 'local_aggregate',
  policyVersion: 3,
  collectionEligibility: null,
  deliveryGrant: null,
}

const pseudonymousDecision: EligibilityDecision = {
  allowed: true,
  lane: 'local_pseudonymous',
  policyVersion: 3,
  collectionEligibility: { refKey: 'ref-1', keyVersion: 'v1', generation: 1 },
  deliveryGrant: null,
}

const deniedDecision: EligibilityDecision = { allowed: false, reason: 'mode_off' }

const quietLog = { warn: (): void => undefined }

describe('analytics runtime lifecycle', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
  })

  afterEach(async () => {
    restoreFetch()
    await stopAnalytics()
  })

  test('startup/shutdown ordering: epoch before subscriptions, close after drain, unsubscribe before db close', async () => {
    const events: string[] = ['migrations']
    const coordinator = createProcessEpochCoordinator({
      getDrizzleDb: () => db,
      nowMs: () => DAY2_EARLY,
      newEpochId: () => 'epoch-ordered',
      drain: () => {
        events.push('drain')
        return Promise.resolve()
      },
    })
    coordinator.recoverStaleEpochs()
    events.push('recover-stale')
    coordinator.open()
    events.push('epoch:open')
    expect(getEpochState({ epochId: 'epoch-ordered' }, { getDrizzleDb: () => db })).toEqual({ state: 'open' })
    expect(events).not.toContain('subscribe')

    const recording = createRecordingSinks()
    const observer = createAnalyticsObserver({
      decide: () => deniedDecision,
      normalizerEnv: () => null,
      health: createRecordingHealth(),
      log: quietLog,
      sinks: recording.sinks,
    })
    const registry = createTurnContextRegistry()
    initAnalyticsRuntime({
      observer,
      registry,
      subscribe: () => {
        events.push('subscribe')
      },
      unsubscribe: () => {
        events.push('unsubscribe')
      },
    })
    events.push('chat-ingress')

    events.push('ingress-stop')
    await observer.flush()
    const result = await coordinator.close()
    expect(result.closed).toBe(true)
    events.push('epoch:closed')
    stopAnalyticsRuntime()
    registry.clear()
    events.push('db:close')

    expect(events).toEqual([
      'migrations',
      'recover-stale',
      'epoch:open',
      'subscribe',
      'chat-ingress',
      'ingress-stop',
      'drain',
      'epoch:closed',
      'unsubscribe',
      'db:close',
    ])
  })

  test('real runtime: crash after a finalized bucket demotes it on the next start; clean stop closes after drain', async () => {
    seedCounterRow(db, DAY1, 5)
    openEpoch({ epochId: 'epoch-crashed', startedAtMs: DAY1_LATE }, { getDrizzleDb: () => db })
    const subscribersBefore = subscribeCountForTest()

    startAnalytics()
    expect(getEpochState({ epochId: 'epoch-crashed' }, { getDrizzleDb: () => db })).toEqual({ state: 'stale_open' })
    expect(bucketRowFor(db, DAY1)).toEqual({
      reconciliationStatus: 'unreconciled_restart_gap',
      finalized: false,
      contributorCount: null,
    })
    const active = getActiveAnalyticsRuntime()
    expect(active).not.toBeNull()
    const open = getOpenEpoch({ getDrizzleDb: () => db })
    expect(open).not.toBeNull()
    assert(open !== null)
    expect(open.epochId).not.toBe('epoch-crashed')
    expect(subscribeCountForTest()).toBe(subscribersBefore + 1)

    await stopAnalytics()
    expect(getEpochState({ epochId: open.epochId }, { getDrizzleDb: () => db })).toEqual({ state: 'closed' })
    expect(getActiveAnalyticsRuntime()).toBeNull()
    expect(subscribeCountForTest()).toBe(subscribersBefore)
  })

  test('a forced drain timeout leaves the epoch open; restart marks it stale without inventing a loss count', async () => {
    seedCounterRow(db, DAY2, 4)
    const stuck = makeCoordinator(db, {
      drain: () => new Promise<void>(() => {}),
      drainTimeoutMs: 10,
    })
    stuck.open()
    const result = await stuck.close()
    expect(result.closed).toBe(false)
    expect(getEpochState({ epochId: 'epoch-lifecycle-new' }, { getDrizzleDb: () => db })).toEqual({ state: 'open' })

    const restarted = makeCoordinator(db, { newEpochId: () => 'epoch-after-restart' })
    restarted.recoverStaleEpochs()
    expect(getEpochState({ epochId: 'epoch-lifecycle-new' }, { getDrizzleDb: () => db })).toEqual({
      state: 'stale_open',
    })
    expect(bucketRowFor(db, DAY2)).toEqual({
      reconciliationStatus: 'unreconciled_restart_gap',
      finalized: false,
      contributorCount: null,
    })
    expect(db.select().from(schema.analyticsDailyCounters).all()).toHaveLength(1)
  })

  test('a clean epoch closes only after the drain completes', async () => {
    const probe: string[] = []
    const coordinator = makeCoordinator(db, {
      drain: () => {
        const state = getEpochState({ epochId: 'epoch-lifecycle-new' }, { getDrizzleDb: () => db })
        assert(state !== undefined)
        probe.push(state.state)
        return Promise.resolve()
      },
    })
    coordinator.open()
    const result = await coordinator.close()
    expect(result.closed).toBe(true)
    expect(probe).toEqual(['open'])
    expect(getEpochState({ epochId: 'epoch-lifecycle-new' }, { getDrizzleDb: () => db })).toEqual({ state: 'closed' })
  })

  test('a crash across UTC midnight marks both intersecting days unreconciled and demotes them', () => {
    seedCounterRow(db, DAY1, 2)
    seedCounterRow(db, DAY2, 4)
    openEpoch({ epochId: 'epoch-midnight', startedAtMs: DAY1_LATE }, { getDrizzleDb: () => db })
    makeCoordinator(db).recoverStaleEpochs()
    for (const day of [DAY1, DAY2]) {
      expect(bucketRowFor(db, day)).toEqual({
        reconciliationStatus: 'unreconciled_restart_gap',
        finalized: false,
        contributorCount: null,
      })
    }
  })

  test('reply path fixture: observe is synchronous with no network work and no awaited write in any mode', async () => {
    let fetchCalls = 0
    setMockFetch(() => {
      fetchCalls += 1
      return Promise.resolve(new Response('{}'))
    })
    const modes: ReadonlyArray<
      Readonly<{ decision: EligibilityDecision; expectedAggregates: number; expectedEvents: number }>
    > = [
      { decision: deniedDecision, expectedAggregates: 0, expectedEvents: 0 },
      { decision: aggregateDecision, expectedAggregates: 1, expectedEvents: 0 },
      { decision: pseudonymousDecision, expectedAggregates: 1, expectedEvents: 1 },
    ]
    for (const { decision, expectedAggregates, expectedEvents } of modes) {
      const recording = createRecordingSinks()
      const observer = createAnalyticsObserver({
        decide: () => decision,
        normalizerEnv: () => normalizerEnv,
        health: createRecordingHealth(),
        log: quietLog,
        sinks: recording.sinks,
      })
      const returned: unknown = observer.observe(messageFact(1))
      expect(returned).toBeUndefined()
      expect(fetchCalls).toBe(0)
      expect(recording.aggregates).toHaveLength(0)
      expect(recording.events).toHaveLength(0)
      await observer.flush()
      expect(fetchCalls).toBe(0)
      expect(recording.aggregates).toHaveLength(expectedAggregates)
      expect(recording.events).toHaveLength(expectedEvents)
      await observer.stop()
    }
  })

  test('a full queue drops only the new fact with an exact epoch-bound overflow count and never blocks chat', async () => {
    openEpoch({ epochId: 'epoch-overflow', startedAtMs: 1_699_000_000_000 }, { getDrizzleDb: () => db })
    const recording = createRecordingSinks()
    const health = createRecordingHealth()
    const deps: AnalyticsRuntimeDeps = {
      decide: () => aggregateDecision,
      normalizerEnv: () => normalizerEnv,
      health,
      log: quietLog,
      sinks: recording.sinks,
      queueCapacity: 1,
      onControlledOverflow: (utcDay) => {
        incrementEpochSourceCounter(
          { epochId: 'epoch-overflow', utcDay, sourceFamily: 'chat', disposition: 'controlled_overflow' },
          { getDrizzleDb: () => db },
        )
      },
    }
    const observer = createAnalyticsObserver(deps)
    expect(observer.observe(messageFact(1))).toBeUndefined()
    expect(observer.observe(messageFact(2))).toBeUndefined()
    expect(observer.observe(messageFact(3))).toBeUndefined()

    expect(health.counts.queue_full).toBe(2)
    const overflowRows = db
      .select()
      .from(schema.analyticsEpochSourceCounters)
      .where(eq(schema.analyticsEpochSourceCounters.disposition, 'controlled_overflow'))
      .all()
    expect(overflowRows).toHaveLength(1)
    expect(overflowRows[0]?.epochId).toBe('epoch-overflow')
    expect(overflowRows[0]?.value).toBe(2)

    await observer.flush()
    expect(recording.aggregates).toHaveLength(1)
  })
})
