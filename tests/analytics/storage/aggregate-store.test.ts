// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { incrementCounter } from '../../../src/analytics/storage/aggregate-store.js'
import { closeEpoch, openEpoch } from '../../../src/analytics/storage/epoch-store.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import {
  commonQuality,
  createTestBackfillRun,
  createTestEpoch,
  getCounterRow,
  getEpochContributionRow,
  TEST_EPOCH_ID,
  TEST_RUN_ID,
  type Db,
} from '../storage-fixtures.js'

describe('analytics aggregate storage', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('incrementing the same counter twice leaves one row with value 2', () => {
    createTestEpoch(db)
    const key = {
      utcDay: '2026-01-01',
      definitionVersion: 1,
      platform: 'telegram' as const,
      contextType: 'dm' as const,
      actorRole: 'admin' as const,
      taskProvider: 'none' as const,
      appVersion: '6.10.0',
      metric: 'llm_completed',
      epochId: TEST_EPOCH_ID,
    }

    incrementCounter({ ...key, delta: 1, ...commonQuality }, { getDrizzleDb: () => db })
    incrementCounter({ ...key, delta: 1, ...commonQuality }, { getDrizzleDb: () => db })

    const row = getCounterRow(db, key.utcDay, key.metric)
    expect(row).toBeDefined()
    expect(row?.value).toBe(2)
  })

  test('aggregate contribution records epoch delta and rolls back on map failure', () => {
    createTestEpoch(db)

    expect(() =>
      incrementCounter(
        {
          utcDay: '2026-01-01',
          definitionVersion: 1,
          platform: 'telegram',
          contextType: 'dm',
          actorRole: 'admin',
          taskProvider: 'none',
          appVersion: '6.10.0',
          metric: 'llm_completed',
          aggregateCellKey: 'cell-001',
          delta: 1,
          ...commonQuality,
          epochId: TEST_EPOCH_ID,
          runId: 'non-existent-run',
          sourceRefKey: 'src-001',
        },
        { getDrizzleDb: () => db },
      ),
    ).toThrow()

    expect(getCounterRow(db, '2026-01-01', 'llm_completed')).toBeUndefined()
    expect(getEpochContributionRow(db, 'cell-001')).toBeUndefined()
  })

  test('aggregate contribution increments epoch contribution in the same transaction', () => {
    createTestEpoch(db)
    createTestBackfillRun(db)

    incrementCounter(
      {
        utcDay: '2026-01-01',
        definitionVersion: 1,
        platform: 'telegram',
        contextType: 'dm',
        actorRole: 'admin',
        taskProvider: 'none',
        appVersion: '6.10.0',
        metric: 'llm_completed',
        aggregateCellKey: 'cell-001',
        delta: 5,
        ...commonQuality,
        epochId: TEST_EPOCH_ID,
        runId: TEST_RUN_ID,
        sourceRefKey: 'src-001',
      },
      { getDrizzleDb: () => db },
    )

    const row = getEpochContributionRow(db, 'cell-001')
    expect(row).toBeDefined()
    expect(row?.measureKind).toBe('counter')
    expect(row?.counterDelta).toBe(5)
  })

  test('increment rejects a missing epoch', () => {
    expect(() =>
      incrementCounter(
        {
          utcDay: '2026-01-01',
          definitionVersion: 1,
          platform: 'telegram',
          contextType: 'dm',
          actorRole: 'admin',
          taskProvider: 'none',
          appVersion: '6.10.0',
          metric: 'llm_completed',
          delta: 1,
          ...commonQuality,
          epochId: 'missing-epoch',
        },
        { getDrizzleDb: () => db },
      ),
    ).toThrow()
  })

  test('live counter increment records matching opportunity and aggregate_only epoch source counters', () => {
    createTestEpoch(db)

    incrementCounter(
      {
        utcDay: '2026-01-01',
        definitionVersion: 1,
        platform: 'telegram',
        contextType: 'dm',
        actorRole: 'admin',
        taskProvider: 'none',
        appVersion: '6.10.0',
        metric: 'llm_completed',
        aggregateCellKey: 'cell-live',
        delta: 2,
        ...commonQuality,
        epochId: TEST_EPOCH_ID,
      },
      { getDrizzleDb: () => db },
    )

    const rows = db
      .select()
      .from(schema.analyticsEpochSourceCounters)
      .where(eq(schema.analyticsEpochSourceCounters.epochId, TEST_EPOCH_ID))
      .all()
    const byDisposition = Object.fromEntries(rows.map((row) => [row.disposition, row.value]))
    expect(byDisposition).toEqual({ opportunity: 2, aggregate_only: 2 })
  })

  test('backfill counter increment (runId set) records no epoch source counters', () => {
    createTestEpoch(db)
    createTestBackfillRun(db)

    incrementCounter(
      {
        utcDay: '2026-01-01',
        definitionVersion: 1,
        platform: 'telegram',
        contextType: 'dm',
        actorRole: 'admin',
        taskProvider: 'none',
        appVersion: '6.10.0',
        metric: 'llm_completed',
        aggregateCellKey: 'cell-backfill',
        delta: 3,
        ...commonQuality,
        epochId: TEST_EPOCH_ID,
        runId: TEST_RUN_ID,
        sourceRefKey: 'src-backfill',
      },
      { getDrizzleDb: () => db },
    )

    const rows = db
      .select()
      .from(schema.analyticsEpochSourceCounters)
      .where(eq(schema.analyticsEpochSourceCounters.epochId, TEST_EPOCH_ID))
      .all()
    expect(rows).toEqual([])
  })

  test('increment rejects a closed epoch', () => {
    openEpoch({ epochId: TEST_EPOCH_ID, startedAtMs: 1700000000000 }, { getDrizzleDb: () => db })
    closeEpoch({ epochId: TEST_EPOCH_ID, closedAtMs: 1700000000001 }, { getDrizzleDb: () => db })

    expect(() =>
      incrementCounter(
        {
          utcDay: '2026-01-01',
          definitionVersion: 1,
          platform: 'telegram',
          contextType: 'dm',
          actorRole: 'admin',
          taskProvider: 'none',
          appVersion: '6.10.0',
          metric: 'llm_completed',
          delta: 1,
          ...commonQuality,
          epochId: TEST_EPOCH_ID,
        },
        { getDrizzleDb: () => db },
      ),
    ).toThrow()
  })
})
