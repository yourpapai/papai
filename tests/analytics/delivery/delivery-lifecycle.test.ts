// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { enqueueDelivery, markSendStarted, renewLease } from '../../../src/analytics/delivery/delivery-lifecycle.js'
import { leaseDeliveries } from '../../../src/analytics/delivery/store.js'
import type { DeliveryStoreDeps } from '../../../src/analytics/delivery/store.js'
import { createGrantSendMutex } from '../../../src/analytics/governance/grant-serialization.js'
import { checkGrantCurrentIn, setGrantState } from '../../../src/analytics/governance/grant-store.js'
import {
  analyticsDeliveries,
  analyticsEligibilityGrants,
  analyticsEvents,
  analyticsProcessEpochs,
  analyticsSinks,
  llmUsageEvents,
} from '../../../src/db/schema.js'
import type { AnalyticsDeliveryRow } from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const requireFirst = <T>(items: readonly T[]): T => {
  const item = items[0]
  if (item === undefined) throw new Error('expected at least one item')
  return item
}

const NOW = 1_700_000_000_000
const GRANT = { grantKey: 'v1.d-grant-1', keyVersion: 'v1', generation: 1 }

const insertEvent = (db: Db, eventId: string): void => {
  db.insert(analyticsProcessEpochs)
    .values({ epochId: 'epoch-1', state: 'open', startedAtMs: NOW })
    .onConflictDoNothing()
    .run()
  db.insert(analyticsEvents)
    .values({
      eventId,
      storageGeneration: 'gen-1',
      processEpochId: 'epoch-1',
      sourceRefKey: `ref-${eventId}`,
      sourceKind: 'live',
      schemaVersion: 1,
      eventName: 'turn_started',
      eventVersion: 1,
      occurredAtMs: NOW,
      ingestedAtMs: NOW + 1,
      source: 'live',
      attributionQuality: 'native',
      appVersion: '6.10.0',
      deploymentKey: 'v1.p-deploy',
      keyVersion: 'v1',
      platform: 'telegram',
      platformInstanceKey: 'v1.p-instance',
      actorKey: 'v1.a-actor',
      conversationKey: 'v1.c-conv',
      contextType: 'dm',
      actorRole: 'admin',
      taskProvider: 'none',
      invocationMode: 'normal',
      turnKey: 'v1.t-turn',
      policyVersion: 1,
      eligibility: 'allowed',
      maxClass: 'C0',
      propsJson: '{"x":1}',
      expiresAtMs: NOW + 100_000_000,
    })
    .run()
}

const insertSink = (db: Db, sinkVersionId: string, state = 'disabled'): void => {
  db.insert(analyticsSinks)
    .values({
      sinkVersionId,
      logicalSinkId: `logical-${sinkVersionId}`,
      version: 1,
      kind: 'webhook',
      state,
      payloadSchemaVersion: 1,
      egressMode: 'pseudonymous',
      endpointCiphertext: 'ct-endpoint',
      secretCiphertext: 'ct-secret',
      configFingerprint: `fp-${sinkVersionId}`,
      createdAtMs: NOW,
    })
    .run()
}

const allowGrant = (db: Db, grantKey = GRANT.grantKey): void => {
  setGrantState(
    { grantKey, keyVersion: 'v1', state: 'allow', policyVersion: 1, nowMs: NOW },
    { getDrizzleDb: () => db },
  )
}

const getDelivery = (db: Db, eventId: string, sinkVersionId: string): AnalyticsDeliveryRow | undefined =>
  db
    .select()
    .from(analyticsDeliveries)
    .where(eq(analyticsDeliveries.eventId, eventId))
    .all()
    .find((row) => row.sinkVersionId === sinkVersionId)

const seed = (db: Db, eventId = 'event-1', sinkVersionId = 'sv-1'): void => {
  insertEvent(db, eventId)
  insertSink(db, sinkVersionId)
  allowGrant(db)
}

describe('delivery lifecycle admission', () => {
  let db: Db
  let deps: DeliveryStoreDeps

  beforeEach(async () => {
    db = await setupTestDb()
    deps = { getDrizzleDb: (): Db => db, grantMutex: createGrantSendMutex() }
  })

  test('one event enqueues independently to two disabled sink versions; a referenced version cannot be deleted', () => {
    insertEvent(db, 'event-1')
    insertSink(db, 'sv-1')
    insertSink(db, 'sv-2')
    allowGrant(db)

    expect(enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)).toEqual({
      status: 'enqueued',
    })
    expect(enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-2', grant: GRANT, nowMs: NOW }, deps)).toEqual({
      status: 'enqueued',
    })

    const rows = db.select().from(analyticsDeliveries).all()
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.sinkVersionId))).toEqual(new Set(['sv-1', 'sv-2']))
    expect(rows.every((row) => row.state === 'pending')).toBe(true)

    expect(() => db.$client.run(`DELETE FROM analytics_sinks WHERE sink_version_id = 'sv-1'`)).toThrow()
    expect(() => db.$client.run(`DELETE FROM analytics_sinks WHERE sink_version_id = 'sv-2'`)).toThrow()
  })

  test('enqueue is idempotent per (event_id, sink_version_id)', () => {
    seed(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)
    expect(enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)).toEqual({
      status: 'already_present',
    })
  })

  test('enqueue never reads or changes the legacy forwarded columns', () => {
    seed(db)
    db.insert(llmUsageEvents)
      .values({
        eventId: 'legacy-1',
        occurredAt: NOW,
        storageContextId: 'ctx-1',
        contextType: 'dm',
        chatUserId: 'user-1',
        model: 'm',
        modelRole: 'primary',
        durationMs: 1,
        forwardedAt: 123,
        forwardAttempts: 4,
        forwardError: 'boom',
      })
      .run()

    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)

    const legacy = db.select().from(llmUsageEvents).all()
    expect(legacy).toHaveLength(1)
    expect(legacy[0]).toMatchObject({ forwardedAt: 123, forwardAttempts: 4, forwardError: 'boom' })
  })

  test('enqueue stores the grant only in the delivery row; canonical analytics never receives it', () => {
    seed(db)
    const before = db.select().from(analyticsEvents).all()
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)
    const after = db.select().from(analyticsEvents).all()
    expect(after).toEqual(before)

    const row = getDelivery(db, 'event-1', 'sv-1')
    expect(row).toMatchObject({
      grantKey: GRANT.grantKey,
      grantKeyVersion: GRANT.keyVersion,
      grantGeneration: GRANT.generation,
    })
  })

  test('grant revoked before enqueue yields no row', () => {
    seed(db)
    setGrantState(
      { grantKey: GRANT.grantKey, keyVersion: 'v1', state: 'deny', policyVersion: 1, nowMs: NOW + 1 },
      { getDrizzleDb: () => db },
    )
    expect(enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)).toEqual({
      status: 'grant_not_current',
    })
    expect(db.select().from(analyticsDeliveries).all()).toHaveLength(0)
  })

  test('grant generation changing during the transaction yields no row, never a stale grant', () => {
    seed(db)
    const racingDeps: DeliveryStoreDeps = {
      getDrizzleDb: () => db,
      recheckGrant: (tx, ref) => {
        tx.update(analyticsEligibilityGrants)
          .set({ state: 'deny', generation: ref.generation + 1, revokedAt: NOW + 1 })
          .where(eq(analyticsEligibilityGrants.grantKey, ref.grantKey))
          .run()
        return checkGrantCurrentIn(tx, ref)
      },
    }
    expect(
      enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, racingDeps),
    ).toEqual({
      status: 'grant_not_current',
    })
    expect(db.select().from(analyticsDeliveries).all()).toHaveLength(0)
  })

  test('enqueue with the exact current generation stores that generation', () => {
    seed(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)
    setGrantState(
      { grantKey: GRANT.grantKey, keyVersion: 'v1', state: 'deny', policyVersion: 1, nowMs: NOW + 1 },
      { getDrizzleDb: () => db },
    )
    setGrantState(
      { grantKey: GRANT.grantKey, keyVersion: 'v1', state: 'allow', policyVersion: 1, nowMs: NOW + 2 },
      { getDrizzleDb: () => db },
    )
    insertSink(db, 'sv-2')
    expect(
      enqueueDelivery(
        { eventId: 'event-1', sinkVersionId: 'sv-2', grant: { ...GRANT, generation: 2 }, nowMs: NOW },
        deps,
      ),
    ).toEqual({ status: 'enqueued' })
    expect(getDelivery(db, 'event-1', 'sv-2')?.grantGeneration).toBe(2)
  })

  test('lease renewal requires the current lease token; a different worker is rejected', () => {
    seed(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)
    const leased = leaseDeliveries({ nowMs: NOW, leaseMs: 100, limit: 10, maxAttempts: 3 }, deps)
    const token = requireFirst(leased).leaseUntilMs
    expect(token).toBe(NOW + 100)

    expect(
      renewLease(
        { eventId: 'event-1', sinkVersionId: 'sv-1', expectedLeaseUntilMs: token, nowMs: NOW + 50, leaseMs: 100 },
        deps,
      ),
    ).toBe(true)
    expect(getDelivery(db, 'event-1', 'sv-1')?.leaseUntilMs).toBe(NOW + 150)

    expect(
      renewLease(
        { eventId: 'event-1', sinkVersionId: 'sv-1', expectedLeaseUntilMs: token, nowMs: NOW + 60, leaseMs: 100 },
        deps,
      ),
    ).toBe(false)
    expect(getDelivery(db, 'event-1', 'sv-1')?.leaseUntilMs).toBe(NOW + 150)
  })

  test('send-start transitions leased to sending with a grant recheck and a durable timestamp', () => {
    seed(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)
    leaseDeliveries({ nowMs: NOW, leaseMs: 100, limit: 10, maxAttempts: 3 }, deps)

    expect(markSendStarted({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW + 10 }, deps)).toBe(
      'started',
    )
    expect(getDelivery(db, 'event-1', 'sv-1')).toMatchObject({ state: 'sending', sendStartedAtMs: NOW + 10 })
  })

  test('send-start with a stale grant does not transition', () => {
    seed(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)
    leaseDeliveries({ nowMs: NOW, leaseMs: 100, limit: 10, maxAttempts: 3 }, deps)
    setGrantState(
      { grantKey: GRANT.grantKey, keyVersion: 'v1', state: 'deny', policyVersion: 1, nowMs: NOW + 5 },
      { getDrizzleDb: () => db },
    )

    expect(markSendStarted({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW + 10 }, deps)).toBe(
      'grant_not_current',
    )
    expect(getDelivery(db, 'event-1', 'sv-1')?.state).toBe('leased')
  })

  test('send-start on an expired never-started lease returns the row to pending', () => {
    seed(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)
    leaseDeliveries({ nowMs: NOW, leaseMs: 10, limit: 10, maxAttempts: 3 }, deps)

    expect(markSendStarted({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW + 20 }, deps)).toBe(
      'lease_expired',
    )
    expect(getDelivery(db, 'event-1', 'sv-1')).toMatchObject({ state: 'pending', sendStartedAtMs: null })
  })

  test('send-start requires a live lease', () => {
    seed(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)
    expect(markSendStarted({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)).toBe(
      'not_leased',
    )
  })
})
