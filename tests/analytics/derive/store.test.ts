// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { findAffectedPartitions, loadPartitionEvents, loadTurnFacts } from '../../../src/analytics/derive/store.js'
import type { CollectionEligibilityRef } from '../../../src/analytics/governance/eligibility.js'
import { resolveActive } from '../../../src/analytics/governance/generation-store.js'
import {
  allowActor,
  denyActor,
  intentProps,
  seedEvent,
  setupDeriveDb,
  T0,
  toolCompletedProps,
  turnCompletedProps,
  TURN_STARTED_PROPS,
} from '../derive-fixtures.js'
import type { TestDb } from '../derive-fixtures.js'

const messageProps = (): Record<string, unknown> => ({
  input_count: '1',
  length_bucket: '1_32',
  attachment_count: '0',
  is_command: false,
  command: 'none',
})

const DAY = 86_400_000
const LIVE_NOW = T0 + 1000
const EXPIRY_DEADLINE = T0 + 90 * DAY

describe('derive store reads', () => {
  let db: TestDb
  let ref: CollectionEligibilityRef
  let generation: string

  beforeEach(async () => {
    db = await setupDeriveDb()
    ref = allowActor(db, 'user-42')
    generation = resolveActive({ getDrizzleDb: () => db }).generation
  })

  test('findAffectedPartitions honors the half-open window and skips guests', () => {
    seedEvent(db, ref, { id: 'v1.p-e1', name: 'chat_message_accepted', occurredAtMs: T0, props: messageProps() })
    seedEvent(db, ref, { id: 'v1.p-e2', name: 'chat_message_accepted', occurredAtMs: T0 + 100, props: messageProps() })
    seedEvent(db, ref, {
      id: 'v1.p-e3',
      name: 'chat_message_accepted',
      occurredAtMs: T0 + 50,
      actorKey: null,
      actorRole: 'guest',
      props: messageProps(),
    })
    expect(findAffectedPartitions(db, generation, T0, T0 + 100, LIVE_NOW)).toEqual([
      { actorKey: 'v1.p-actor', conversationKey: 'v1.p-context' },
    ])
    expect(findAffectedPartitions(db, generation, T0 + 100, T0 + 200, LIVE_NOW)).toEqual([
      { actorKey: 'v1.p-actor', conversationKey: 'v1.p-context' },
    ])
    expect(findAffectedPartitions(db, generation, T0 + 101, T0 + 200, LIVE_NOW)).toEqual([])
  })

  test('loadPartitionEvents matches thread-keyed and context-keyed conversations', () => {
    seedEvent(db, ref, {
      id: 'v1.p-e1',
      name: 'chat_message_accepted',
      occurredAtMs: T0,
      threadKey: 'v1.p-thread',
      props: messageProps(),
    })
    seedEvent(db, ref, { id: 'v1.p-e2', name: 'chat_message_accepted', occurredAtMs: T0 + 1, props: messageProps() })
    const threaded = loadPartitionEvents(
      db,
      generation,
      { actorKey: 'v1.p-actor', conversationKey: 'v1.p-thread' },
      LIVE_NOW,
    )
    expect(threaded.map((event) => event.eventId)).toHaveLength(1)
    const contexted = loadPartitionEvents(
      db,
      generation,
      { actorKey: 'v1.p-actor', conversationKey: 'v1.p-context' },
      LIVE_NOW,
    )
    expect(contexted.map((event) => event.eventId)).toHaveLength(1)
  })

  test('loadTurnFacts assembles goals, executed outcomes, flags, and per-turn censoring', () => {
    seedEvent(db, ref, {
      id: 'v1.p-ts',
      name: 'turn_started',
      occurredAtMs: T0,
      turnKey: 'v1.p-turn-1',
      props: TURN_STARTED_PROPS,
    })
    seedEvent(db, ref, {
      id: 'v1.p-tc1',
      name: 'tool_completed',
      occurredAtMs: T0 + 10,
      turnKey: 'v1.p-turn-1',
      props: toolCompletedProps('structured_failure'),
    })
    seedEvent(db, ref, {
      id: 'v1.p-tc2',
      name: 'tool_completed',
      occurredAtMs: T0 + 20,
      turnKey: 'v1.p-turn-1',
      props: toolCompletedProps('permission_denied'),
    })
    seedEvent(db, ref, {
      id: 'v1.p-tc3',
      name: 'tool_completed',
      occurredAtMs: T0 + 30,
      turnKey: 'v1.p-turn-1',
      props: toolCompletedProps('semantic_success'),
    })
    seedEvent(db, ref, {
      id: 'v1.p-cr',
      name: 'confirmation_resolved',
      occurredAtMs: T0 + 25,
      turnKey: 'v1.p-turn-1',
      props: { tool_slug: 'core_task_create', tool_key: 'v1.p-tool', decision: 'denied', decision_latency_ms: 5 },
    })
    seedEvent(db, ref, {
      id: 'v1.p-done',
      name: 'turn_completed',
      occurredAtMs: T0 + 40,
      turnKey: 'v1.p-turn-1',
      props: turnCompletedProps(40),
    })
    seedEvent(db, ref, {
      id: 'v1.p-intent',
      name: 'intent_classified',
      occurredAtMs: T0 + 40,
      turnKey: 'v1.p-turn-1',
      props: intentProps(['I01']),
    })
    const partition = { actorKey: 'v1.p-actor', conversationKey: 'v1.p-context' }
    const facts = loadTurnFacts(db, generation, partition, LIVE_NOW)
    expect(facts).toHaveLength(1)
    const fact = facts[0]
    expect(fact?.turnStartMs).toBe(T0)
    expect(fact?.turnEndMs).toBe(T0 + 40)
    expect(fact?.goals).toEqual(['I01'])
    expect(fact?.executedOutcomes).toEqual(['structured_failure', 'semantic_success'])
    expect(fact?.hasPermissionIssue).toBe(true)
    expect(fact?.durationMs).toBe(40)
    expect(fact?.censorStartMs).toBeNull()

    denyActor(db, ref, T0 + 100)
    const censored = loadTurnFacts(db, generation, partition, LIVE_NOW)
    expect(censored[0]?.censorStartMs).toBe(T0 + 100)
  })

  test('expiry guard: a row at the exact deadline is hidden from every derive scan with purge disabled', () => {
    seedEvent(db, ref, {
      id: 'v1.p-x-start',
      name: 'turn_started',
      occurredAtMs: T0,
      turnKey: 'v1.p-turn-x',
      props: TURN_STARTED_PROPS,
    })
    seedEvent(db, ref, {
      id: 'v1.p-x-end',
      name: 'turn_completed',
      occurredAtMs: T0,
      turnKey: 'v1.p-turn-x',
      props: turnCompletedProps(0),
    })
    const partition = { actorKey: 'v1.p-actor', conversationKey: 'v1.p-context' }

    expect(findAffectedPartitions(db, generation, T0, EXPIRY_DEADLINE, EXPIRY_DEADLINE - 1)).toEqual([partition])
    expect(loadPartitionEvents(db, generation, partition, EXPIRY_DEADLINE - 1)).toHaveLength(2)
    expect(loadTurnFacts(db, generation, partition, EXPIRY_DEADLINE - 1)).toHaveLength(1)

    expect(findAffectedPartitions(db, generation, T0, EXPIRY_DEADLINE, EXPIRY_DEADLINE)).toEqual([])
    expect(loadPartitionEvents(db, generation, partition, EXPIRY_DEADLINE)).toHaveLength(0)
    expect(loadTurnFacts(db, generation, partition, EXPIRY_DEADLINE)).toHaveLength(0)

    expect(findAffectedPartitions(db, generation, T0, EXPIRY_DEADLINE, EXPIRY_DEADLINE + 1)).toEqual([])
    expect(loadPartitionEvents(db, generation, partition, EXPIRY_DEADLINE + 1)).toHaveLength(0)
    expect(loadTurnFacts(db, generation, partition, EXPIRY_DEADLINE + 1)).toHaveLength(0)
  })
})
