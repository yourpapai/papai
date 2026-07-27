// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { enqueueDelivery, markSendStarted } from '../../../src/analytics/delivery/delivery-lifecycle.js'
import { DELIVERY_ERROR_CLASSES } from '../../../src/analytics/delivery/sink.js'
import {
  classifyDelivery,
  classifySendError,
  leaseDeliveries,
  reconcileAmbiguous,
  recoverOrphanedSends,
} from '../../../src/analytics/delivery/store.js'
import type { DeliveryStoreDeps } from '../../../src/analytics/delivery/store.js'
import { createGrantSendMutex } from '../../../src/analytics/governance/grant-serialization.js'
import { setGrantState } from '../../../src/analytics/governance/grant-store.js'
import { analyticsDeliveries, analyticsEvents, analyticsProcessEpochs, analyticsSinks } from '../../../src/db/schema.js'
import type { AnalyticsDeliveryRow } from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const NOW = 1_700_000_000_000
const GRANT = { grantKey: 'v1.d-grant-1', keyVersion: 'v1', generation: 1 }
const GRANT_2 = { grantKey: 'v1.d-grant-2', keyVersion: 'v1', generation: 1 }

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

const stateCounts = (db: Db): { total: number; states: Record<string, number> } => {
  const rows = db.select().from(analyticsDeliveries).all()
  const states: Record<string, number> = {}
  for (const row of rows) states[row.state] = (states[row.state] ?? 0) + 1
  return { total: rows.length, states }
}

describe('analytics delivery store', () => {
  let db: Db
  let deps: DeliveryStoreDeps

  beforeEach(async () => {
    db = await setupTestDb()
    deps = { getDrizzleDb: (): Db => db, grantMutex: createGrantSendMutex() }
  })

  test('lease respects ready time and returns only IDs plus strict payload data', () => {
    seed(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW + 5000 }, deps)
    expect(leaseDeliveries({ nowMs: NOW, leaseMs: 100, limit: 10, maxAttempts: 3 }, deps)).toEqual([])

    const leased = leaseDeliveries({ nowMs: NOW + 5000, leaseMs: 100, limit: 10, maxAttempts: 3 }, deps)
    expect(leased).toHaveLength(1)
    expect(leased[0]).toEqual({
      eventId: 'event-1',
      sinkVersionId: 'sv-1',
      grant: GRANT,
      attempts: 1,
      leaseUntilMs: NOW + 5100,
      payload: { schemaVersion: 1, eventName: 'turn_started', occurredAtMs: NOW, propsJson: '{"x":1}' },
    })
    expect(getDelivery(db, 'event-1', 'sv-1')).toMatchObject({
      state: 'leased',
      attempts: 1,
      leaseUntilMs: NOW + 5100,
    })
  })

  test('lease acquisition is atomic: a second call does not take live leases', () => {
    seed(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)
    leaseDeliveries({ nowMs: NOW, leaseMs: 1000, limit: 10, maxAttempts: 3 }, deps)
    expect(leaseDeliveries({ nowMs: NOW + 1, leaseMs: 1000, limit: 10, maxAttempts: 3 }, deps)).toEqual([])
  })

  test('an expired never-started lease returns to pending and may retry', () => {
    seed(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)
    leaseDeliveries({ nowMs: NOW, leaseMs: 10, limit: 10, maxAttempts: 3 }, deps)

    const reLeased = leaseDeliveries({ nowMs: NOW + 20, leaseMs: 10, limit: 10, maxAttempts: 3 }, deps)
    expect(reLeased).toHaveLength(1)
    expect(reLeased[0]?.attempts).toBe(2)
    expect(getDelivery(db, 'event-1', 'sv-1')?.state).toBe('leased')
  })

  test('attempt increments are bounded: exhausted rows become dead and stop leasing', () => {
    seed(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)
    leaseDeliveries({ nowMs: NOW, leaseMs: 10, limit: 10, maxAttempts: 2 }, deps)
    leaseDeliveries({ nowMs: NOW + 20, leaseMs: 10, limit: 10, maxAttempts: 2 }, deps)
    const third = leaseDeliveries({ nowMs: NOW + 40, leaseMs: 10, limit: 10, maxAttempts: 2 }, deps)
    expect(third).toEqual([])
    expect(getDelivery(db, 'event-1', 'sv-1')).toMatchObject({ state: 'dead', attempts: 2 })
  })

  const toSending = (): void => {
    seed(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)
    leaseDeliveries({ nowMs: NOW, leaseMs: 100, limit: 10, maxAttempts: 3 }, deps)
    markSendStarted({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW + 10 }, deps)
  }

  test('the lease owner classifies a known response before lease expiry', () => {
    toSending()
    expect(
      classifyDelivery(
        {
          eventId: 'event-1',
          sinkVersionId: 'sv-1',
          nowMs: NOW + 20,
          outcome: 'delivered',
          remoteReceiptHash: 'receipt-1',
        },
        deps,
      ),
    ).toBe('classified')
    expect(getDelivery(db, 'event-1', 'sv-1')).toMatchObject({
      state: 'delivered',
      deliveredAtMs: NOW + 20,
      remoteReceiptHash: 'receipt-1',
    })
  })

  test('a retryable classification returns the row to pending with a bounded error class', () => {
    toSending()
    expect(
      classifyDelivery(
        {
          eventId: 'event-1',
          sinkVersionId: 'sv-1',
          nowMs: NOW + 20,
          outcome: 'retryable',
          errorClass: 'http_5xx',
          retryAtMs: NOW + 200,
        },
        deps,
      ),
    ).toBe('classified')
    expect(getDelivery(db, 'event-1', 'sv-1')).toMatchObject({
      state: 'pending',
      nextAttemptAtMs: NOW + 200,
      lastErrorClass: 'http_5xx',
      leaseUntilMs: null,
      sendStartedAtMs: null,
    })
  })

  test('classification after lease expiry is rejected', () => {
    toSending()
    expect(
      classifyDelivery(
        { eventId: 'event-1', sinkVersionId: 'sv-1', nowMs: NOW + 500, outcome: 'delivered', remoteReceiptHash: 'r' },
        deps,
      ),
    ).toBe('lease_expired')
    expect(getDelivery(db, 'event-1', 'sv-1')?.state).toBe('sending')
  })

  test('classification requires the sending state', () => {
    seed(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)
    expect(
      classifyDelivery(
        { eventId: 'event-1', sinkVersionId: 'sv-1', nowMs: NOW, outcome: 'delivered', remoteReceiptHash: 'r' },
        deps,
      ),
    ).toBe('not_sending')
  })

  test('send-start holds the per-grant mutex until classification releases it', () => {
    seed(db)
    const mutex = createGrantSendMutex()
    const mutexDeps: DeliveryStoreDeps = { getDrizzleDb: (): Db => db, grantMutex: mutex }
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, mutexDeps)
    leaseDeliveries({ nowMs: NOW, leaseMs: 100, limit: 10, maxAttempts: 3 }, mutexDeps)

    expect(mutex.isHeld(GRANT.grantKey)).toBe(false)
    expect(
      markSendStarted({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW + 10 }, mutexDeps),
    ).toBe('started')
    expect(mutex.isHeld(GRANT.grantKey)).toBe(true)

    insertEvent(db, 'event-2')
    insertSink(db, 'sv-2')
    enqueueDelivery({ eventId: 'event-2', sinkVersionId: 'sv-2', grant: GRANT, nowMs: NOW }, mutexDeps)
    leaseDeliveries({ nowMs: NOW, leaseMs: 100, limit: 10, maxAttempts: 3 }, mutexDeps)
    expect(
      markSendStarted({ eventId: 'event-2', sinkVersionId: 'sv-2', grant: GRANT, nowMs: NOW + 10 }, mutexDeps),
    ).toBe('send_in_progress')
    expect(getDelivery(db, 'event-2', 'sv-2')?.state).toBe('leased')

    expect(
      classifyDelivery(
        { eventId: 'event-1', sinkVersionId: 'sv-1', nowMs: NOW + 20, outcome: 'delivered', remoteReceiptHash: 'r' },
        mutexDeps,
      ),
    ).toBe('classified')
    expect(mutex.isHeld(GRANT.grantKey)).toBe(false)

    expect(
      markSendStarted({ eventId: 'event-2', sinkVersionId: 'sv-2', grant: GRANT, nowMs: NOW + 30 }, mutexDeps),
    ).toBe('started')
  })

  test('recovery of an orphaned send releases the per-grant mutex', () => {
    seed(db)
    const mutex = createGrantSendMutex()
    const mutexDeps: DeliveryStoreDeps = { getDrizzleDb: (): Db => db, grantMutex: mutex }
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, mutexDeps)
    leaseDeliveries({ nowMs: NOW, leaseMs: 100, limit: 10, maxAttempts: 3 }, mutexDeps)
    markSendStarted({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW + 10 }, mutexDeps)
    expect(mutex.isHeld(GRANT.grantKey)).toBe(true)

    expect(recoverOrphanedSends({ nowMs: NOW + 500 }, mutexDeps)).toEqual({ moved: 1 })
    expect(mutex.isHeld(GRANT.grantKey)).toBe(false)
  })

  test('recovery moves orphaned sending rows to ambiguous; live sends are untouched', () => {
    toSending()
    insertEvent(db, 'event-2')
    insertSink(db, 'sv-2')
    allowGrant(db, GRANT_2.grantKey)
    enqueueDelivery({ eventId: 'event-2', sinkVersionId: 'sv-2', grant: GRANT_2, nowMs: NOW }, deps)
    leaseDeliveries({ nowMs: NOW, leaseMs: 100000, limit: 10, maxAttempts: 3 }, deps)
    markSendStarted({ eventId: 'event-2', sinkVersionId: 'sv-2', grant: GRANT_2, nowMs: NOW + 10 }, deps)

    expect(recoverOrphanedSends({ nowMs: NOW + 500 }, deps)).toEqual({ moved: 1 })
    expect(getDelivery(db, 'event-1', 'sv-1')?.state).toBe('ambiguous')
    expect(getDelivery(db, 'event-2', 'sv-2')?.state).toBe('sending')
  })

  test('state conservation holds across transitions', () => {
    toSending()
    insertEvent(db, 'event-2')
    insertSink(db, 'sv-2')
    enqueueDelivery({ eventId: 'event-2', sinkVersionId: 'sv-2', grant: GRANT, nowMs: NOW }, deps)
    insertEvent(db, 'event-3')
    insertSink(db, 'sv-3')
    enqueueDelivery({ eventId: 'event-3', sinkVersionId: 'sv-3', grant: GRANT, nowMs: NOW }, deps)
    recoverOrphanedSends({ nowMs: NOW + 500 }, deps)

    const counts = stateCounts(db)
    const sum = Object.values(counts.states).reduce((acc, value) => acc + value, 0)
    expect(sum).toBe(counts.total)
    expect(counts.states['ambiguous']).toBe(1)
    expect(counts.states['pending']).toBe(2)
  })

  test('ambiguous rows are never selected for automatic retry', () => {
    toSending()
    recoverOrphanedSends({ nowMs: NOW + 500 }, deps)
    expect(getDelivery(db, 'event-1', 'sv-1')?.state).toBe('ambiguous')
    for (const advance of [1000, 100000, 10000000]) {
      expect(leaseDeliveries({ nowMs: NOW + 500 + advance, leaseMs: 10, limit: 10, maxAttempts: 99 }, deps)).toEqual([])
    }
    expect(getDelivery(db, 'event-1', 'sv-1')?.state).toBe('ambiguous')
  })

  test('only an explicit reconciled operator transition resolves ambiguity', () => {
    toSending()
    recoverOrphanedSends({ nowMs: NOW + 500 }, deps)
    expect(
      reconcileAmbiguous(
        {
          eventId: 'event-1',
          sinkVersionId: 'sv-1',
          outcome: 'delivered',
          remoteReceiptHash: 'reconciled-receipt',
          nowMs: NOW + 600,
        },
        deps,
      ),
    ).toBe('resolved')
    expect(getDelivery(db, 'event-1', 'sv-1')).toMatchObject({
      state: 'delivered',
      deliveredAtMs: NOW + 600,
      remoteReceiptHash: 'reconciled-receipt',
    })
    expect(
      reconcileAmbiguous(
        { eventId: 'event-1', sinkVersionId: 'sv-1', outcome: 'dead', errorClass: 'unknown', nowMs: NOW + 700 },
        deps,
      ),
    ).toBe('not_ambiguous')
  })

  test('crash before the durable sending transition: the expired lease may retry', () => {
    seed(db)
    enqueueDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', grant: GRANT, nowMs: NOW }, deps)
    leaseDeliveries({ nowMs: NOW, leaseMs: 10, limit: 10, maxAttempts: 3 }, deps)
    const retried = leaseDeliveries({ nowMs: NOW + 20, leaseMs: 10, limit: 10, maxAttempts: 3 }, deps)
    expect(retried).toHaveLength(1)
  })

  test('crash after the sending transition but before the call: ambiguous, never replayed', () => {
    toSending()
    recoverOrphanedSends({ nowMs: NOW + 500 }, deps)
    expect(getDelivery(db, 'event-1', 'sv-1')?.state).toBe('ambiguous')
    expect(leaseDeliveries({ nowMs: NOW + 100000, leaseMs: 10, limit: 10, maxAttempts: 99 }, deps)).toEqual([])
  })

  test('crash after remote acceptance but before local classification: ambiguous, never replayed', () => {
    toSending()
    recoverOrphanedSends({ nowMs: NOW + 500 }, deps)
    const row = getDelivery(db, 'event-1', 'sv-1')
    expect(row?.state).toBe('ambiguous')
    expect(row?.deliveredAtMs).toBeNull()
    expect(leaseDeliveries({ nowMs: NOW + 100000, leaseMs: 10, limit: 10, maxAttempts: 99 }, deps)).toEqual([])
  })

  test('retryable then crash before send-start: expired-lease recovery returns the row to pending', () => {
    toSending()
    expect(
      classifyDelivery(
        {
          eventId: 'event-1',
          sinkVersionId: 'sv-1',
          nowMs: NOW + 20,
          outcome: 'retryable',
          errorClass: 'http_5xx',
          retryAtMs: NOW + 30,
        },
        deps,
      ),
    ).toBe('classified')

    const reLeased = leaseDeliveries({ nowMs: NOW + 30, leaseMs: 10, limit: 10, maxAttempts: 3 }, deps)
    expect(reLeased).toHaveLength(1)
    const leasedRow = getDelivery(db, 'event-1', 'sv-1')
    expect(leasedRow?.state).toBe('leased')
    expect(leasedRow?.sendStartedAtMs).toBeNull()

    const retried = leaseDeliveries({ nowMs: NOW + 100, leaseMs: 10, limit: 10, maxAttempts: 3 }, deps)
    expect(retried).toHaveLength(1)
    expect(retried[0]?.attempts).toBe(3)
    expect(getDelivery(db, 'event-1', 'sv-1')).toMatchObject({ state: 'leased', sendStartedAtMs: null })
  })

  test('arbitrary network errors map to a finite error class and no message persists', () => {
    expect(classifySendError(Object.assign(new Error('x'), { status: 503 }))).toBe('http_5xx')
    expect(classifySendError(Object.assign(new Error('x'), { status: 429 }))).toBe('http_4xx')
    expect(classifySendError(Object.assign(new Error('x'), { status: 401 }))).toBe('auth')
    expect(classifySendError(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe('network')
    expect(classifySendError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe('timeout')
    expect(classifySendError('total garbage')).toBe('unknown')

    const hugeMessage = `upstream exploded: ${'sensitive-body '.repeat(500)}`
    const errorClass = classifySendError(new Error(hugeMessage))
    expect(DELIVERY_ERROR_CLASSES).toContain(errorClass)

    toSending()
    classifyDelivery({ eventId: 'event-1', sinkVersionId: 'sv-1', nowMs: NOW + 20, outcome: 'dead', errorClass }, deps)
    const row = getDelivery(db, 'event-1', 'sv-1')
    expect(row?.state).toBe('dead')
    expect(row?.lastErrorClass).toBe(errorClass)
    expect(JSON.stringify(row)).not.toContain('sensitive-body')
  })
})
