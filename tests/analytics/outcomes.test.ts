// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { deleteCanonicalEventsForRef } from '../../src/analytics/governance/collection-serialization.js'
import type { CollectionEligibilityRef } from '../../src/analytics/governance/eligibility.js'
import { runDeriveJob } from '../../src/analytics/jobs/derive.js'
import type { DeriveJobInput } from '../../src/analytics/jobs/derive.js'
import * as schema from '../../src/db/schema.js'
import {
  allowActor,
  denyActor,
  DERIVE_EPOCH,
  DERIVE_KEY,
  DERIVE_KEY_VERSION,
  intentProps,
  seedEvent,
  setupDeriveDb,
  T0,
  toolCompletedProps,
  turnCompletedProps,
  TURN_STARTED_PROPS,
} from './derive-fixtures.js'
import type { TestDb } from './derive-fixtures.js'

const HOUR = 3_600_000
const DAY = 86_400_000
const NOW = T0 + 2 * DAY

const jobInput = (overrides?: Partial<DeriveJobInput>): DeriveJobInput => ({
  processEpochId: DERIVE_EPOCH,
  key: DERIVE_KEY,
  keyVersion: DERIVE_KEY_VERSION,
  nowMs: NOW,
  localMode: 'local_pseudonymous',
  windowStartMs: T0 - 1,
  windowEndMs: NOW,
  ...overrides,
})

const runJob = (db: TestDb, overrides?: Partial<DeriveJobInput>): ReturnType<typeof runDeriveJob> =>
  runDeriveJob(jobInput(overrides), { getDrizzleDb: () => db })

const seedTurn = (
  db: TestDb,
  ref: CollectionEligibilityRef,
  idSuffix: string,
  turnKey: string,
  startMs: number,
  options?: { outcomes?: readonly string[]; goals?: readonly string[]; clarification?: boolean; durationMs?: number },
): void => {
  const durationMs = options?.durationMs ?? 1_000
  seedEvent(db, ref, {
    id: `v1.p-ts-${idSuffix}`,
    name: 'turn_started',
    occurredAtMs: startMs,
    turnKey,
    props: TURN_STARTED_PROPS,
  })
  for (const [index, outcome] of (options?.outcomes ?? []).entries()) {
    seedEvent(db, ref, {
      id: `v1.p-tc-${idSuffix}-${index}`,
      name: 'tool_completed',
      occurredAtMs: startMs + 10 + index,
      turnKey,
      props: toolCompletedProps(outcome),
    })
  }
  if (options?.clarification === true) {
    seedEvent(db, ref, {
      id: `v1.p-cl-${idSuffix}`,
      name: 'clarification_requested',
      occurredAtMs: startMs + 50,
      turnKey,
      props: { reason: 'ambiguous_target' },
    })
  }
  seedEvent(db, ref, {
    id: `v1.p-done-${idSuffix}`,
    name: 'turn_completed',
    occurredAtMs: startMs + durationMs,
    turnKey,
    props: turnCompletedProps(durationMs, options?.clarification ?? false),
  })
  const goals = options?.goals ?? ['I01']
  seedEvent(db, ref, {
    id: `v1.p-int-${idSuffix}`,
    name: 'intent_classified',
    occurredAtMs: startMs + durationMs,
    turnKey,
    props: intentProps(goals, goals.length > 1 ? 'I23' : (goals[0] ?? 'I22')),
  })
}

const attemptsOf = (db: TestDb, turnKey: string): readonly schema.AnalyticsGoalAttemptRow[] =>
  db.select().from(schema.analyticsGoalAttempts).where(eq(schema.analyticsGoalAttempts.turnKey, turnKey)).all()

const clarificationEventsOf = (db: TestDb): readonly schema.AnalyticsEventRow[] =>
  db.select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventName, 'clarification_abandoned')).all()

const requireRow = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a row')
  return value
}

describe('outcome materialization (outcome v1)', () => {
  let db: TestDb
  let ref: CollectionEligibilityRef

  beforeEach(async () => {
    db = await setupDeriveDb()
    ref = allowActor(db, 'user-42')
  })

  test('immediate success materializes as immediate_success', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { outcomes: ['semantic_success'] })
    runJob(db)
    expect(attemptsOf(db, 'v1.p-turn-a')[0]?.outcome).toBe('immediate_success')
  })

  test('failure then same-turn recovery is recovered_same_turn, never first-time success', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { outcomes: ['structured_failure', 'semantic_success'] })
    runJob(db)
    const attempt = attemptsOf(db, 'v1.p-turn-a')[0]
    expect(attempt?.outcome).toBe('recovered_same_turn')
    expect(attempt?.outcome).not.toBe('immediate_success')
  })

  test('next-turn recovery within 30 minutes materializes as recovered_next_turn', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { outcomes: ['thrown_failure'] })
    seedTurn(db, ref, 'b', 'v1.p-turn-b', T0 + 20 * 60_000, { outcomes: ['semantic_success'] })
    runJob(db)
    expect(attemptsOf(db, 'v1.p-turn-a')[0]?.outcome).toBe('recovered_next_turn')
  })

  test('same-goal follow-up within 24 hours without success is unresolved_engaged', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { outcomes: ['thrown_failure'] })
    seedTurn(db, ref, 'b', 'v1.p-turn-b', T0 + 2 * HOUR, { outcomes: ['thrown_failure'] })
    runJob(db)
    expect(attemptsOf(db, 'v1.p-turn-a')[0]?.outcome).toBe('unresolved_engaged')
  })

  test('mature failure without follow-up is abandoned_after_failure', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { outcomes: ['structured_failure'] })
    runJob(db)
    expect(attemptsOf(db, 'v1.p-turn-a')[0]?.outcome).toBe('abandoned_after_failure')
  })

  test('mature clarification without follow-up is abandoned_after_clarification', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { clarification: true })
    runJob(db)
    expect(attemptsOf(db, 'v1.p-turn-a')[0]?.outcome).toBe('abandoned_after_clarification')
  })

  test('reply-only is not success and matures into abandoned_after_no_action', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0)
    runJob(db)
    expect(attemptsOf(db, 'v1.p-turn-a')[0]?.outcome).toBe('abandoned_after_no_action')
  })

  test('permission denial is neither success nor an executed failure', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { outcomes: ['permission_denied'] })
    runJob(db)
    expect(attemptsOf(db, 'v1.p-turn-a')[0]?.outcome).toBe('abandoned_after_no_action')
  })

  test('a structured tool failure is not success', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { outcomes: ['structured_failure'] })
    runJob(db)
    expect(attemptsOf(db, 'v1.p-turn-a')[0]?.outcome).not.toBe('immediate_success')
  })

  test('an attempt younger than 24 hours is censored, not abandoned', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { outcomes: ['thrown_failure'] })
    runJob(db, { nowMs: T0 + 12 * HOUR })
    const attempt = attemptsOf(db, 'v1.p-turn-a')[0]
    expect(attempt?.outcome).toBe('censored')
    expect(attempt?.resolvedAtMs).toBeNull()
  })

  test('a multi-goal turn creates up to three attempts but remains one turn', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { goals: ['I01', 'I02', 'I03'], outcomes: ['semantic_success'] })
    runJob(db)
    const attempts = attemptsOf(db, 'v1.p-turn-a')
    expect(attempts).toHaveLength(3)
    expect(new Set(attempts.map((row) => row.goal))).toEqual(new Set(['I01', 'I02', 'I03']))
    expect(attempts.every((row) => row.outcome === 'immediate_success')).toBe(true)
  })

  test('guests produce no outcome rows', () => {
    seedEvent(db, ref, {
      id: 'v1.p-g-done',
      name: 'turn_completed',
      occurredAtMs: T0,
      actorKey: null,
      actorRole: 'guest',
      turnKey: 'v1.p-guest-turn',
      props: turnCompletedProps(10),
    })
    const result = runJob(db)
    expect(result.attemptsWritten).toBe(0)
    expect(db.select().from(schema.analyticsGoalAttempts).all()).toHaveLength(0)
  })

  test('withdrawal right-censors immature attempts instead of counting churn', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { outcomes: ['thrown_failure'] })
    denyActor(db, ref, T0 + 12 * HOUR)
    runJob(db)
    const attempt = attemptsOf(db, 'v1.p-turn-a')[0]
    expect(attempt?.outcome).toBe('censored')
    const interval = db.select().from(schema.analyticsCensorIntervals).get()
    expect(interval?.actorKey).toBe('v1.p-actor')
    expect(interval?.kind).toBe('withdrawal')
    expect(interval?.startMs).toBe(T0 + 12 * HOUR)
  })

  test('withdrawal deletion removes derived attempt rows but keeps the censor interval', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { outcomes: ['thrown_failure'] })
    runJob(db)
    expect(attemptsOf(db, 'v1.p-turn-a')[0]?.outcome).toBe('abandoned_after_failure')
    denyActor(db, ref, T0 + 2 * DAY)
    runJob(db)
    deleteCanonicalEventsForRef({ refKey: ref.refKey }, { getDrizzleDb: () => db })
    expect(db.select().from(schema.analyticsGoalAttempts).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsSessions).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsCensorIntervals).all()).toHaveLength(1)
  })

  test('a mature structured clarification materializes exactly one deterministic clarification_abandoned event', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { clarification: true })
    const first = runJob(db)
    expect(first.clarificationAbandonedInserted).toBe(1)
    const events = clarificationEventsOf(db)
    expect(events).toHaveLength(1)
    const derived = requireRow(events[0])
    expect(derived.turnKey).toBe('v1.p-turn-a')
    expect(derived.occurredAtMs).toBe(T0 + 50 + DAY)
    expect(JSON.parse(derived.propsJson)).toEqual({ observation_hours: 24 })
    const source = db
      .select()
      .from(schema.analyticsEvents)
      .where(eq(schema.analyticsEvents.sourceRefKey, 'v1.p-cl-a'))
      .get()
    const derivedRef = db
      .select()
      .from(schema.analyticsEventCollectionRefs)
      .where(eq(schema.analyticsEventCollectionRefs.eventId, derived.eventId))
      .get()
    const sourceRef = db
      .select()
      .from(schema.analyticsEventCollectionRefs)
      .where(eq(schema.analyticsEventCollectionRefs.eventId, requireRow(source).eventId))
      .get()
    expect(derivedRef?.refKey).toBe(sourceRef?.refKey)
    expect(derivedRef?.generation).toBe(sourceRef?.generation)
    const second = runJob(db)
    expect(second.clarificationAbandonedInserted).toBe(0)
    expect(clarificationEventsOf(db)).toHaveLength(1)
    expect(clarificationEventsOf(db)[0]?.eventId).toBe(derived?.eventId)
  })

  test('an immature clarification stays censored and materializes nothing', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { clarification: true })
    const result = runJob(db, { nowMs: T0 + 12 * HOUR })
    expect(result.clarificationAbandonedInserted).toBe(0)
    expect(clarificationEventsOf(db)).toHaveLength(0)
    expect(attemptsOf(db, 'v1.p-turn-a')[0]?.outcome).toBe('censored')
  })

  test('a same-goal follow-up keeps the clarification engaged', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { clarification: true })
    seedTurn(db, ref, 'b', 'v1.p-turn-b', T0 + 2 * HOUR, { outcomes: ['semantic_success'] })
    const result = runJob(db)
    expect(result.clarificationAbandonedInserted).toBe(0)
    expect(clarificationEventsOf(db)).toHaveLength(0)
  })

  test('a rebuilt run removes a derived clarification_abandoned event whose source was deleted', () => {
    seedEvent(db, ref, {
      id: 'v1.p-ts-x',
      name: 'turn_started',
      occurredAtMs: T0,
      turnKey: 'v1.p-turn-x',
      props: TURN_STARTED_PROPS,
    })
    seedEvent(db, ref, {
      id: 'v1.p-cl-x',
      name: 'clarification_requested',
      occurredAtMs: T0 + 50,
      turnKey: 'v1.p-turn-x',
      props: { reason: 'ambiguous_target' },
    })
    seedEvent(db, ref, {
      id: 'v1.p-done-x',
      name: 'turn_completed',
      occurredAtMs: T0 + 1_000,
      turnKey: 'v1.p-turn-x',
      props: turnCompletedProps(1_000, false),
    })
    seedEvent(db, ref, {
      id: 'v1.p-int-x',
      name: 'intent_classified',
      occurredAtMs: T0 + 1_000,
      turnKey: 'v1.p-turn-x',
      props: intentProps(['I01']),
    })
    runJob(db)
    expect(clarificationEventsOf(db)).toHaveLength(1)
    const clarification = requireRow(
      db.select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.sourceRefKey, 'v1.p-cl-x')).get(),
    )
    db.delete(schema.analyticsEventCollectionRefs)
      .where(eq(schema.analyticsEventCollectionRefs.eventId, clarification.eventId))
      .run()
    db.delete(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventId, clarification.eventId)).run()
    const result = runJob(db)
    expect(result.clarificationAbandonedRemoved).toBe(1)
    expect(clarificationEventsOf(db)).toHaveLength(0)
  })

  test('deny after scan but before insert creates no event, association, or abandonment disposition', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { clarification: true })
    const associationsBefore = db.select().from(schema.analyticsEventCollectionRefs).all().length
    denyActor(db, ref, T0 + DAY)
    const result = runJob(db)
    expect(result.clarificationAbandonedInserted).toBe(0)
    expect(clarificationEventsOf(db)).toHaveLength(0)
    expect(db.select().from(schema.analyticsEventCollectionRefs).all()).toHaveLength(associationsBefore)
    const attempt = attemptsOf(db, 'v1.p-turn-a')[0]
    expect(attempt?.outcome).toBe('censored')
    expect(attempt?.outcome).not.toBe('abandoned_after_clarification')
  })

  test('writer-before-deny race is withdrawn through the inherited ref association', () => {
    seedTurn(db, ref, 'a', 'v1.p-turn-a', T0, { clarification: true })
    runJob(db)
    expect(clarificationEventsOf(db)).toHaveLength(1)
    denyActor(db, ref, T0 + 2 * DAY)
    const deletion = deleteCanonicalEventsForRef({ refKey: ref.refKey }, { getDrizzleDb: () => db })
    expect(deletion.deletedEventIds.length).toBeGreaterThan(0)
    expect(clarificationEventsOf(db)).toHaveLength(0)
    expect(db.select().from(schema.analyticsEventCollectionRefs).all()).toHaveLength(0)
  })
})
