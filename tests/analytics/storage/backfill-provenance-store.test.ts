// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import {
  completeBackfillRun,
  createBackfillRun,
  insertBackfillAggregateContribution,
  insertBackfillEventMap,
} from '../../../src/analytics/storage/backfill-provenance-store.js'
import { insertCanonicalEvent } from '../../../src/analytics/storage/event-store.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { createTestEpoch, eventInsertInput, makeTestEvent, TEST_RUN_ID, type Db } from '../storage-fixtures.js'

describe('analytics backfill provenance storage', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('backfill run stores high-water and policy cutoff without payload', () => {
    createBackfillRun(
      {
        runId: TEST_RUN_ID,
        sourceTable: 'llm_usage_events',
        highWaterRowKey: 'row-42',
        policyCutoffMs: 1700000000000,
        startedAtMs: 1700000000001,
      },
      { getDrizzleDb: () => db },
    )

    const row = db
      .select()
      .from(schema.analyticsBackfillRuns)
      .where(eq(schema.analyticsBackfillRuns.runId, TEST_RUN_ID))
      .get()
    expect(row).toBeDefined()
    expect(row?.highWaterRowKey).toBe('row-42')
    expect(row?.policyCutoffMs).toBe(1700000000000)

    const columns = db.$client
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('analytics_backfill_runs')")
      .all()
    const names = columns.map((c) => c.name)
    expect(names).not.toContain('payload')
    expect(names).not.toContain('raw_row_id')
  })

  test('completing a run records counts and timestamp', () => {
    createBackfillRun(
      {
        runId: TEST_RUN_ID,
        sourceTable: 'llm_usage_events',
        highWaterRowKey: 'row-0',
        policyCutoffMs: 1700000000000,
        startedAtMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    completeBackfillRun(
      { runId: TEST_RUN_ID, completedAtMs: 1700000000010, eventCount: 5, aggregateCount: 2 },
      { getDrizzleDb: () => db },
    )

    const row = db
      .select()
      .from(schema.analyticsBackfillRuns)
      .where(eq(schema.analyticsBackfillRuns.runId, TEST_RUN_ID))
      .get()
    expect(row?.status).toBe('completed')
    expect(row?.eventCount).toBe(5)
    expect(row?.aggregateCount).toBe(2)
    expect(row?.completedAtMs).toBe(1700000000010)
  })

  test('backfill event map enforces unique source mappings', () => {
    createTestEpoch(db)
    createBackfillRun(
      {
        runId: TEST_RUN_ID,
        sourceTable: 'llm_usage_events',
        highWaterRowKey: 'row-0',
        policyCutoffMs: 1700000000000,
        startedAtMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    const event = makeTestEvent()
    const eventId = insertCanonicalEvent(eventInsertInput(event), { getDrizzleDb: () => db }).eventId
    insertBackfillEventMap({ runId: TEST_RUN_ID, eventId, sourceRefKey: event.event.id }, { getDrizzleDb: () => db })

    expect(() =>
      insertBackfillEventMap({ runId: TEST_RUN_ID, eventId, sourceRefKey: event.event.id }, { getDrizzleDb: () => db }),
    ).toThrow()
  })

  test('backfill aggregate contribution enforces unique source mappings', () => {
    createBackfillRun(
      {
        runId: TEST_RUN_ID,
        sourceTable: 'llm_usage_events',
        highWaterRowKey: 'row-0',
        policyCutoffMs: 1700000000000,
        startedAtMs: 1700000000000,
      },
      { getDrizzleDb: () => db },
    )
    insertBackfillAggregateContribution(
      { runId: TEST_RUN_ID, aggregateCellKey: 'cell-001', metric: 'llm_completed', delta: 1, sourceRefKey: 'src-001' },
      { getDrizzleDb: () => db },
    )

    expect(() =>
      insertBackfillAggregateContribution(
        {
          runId: TEST_RUN_ID,
          aggregateCellKey: 'cell-001',
          metric: 'llm_completed',
          delta: 1,
          sourceRefKey: 'src-001',
        },
        { getDrizzleDb: () => db },
      ),
    ).toThrow()
  })
})
