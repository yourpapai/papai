// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { KeyVersionSchema, VersionStringSchema } from '../../src/analytics/controlled-types.js'
import { enqueueDelivery, markSendStarted } from '../../src/analytics/delivery/delivery-lifecycle.js'
import { leaseDeliveries } from '../../src/analytics/delivery/store.js'
import type { DeliveryStoreDeps } from '../../src/analytics/delivery/store.js'
import { createGrantSendMutex } from '../../src/analytics/governance/grant-serialization.js'
import { setGrantState } from '../../src/analytics/governance/grant-store.js'
import { createSnapshotInvalidator } from '../../src/analytics/governance/snapshot-invalidator.js'
import { exportSubjectData } from '../../src/analytics/governance/subject-service.js'
import type { SubjectServiceDeps } from '../../src/analytics/governance/subject-service.js'
import { createPseudonym } from '../../src/analytics/identity/pseudonym.js'
import { runDeriveJob } from '../../src/analytics/jobs/derive.js'
import { createRetentionBarrier, nextExpiryDeadline, purgeExpired } from '../../src/analytics/jobs/retention.js'
import type { RetentionJobDeps } from '../../src/analytics/jobs/retention.js'
import { normalize } from '../../src/analytics/normalizer.js'
import type { NormalizerEnv } from '../../src/analytics/normalizer.js'
import {
  canonicalEventExpiryMs,
  isUnexpired,
  resolveRetentionLimits,
  RetentionLimitExceededError,
  RETENTION_MAXIMA,
} from '../../src/analytics/retention/expiry-guard.js'
import type { AnalyticsSourceContext } from '../../src/analytics/source-facts.js'
import { loadUnexpiredEventRow, listSnapshotSourceEvents } from '../../src/analytics/storage/event-store.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import * as schema from '../../src/db/schema.js'
import { setupTestDb } from '../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const DAY = 86_400_000
const MINUTE = 60_000
const T = 1_800_000_000_000
const EPOCH_ID = 'epoch-retention-1'
const ACTIVE_GENERATION = 'gen-1'
const GRANT = { grantKey: 'v1.d-grant-retention', keyVersion: 'v1', generation: 1 }

const ANALYTICS_KEY = Buffer.alloc(32, 7)
const GOVERNANCE_KEY = Buffer.alloc(32, 9)

const keyrings = {
  analytics: {
    kind: 'available',
    activeVersion: 'v1',
    activeKey: ANALYTICS_KEY,
    keys: new Map([['v1', ANALYTICS_KEY]]),
  },
  governance: {
    kind: 'available',
    activeVersion: 'v1',
    activeKey: GOVERNANCE_KEY,
    keys: new Map([['v1', GOVERNANCE_KEY]]),
  },
} as const

const actorKeyFor = (platformUserId: string): string =>
  createPseudonym({
    key: ANALYTICS_KEY,
    keyVersion: 'v1',
    domain: 'actor:v1',
    components: ['pi-1', platformUserId],
  })

const insertEventRow = (
  db: Db,
  input: Readonly<{
    eventId: string
    occurredAtMs: number
    expiresAtMs: number
    actorKey?: string | null
    storageGeneration?: string
    eventName?: string
    sourceRefKey?: string
    conversationKey?: string | null
    turnKey?: string | null
    actorRole?: string
  }>,
): void => {
  db.insert(schema.analyticsProcessEpochs)
    .values({ epochId: EPOCH_ID, state: 'open', startedAtMs: T - 400 * DAY })
    .onConflictDoNothing()
    .run()
  db.insert(schema.analyticsEvents)
    .values({
      eventId: input.eventId,
      storageGeneration: input.storageGeneration ?? ACTIVE_GENERATION,
      processEpochId: EPOCH_ID,
      sourceRefKey: input.sourceRefKey ?? `ref-${input.eventId}`,
      sourceKind: 'live',
      schemaVersion: 1,
      eventName: input.eventName ?? 'turn_started',
      eventVersion: 1,
      occurredAtMs: input.occurredAtMs,
      ingestedAtMs: input.occurredAtMs + 1,
      source: 'live',
      attributionQuality: 'native',
      appVersion: '6.10.0',
      deploymentKey: 'v1.p-deploy',
      keyVersion: 'v1',
      platform: 'telegram',
      platformInstanceKey: 'v1.p-instance',
      actorKey: input.actorKey === undefined ? 'v1.a-actor' : input.actorKey,
      contextKey: 'v1.c-context',
      threadKey: null,
      conversationKey: input.conversationKey === undefined ? 'v1.c-context' : input.conversationKey,
      taskInstanceKey: null,
      contextType: 'dm',
      actorRole: input.actorRole ?? 'member',
      taskProvider: 'none',
      invocationMode: 'normal',
      turnKey: input.turnKey ?? null,
      sessionKey: null,
      policyVersion: 1,
      eligibility: 'allowed',
      maxClass: 'C0',
      propsJson: '{}',
      expiresAtMs: input.expiresAtMs,
    })
    .run()
}

const insertSessionRow = (
  db: Db,
  input: Readonly<{ sessionKey: string; actorKey: string; eventId: string; startMs: number; endMs: number }>,
): void => {
  db.insert(schema.analyticsSessions)
    .values({
      sessionKey: input.sessionKey,
      storageGeneration: ACTIVE_GENERATION,
      actorKey: input.actorKey,
      conversationKey: 'v1.c-context',
      startMs: input.startMs,
      endMs: input.endMs,
      durationMs: input.endMs - input.startMs,
      activityCount: 1,
      turnCount: 1,
      firstEventId: input.eventId,
      lastEventId: input.eventId,
      sessionizationVersion: 1,
    })
    .run()
}

const insertSinkRow = (db: Db, sinkVersionId: string): void => {
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
      createdAtMs: T - 400 * DAY,
    })
    .run()
}

const insertDeliveryRow = (
  db: Db,
  input: Readonly<{
    eventId: string
    sinkVersionId: string
    state: string
    nextAttemptAtMs?: number
    deliveredAtMs?: number | null
    sendStartedAtMs?: number | null
    leaseUntilMs?: number | null
    lastErrorClass?: string | null
  }>,
): void => {
  db.insert(schema.analyticsDeliveries)
    .values({
      eventId: input.eventId,
      sinkVersionId: input.sinkVersionId,
      grantKey: GRANT.grantKey,
      grantKeyVersion: GRANT.keyVersion,
      grantGeneration: GRANT.generation,
      state: input.state,
      attempts: 0,
      nextAttemptAtMs: input.nextAttemptAtMs ?? T - 400 * DAY,
      leaseUntilMs: input.leaseUntilMs ?? null,
      sendStartedAtMs: input.sendStartedAtMs ?? null,
      lastErrorClass: input.lastErrorClass ?? null,
      deliveredAtMs: input.deliveredAtMs ?? null,
      payloadSchemaVersion: 1,
    })
    .run()
}

const insertCounterRow = (
  db: Db,
  input: Readonly<{ utcDay: string; metric?: string; value?: number; threshold?: number | null }>,
): void => {
  db.insert(schema.analyticsDailyCounters)
    .values({
      utcDay: input.utcDay,
      definitionVersion: 1,
      platform: 'telegram',
      contextType: 'dm',
      actorRole: 'member',
      taskProvider: 'none',
      appVersion: '6.10.0',
      metric: input.metric ?? 'turns',
      value: input.value ?? 1,
      finalized: false,
      partialDay: false,
      restartGapDetected: false,
      lateEventCount: 0,
      reconciliationStatus: 'complete_epoch',
      disclosureScope: 'local_only',
      contributorBasis: 'not_required',
      contributorCount: null,
      threshold: input.threshold ?? null,
    })
    .run()
}

const insertHistogramRow = (db: Db, input: Readonly<{ utcDay: string; threshold?: number | null }>): void => {
  db.insert(schema.analyticsDailyHistograms)
    .values({
      utcDay: input.utcDay,
      definitionVersion: 1,
      platform: 'telegram',
      contextType: 'dm',
      actorRole: 'member',
      taskProvider: 'none',
      appVersion: '6.10.0',
      metric: 'turn_duration_ms',
      fixedBucketsJson: '[1,2,3]',
      countsJson: '[0,1,0,0]',
      sum: 2,
      sampleCount: 1,
      finalized: false,
      partialDay: false,
      restartGapDetected: false,
      lateEventCount: 0,
      reconciliationStatus: 'complete_epoch',
      disclosureScope: 'local_only',
      contributorBasis: 'not_required',
      contributorCount: null,
      threshold: input.threshold ?? null,
    })
    .run()
}

const insertAuditRow = (
  db: Db,
  input: Readonly<{ auditId: string; governanceActorKey: string; occurredAt: number }>,
): void => {
  db.insert(schema.analyticsPolicyAudit)
    .values({
      auditId: input.auditId,
      governanceActorKey: input.governanceActorKey,
      action: 'allow',
      policyVersion: 1,
      occurredAt: input.occurredAt,
      result: 'applied',
      failureClass: null,
    })
    .run()
}

const allowGrant = (db: Db): void => {
  setGrantState(
    { grantKey: GRANT.grantKey, keyVersion: GRANT.keyVersion, state: 'allow', policyVersion: 1, nowMs: T - 400 * DAY },
    { getDrizzleDb: (): Db => db },
  )
}

const eventRow = (db: Db, eventId: string): typeof schema.analyticsEvents.$inferSelect | undefined =>
  db.select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventId, eventId)).get()

const deliveryRows = (db: Db): readonly (typeof schema.analyticsDeliveries.$inferSelect)[] =>
  db.select().from(schema.analyticsDeliveries).all()

const counterRows = (db: Db): readonly (typeof schema.analyticsDailyCounters.$inferSelect)[] =>
  db.select().from(schema.analyticsDailyCounters).all()

const histogramRows = (db: Db): readonly (typeof schema.analyticsDailyHistograms.$inferSelect)[] =>
  db.select().from(schema.analyticsDailyHistograms).all()

const auditRows = (db: Db, governanceActorKey: string): readonly (typeof schema.analyticsPolicyAudit.$inferSelect)[] =>
  db
    .select()
    .from(schema.analyticsPolicyAudit)
    .where(eq(schema.analyticsPolicyAudit.governanceActorKey, governanceActorKey))
    .all()

const utcDayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

describe('retention boundary fixtures at max-1, max, max+1', () => {
  let db: Db
  let deps: RetentionJobDeps

  beforeEach(async () => {
    db = await setupTestDb()
    deps = { getDrizzleDb: (): Db => db }
  })

  test('canonical events and cascaded sessions: kept at max-1, removed at max and max+1', () => {
    const maxMs = RETENTION_MAXIMA.canonicalEventDays * DAY
    insertEventRow(db, { eventId: 'ev-kept', occurredAtMs: T + 1 - maxMs, expiresAtMs: T + 1 })
    insertEventRow(db, { eventId: 'ev-exact', occurredAtMs: T - maxMs, expiresAtMs: T })
    insertEventRow(db, { eventId: 'ev-over', occurredAtMs: T - 1 - maxMs, expiresAtMs: T - 1 })
    insertSessionRow(db, {
      sessionKey: 'sess-exact',
      actorKey: 'v1.a-actor',
      eventId: 'ev-exact',
      startMs: T - maxMs,
      endMs: T - maxMs + 1000,
    })

    purgeExpired({ nowMs: T }, deps)

    expect(eventRow(db, 'ev-kept')).toBeDefined()
    expect(eventRow(db, 'ev-exact')).toBeUndefined()
    expect(eventRow(db, 'ev-over')).toBeUndefined()
    expect(db.select().from(schema.analyticsSessions).all()).toHaveLength(0)
  })

  test('pending delivery: earlier of event expiry or 14 days', () => {
    const pendingMs = RETENTION_MAXIMA.pendingDeliveryDays * DAY
    insertSinkRow(db, 'sv-1')
    insertSinkRow(db, 'sv-2')
    insertSinkRow(db, 'sv-3')
    insertEventRow(db, { eventId: 'ev-p1', occurredAtMs: T + 1 - pendingMs, expiresAtMs: T + 1 - pendingMs + 90 * DAY })
    insertEventRow(db, { eventId: 'ev-p2', occurredAtMs: T - pendingMs, expiresAtMs: T - pendingMs + 90 * DAY })
    insertEventRow(db, { eventId: 'ev-p3', occurredAtMs: T - 1 - pendingMs, expiresAtMs: T - 1 - pendingMs + 90 * DAY })
    insertDeliveryRow(db, { eventId: 'ev-p1', sinkVersionId: 'sv-1', state: 'pending', nextAttemptAtMs: T })
    insertDeliveryRow(db, { eventId: 'ev-p2', sinkVersionId: 'sv-2', state: 'pending', nextAttemptAtMs: T })
    insertDeliveryRow(db, {
      eventId: 'ev-p3',
      sinkVersionId: 'sv-3',
      state: 'leased',
      leaseUntilMs: T + 1000,
      sendStartedAtMs: null,
    })

    purgeExpired({ nowMs: T }, deps)

    const rows = deliveryRows(db)
    expect(rows.map((row) => row.eventId)).toEqual(['ev-p1'])
    expect(eventRow(db, 'ev-p1')).toBeDefined()
    expect(eventRow(db, 'ev-p2')).toBeDefined()
    expect(eventRow(db, 'ev-p3')).toBeDefined()
  })

  test('pending delivery: event expiry earlier than 14 days removes event and delivery together', () => {
    insertSinkRow(db, 'sv-1')
    insertEventRow(db, { eventId: 'ev-x', occurredAtMs: T - 90 * DAY, expiresAtMs: T })
    insertDeliveryRow(db, { eventId: 'ev-x', sinkVersionId: 'sv-1', state: 'pending', nextAttemptAtMs: T })

    purgeExpired({ nowMs: T }, deps)

    expect(deliveryRows(db)).toHaveLength(0)
    expect(eventRow(db, 'ev-x')).toBeUndefined()
  })

  test('delivery receipts and errors: 30 days after settlement', () => {
    const receiptMs = RETENTION_MAXIMA.deliveryReceiptDays * DAY
    insertSinkRow(db, 'sv-1')
    insertSinkRow(db, 'sv-2')
    insertSinkRow(db, 'sv-3')
    insertSinkRow(db, 'sv-4')
    insertEventRow(db, { eventId: 'ev-r1', occurredAtMs: T - DAY, expiresAtMs: T + 89 * DAY })
    insertEventRow(db, { eventId: 'ev-r2', occurredAtMs: T - DAY, expiresAtMs: T + 89 * DAY })
    insertEventRow(db, { eventId: 'ev-r3', occurredAtMs: T - DAY, expiresAtMs: T + 89 * DAY })
    insertEventRow(db, { eventId: 'ev-r4', occurredAtMs: T - DAY, expiresAtMs: T + 89 * DAY })
    insertDeliveryRow(db, {
      eventId: 'ev-r1',
      sinkVersionId: 'sv-1',
      state: 'delivered',
      deliveredAtMs: T + 1 - receiptMs,
    })
    insertDeliveryRow(db, { eventId: 'ev-r2', sinkVersionId: 'sv-2', state: 'delivered', deliveredAtMs: T - receiptMs })
    insertDeliveryRow(db, {
      eventId: 'ev-r3',
      sinkVersionId: 'sv-3',
      state: 'dead',
      lastErrorClass: 'http_5xx',
      nextAttemptAtMs: T - receiptMs,
    })
    insertDeliveryRow(db, {
      eventId: 'ev-r4',
      sinkVersionId: 'sv-4',
      state: 'dead',
      lastErrorClass: 'timeout',
      nextAttemptAtMs: T + 1 - receiptMs,
    })

    purgeExpired({ nowMs: T }, deps)

    expect(
      deliveryRows(db)
        .map((row) => row.eventId)
        .sort(),
    ).toEqual(['ev-r1', 'ev-r4'])
  })

  test('local aggregates expire at 90 days; assessed thresholded rollups retained to 400 days', () => {
    const base = T - (T % DAY)
    const localDeadline = base + RETENTION_MAXIMA.canonicalEventDays * DAY
    insertCounterRow(db, { utcDay: utcDayOf(base), metric: 'kept-local' })
    insertCounterRow(db, { utcDay: utcDayOf(base - DAY), metric: 'exact-local' })
    insertCounterRow(db, { utcDay: utcDayOf(base - 2 * DAY), metric: 'over-local' })
    insertHistogramRow(db, { utcDay: utcDayOf(base - DAY) })

    purgeExpired({ nowMs: localDeadline }, deps)

    expect(counterRows(db).map((row) => row.metric)).toEqual(['kept-local'])
    expect(histogramRows(db)).toHaveLength(0)

    const assessedBase = T - (T % DAY)
    const assessedDeadline = assessedBase + RETENTION_MAXIMA.assessedRollupDays * DAY
    insertCounterRow(db, { utcDay: utcDayOf(assessedBase), metric: 'assessed-kept', threshold: 10 })
    insertCounterRow(db, { utcDay: utcDayOf(assessedBase - DAY), metric: 'assessed-exact', threshold: 10 })

    purgeExpired({ nowMs: assessedDeadline }, deps)

    expect(counterRows(db).map((row) => row.metric)).toEqual(['assessed-kept'])
  })

  test('superseded governance audit: 400 days, newest row always retained', () => {
    const auditMs = RETENTION_MAXIMA.supersededGovernanceAuditDays * DAY
    insertAuditRow(db, { auditId: 'a-latest', governanceActorKey: 'v1.g-actor', occurredAt: T })
    insertAuditRow(db, { auditId: 'a-kept', governanceActorKey: 'v1.g-actor', occurredAt: T + 1 - auditMs })
    insertAuditRow(db, { auditId: 'a-exact', governanceActorKey: 'v1.g-actor', occurredAt: T - auditMs })
    insertAuditRow(db, { auditId: 'a-over', governanceActorKey: 'v1.g-actor', occurredAt: T - 1 - auditMs })
    insertAuditRow(db, { auditId: 'a-solo-old', governanceActorKey: 'v1.g-solo', occurredAt: T - 1 - auditMs })

    purgeExpired({ nowMs: T }, deps)

    expect(
      auditRows(db, 'v1.g-actor')
        .map((row) => row.auditId)
        .sort(),
    ).toEqual(['a-kept', 'a-latest'])
    expect(auditRows(db, 'v1.g-solo').map((row) => row.auditId)).toEqual(['a-solo-old'])
  })
})

describe('read boundary: every path hides the row at the exact deadline', () => {
  let db: Db
  let deps: RetentionJobDeps
  let deliveryDeps: DeliveryStoreDeps

  beforeEach(async () => {
    db = await setupTestDb()
    deps = { getDrizzleDb: (): Db => db }
    deliveryDeps = { getDrizzleDb: (): Db => db, grantMutex: createGrantSendMutex() }
  })

  test('canonical query: visible at expires_at-1, hidden at expires_at and expires_at+1', () => {
    insertEventRow(db, { eventId: 'ev-q', occurredAtMs: T - 90 * DAY, expiresAtMs: T })
    expect(loadUnexpiredEventRow({ eventId: 'ev-q', nowMs: T - 1 }, deps)).not.toBeNull()
    expect(loadUnexpiredEventRow({ eventId: 'ev-q', nowMs: T }, deps)).toBeNull()
    expect(loadUnexpiredEventRow({ eventId: 'ev-q', nowMs: T + 1 }, deps)).toBeNull()
  })

  test('snapshot source: visible at expires_at-1, hidden at expires_at and expires_at+1', () => {
    insertEventRow(db, { eventId: 'ev-s', occurredAtMs: T - 90 * DAY, expiresAtMs: T })
    expect(listSnapshotSourceEvents({ storageGeneration: ACTIVE_GENERATION, nowMs: T - 1 }, deps)).toHaveLength(1)
    expect(listSnapshotSourceEvents({ storageGeneration: ACTIVE_GENERATION, nowMs: T }, deps)).toHaveLength(0)
    expect(listSnapshotSourceEvents({ storageGeneration: ACTIVE_GENERATION, nowMs: T + 1 }, deps)).toHaveLength(0)
  })

  test('derivation: materializes at expires_at-1, never at expires_at or expires_at+1', async () => {
    const runDerive = (nowMs: number): number => {
      const result = runDeriveJob(
        {
          processEpochId: EPOCH_ID,
          key: ANALYTICS_KEY,
          keyVersion: KeyVersionSchema.parse('v1'),
          nowMs,
          localMode: 'local_pseudonymous',
          windowStartMs: T - 90 * DAY - 1,
          windowEndMs: nowMs,
        },
        { getDrizzleDb: (): Db => db },
      )
      return result.sessionsWritten
    }
    const seedTurn = (): void => {
      insertEventRow(db, {
        eventId: 'ev-d-start',
        occurredAtMs: T - 90 * DAY,
        expiresAtMs: T,
        turnKey: 'v1.t-turn-d',
        eventName: 'turn_started',
      })
      insertEventRow(db, {
        eventId: 'ev-d-end',
        occurredAtMs: T - 90 * DAY + 1000,
        expiresAtMs: T,
        turnKey: 'v1.t-turn-d',
        eventName: 'turn_completed',
      })
    }

    seedTurn()
    expect(runDerive(T - 1)).toBeGreaterThan(0)

    db = await setupTestDb()
    deps = { getDrizzleDb: (): Db => db }
    seedTurn()
    expect(runDerive(T)).toBe(0)

    db = await setupTestDb()
    deps = { getDrizzleDb: (): Db => db }
    seedTurn()
    expect(runDerive(T + 1)).toBe(0)
  })

  test('export: includes the row at expires_at-1, excludes it at expires_at and expires_at+1', async () => {
    const seedSubjectEvent = (): void => {
      insertEventRow(db, {
        eventId: 'ev-e',
        occurredAtMs: T - 90 * DAY,
        expiresAtMs: T,
        actorKey: actorKeyFor('user-a'),
      })
    }
    const subjectDeps = (): SubjectServiceDeps => ({
      getDrizzleDb: (): Db => db,
      keyrings,
      snapshotInvalidator: createSnapshotInvalidator({ getDrizzleDb: (): Db => db }),
    })

    seedSubjectEvent()
    const atMinusOne = exportSubjectData({ platformInstanceId: 'pi-1', platformUserId: 'user-a' }, subjectDeps(), T - 1)
    expect(atMinusOne.productAnalytics.events).toHaveLength(1)

    db = await setupTestDb()
    seedSubjectEvent()
    const atExact = exportSubjectData({ platformInstanceId: 'pi-1', platformUserId: 'user-a' }, subjectDeps(), T)
    expect(atExact.productAnalytics.events).toHaveLength(0)

    db = await setupTestDb()
    seedSubjectEvent()
    const atPlusOne = exportSubjectData({ platformInstanceId: 'pi-1', platformUserId: 'user-a' }, subjectDeps(), T + 1)
    expect(atPlusOne.productAnalytics.events).toHaveLength(0)
  })

  test('lease: takes the row at expires_at-1, never at expires_at or expires_at+1', () => {
    insertSinkRow(db, 'sv-1')
    allowGrant(db)
    insertEventRow(db, { eventId: 'ev-l', occurredAtMs: T - 90 * DAY, expiresAtMs: T })
    enqueueDelivery({ eventId: 'ev-l', sinkVersionId: 'sv-1', grant: GRANT, nowMs: T - 2 }, deliveryDeps)

    expect(leaseDeliveries({ nowMs: T - 1, leaseMs: 10_000, limit: 10, maxAttempts: 3 }, deliveryDeps)).toHaveLength(1)
    expect(leaseDeliveries({ nowMs: T, leaseMs: 10_000, limit: 10, maxAttempts: 3 }, deliveryDeps)).toHaveLength(0)
    expect(leaseDeliveries({ nowMs: T + 1, leaseMs: 10_000, limit: 10, maxAttempts: 3 }, deliveryDeps)).toHaveLength(0)
  })

  test('send: starts at expires_at-1, refused at expires_at and expires_at+1', async () => {
    insertSinkRow(db, 'sv-1')
    allowGrant(db)
    insertEventRow(db, { eventId: 'ev-send', occurredAtMs: T - 90 * DAY, expiresAtMs: T })
    enqueueDelivery({ eventId: 'ev-send', sinkVersionId: 'sv-1', grant: GRANT, nowMs: T - 2 }, deliveryDeps)
    leaseDeliveries({ nowMs: T - 2, leaseMs: 10_000, limit: 10, maxAttempts: 3 }, deliveryDeps)

    expect(
      markSendStarted({ eventId: 'ev-send', sinkVersionId: 'sv-1', grant: GRANT, nowMs: T - 1 }, deliveryDeps),
    ).toBe('started')

    db = await setupTestDb()
    deliveryDeps = { getDrizzleDb: (): Db => db, grantMutex: createGrantSendMutex() }
    insertSinkRow(db, 'sv-1')
    allowGrant(db)
    insertEventRow(db, { eventId: 'ev-send', occurredAtMs: T - 90 * DAY, expiresAtMs: T })
    enqueueDelivery({ eventId: 'ev-send', sinkVersionId: 'sv-1', grant: GRANT, nowMs: T - 2 }, deliveryDeps)
    leaseDeliveries({ nowMs: T - 2, leaseMs: 100_000, limit: 10, maxAttempts: 3 }, deliveryDeps)
    expect(markSendStarted({ eventId: 'ev-send', sinkVersionId: 'sv-1', grant: GRANT, nowMs: T }, deliveryDeps)).toBe(
      'event_expired',
    )
    expect(
      markSendStarted({ eventId: 'ev-send', sinkVersionId: 'sv-1', grant: GRANT, nowMs: T + 1 }, deliveryDeps),
    ).toBe('event_expired')
  })
})

describe('startup purge barrier', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('readers, snapshot, and delivery workers are blocked until purgeExpiredBeforeStart finishes', () => {
    insertSinkRow(db, 'sv-1')
    insertEventRow(db, { eventId: 'ev-overdue', occurredAtMs: T - 90 * DAY - DAY, expiresAtMs: T - DAY })
    insertDeliveryRow(db, { eventId: 'ev-overdue', sinkVersionId: 'sv-1', state: 'pending', nextAttemptAtMs: T - DAY })
    insertCounterRow(db, { utcDay: utcDayOf(T - 100 * DAY), metric: 'overdue-counter' })

    const barrier = createRetentionBarrier({ getDrizzleDb: (): Db => db })
    expect(() => barrier.assertReadersAllowed()).toThrow()

    barrier.purgeExpiredBeforeStart({ nowMs: T })
    barrier.assertReadersAllowed()

    expect(eventRow(db, 'ev-overdue')).toBeUndefined()
    expect(deliveryRows(db)).toHaveLength(0)
    expect(counterRows(db)).toHaveLength(0)
  })

  test('a second barrier instance also requires its own purge before readers are allowed', () => {
    const first = createRetentionBarrier({ getDrizzleDb: (): Db => db })
    first.purgeExpiredBeforeStart({ nowMs: T })
    const second = createRetentionBarrier({ getDrizzleDb: (): Db => db })
    expect(() => second.assertReadersAllowed()).toThrow()
    second.purgeExpiredBeforeStart({ nowMs: T })
    second.assertReadersAllowed()
  })
})

describe('nextExpiryDeadline wakes at the earliest row deadline and at least once per minute', () => {
  let db: Db
  let deps: RetentionJobDeps

  beforeEach(async () => {
    db = await setupTestDb()
    deps = { getDrizzleDb: (): Db => db }
  })

  test('no rows: wake one minute out (the daily censor materialization is not the enforcement clock)', () => {
    expect(nextExpiryDeadline({ nowMs: T }, deps)).toBe(T + MINUTE)
  })

  test('earliest event deadline wins when it is within a minute', () => {
    insertEventRow(db, { eventId: 'ev-1', occurredAtMs: T, expiresAtMs: T + 30_000 })
    insertEventRow(db, { eventId: 'ev-2', occurredAtMs: T, expiresAtMs: T + 45_000 })
    expect(nextExpiryDeadline({ nowMs: T }, deps)).toBe(T + 30_000)
  })

  test('wake is capped at one minute even when the earliest deadline is further out', () => {
    insertEventRow(db, { eventId: 'ev-1', occurredAtMs: T, expiresAtMs: T + 5 * MINUTE })
    expect(nextExpiryDeadline({ nowMs: T }, deps)).toBe(T + MINUTE)
  })

  test('a pending delivery deadline earlier than event expiry wins', () => {
    insertSinkRow(db, 'sv-1')
    insertEventRow(db, { eventId: 'ev-1', occurredAtMs: T - 14 * DAY + 30_000, expiresAtMs: T + 76 * DAY })
    insertDeliveryRow(db, { eventId: 'ev-1', sinkVersionId: 'sv-1', state: 'pending', nextAttemptAtMs: T })
    expect(nextExpiryDeadline({ nowMs: T }, deps)).toBe(T + 30_000)
  })

  test('already-expired rows do not push the wake into the past', () => {
    insertEventRow(db, { eventId: 'ev-1', occurredAtMs: T - 100 * DAY, expiresAtMs: T - 10 * DAY })
    expect(nextExpiryDeadline({ nowMs: T }, deps)).toBe(T + MINUTE)
  })
})

describe('retention policy: maxima are fixed defaults, configurable only downward', () => {
  test('defaults equal the fixed maxima', () => {
    expect(resolveRetentionLimits()).toEqual({
      canonicalEventDays: RETENTION_MAXIMA.canonicalEventDays,
      pendingDeliveryDays: RETENTION_MAXIMA.pendingDeliveryDays,
      deliveryReceiptDays: RETENTION_MAXIMA.deliveryReceiptDays,
      assessedRollupDays: RETENTION_MAXIMA.assessedRollupDays,
      supersededGovernanceAuditDays: RETENTION_MAXIMA.supersededGovernanceAuditDays,
    })
  })

  test('values above the maxima are rejected', () => {
    expect(() => resolveRetentionLimits({ canonicalEventDays: RETENTION_MAXIMA.canonicalEventDays + 1 })).toThrow(
      RetentionLimitExceededError,
    )
    expect(() => resolveRetentionLimits({ pendingDeliveryDays: RETENTION_MAXIMA.pendingDeliveryDays + 1 })).toThrow(
      RetentionLimitExceededError,
    )
    expect(() => resolveRetentionLimits({ deliveryReceiptDays: RETENTION_MAXIMA.deliveryReceiptDays + 1 })).toThrow(
      RetentionLimitExceededError,
    )
    expect(() => resolveRetentionLimits({ assessedRollupDays: RETENTION_MAXIMA.assessedRollupDays + 1 })).toThrow(
      RetentionLimitExceededError,
    )
    expect(() =>
      resolveRetentionLimits({ supersededGovernanceAuditDays: RETENTION_MAXIMA.supersededGovernanceAuditDays + 1 }),
    ).toThrow(RetentionLimitExceededError)
  })

  test('values at or below the maxima are accepted', () => {
    expect(resolveRetentionLimits({ canonicalEventDays: RETENTION_MAXIMA.canonicalEventDays }).canonicalEventDays).toBe(
      RETENTION_MAXIMA.canonicalEventDays,
    )
    const lowered = resolveRetentionLimits({ canonicalEventDays: 30, pendingDeliveryDays: 7 })
    expect(lowered.canonicalEventDays).toBe(30)
    expect(lowered.pendingDeliveryDays).toBe(7)
    expect(lowered.deliveryReceiptDays).toBe(RETENTION_MAXIMA.deliveryReceiptDays)
  })

  test('non-positive or non-integer values are rejected', () => {
    expect(() => resolveRetentionLimits({ canonicalEventDays: 0 })).toThrow(RetentionLimitExceededError)
    expect(() => resolveRetentionLimits({ canonicalEventDays: -5 })).toThrow(RetentionLimitExceededError)
    expect(() => resolveRetentionLimits({ canonicalEventDays: 30.5 })).toThrow(RetentionLimitExceededError)
  })

  test('isUnexpired hides the row at the exact deadline', () => {
    expect(isUnexpired(T - 1, T)).toBe(true)
    expect(isUnexpired(T, T)).toBe(false)
    expect(isUnexpired(T + 1, T)).toBe(false)
    expect(canonicalEventExpiryMs(T - 90 * DAY)).toBe(T)
  })
})

describe('physical expiry ordering is enforced by ON DELETE RESTRICT', () => {
  let db: Db
  let deps: RetentionJobDeps

  beforeEach(async () => {
    db = await setupTestDb()
    deps = { getDrizzleDb: (): Db => db }
  })

  test('deleting a canonical event before its delivery rows fails; the purge order succeeds', () => {
    insertSinkRow(db, 'sv-1')
    insertEventRow(db, { eventId: 'ev-ord', occurredAtMs: T - 90 * DAY, expiresAtMs: T })
    insertDeliveryRow(db, { eventId: 'ev-ord', sinkVersionId: 'sv-1', state: 'pending', nextAttemptAtMs: T })

    expect(() => db.delete(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventId, 'ev-ord')).run()).toThrow()
    expect(eventRow(db, 'ev-ord')).toBeDefined()

    purgeExpired({ nowMs: T }, deps)
    expect(deliveryRows(db)).toHaveLength(0)
    expect(eventRow(db, 'ev-ord')).toBeUndefined()
  })

  test('physical expiry settles pending, leased, sending, and delivered rows before removing the event', () => {
    insertSinkRow(db, 'sv-1')
    insertSinkRow(db, 'sv-2')
    insertSinkRow(db, 'sv-3')
    insertSinkRow(db, 'sv-4')
    insertEventRow(db, { eventId: 'ev-st', occurredAtMs: T - 90 * DAY, expiresAtMs: T })
    insertDeliveryRow(db, { eventId: 'ev-st', sinkVersionId: 'sv-1', state: 'pending', nextAttemptAtMs: T })
    insertDeliveryRow(db, { eventId: 'ev-st', sinkVersionId: 'sv-2', state: 'leased', leaseUntilMs: T + 1000 })
    insertDeliveryRow(db, {
      eventId: 'ev-st',
      sinkVersionId: 'sv-3',
      state: 'sending',
      sendStartedAtMs: T - 100,
      leaseUntilMs: T + 1000,
    })
    insertDeliveryRow(db, { eventId: 'ev-st', sinkVersionId: 'sv-4', state: 'delivered', deliveredAtMs: T - DAY })

    const remoteCalls: string[] = []
    const remoteDeps: RetentionJobDeps = {
      getDrizzleDb: (): Db => db,
      requestRemoteDeletion: (sinkVersionId) => {
        remoteCalls.push(sinkVersionId)
        return { remoteReceiptHash: `remote-${sinkVersionId}` }
      },
    }
    const result = purgeExpired({ nowMs: T }, remoteDeps)

    expect(remoteCalls).toEqual(['sv-3', 'sv-4'])
    expect(deliveryRows(db)).toHaveLength(0)
    expect(eventRow(db, 'ev-st')).toBeUndefined()
    expect(result.deliveryRowsRemoved).toBe(4)
    expect(result.eventsRemoved).toBe(1)
    const receipts = db.select().from(schema.analyticsDeliveryDeletionReceipts).all()
    expect(receipts.map((row) => row.sinkVersionId).sort()).toEqual(['sv-3', 'sv-4'])
  })
})

describe('normalizer ingest boundary: expired-at-ingest facts never enter the pipeline', () => {
  const env = (ingestedAtMs: number): NormalizerEnv => ({
    hmacKey: ANALYTICS_KEY,
    keyVersion: KeyVersionSchema.parse('v1'),
    installId: 'install-retention',
    appVersion: VersionStringSchema.parse('6.10.0'),
    policyVersion: 1,
    ingestedAtMs,
  })

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

  const fact = {
    version: 1,
    type: 'chat_message_accepted',
    sourceEventId: 'se-retention-1',
    occurredAtMs: T - 90 * DAY,
    source: memberSource,
    inputCount: 1,
    inputLengthChars: 200,
    attachmentCount: 0,
    isCommand: false,
    command: 'none',
  } as const

  test('a fact at max age minus one millisecond still normalizes', () => {
    expect(normalize(fact, env(T - 1)).status).toBe('ok')
  })

  test('a fact at or beyond max age is rejected', () => {
    expect(normalize(fact, env(T)).status).toBe('rejected')
    expect(normalize(fact, env(T + 1)).status).toBe('rejected')
  })
})
