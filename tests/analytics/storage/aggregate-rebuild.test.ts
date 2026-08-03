// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { llmCompletedFixture } from '../../../src/analytics/contracts.js'
import { PseudonymSchema } from '../../../src/analytics/controlled-types.js'
import { rebuildDailyAggregatesForDays } from '../../../src/analytics/storage/aggregate-rebuild.js'
import { openEpoch } from '../../../src/analytics/storage/epoch-store.js'
import { insertCanonicalEventRow } from '../../../src/analytics/storage/event-store.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const DAY = 86_400_000
const T = Date.UTC(2027, 0, 10, 12, 0, 0)
const UTC_DAY = '2027-01-10'
const EXPIRY = T + 90 * DAY

const insertEvent = (db: Db, sourceRefKey: string, actorKey: string): void => {
  const event = {
    ...llmCompletedFixture,
    event: {
      ...llmCompletedFixture.event,
      id: PseudonymSchema.parse(sourceRefKey),
      occurred_at_ms: T,
      ingested_at_ms: T + 1,
    },
    identity: { ...llmCompletedFixture.identity, actor_key: PseudonymSchema.parse(actorKey) },
  }
  const result = insertCanonicalEventRow(db, {
    storageGeneration: 'gen-1',
    processEpochId: 'epoch-rebuild',
    sourceRefKey,
    sourceKind: 'live',
    expiresAtMs: EXPIRY,
    event,
  })
  if (result.status !== 'created') throw new Error('expected event insert')
}

const counterValues = (db: Db): Record<string, number> =>
  Object.fromEntries(
    db
      .select()
      .from(schema.analyticsDailyCounters)
      .all()
      .map((row) => [row.metric, row.value]),
  )

describe('aggregate rebuild after contribution removal', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    openEpoch({ epochId: 'epoch-rebuild', startedAtMs: T }, { getDrizzleDb: () => db })
  })

  test('recomputes daily counters and histograms from the remaining unexpired events', () => {
    insertEvent(db, 'v1.p-src-a', 'v1.a-actor-a')
    insertEvent(db, 'v1.p-src-b', 'v1.a-actor-b')

    const first = rebuildDailyAggregatesForDays({ utcDays: [UTC_DAY], nowMs: T + 1000 }, { getDrizzleDb: () => db })
    expect(first.days).toBe(1)
    const before = counterValues(db)
    expect(Object.values(before).some((value) => value === 2)).toBe(true)

    db.delete(schema.analyticsEvents).run()
    insertEvent(db, 'v1.p-src-b2', 'v1.a-actor-b')
    rebuildDailyAggregatesForDays({ utcDays: [UTC_DAY], nowMs: T + 1000 }, { getDrizzleDb: () => db })

    const after = counterValues(db)
    expect(Object.values(after).every((value) => value === 1)).toBe(true)
  })

  test('drops rows whose contributing events are gone or expired', () => {
    insertEvent(db, 'v1.p-src-a', 'v1.a-actor-a')
    rebuildDailyAggregatesForDays({ utcDays: [UTC_DAY], nowMs: T + 1000 }, { getDrizzleDb: () => db })
    expect(Object.keys(counterValues(db)).length).toBeGreaterThan(0)

    rebuildDailyAggregatesForDays({ utcDays: [UTC_DAY], nowMs: EXPIRY + 1 }, { getDrizzleDb: () => db })
    expect(counterValues(db)).toEqual({})
    expect(db.select().from(schema.analyticsDailyHistograms).all()).toHaveLength(0)
  })

  test('an unknown day with no events is a no-op', () => {
    const result = rebuildDailyAggregatesForDays({ utcDays: ['2027-02-01'], nowMs: T }, { getDrizzleDb: () => db })
    expect(result.days).toBe(1)
    expect(counterValues(db)).toEqual({})
  })
})
