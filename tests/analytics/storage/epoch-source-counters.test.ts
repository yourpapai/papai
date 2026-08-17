// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import {
  createControlledOverflowBinding,
  incrementEpochSourceCounter,
  recordLiveAggregateDisposition,
} from '../../../src/analytics/storage/epoch-source-counters.js'
import { openEpoch } from '../../../src/analytics/storage/epoch-store.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { TEST_EPOCH_ID, type Db } from '../storage-fixtures.js'

describe('analytics epoch source counters', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('bounded dispositions for epoch source counters', () => {
    openEpoch({ epochId: TEST_EPOCH_ID, startedAtMs: 1700000000000 }, { getDrizzleDb: () => db })
    incrementEpochSourceCounter(
      { epochId: TEST_EPOCH_ID, utcDay: '2026-01-01', sourceFamily: 'llm', disposition: 'canonical', value: 1 },
      { getDrizzleDb: () => db },
    )
    const row = db.select().from(schema.analyticsEpochSourceCounters).get()
    expect(row).toBeDefined()
    expect(row?.value).toBe(1)

    expect(() =>
      incrementEpochSourceCounter(
        { epochId: TEST_EPOCH_ID, utcDay: '2026-01-01', sourceFamily: 'llm', disposition: 'invalid', value: 1 },
        { getDrizzleDb: () => db },
      ),
    ).toThrow()
  })

  test('the controlled overflow binding increments the exact epoch-bound overflow counter', () => {
    openEpoch({ epochId: TEST_EPOCH_ID, startedAtMs: 1700000000000 }, { getDrizzleDb: () => db })
    const onControlledOverflow = createControlledOverflowBinding({ epochId: TEST_EPOCH_ID }, { getDrizzleDb: () => db })
    onControlledOverflow('2026-01-01')
    onControlledOverflow('2026-01-01')
    const rows = db.select().from(schema.analyticsEpochSourceCounters).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      epochId: TEST_EPOCH_ID,
      utcDay: '2026-01-01',
      sourceFamily: 'chat',
      disposition: 'controlled_overflow',
      value: 2,
    })
  })

  test('live aggregate disposition bumps opportunity and aggregate_only together in contribution units', () => {
    openEpoch({ epochId: TEST_EPOCH_ID, startedAtMs: 1700000000000 }, { getDrizzleDb: () => db })
    db.transaction((tx) => {
      recordLiveAggregateDisposition(tx, { epochId: TEST_EPOCH_ID, utcDay: '2026-01-01', value: 3 })
      recordLiveAggregateDisposition(tx, { epochId: TEST_EPOCH_ID, utcDay: '2026-01-01', value: 1 })
    })
    const rows = db
      .select()
      .from(schema.analyticsEpochSourceCounters)
      .where(eq(schema.analyticsEpochSourceCounters.epochId, TEST_EPOCH_ID))
      .all()
    const byDisposition = Object.fromEntries(rows.map((row) => [row.disposition, row.value]))
    expect(byDisposition).toEqual({ opportunity: 4, aggregate_only: 4 })
    expect(rows.every((row) => row.sourceFamily === 'chat')).toBe(true)
  })
})
