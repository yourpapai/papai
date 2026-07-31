// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import type { CollectionEligibilityRef } from '../../src/analytics/governance/eligibility.js'
import { runDeriveJob } from '../../src/analytics/jobs/derive.js'
import type { DeriveJobInput } from '../../src/analytics/jobs/derive.js'
import * as schema from '../../src/db/schema.js'
import {
  allowActor,
  DERIVE_EPOCH,
  DERIVE_KEY,
  DERIVE_KEY_VERSION,
  seedEvent,
  setupDeriveDb,
  T0,
  toolCompletedProps,
  turnCompletedProps,
  TURN_STARTED_PROPS,
} from './derive-fixtures.js'
import type { TestDb } from './derive-fixtures.js'

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

const frictionOf = (db: TestDb, turnKey: string): schema.AnalyticsTurnFrictionRow | undefined =>
  db.select().from(schema.analyticsTurnFriction).where(eq(schema.analyticsTurnFriction.turnKey, turnKey)).get()

const seedBaseTurn = (
  db: TestDb,
  ref: CollectionEligibilityRef,
  suffix: string,
  turnKey: string,
  startMs: number,
  durationMs = 1_000,
): void => {
  seedEvent(db, ref, {
    id: `v1.p-ts-${suffix}`,
    name: 'turn_started',
    occurredAtMs: startMs,
    turnKey,
    props: TURN_STARTED_PROPS,
  })
  seedEvent(db, ref, {
    id: `v1.p-done-${suffix}`,
    name: 'turn_completed',
    occurredAtMs: startMs + durationMs,
    turnKey,
    props: turnCompletedProps(durationMs),
  })
}

describe('friction materialization (friction v1)', () => {
  let db: TestDb
  let ref: CollectionEligibilityRef

  beforeEach(async () => {
    db = await setupDeriveDb()
    ref = allowActor(db, 'user-42')
  })

  test('each component fixture sets its bit with count 1 and score 14', () => {
    seedBaseTurn(db, ref, 'r', 'v1.p-turn-r', T0)
    seedEvent(db, ref, {
      id: 'v1.p-rephrase',
      name: 'rephrase_detected',
      occurredAtMs: T0 + 5,
      turnKey: 'v1.p-turn-r',
      props: { detector: 'lexical_v1', similarity: 'ge_095', prior_outcome: 'failure', gap: 'le_2m' },
    })
    seedBaseTurn(db, ref, 'p', 'v1.p-turn-p', T0 + 10_000)
    seedEvent(db, ref, {
      id: 'v1.p-conf',
      name: 'confirmation_resolved',
      occurredAtMs: T0 + 10_005,
      turnKey: 'v1.p-turn-p',
      props: { tool_slug: 'core_task_create', tool_key: 'v1.p-tool', decision: 'ignored', decision_latency_ms: 5 },
    })
    seedBaseTurn(db, ref, 's', 'v1.p-turn-s', T0 + 20_000)
    seedEvent(db, ref, {
      id: 'v1.p-stop',
      name: 'turn_stop_requested',
      occurredAtMs: T0 + 20_005,
      turnKey: 'v1.p-turn-s',
      props: { stage: 'forced' },
    })
    seedBaseTurn(db, ref, 'l', 'v1.p-turn-l', T0 + 30_000, 31_000)
    seedBaseTurn(db, ref, 'd', 'v1.p-turn-d', T0 + 70_000)
    seedEvent(db, ref, {
      id: 'v1.p-fallback',
      name: 'disclosure_fallback',
      occurredAtMs: T0 + 70_005,
      turnKey: 'v1.p-turn-d',
      props: { reason: 'meta_tool_churn', step_bucket: '3_5' },
    })
    runJob(db)
    type FrictionRow = typeof schema.analyticsTurnFriction.$inferSelect
    const expected: ReadonlyArray<readonly [string, keyof FrictionRow]> = [
      ['v1.p-turn-r', 'rephrase'],
      ['v1.p-turn-p', 'permissionIssue'],
      ['v1.p-turn-s', 'stop'],
      ['v1.p-turn-l', 'longTurn'],
      ['v1.p-turn-d', 'disclosureFallback'],
    ]
    for (const [turnKey, column] of expected) {
      const row = frictionOf(db, turnKey)
      expect(row?.componentCount).toBe(1)
      expect(row?.displayScore).toBe(14)
      expect(row?.[column]).toBe(true)
      expect(row?.frictionVersion).toBe(1)
    }
  })

  test('a clean turn has count 0 and score 0', () => {
    seedBaseTurn(db, ref, 'z', 'v1.p-turn-z', T0)
    runJob(db)
    const row = frictionOf(db, 'v1.p-turn-z')
    expect(row?.componentCount).toBe(0)
    expect(row?.displayScore).toBe(0)
  })

  test('a turn with every component has count 7 and score 100', () => {
    seedBaseTurn(db, ref, 'x', 'v1.p-turn-x', T0, 45_000)
    seedEvent(db, ref, {
      id: 'v1.p-rephrase',
      name: 'rephrase_detected',
      occurredAtMs: T0 + 5,
      turnKey: 'v1.p-turn-x',
      props: { detector: 'lexical_v1', similarity: '090_094', prior_outcome: 'clarification', gap: '2m_10m' },
    })
    seedEvent(db, ref, {
      id: 'v1.p-cl-x',
      name: 'clarification_requested',
      occurredAtMs: T0 + 6,
      turnKey: 'v1.p-turn-x',
      props: { reason: 'ambiguous_action' },
    })
    seedEvent(db, ref, {
      id: 'v1.p-conf',
      name: 'confirmation_resolved',
      occurredAtMs: T0 + 7,
      turnKey: 'v1.p-turn-x',
      props: {
        tool_slug: 'core_task_create',
        tool_key: 'v1.p-tool',
        decision: 'prompt_failed',
        decision_latency_ms: 5,
      },
    })
    seedEvent(db, ref, {
      id: 'v1.p-stop',
      name: 'turn_stop_requested',
      occurredAtMs: T0 + 8,
      turnKey: 'v1.p-turn-x',
      props: { stage: 'graceful' },
    })
    seedEvent(db, ref, {
      id: 'v1.p-fallback',
      name: 'disclosure_fallback',
      occurredAtMs: T0 + 9,
      turnKey: 'v1.p-turn-x',
      props: { reason: 'no_real_load', step_bucket: '1_2' },
    })
    seedEvent(db, ref, {
      id: 'v1.p-t1',
      name: 'tool_completed',
      occurredAtMs: T0 + 10,
      turnKey: 'v1.p-turn-x',
      props: toolCompletedProps('structured_failure'),
    })
    seedEvent(db, ref, {
      id: 'v1.p-t2',
      name: 'tool_completed',
      occurredAtMs: T0 + 11,
      turnKey: 'v1.p-turn-x',
      props: toolCompletedProps('thrown_failure'),
    })
    runJob(db)
    const row = frictionOf(db, 'v1.p-turn-x')
    expect(row?.componentCount).toBe(7)
    expect(row?.displayScore).toBe(100)
    expect(row?.clarificationAbandoned).toBe(true)
  })

  test('two consecutive failures with no intervening success set the chain bit', () => {
    seedBaseTurn(db, ref, 'f', 'v1.p-turn-f', T0)
    seedEvent(db, ref, {
      id: 'v1.p-t1',
      name: 'tool_completed',
      occurredAtMs: T0 + 10,
      turnKey: 'v1.p-turn-f',
      props: toolCompletedProps('structured_failure'),
    })
    seedEvent(db, ref, {
      id: 'v1.p-t2',
      name: 'tool_completed',
      occurredAtMs: T0 + 11,
      turnKey: 'v1.p-turn-f',
      props: toolCompletedProps('thrown_failure'),
    })
    runJob(db)
    expect(frictionOf(db, 'v1.p-turn-f')?.failureChain).toBe(true)
  })

  test('an intervening success clears the chain', () => {
    seedBaseTurn(db, ref, 'f', 'v1.p-turn-f', T0)
    seedEvent(db, ref, {
      id: 'v1.p-t1',
      name: 'tool_completed',
      occurredAtMs: T0 + 10,
      turnKey: 'v1.p-turn-f',
      props: toolCompletedProps('structured_failure'),
    })
    seedEvent(db, ref, {
      id: 'v1.p-t2',
      name: 'tool_completed',
      occurredAtMs: T0 + 11,
      turnKey: 'v1.p-turn-f',
      props: toolCompletedProps('semantic_success'),
    })
    seedEvent(db, ref, {
      id: 'v1.p-t3',
      name: 'tool_completed',
      occurredAtMs: T0 + 12,
      turnKey: 'v1.p-turn-f',
      props: toolCompletedProps('thrown_failure'),
    })
    runJob(db)
    expect(frictionOf(db, 'v1.p-turn-f')?.failureChain).toBe(false)
  })

  test('permission denials are not executed failures and never form a chain', () => {
    seedBaseTurn(db, ref, 'f', 'v1.p-turn-f', T0)
    seedEvent(db, ref, {
      id: 'v1.p-t1',
      name: 'tool_completed',
      occurredAtMs: T0 + 10,
      turnKey: 'v1.p-turn-f',
      props: toolCompletedProps('permission_denied'),
    })
    seedEvent(db, ref, {
      id: 'v1.p-t2',
      name: 'tool_completed',
      occurredAtMs: T0 + 11,
      turnKey: 'v1.p-turn-f',
      props: toolCompletedProps('permission_denied'),
    })
    runJob(db)
    expect(frictionOf(db, 'v1.p-turn-f')?.failureChain).toBe(false)
  })

  test('the clarification-abandoned bit follows the derived event lifecycle', () => {
    seedBaseTurn(db, ref, 'c', 'v1.p-turn-c', T0)
    seedEvent(db, ref, {
      id: 'v1.p-cl-c',
      name: 'clarification_requested',
      occurredAtMs: T0 + 50,
      turnKey: 'v1.p-turn-c',
      props: { reason: 'missing_required_input' },
    })
    runJob(db, { nowMs: T0 + 12 * 3_600_000 })
    expect(frictionOf(db, 'v1.p-turn-c')?.clarificationAbandoned).toBe(false)
    runJob(db)
    expect(frictionOf(db, 'v1.p-turn-c')?.clarificationAbandoned).toBe(true)
  })

  test('friction rows recompute after source-event deletion', () => {
    seedBaseTurn(db, ref, 'f', 'v1.p-turn-f', T0)
    const secondFailure = seedEvent(db, ref, {
      id: 'v1.p-t1',
      name: 'tool_completed',
      occurredAtMs: T0 + 10,
      turnKey: 'v1.p-turn-f',
      props: toolCompletedProps('structured_failure'),
    })
    seedEvent(db, ref, {
      id: 'v1.p-t2',
      name: 'tool_completed',
      occurredAtMs: T0 + 11,
      turnKey: 'v1.p-turn-f',
      props: toolCompletedProps('thrown_failure'),
    })
    runJob(db)
    expect(frictionOf(db, 'v1.p-turn-f')?.failureChain).toBe(true)
    db.delete(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventId, secondFailure)).run()
    runJob(db)
    expect(frictionOf(db, 'v1.p-turn-f')?.failureChain).toBe(false)
  })
})
