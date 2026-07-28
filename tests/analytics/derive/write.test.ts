// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { loadFeatureFacts } from '../../../src/analytics/derive/facts.js'
import { materializeFeatureDays } from '../../../src/analytics/derive/features.js'
import { computeTurnFriction } from '../../../src/analytics/derive/friction.js'
import { buildGoalAttempts } from '../../../src/analytics/derive/outcomes.js'
import { sessionizePartition } from '../../../src/analytics/derive/sessionizer.js'
import { loadPartitionEvents, loadTurnFacts } from '../../../src/analytics/derive/store.js'
import {
  replaceFeatureDays,
  replaceGoalAttempts,
  replaceSessions,
  replaceTurnFriction,
  upsertCensorIntervals,
} from '../../../src/analytics/derive/write.js'
import type { CollectionEligibilityRef } from '../../../src/analytics/governance/eligibility.js'
import { resolveActive } from '../../../src/analytics/governance/generation-store.js'
import * as schema from '../../../src/db/schema.js'
import {
  allowActor,
  DERIVE_KEY,
  DERIVE_KEY_VERSION,
  intentProps,
  seedEvent,
  setupDeriveDb,
  T0,
  toolCompletedProps,
  turnCompletedProps,
  TURN_STARTED_PROPS,
} from '../derive-fixtures.js'
import type { TestDb } from '../derive-fixtures.js'

const KEY_INPUT = { key: DERIVE_KEY, keyVersion: DERIVE_KEY_VERSION } as const
const PARTITION = { actorKey: 'v1.p-actor', conversationKey: 'v1.p-context' } as const

const messageProps = (): Record<string, unknown> => ({
  input_count: '1',
  length_bucket: '1_32',
  attachment_count: '0',
  is_command: false,
  command: 'none',
})

describe('derive write', () => {
  let db: TestDb
  let ref: CollectionEligibilityRef
  let generation: string

  beforeEach(async () => {
    db = await setupDeriveDb()
    ref = allowActor(db, 'user-42')
    generation = resolveActive({ getDrizzleDb: () => db }).generation
  })

  test('replaceSessions persists rows and a rerun replaces them without duplicates', () => {
    seedEvent(db, ref, { id: 'v1.p-e1', name: 'chat_message_accepted', occurredAtMs: T0, props: messageProps() })
    const events = loadPartitionEvents(db, generation, PARTITION, T0 + 1000)
    const sessions = sessionizePartition({ ...PARTITION, events }, KEY_INPUT)
    expect(replaceSessions(db, generation, PARTITION, sessions)).toEqual({ sessions: 1, events: 1 })
    expect(replaceSessions(db, generation, PARTITION, sessions)).toEqual({ sessions: 1, events: 1 })
    expect(db.select().from(schema.analyticsSessions).all()).toHaveLength(1)
    expect(db.select().from(schema.analyticsSessionEvents).all()).toHaveLength(1)
    const row = db.select().from(schema.analyticsSessions).get()
    expect(row?.sessionizationVersion).toBe(1)
    expect(row?.durationMs).toBe(0)
  })

  test('replaceGoalAttempts upserts without duplicating and cascades on anchor deletion', () => {
    const anchorId = seedEvent(db, ref, {
      id: 'v1.p-done',
      name: 'turn_completed',
      occurredAtMs: T0,
      turnKey: 'v1.p-turn-1',
      props: turnCompletedProps(10),
    })
    const facts = loadTurnFacts(db, generation, PARTITION, T0 + 1000)
    const attempts = buildGoalAttempts(
      facts.map((fact) => ({ ...fact, goals: ['I01'] })),
      { nowMs: T0 + 90_000_000, censorStartMs: null },
      KEY_INPUT,
    )
    replaceGoalAttempts(db, PARTITION, attempts, generation)
    replaceGoalAttempts(db, PARTITION, attempts, generation)
    expect(db.select().from(schema.analyticsGoalAttempts).all()).toHaveLength(1)
    const row = db.select().from(schema.analyticsGoalAttempts).get()
    expect(row?.outcome).toBe('abandoned_after_no_action')
    expect(row?.anchorEventId).toBe(anchorId)
    expect(row?.outcomeVersion).toBe(1)
    db.delete(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventId, anchorId)).run()
    expect(db.select().from(schema.analyticsGoalAttempts).all()).toHaveLength(0)
  })

  test('replaceTurnFriction persists bits, count, and score', () => {
    seedEvent(db, ref, {
      id: 'v1.p-ts',
      name: 'turn_started',
      occurredAtMs: T0,
      turnKey: 'v1.p-turn-1',
      props: TURN_STARTED_PROPS,
    })
    seedEvent(db, ref, {
      id: 'v1.p-tc',
      name: 'tool_completed',
      occurredAtMs: T0 + 10,
      turnKey: 'v1.p-turn-1',
      props: toolCompletedProps('structured_failure'),
    })
    seedEvent(db, ref, {
      id: 'v1.p-td',
      name: 'tool_completed',
      occurredAtMs: T0 + 11,
      turnKey: 'v1.p-turn-1',
      props: toolCompletedProps('thrown_failure'),
    })
    seedEvent(db, ref, {
      id: 'v1.p-done',
      name: 'turn_completed',
      occurredAtMs: T0 + 40,
      turnKey: 'v1.p-turn-1',
      props: turnCompletedProps(40),
    })
    seedEvent(db, ref, {
      id: 'v1.p-int',
      name: 'intent_classified',
      occurredAtMs: T0 + 40,
      turnKey: 'v1.p-turn-1',
      props: intentProps(['I01']),
    })
    const facts = loadTurnFacts(db, generation, PARTITION, T0 + 1000)
    const rows = facts.map((fact) =>
      computeTurnFriction({
        turnKey: fact.turnKey,
        actorKey: fact.actorKey,
        conversationKey: fact.conversationKey,
        occurredAtMs: fact.turnEndMs,
        anchorEventId: fact.anchorEventId,
        durationMs: fact.durationMs,
        hasRephrase: fact.hasRephrase,
        hasClarificationAbandoned: fact.hasClarificationAbandoned,
        hasPermissionIssue: fact.hasPermissionIssue,
        hasStop: fact.hasStop,
        hasDisclosureFallback: fact.hasDisclosureFallback,
        executedOutcomes: fact.executedOutcomes,
      }),
    )
    expect(replaceTurnFriction(db, PARTITION, rows, generation)).toBe(1)
    expect(replaceTurnFriction(db, PARTITION, rows, generation)).toBe(1)
    expect(db.select().from(schema.analyticsTurnFriction).all()).toHaveLength(1)
    const row = db.select().from(schema.analyticsTurnFriction).get()
    expect(row?.failureChain).toBe(true)
    expect(row?.componentCount).toBe(1)
    expect(row?.displayScore).toBe(14)
  })

  test('replaceFeatureDays materializes day rows per actor', () => {
    seedEvent(db, ref, {
      id: 'v1.p-opp',
      name: 'feature_opportunity',
      occurredAtMs: T0,
      props: { feature: 'coding', available: true, reason: 'available', sampling: 'first_eligible_actor_day' },
    })
    seedEvent(db, ref, {
      id: 'v1.p-use',
      name: 'feature_used',
      occurredAtMs: T0 + 10,
      props: { feature: 'coding', operation: 'start', outcome: 'success' },
    })
    const materialization = materializeFeatureDays(loadFeatureFacts(db, generation, 'v1.p-actor', T0 + 1000))
    expect(replaceFeatureDays(db, 'v1.p-actor', materialization, generation)).toEqual({ opportunities: 1, uses: 1 })
    replaceFeatureDays(db, 'v1.p-actor', materialization, generation)
    const useRow = db.select().from(schema.analyticsFeatureUseDays).get()
    expect(useRow?.adopted).toBe(true)
    expect(useRow?.joinedAvailable).toBe(true)
    expect(useRow?.definitionVersion).toBe(1)
  })

  test('replaceSessions rolls back the delete when an insert fails mid-partition', () => {
    seedEvent(db, ref, { id: 'v1.p-e1', name: 'chat_message_accepted', occurredAtMs: T0, props: messageProps() })
    const events = loadPartitionEvents(db, generation, PARTITION, T0 + 1000)
    const sessions = sessionizePartition({ ...PARTITION, events }, KEY_INPUT)
    replaceSessions(db, generation, PARTITION, sessions)
    expect(() => replaceSessions(db, generation, PARTITION, [...sessions, ...sessions])).toThrow()
    expect(db.select().from(schema.analyticsSessions).all()).toHaveLength(1)
    expect(db.select().from(schema.analyticsSessionEvents).all()).toHaveLength(1)
  })

  test('replaceGoalAttempts rolls back the delete when an insert fails mid-partition', () => {
    seedEvent(db, ref, {
      id: 'v1.p-done',
      name: 'turn_completed',
      occurredAtMs: T0,
      turnKey: 'v1.p-turn-1',
      props: turnCompletedProps(10),
    })
    const facts = loadTurnFacts(db, generation, PARTITION, T0 + 1000)
    const attempts = buildGoalAttempts(
      facts.map((fact) => ({ ...fact, goals: ['I01'] })),
      { nowMs: T0 + 90_000_000, censorStartMs: null },
      KEY_INPUT,
    )
    replaceGoalAttempts(db, PARTITION, attempts, generation)
    expect(() => replaceGoalAttempts(db, PARTITION, [...attempts, ...attempts], generation)).toThrow()
    expect(db.select().from(schema.analyticsGoalAttempts).all()).toHaveLength(1)
  })

  test('replaceTurnFriction rolls back the delete when an insert fails mid-partition', () => {
    seedEvent(db, ref, {
      id: 'v1.p-done',
      name: 'turn_completed',
      occurredAtMs: T0,
      turnKey: 'v1.p-turn-1',
      props: turnCompletedProps(40),
    })
    const facts = loadTurnFacts(db, generation, PARTITION, T0 + 1000)
    const rows = facts.map((fact) =>
      computeTurnFriction({
        turnKey: fact.turnKey,
        actorKey: fact.actorKey,
        conversationKey: fact.conversationKey,
        occurredAtMs: fact.turnEndMs,
        anchorEventId: fact.anchorEventId,
        durationMs: fact.durationMs,
        hasRephrase: fact.hasRephrase,
        hasClarificationAbandoned: fact.hasClarificationAbandoned,
        hasPermissionIssue: fact.hasPermissionIssue,
        hasStop: fact.hasStop,
        hasDisclosureFallback: fact.hasDisclosureFallback,
        executedOutcomes: fact.executedOutcomes,
      }),
    )
    replaceTurnFriction(db, PARTITION, rows, generation)
    expect(() => replaceTurnFriction(db, PARTITION, [...rows, ...rows], generation)).toThrow()
    expect(db.select().from(schema.analyticsTurnFriction).all()).toHaveLength(1)
  })

  test('replaceFeatureDays rolls back both deletes when an insert fails mid-actor', () => {
    seedEvent(db, ref, {
      id: 'v1.p-opp',
      name: 'feature_opportunity',
      occurredAtMs: T0,
      props: { feature: 'coding', available: true, reason: 'available', sampling: 'first_eligible_actor_day' },
    })
    seedEvent(db, ref, {
      id: 'v1.p-use',
      name: 'feature_used',
      occurredAtMs: T0 + 10,
      props: { feature: 'coding', operation: 'start', outcome: 'success' },
    })
    const materialization = materializeFeatureDays(loadFeatureFacts(db, generation, 'v1.p-actor', T0 + 1000))
    replaceFeatureDays(db, 'v1.p-actor', materialization, generation)
    const duplicated = {
      opportunities: [...materialization.opportunities, ...materialization.opportunities],
      uses: [...materialization.uses, ...materialization.uses],
    }
    expect(() => replaceFeatureDays(db, 'v1.p-actor', duplicated, generation)).toThrow()
    expect(db.select().from(schema.analyticsFeatureOpportunityDays).all()).toHaveLength(1)
    expect(db.select().from(schema.analyticsFeatureUseDays).all()).toHaveLength(1)
  })

  test('upsertCensorIntervals writes each actor interval once', () => {
    const rows = [{ actorKey: 'v1.p-actor', startMs: T0 + 200 }]
    expect(upsertCensorIntervals(db, rows)).toBe(1)
    expect(upsertCensorIntervals(db, rows)).toBe(0)
    const stored = db.select().from(schema.analyticsCensorIntervals).all()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.kind).toBe('withdrawal')
    expect(stored[0]?.startMs).toBe(T0 + 200)
    expect(stored[0]?.censorVersion).toBe(1)
  })
})
