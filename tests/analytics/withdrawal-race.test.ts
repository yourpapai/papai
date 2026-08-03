// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { enqueueDelivery, markSendStarted } from '../../src/analytics/delivery/delivery-lifecycle.js'
import { leaseDeliveries } from '../../src/analytics/delivery/store.js'
import type { DeliveryStoreDeps } from '../../src/analytics/delivery/store.js'
import { classifyDelivery } from '../../src/analytics/delivery/store.js'
import { recheckAndAssociateEvent } from '../../src/analytics/governance/collection-store.js'
import { createGrantSendMutex } from '../../src/analytics/governance/grant-serialization.js'
import type { GrantSendMutex } from '../../src/analytics/governance/grant-serialization.js'
import { requestSubjectDeletion, withdrawSubject } from '../../src/analytics/governance/subject-service.js'
import * as schema from '../../src/db/schema.js'
import { setupTestDb } from '../utils/test-helpers.js'
import {
  allDeliveries,
  allowCollectionRef,
  allowGrantFor,
  GENERATIONS,
  grantKeyFor,
  IDENTITY_A,
  makeSubjectDeps,
  refKeyFor,
  seedDelivery,
  seedRefAssociation,
  seedSink,
  seedSubjectEvent,
  T,
} from './subject-fixtures.js'

describe('withdrawal races', () => {
  type Db = Awaited<ReturnType<typeof setupTestDb>>
  let db: Db
  let deliveryDeps: DeliveryStoreDeps
  let grantMutex: GrantSendMutex

  beforeEach(async () => {
    db = await setupTestDb()
    grantMutex = createGrantSendMutex()
    deliveryDeps = { getDrizzleDb: (): Db => db, grantMutex }
  })

  test('deny-before-writer: associating an event after withdrawal inserts nothing', () => {
    const ref = allowCollectionRef(db, IDENTITY_A, 'v3')
    withdrawSubject(IDENTITY_A, makeSubjectDeps(db), T)

    const eventId = seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-race-after',
      eventId: 'ev-race-after',
    })
    const associated = recheckAndAssociateEvent({ ref, eventId, nowMs: T + 1 }, { getDrizzleDb: (): Db => db })

    expect(associated.status).toBe('not_eligible')
    expect(db.select().from(schema.analyticsEventCollectionRefs).all()).toHaveLength(0)
  })

  test('writer-before-deny: withdrawal deletes the newly associated event graph and advances the generation', () => {
    const ref = allowCollectionRef(db, IDENTITY_A, 'v3')
    const grant = allowGrantFor(db, IDENTITY_A, 'v3')
    const eventId = seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-race-before',
      eventId: 'ev-race-before',
    })
    const associated = recheckAndAssociateEvent({ ref, eventId, nowMs: T }, { getDrizzleDb: (): Db => db })
    expect(associated.status).toBe('associated')
    seedSink(db, 'sv-race')
    seedDelivery(db, { eventId, sinkVersionId: 'sv-race', state: 'pending', grant })

    const result = withdrawSubject(IDENTITY_A, makeSubjectDeps(db), T + 1)

    expect(result.state).toBe('completed')
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsEventCollectionRefs).all()).toHaveLength(0)
    expect(allDeliveries(db)).toHaveLength(0)
    const refRow = db
      .select()
      .from(schema.analyticsCollectionEligibility)
      .where(eq(schema.analyticsCollectionEligibility.refKey, ref.refKey))
      .get()
    expect(refRow?.state).toBe('deny')
    expect(refRow?.generation).toBe(ref.generation + 1)
  })

  test('grant race at enqueue: a delivery enqueued before withdrawal is cancelled and never sent after', () => {
    const grant = allowGrantFor(db, IDENTITY_A, 'v3')
    const eventId = seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-race-enqueue',
      eventId: 'ev-race-enqueue',
    })
    seedSink(db, 'sv-enqueue')
    enqueueDelivery({ eventId, sinkVersionId: 'sv-enqueue', grant, nowMs: T }, deliveryDeps)

    withdrawSubject(IDENTITY_A, makeSubjectDeps(db), T + 1)

    expect(allDeliveries(db)).toHaveLength(0)
    expect(leaseDeliveries({ nowMs: T + 2, leaseMs: 10_000, limit: 10, maxAttempts: 3 }, deliveryDeps)).toHaveLength(0)
    expect(markSendStarted({ eventId, sinkVersionId: 'sv-enqueue', grant, nowMs: T + 3 }, deliveryDeps)).not.toBe(
      'started',
    )
  })

  test('grant race at lease: a leased-but-never-started row is settled by withdrawal and cannot start sending', () => {
    const grant = allowGrantFor(db, IDENTITY_A, 'v3')
    const eventId = seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-race-lease',
      eventId: 'ev-race-lease',
    })
    seedSink(db, 'sv-lease')
    enqueueDelivery({ eventId, sinkVersionId: 'sv-lease', grant, nowMs: T }, deliveryDeps)
    const leased = leaseDeliveries({ nowMs: T, leaseMs: 100_000, limit: 10, maxAttempts: 3 }, deliveryDeps)
    expect(leased).toHaveLength(1)

    withdrawSubject(IDENTITY_A, makeSubjectDeps(db), T + 1)

    expect(markSendStarted({ eventId, sinkVersionId: 'sv-lease', grant, nowMs: T + 2 }, deliveryDeps)).not.toBe(
      'started',
    )
    expect(allDeliveries(db)).toHaveLength(0)
  })

  test('grant race at durable send-start: an in-flight send is classified ambiguous and settled with a remote receipt', () => {
    const grant = allowGrantFor(db, IDENTITY_A, 'v3')
    const eventId = seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-race-send',
      eventId: 'ev-race-send',
    })
    seedSink(db, 'sv-send')
    enqueueDelivery({ eventId, sinkVersionId: 'sv-send', grant, nowMs: T }, deliveryDeps)
    leaseDeliveries({ nowMs: T, leaseMs: 100_000, limit: 10, maxAttempts: 3 }, deliveryDeps)
    expect(markSendStarted({ eventId, sinkVersionId: 'sv-send', grant, nowMs: T }, deliveryDeps)).toBe('started')
    const remoteCalls: string[] = []

    const result = withdrawSubject(
      IDENTITY_A,
      {
        ...makeSubjectDeps(db),
        requestRemoteDeletion: (sinkVersionId) => {
          remoteCalls.push(sinkVersionId)
          return { remoteReceiptHash: 'remote-race' }
        },
      },
      T + 1,
    )

    expect(result.state).toBe('completed')
    expect(remoteCalls).toEqual(['sv-send'])
    expect(allDeliveries(db)).toHaveLength(0)
    const receipts = db.select().from(schema.analyticsDeliveryDeletionReceipts).all()
    expect(receipts).toHaveLength(1)
    expect(receipts[0]?.remoteReceiptHash).toBe('remote-race')
    expect(JSON.stringify(receipts)).not.toContain(eventId)
  })

  test('the withdrawal transaction cancels never-started deliveries, so no send begins before settlement runs', () => {
    const grant = allowGrantFor(db, IDENTITY_A, 'v3')
    const eventId = seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-race-tx',
      eventId: 'ev-race-tx',
    })
    seedSink(db, 'sv-tx')
    enqueueDelivery({ eventId, sinkVersionId: 'sv-tx', grant, nowMs: T }, deliveryDeps)
    leaseDeliveries({ nowMs: T, leaseMs: 100_000, limit: 10, maxAttempts: 3 }, deliveryDeps)

    requestSubjectDeletion(IDENTITY_A, makeSubjectDeps(db), T + 1)

    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(1)
    expect(allDeliveries(db).map((row) => row.state)).toEqual(['cancelled'])
    expect(markSendStarted({ eventId, sinkVersionId: 'sv-tx', grant, nowMs: T + 2 }, deliveryDeps)).not.toBe('started')
    expect(leaseDeliveries({ nowMs: T + 3, leaseMs: 10_000, limit: 10, maxAttempts: 3 }, deliveryDeps)).toHaveLength(0)
  })

  test('send holding the per-grant mutex vs deny commit: no send begins or completes after deny', () => {
    const grant = allowGrantFor(db, IDENTITY_A, 'v3')
    const eventId = seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v3',
      storageGeneration: GENERATIONS.active,
      sourceRefKey: 'ref-race-mutex',
      eventId: 'ev-race-mutex',
    })
    seedSink(db, 'sv-mutex-a')
    seedSink(db, 'sv-mutex-b')
    enqueueDelivery({ eventId, sinkVersionId: 'sv-mutex-a', grant, nowMs: T }, deliveryDeps)
    enqueueDelivery({ eventId, sinkVersionId: 'sv-mutex-b', grant, nowMs: T }, deliveryDeps)
    leaseDeliveries({ nowMs: T, leaseMs: 100_000, limit: 10, maxAttempts: 3 }, deliveryDeps)

    expect(markSendStarted({ eventId, sinkVersionId: 'sv-mutex-a', grant, nowMs: T }, deliveryDeps)).toBe('started')
    expect(grantMutex.isHeld(grant.grantKey)).toBe(true)
    expect(markSendStarted({ eventId, sinkVersionId: 'sv-mutex-b', grant, nowMs: T }, deliveryDeps)).toBe(
      'send_in_progress',
    )

    const result = withdrawSubject(
      IDENTITY_A,
      {
        ...makeSubjectDeps(db),
        requestRemoteDeletion: (sinkVersionId) => ({ remoteReceiptHash: `remote-${sinkVersionId}` }),
      },
      T + 1,
    )

    expect(result.state).toBe('completed')
    expect(
      classifyDelivery(
        {
          eventId,
          sinkVersionId: 'sv-mutex-a',
          grantKey: grant.grantKey,
          nowMs: T + 2,
          outcome: 'delivered',
          remoteReceiptHash: 'late-ack',
        },
        deliveryDeps,
      ),
    ).toBe('not_sending')
    expect(grantMutex.isHeld(grant.grantKey)).toBe(false)
    expect(markSendStarted({ eventId, sinkVersionId: 'sv-mutex-b', grant, nowMs: T + 3 }, deliveryDeps)).not.toBe(
      'started',
    )
    expect(allDeliveries(db)).toHaveLength(0)
  })

  test('withdrawal covers every retained key version: old-version refs and grants are revoked too', () => {
    const refV1 = allowCollectionRef(db, IDENTITY_A, 'v1')
    const refV2 = allowCollectionRef(db, IDENTITY_A, 'v2')
    allowGrantFor(db, IDENTITY_A, 'v1')
    allowGrantFor(db, IDENTITY_A, 'v2')
    allowGrantFor(db, IDENTITY_A, 'v3')
    const eventId = seedSubjectEvent(db, IDENTITY_A, {
      keyVersion: 'v1',
      storageGeneration: GENERATIONS.retired,
      sourceRefKey: 'ref-race-old',
      eventId: 'ev-race-old',
    })
    seedRefAssociation(db, {
      eventId,
      refKey: refV1.refKey,
      keyVersion: refV1.keyVersion,
      generation: refV1.generation,
    })

    withdrawSubject(IDENTITY_A, makeSubjectDeps(db), T + 1)

    const refs = db.select().from(schema.analyticsCollectionEligibility).all()
    for (const row of refs) expect(row.state).toBe('deny')
    const grants = db.select().from(schema.analyticsEligibilityGrants).all()
    for (const row of grants) expect(row.state).toBe('deny')
    expect(db.select().from(schema.analyticsEvents).all()).toHaveLength(0)
    expect(refV2.refKey).toBe(refKeyFor(IDENTITY_A, 'v2'))
    expect(grantKeyFor(IDENTITY_A, 'v3')).toBeTruthy()
  })
})
