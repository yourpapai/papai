// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import type { CollectionEligibilityRef } from '../../../src/analytics/governance/eligibility.js'
import { LIVE_WATERMARK_MS, runDeriveJob } from '../../../src/analytics/jobs/derive.js'
import type { DeriveJobInput } from '../../../src/analytics/jobs/derive.js'
import * as schema from '../../../src/db/schema.js'
import {
  allowActor,
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
} from '../derive-fixtures.js'
import type { TestDb } from '../derive-fixtures.js'

const MIN = 60_000
const NOW = T0 + 2 * 86_400_000

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

const messageProps = (): Record<string, unknown> => ({
  input_count: '1',
  length_bucket: '1_32',
  attachment_count: '0',
  is_command: false,
  command: 'none',
})

const seedTurn = (
  db: TestDb,
  ref: CollectionEligibilityRef,
  turnKey: string,
  startMs: number,
  outcome: string,
  goals: readonly string[] = ['I01'],
  durationMs = 1_000,
): void => {
  seedEvent(db, ref, {
    id: `v1.p-ts-${turnKey.slice(8)}`,
    name: 'turn_started',
    occurredAtMs: startMs,
    turnKey,
    props: TURN_STARTED_PROPS,
  })
  if (outcome !== 'none') {
    seedEvent(db, ref, {
      id: `v1.p-tc-${turnKey.slice(8)}`,
      name: 'tool_completed',
      occurredAtMs: startMs + 10,
      turnKey,
      props: toolCompletedProps(outcome),
    })
  }
  seedEvent(db, ref, {
    id: `v1.p-done-${turnKey.slice(8)}`,
    name: 'turn_completed',
    occurredAtMs: startMs + durationMs,
    turnKey,
    props: turnCompletedProps(durationMs),
  })
  seedEvent(db, ref, {
    id: `v1.p-int-${turnKey.slice(8)}`,
    name: 'intent_classified',
    occurredAtMs: startMs + durationMs,
    turnKey,
    props: intentProps(goals, goals.length > 1 ? 'I23' : (goals[0] ?? 'I22')),
  })
}

describe('derive job', () => {
  let db: TestDb
  let ref: CollectionEligibilityRef

  beforeEach(async () => {
    db = await setupDeriveDb()
    ref = allowActor(db, 'user-42')
  })

  test('non-pseudonymous modes short-circuit before resolving the database', () => {
    const probeDb = (): never => {
      throw new Error('derive job resolved the database outside local_pseudonymous mode')
    }
    for (const localMode of ['off', 'local_aggregate'] as const) {
      const result = runDeriveJob(jobInput({ localMode }), { getDrizzleDb: probeDb })
      expect(result.partitions).toBe(0)
      expect(result.sessionsWritten).toBe(0)
    }
  })

  test('materializes sessions, attempts, friction, and feature days for window partitions', () => {
    seedTurn(db, ref, 'v1.p-turn-1', T0, 'semantic_success')
    seedEvent(db, ref, {
      id: 'v1.p-opp',
      name: 'feature_opportunity',
      occurredAtMs: T0,
      props: { feature: 'coding', available: true, reason: 'available', sampling: 'first_eligible_actor_day' },
    })
    const result = runDeriveJob(jobInput(), { getDrizzleDb: () => db })
    expect(result.partitions).toBe(1)
    expect(result.sessionsWritten).toBe(1)
    expect(result.attemptsWritten).toBe(1)
    expect(result.frictionWritten).toBe(1)
    expect(result.featureOpportunityDaysWritten).toBe(1)
    expect(db.select().from(schema.analyticsGoalAttempts).get()?.outcome).toBe('immediate_success')
  })

  test('the two-minute live watermark excludes too-recent events from the scan', () => {
    expect(LIVE_WATERMARK_MS).toBe(120_000)
    seedEvent(db, ref, {
      id: 'v1.p-e1',
      name: 'chat_message_accepted',
      occurredAtMs: NOW - 60_000,
      props: messageProps(),
    })
    const result = runDeriveJob(jobInput(), { getDrizzleDb: () => db })
    expect(result.partitions).toBe(0)
    expect(db.select().from(schema.analyticsSessions).all()).toHaveLength(0)
  })

  test('the half-open window excludes events before the start', () => {
    seedEvent(db, ref, { id: 'v1.p-e1', name: 'chat_message_accepted', occurredAtMs: T0 - 2, props: messageProps() })
    const result = runDeriveJob(jobInput({ windowStartMs: T0, windowEndMs: T0 + 10 }), { getDrizzleDb: () => db })
    expect(result.partitions).toBe(0)
  })

  test('rerunning the same window duplicates nothing', () => {
    seedTurn(db, ref, 'v1.p-turn-1', T0, 'semantic_success')
    const first = runDeriveJob(jobInput(), { getDrizzleDb: () => db })
    const second = runDeriveJob(jobInput(), { getDrizzleDb: () => db })
    expect(second).toEqual(first)
    expect(db.select().from(schema.analyticsSessions).all()).toHaveLength(1)
    expect(db.select().from(schema.analyticsSessionEvents).all().length).toBeGreaterThan(0)
    expect(db.select().from(schema.analyticsGoalAttempts).all()).toHaveLength(1)
    expect(db.select().from(schema.analyticsTurnFriction).all()).toHaveLength(1)
  })

  test('source-event deletion recomputes affected session rows on rerun', () => {
    seedEvent(db, ref, { id: 'v1.p-e1', name: 'chat_message_accepted', occurredAtMs: T0, props: messageProps() })
    const secondId = seedEvent(db, ref, {
      id: 'v1.p-e2',
      name: 'chat_message_accepted',
      occurredAtMs: T0 + 20 * MIN,
      props: messageProps(),
    })
    runDeriveJob(jobInput(), { getDrizzleDb: () => db })
    expect(db.select().from(schema.analyticsSessions).get()?.activityCount).toBe(2)
    db.delete(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventId, secondId)).run()
    runDeriveJob(jobInput(), { getDrizzleDb: () => db })
    const session = db.select().from(schema.analyticsSessions).get()
    expect(session?.activityCount).toBe(1)
    expect(session?.durationMs).toBe(0)
    expect(db.select().from(schema.analyticsSessions).all()).toHaveLength(1)
  })

  test('follow-up deletion recomputes the earlier attempt outcome on rerun', () => {
    seedTurn(db, ref, 'v1.p-turn-1', T0, 'thrown_failure')
    const followUpDone = seedEvent(db, ref, {
      id: 'v1.p-done-turn-2',
      name: 'turn_completed',
      occurredAtMs: T0 + 2 * 3_600_000,
      turnKey: 'v1.p-turn-2',
      props: turnCompletedProps(500),
    })
    seedEvent(db, ref, {
      id: 'v1.p-int-turn-2',
      name: 'intent_classified',
      occurredAtMs: T0 + 2 * 3_600_000,
      turnKey: 'v1.p-turn-2',
      props: intentProps(['I01']),
    })
    runDeriveJob(jobInput(), { getDrizzleDb: () => db })
    const engaged = db
      .select()
      .from(schema.analyticsGoalAttempts)
      .where(eq(schema.analyticsGoalAttempts.turnKey, 'v1.p-turn-1'))
      .get()
    expect(engaged?.outcome).toBe('unresolved_engaged')
    db.delete(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventId, followUpDone)).run()
    runDeriveJob(jobInput(), { getDrizzleDb: () => db })
    const abandoned = db
      .select()
      .from(schema.analyticsGoalAttempts)
      .where(eq(schema.analyticsGoalAttempts.turnKey, 'v1.p-turn-1'))
      .get()
    expect(abandoned?.outcome).toBe('abandoned_after_failure')
  })
})
