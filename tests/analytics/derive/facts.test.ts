// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  collectionRefForEvent,
  findDerivedClarificationEvents,
  findWithdrawnActorCensors,
  loadEventRow,
  loadFeatureFacts,
} from '../../../src/analytics/derive/facts.js'
import type { CollectionEligibilityRef } from '../../../src/analytics/governance/eligibility.js'
import { resolveActive } from '../../../src/analytics/governance/generation-store.js'
import { allowActor, denyActor, seedEvent, setupDeriveDb, T0 } from '../derive-fixtures.js'
import type { TestDb } from '../derive-fixtures.js'

const acceptedProps = (): Record<string, unknown> => ({
  input_count: '1',
  length_bucket: '1_32',
  attachment_count: '0',
  is_command: false,
  command: 'none',
})

describe('derive facts lookups', () => {
  let db: TestDb
  let ref: CollectionEligibilityRef
  let generation: string

  beforeEach(async () => {
    db = await setupDeriveDb()
    ref = allowActor(db, 'user-42')
    generation = resolveActive({ getDrizzleDb: () => db }).generation
  })

  test('loadFeatureFacts reads opportunity and use props in occurrence order', () => {
    seedEvent(db, ref, {
      id: 'v1.p-use',
      name: 'feature_used',
      occurredAtMs: T0 + 10,
      props: { feature: 'coding', operation: 'start', outcome: 'blocked' },
    })
    seedEvent(db, ref, {
      id: 'v1.p-opp',
      name: 'feature_opportunity',
      occurredAtMs: T0,
      props: { feature: 'coding', available: true, reason: 'available', sampling: 'first_eligible_actor_day' },
    })
    const facts = loadFeatureFacts(db, generation, 'v1.p-actor', T0 + 1000)
    expect(facts.opportunities).toHaveLength(1)
    expect(facts.opportunities[0]?.available).toBe(true)
    expect(facts.uses).toHaveLength(1)
    expect(facts.uses[0]?.outcome).toBe('blocked')
  })

  test('findWithdrawnActorCensors reports the earliest deny time per actor', () => {
    seedEvent(db, ref, { id: 'v1.p-e1', name: 'chat_message_accepted', occurredAtMs: T0, props: acceptedProps() })
    expect(findWithdrawnActorCensors(db)).toEqual([])
    denyActor(db, ref, T0 + 500)
    expect(findWithdrawnActorCensors(db)).toEqual([{ actorKey: 'v1.p-actor', startMs: T0 + 500 }])
  })

  test('collectionRefForEvent returns the exact association and loadEventRow reads the row', () => {
    const eventId = seedEvent(db, ref, {
      id: 'v1.p-e1',
      name: 'chat_message_accepted',
      occurredAtMs: T0,
      props: acceptedProps(),
    })
    const association = collectionRefForEvent(db, eventId)
    expect(association?.refKey).toBe(ref.refKey)
    expect(association?.generation).toBe(ref.generation)
    expect(collectionRefForEvent(db, 'missing')).toBeNull()
    expect(loadEventRow(db, eventId)?.eventId).toBe(eventId)
    expect(loadEventRow(db, 'missing')).toBeUndefined()
  })

  test('findDerivedClarificationEvents scopes to the partition', () => {
    expect(
      findDerivedClarificationEvents(db, generation, { actorKey: 'v1.p-actor', conversationKey: 'v1.p-context' }),
    ).toEqual([])
  })
})
