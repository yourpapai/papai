// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  cancelNeverStartedIn,
  deleteDeliveryRowsForEventsIn,
  listDeliveryRowsForEvents,
  markSendingAmbiguousIn,
} from '../../../src/analytics/delivery/settlement.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const T = 1_800_000_000_000

const insertEvent = (db: Db, eventId: string): void => {
  db.insert(schema.analyticsProcessEpochs)
    .values({ epochId: 'epoch-settle', state: 'open', startedAtMs: T })
    .onConflictDoNothing()
    .run()
  db.insert(schema.analyticsEvents)
    .values({
      eventId,
      storageGeneration: 'gen-1',
      processEpochId: 'epoch-settle',
      sourceRefKey: `ref-${eventId}`,
      sourceKind: 'live',
      schemaVersion: 1,
      eventName: 'turn_started',
      eventVersion: 1,
      occurredAtMs: T,
      ingestedAtMs: T + 1,
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
      expiresAtMs: T + 1000,
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

const insertDelivery = (db: Db, eventId: string, sinkVersionId: string, state: string, sendStarted = false): void => {
  db.insert(schema.analyticsDeliveries)
    .values({
      eventId,
      sinkVersionId,
      grantKey: 'v1.d-grant',
      grantKeyVersion: 'v1',
      grantGeneration: 1,
      state,
      attempts: 1,
      nextAttemptAtMs: T,
      sendStartedAtMs: sendStarted ? T : null,
      payloadSchemaVersion: 1,
    })
    .run()
}

const rowsFor = (db: Db, eventId: string): readonly (typeof schema.analyticsDeliveries.$inferSelect)[] =>
  listDeliveryRowsForEvents(db, [eventId])

describe('delivery settlement primitives', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('cancelNeverStartedIn cancels pending and never-started leased rows only', () => {
    insertEvent(db, 'ev-1')
    insertSink(db, 'sv-1')
    insertSink(db, 'sv-2')
    insertSink(db, 'sv-3')
    insertDelivery(db, 'ev-1', 'sv-1', 'pending')
    insertDelivery(db, 'ev-1', 'sv-2', 'leased', false)
    insertDelivery(db, 'ev-1', 'sv-3', 'sending', true)

    const cancelled = db.transaction((tx) => cancelNeverStartedIn(tx, ['ev-1']))
    expect(cancelled).toBe(2)
    const states = rowsFor(db, 'ev-1').map((row) => row.state)
    expect(states).toEqual(['cancelled', 'cancelled', 'sending'])
  })

  test('markSendingAmbiguousIn never silently deletes a sending row', () => {
    insertEvent(db, 'ev-1')
    insertSink(db, 'sv-1')
    insertSink(db, 'sv-2')
    insertDelivery(db, 'ev-1', 'sv-1', 'sending', true)
    insertDelivery(db, 'ev-1', 'sv-2', 'delivered', true)

    const moved = db.transaction((tx) => markSendingAmbiguousIn(tx, ['ev-1']))
    expect(moved).toBe(1)
    const states = rowsFor(db, 'ev-1').map((row) => row.state)
    expect(states).toEqual(['ambiguous', 'delivered'])
  })

  test('deleteDeliveryRowsForEventsIn removes every row for the events', () => {
    insertEvent(db, 'ev-1')
    insertEvent(db, 'ev-2')
    insertSink(db, 'sv-1')
    insertSink(db, 'sv-2')
    insertDelivery(db, 'ev-1', 'sv-1', 'cancelled')
    insertDelivery(db, 'ev-2', 'sv-2', 'pending')

    const removed = db.transaction((tx) => deleteDeliveryRowsForEventsIn(tx, ['ev-1']))
    expect(removed).toBe(1)
    expect(rowsFor(db, 'ev-1')).toHaveLength(0)
    expect(rowsFor(db, 'ev-2')).toHaveLength(1)
  })

  test('empty event id sets are no-ops', () => {
    const result = db.transaction((tx) => ({
      cancelled: cancelNeverStartedIn(tx, []),
      ambiguous: markSendingAmbiguousIn(tx, []),
      removed: deleteDeliveryRowsForEventsIn(tx, []),
    }))
    expect(result).toEqual({ cancelled: 0, ambiguous: 0, removed: 0 })
    expect(listDeliveryRowsForEvents(db, [])).toHaveLength(0)
  })
})
