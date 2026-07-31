// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import {
  deriveCollectionRefKey,
  getEligibilityRef,
  listEligibilityVersions,
  recheckAndAssociateEvent,
  setEligibilityState,
} from '../../../src/analytics/governance/collection-store.js'
import { deriveDeliveryGrantKey } from '../../../src/analytics/governance/grant-store.js'
import { deriveGovernanceActorKey } from '../../../src/analytics/governance/preference-store.js'
import { createPseudonym } from '../../../src/analytics/identity/pseudonym.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const KEY = Buffer.alloc(32, 7)
const ACTOR_INPUT = {
  key: KEY,
  keyVersion: 'v1',
  platformInstanceId: 'inst-1',
  platformUserId: 'user-1',
}

const refKey = (): string => deriveCollectionRefKey(ACTOR_INPUT)

const insertEvent = (db: Db, eventId: string): void => {
  db.insert(schema.analyticsProcessEpochs)
    .values({
      epochId: `epoch-${eventId}`,
      state: 'open',
      startedAtMs: 1700000000000,
    })
    .run()
  db.insert(schema.analyticsEvents)
    .values({
      eventId,
      storageGeneration: 'gen-1',
      processEpochId: `epoch-${eventId}`,
      sourceRefKey: `ref-${eventId}`,
      sourceKind: 'live',
      schemaVersion: 1,
      eventName: 'turn_started',
      eventVersion: 1,
      occurredAtMs: 1700000000000,
      ingestedAtMs: 1700000000001,
      source: 'live',
      attributionQuality: 'native',
      appVersion: '6.10.0',
      deploymentKey: 'v1.p-deploy',
      keyVersion: 'v1',
      platform: 'telegram',
      platformInstanceKey: 'v1.p-instance',
      contextType: 'dm',
      actorRole: 'admin',
      taskProvider: 'none',
      invocationMode: 'normal',
      policyVersion: 1,
      eligibility: 'allowed',
      maxClass: 'C0',
      propsJson: '{}',
      expiresAtMs: 1700000000002,
    })
    .run()
}

describe('analytics collection eligibility store', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('collection-eligibility:v1 differs from analytics, governance, and delivery domains', () => {
    const analyticsActorKey = createPseudonym({
      key: KEY,
      keyVersion: 'v1',
      domain: 'actor:v1',
      components: ['inst-1', 'user-1'],
    })
    const collectionKey = deriveCollectionRefKey(ACTOR_INPUT)
    expect(collectionKey).not.toBe(analyticsActorKey)
    expect(collectionKey).not.toBe(deriveGovernanceActorKey(ACTOR_INPUT))
    expect(collectionKey).not.toBe(deriveDeliveryGrantKey(ACTOR_INPUT))
  })

  test('allow returns a generation-bearing ref for an eligible writer', () => {
    const result = setEligibilityState(
      {
        refKey: refKey(),
        keyVersion: 'v1',
        state: 'allow',
        policyVersion: 1,
        nowMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    expect(result.generation).toBe(1)

    const ref = getEligibilityRef(refKey(), { getDrizzleDb: () => db })
    expect(ref).toEqual({ refKey: refKey(), keyVersion: 'v1', generation: 1 })
  })

  test('deny advances the generation and stale refs no longer resolve', () => {
    setEligibilityState(
      {
        refKey: refKey(),
        keyVersion: 'v1',
        state: 'allow',
        policyVersion: 1,
        nowMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    const denied = setEligibilityState(
      {
        refKey: refKey(),
        keyVersion: 'v1',
        state: 'deny',
        policyVersion: 1,
        nowMs: 1700000001000,
      },
      { getDrizzleDb: () => db },
    )
    expect(denied.generation).toBe(2)
    expect(getEligibilityRef(refKey(), { getDrizzleDb: () => db })).toBeNull()
  })

  test('all retained key versions are returned for withdrawal lookup', () => {
    const refV1 = deriveCollectionRefKey(ACTOR_INPUT)
    const refV2 = deriveCollectionRefKey({ ...ACTOR_INPUT, keyVersion: 'v2' })
    setEligibilityState(
      {
        refKey: refV1,
        keyVersion: 'v1',
        state: 'deny',
        policyVersion: 1,
        nowMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    setEligibilityState(
      {
        refKey: refV2,
        keyVersion: 'v2',
        state: 'deny',
        policyVersion: 1,
        nowMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    const rows = listEligibilityVersions([refV1, refV2], {
      getDrizzleDb: () => db,
    })
    expect(rows.map((row) => row.keyVersion).sort()).toEqual(['v1', 'v2'])
    expect(rows.every((row) => row.state === 'deny')).toBe(true)
  })

  test('exact-generation recheck associates the event only for the current allow generation', () => {
    insertEvent(db, 'event-1')
    setEligibilityState(
      {
        refKey: refKey(),
        keyVersion: 'v1',
        state: 'allow',
        policyVersion: 1,
        nowMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    const ref = { refKey: refKey(), keyVersion: 'v1', generation: 1 }
    expect(getEligibilityRef(refKey(), { getDrizzleDb: () => db })).toEqual(ref)

    const associated = recheckAndAssociateEvent(
      { ref, eventId: 'event-1', nowMs: 1700000000001 },
      { getDrizzleDb: () => db },
    )
    expect(associated.status).toBe('associated')
    const row = db
      .select()
      .from(schema.analyticsEventCollectionRefs)
      .where(eq(schema.analyticsEventCollectionRefs.eventId, 'event-1'))
      .get()
    expect(row).toMatchObject({
      refKey: refKey(),
      keyVersion: 'v1',
      generation: 1,
    })
  })

  test('recheck with a stale generation inserts nothing', () => {
    insertEvent(db, 'event-2')
    setEligibilityState(
      {
        refKey: refKey(),
        keyVersion: 'v1',
        state: 'allow',
        policyVersion: 1,
        nowMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    setEligibilityState(
      {
        refKey: refKey(),
        keyVersion: 'v1',
        state: 'deny',
        policyVersion: 1,
        nowMs: 1700000001000,
      },
      { getDrizzleDb: () => db },
    )
    const stale = recheckAndAssociateEvent(
      {
        ref: { refKey: refKey(), keyVersion: 'v1', generation: 1 },
        eventId: 'event-2',
        nowMs: 1700000002000,
      },
      { getDrizzleDb: () => db },
    )
    expect(stale.status).toBe('not_eligible')
    const rows = db.select().from(schema.analyticsEventCollectionRefs).all()
    expect(rows).toHaveLength(0)
  })
})
