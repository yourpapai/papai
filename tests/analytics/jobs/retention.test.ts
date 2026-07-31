// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  createRetentionBarrier,
  nextExpiryDeadline,
  purgeExpired,
  purgeExpiredBeforeStart,
} from '../../../src/analytics/jobs/retention.js'
import type { RetentionJobDeps } from '../../../src/analytics/jobs/retention.js'
import { DAY_MS, MINUTE_MS } from '../../../src/analytics/retention/expiry-guard.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const T = 1_800_000_000_000

const insertEventRow = (db: Db, eventId: string, occurredAtMs: number, expiresAtMs: number): void => {
  db.insert(schema.analyticsProcessEpochs)
    .values({ epochId: 'epoch-ret-job', state: 'open', startedAtMs: T - 400 * DAY_MS })
    .onConflictDoNothing()
    .run()
  db.insert(schema.analyticsEvents)
    .values({
      eventId,
      storageGeneration: 'gen-1',
      processEpochId: 'epoch-ret-job',
      sourceRefKey: `ref-${eventId}`,
      sourceKind: 'live',
      schemaVersion: 1,
      eventName: 'turn_started',
      eventVersion: 1,
      occurredAtMs,
      ingestedAtMs: occurredAtMs + 1,
      source: 'live',
      attributionQuality: 'native',
      appVersion: '6.10.0',
      deploymentKey: 'v1.p-deploy',
      keyVersion: 'v1',
      platform: 'telegram',
      platformInstanceKey: 'v1.p-instance',
      actorKey: 'v1.a-actor',
      contextKey: 'v1.c-context',
      threadKey: null,
      conversationKey: 'v1.c-context',
      taskInstanceKey: null,
      contextType: 'dm',
      actorRole: 'member',
      taskProvider: 'none',
      invocationMode: 'normal',
      turnKey: null,
      sessionKey: null,
      policyVersion: 1,
      eligibility: 'allowed',
      maxClass: 'C0',
      propsJson: '{}',
      expiresAtMs,
    })
    .run()
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
      endpointCiphertext: 'ct',
      secretCiphertext: 'ct',
      configFingerprint: `fp-${sinkVersionId}`,
      createdAtMs: T,
    })
    .run()
}

const insertDelivery = (db: Db, eventId: string, sinkVersionId: string, state: string, nextAttemptAtMs = T): void => {
  db.insert(schema.analyticsDeliveries)
    .values({
      eventId,
      sinkVersionId,
      grantKey: 'v1.d-grant',
      grantKeyVersion: 'v1',
      grantGeneration: 1,
      state,
      attempts: 0,
      nextAttemptAtMs,
      payloadSchemaVersion: 1,
    })
    .run()
}

describe('retention job', () => {
  let db: Db
  let deps: RetentionJobDeps

  beforeEach(async () => {
    db = await setupTestDb()
    deps = { getDrizzleDb: (): Db => db }
  })

  test('purgeExpired removes expired events and their delivery rows in FK-safe order', () => {
    insertEventRow(db, 'ev-old', T - 90 * DAY_MS, T - 1)
    insertEventRow(db, 'ev-live', T - DAY_MS, T + 89 * DAY_MS)
    insertSink(db, 'sv-1')
    insertDelivery(db, 'ev-old', 'sv-1', 'pending')

    const result = purgeExpired({ nowMs: T }, deps)
    expect(result.eventsRemoved).toBe(1)
    expect(result.deliveryRowsRemoved).toBe(1)
    expect(
      db
        .select()
        .from(schema.analyticsEvents)
        .all()
        .map((row) => row.eventId),
    ).toEqual(['ev-live'])
    expect(db.select().from(schema.analyticsDeliveries).all()).toHaveLength(0)
  })

  test('purgeExpired honours downward-configured limits', () => {
    const dayStart = T - (T % DAY_MS)
    const utcDay = new Date(dayStart - 45 * DAY_MS).toISOString().slice(0, 10)
    db.insert(schema.analyticsDailyCounters)
      .values({
        utcDay,
        definitionVersion: 1,
        platform: 'telegram',
        contextType: 'dm',
        actorRole: 'member',
        taskProvider: 'none',
        appVersion: '6.10.0',
        metric: 'turns',
        value: 1,
        finalized: false,
        partialDay: false,
        restartGapDetected: false,
        lateEventCount: 0,
        reconciliationStatus: 'complete_epoch',
        disclosureScope: 'local_only',
        contributorBasis: 'not_required',
        contributorCount: null,
        threshold: null,
      })
      .run()
    const kept = purgeExpired({ nowMs: T }, deps)
    expect(kept.aggregateRowsRemoved).toBe(0)
    const removed = purgeExpired({ nowMs: T, limits: { canonicalEventDays: 30 } }, deps)
    expect(removed.aggregateRowsRemoved).toBe(1)
  })

  test('purgeExpiredBeforeStart is the same purge exposed as the startup barrier step', () => {
    insertEventRow(db, 'ev-old', T - 90 * DAY_MS, T - 1)
    const result = purgeExpiredBeforeStart({ nowMs: T }, deps)
    expect(result.eventsRemoved).toBe(1)
  })

  test('nextExpiryDeadline wakes at the earliest row deadline, capped at one minute', () => {
    expect(nextExpiryDeadline({ nowMs: T }, deps)).toBe(T + MINUTE_MS)
    insertEventRow(db, 'ev-1', T, T + 5_000)
    expect(nextExpiryDeadline({ nowMs: T }, deps)).toBe(T + 5_000)
  })

  test('the barrier gates readers until the startup purge completes', () => {
    const barrier = createRetentionBarrier(deps)
    expect(() => barrier.assertReadersAllowed()).toThrow()
    barrier.purgeExpiredBeforeStart({ nowMs: T })
    expect(() => barrier.assertReadersAllowed()).not.toThrow()
  })
})
