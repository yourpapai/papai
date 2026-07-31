// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { and, eq } from 'drizzle-orm'

import { eligibleActorDayDenominator } from '../../src/analytics/derive/features.js'
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
} from './derive-fixtures.js'
import type { TestDb } from './derive-fixtures.js'

const DAY = 86_400_000
const NOW = T0 + 2 * DAY
const DAY_ONE = '2026-01-01'
const DAY_TWO = '2026-01-02'

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

const opportunityProps = (available: boolean, reason: string): Record<string, unknown> => ({
  feature: 'coding',
  available,
  reason,
  sampling: 'first_eligible_actor_day',
})

const useProps = (outcome: string): Record<string, unknown> => ({
  feature: 'coding',
  operation: 'start',
  outcome,
})

const opportunityDaysOf = (db: TestDb): readonly schema.AnalyticsFeatureOpportunityDayRow[] =>
  db.select().from(schema.analyticsFeatureOpportunityDays).all()
const useDaysOf = (db: TestDb): readonly schema.AnalyticsFeatureUseDayRow[] =>
  db.select().from(schema.analyticsFeatureUseDays).all()

const requireRow = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a row')
  return value
}

describe('feature exposure/use materialization', () => {
  let db: TestDb
  let ref: CollectionEligibilityRef

  beforeEach(async () => {
    db = await setupDeriveDb()
    ref = allowActor(db, 'user-42')
  })

  test('one opportunity per (actor, feature, UTC day) keeps the first eligible snapshot', () => {
    seedEvent(db, ref, { id: 'v1.p-m1', name: 'chat_message_accepted', occurredAtMs: T0, props: acceptedProps() })
    seedEvent(db, ref, {
      id: 'v1.p-opp-late',
      name: 'feature_opportunity',
      occurredAtMs: T0 + 5_000,
      props: opportunityProps(false, 'configuration_missing'),
    })
    seedEvent(db, ref, {
      id: 'v1.p-opp-early',
      name: 'feature_opportunity',
      occurredAtMs: T0 + 1_000,
      props: opportunityProps(true, 'available'),
    })
    runJob(db)
    const days = opportunityDaysOf(db)
    expect(days).toHaveLength(1)
    expect(days[0]?.utcDay).toBe(DAY_ONE)
    expect(days[0]?.available).toBe(true)
    expect(days[0]?.definitionVersion).toBe(1)
    const early = db
      .select()
      .from(schema.analyticsEvents)
      .where(eq(schema.analyticsEvents.sourceRefKey, 'v1.p-opp-early'))
      .get()
    expect(days[0]?.opportunityEventId).toBe(early?.eventId)
  })

  test('changed capability is materialized again the next day', () => {
    seedEvent(db, ref, { id: 'v1.p-m1', name: 'chat_message_accepted', occurredAtMs: T0, props: acceptedProps() })
    seedEvent(db, ref, { id: 'v1.p-m2', name: 'chat_message_accepted', occurredAtMs: T0 + DAY, props: acceptedProps() })
    seedEvent(db, ref, {
      id: 'v1.p-opp-1',
      name: 'feature_opportunity',
      occurredAtMs: T0,
      props: opportunityProps(true, 'available'),
    })
    seedEvent(db, ref, {
      id: 'v1.p-opp-2',
      name: 'feature_opportunity',
      occurredAtMs: T0 + DAY,
      props: opportunityProps(false, 'provider_missing'),
    })
    runJob(db)
    const days = opportunityDaysOf(db)
    expect(days).toHaveLength(2)
    expect(days.map((row) => [row.utcDay, row.available, row.reason])).toEqual([
      [DAY_ONE, true, 'available'],
      [DAY_TWO, false, 'provider_missing'],
    ])
  })

  test('use without an opportunity is recorded but never joined or adopted', () => {
    seedEvent(db, ref, { id: 'v1.p-m1', name: 'chat_message_accepted', occurredAtMs: T0, props: acceptedProps() })
    seedEvent(db, ref, { id: 'v1.p-use-1', name: 'feature_used', occurredAtMs: T0 + 10, props: useProps('success') })
    runJob(db)
    const uses = useDaysOf(db)
    expect(uses).toHaveLength(1)
    expect(uses[0]?.successCount).toBe(1)
    expect(uses[0]?.joinedAvailable).toBe(false)
    expect(uses[0]?.adopted).toBe(false)
  })

  test('blocked use is counted but is not adoption', () => {
    seedEvent(db, ref, { id: 'v1.p-m1', name: 'chat_message_accepted', occurredAtMs: T0, props: acceptedProps() })
    seedEvent(db, ref, {
      id: 'v1.p-opp-1',
      name: 'feature_opportunity',
      occurredAtMs: T0,
      props: opportunityProps(true, 'available'),
    })
    seedEvent(db, ref, { id: 'v1.p-use-1', name: 'feature_used', occurredAtMs: T0 + 10, props: useProps('blocked') })
    runJob(db)
    const uses = useDaysOf(db)
    expect(uses[0]?.blockedCount).toBe(1)
    expect(uses[0]?.joinedAvailable).toBe(true)
    expect(uses[0]?.adopted).toBe(false)
  })

  test('successful adoption requires a same-day available opportunity and a success', () => {
    seedEvent(db, ref, { id: 'v1.p-m1', name: 'chat_message_accepted', occurredAtMs: T0, props: acceptedProps() })
    seedEvent(db, ref, {
      id: 'v1.p-opp-1',
      name: 'feature_opportunity',
      occurredAtMs: T0,
      props: opportunityProps(true, 'available'),
    })
    seedEvent(db, ref, { id: 'v1.p-use-1', name: 'feature_used', occurredAtMs: T0 + 10, props: useProps('success') })
    runJob(db)
    expect(useDaysOf(db)[0]?.adopted).toBe(true)
  })

  test('use joins only to a same-day available=true opportunity', () => {
    seedEvent(db, ref, { id: 'v1.p-m1', name: 'chat_message_accepted', occurredAtMs: T0, props: acceptedProps() })
    seedEvent(db, ref, { id: 'v1.p-m2', name: 'chat_message_accepted', occurredAtMs: T0 + DAY, props: acceptedProps() })
    seedEvent(db, ref, {
      id: 'v1.p-opp-1',
      name: 'feature_opportunity',
      occurredAtMs: T0 + DAY,
      props: opportunityProps(true, 'available'),
    })
    seedEvent(db, ref, { id: 'v1.p-use-1', name: 'feature_used', occurredAtMs: T0, props: useProps('success') })
    runJob(db)
    const use = db
      .select()
      .from(schema.analyticsFeatureUseDays)
      .where(and(eq(schema.analyticsFeatureUseDays.utcDay, DAY_ONE)))
      .get()
    expect(use?.joinedAvailable).toBe(false)
    expect(use?.adopted).toBe(false)
  })

  test('eligible actor-day denominators exclude unavailable days and are never all-actor counts', () => {
    seedEvent(db, ref, { id: 'v1.p-m1', name: 'chat_message_accepted', occurredAtMs: T0, props: acceptedProps() })
    seedEvent(db, ref, {
      id: 'v1.p-m2',
      name: 'chat_message_accepted',
      occurredAtMs: T0,
      actorKey: 'v1.p-actor-b',
      contextKey: 'v1.p-context-b',
      props: acceptedProps(),
    })
    seedEvent(db, ref, {
      id: 'v1.p-opp-1',
      name: 'feature_opportunity',
      occurredAtMs: T0,
      props: opportunityProps(true, 'available'),
    })
    seedEvent(db, ref, {
      id: 'v1.p-opp-2',
      name: 'feature_opportunity',
      occurredAtMs: T0,
      actorKey: 'v1.p-actor-b',
      contextKey: 'v1.p-context-b',
      props: opportunityProps(false, 'role_denied'),
    })
    runJob(db)
    const rows = opportunityDaysOf(db)
    expect(rows).toHaveLength(2)
    expect(eligibleActorDayDenominator(rows, 'coding', DAY_ONE)).toBe(1)
  })

  test('feature days recompute after source-event deletion', () => {
    seedEvent(db, ref, { id: 'v1.p-m1', name: 'chat_message_accepted', occurredAtMs: T0, props: acceptedProps() })
    seedEvent(db, ref, {
      id: 'v1.p-opp-1',
      name: 'feature_opportunity',
      occurredAtMs: T0,
      props: opportunityProps(true, 'available'),
    })
    seedEvent(db, ref, { id: 'v1.p-use-1', name: 'feature_used', occurredAtMs: T0 + 10, props: useProps('success') })
    runJob(db)
    expect(useDaysOf(db)[0]?.adopted).toBe(true)
    const opportunity = requireRow(
      db.select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.sourceRefKey, 'v1.p-opp-1')).get(),
    )
    db.delete(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventId, opportunity.eventId)).run()
    expect(opportunityDaysOf(db)).toHaveLength(0)
    runJob(db)
    const use = useDaysOf(db)[0]
    expect(use?.joinedAvailable).toBe(false)
    expect(use?.adopted).toBe(false)
  })
})

const acceptedProps = (): Record<string, unknown> => ({
  input_count: '1',
  length_bucket: '1_32',
  attachment_count: '0',
  is_command: false,
  command: 'none',
})
