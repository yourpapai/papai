// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { rollbackBackfillRun } from '../../../src/analytics/jobs/backfill-rollback.js'
import * as schema from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

describe('backfill rollback', () => {
  let db: Db

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
  })

  test('rolling back a run removes its rejected provenance and rejection counts', () => {
    db.insert(schema.analyticsBackfillRuns)
      .values({
        runId: 'run-rb',
        sourceTable: 'llm_usage_events',
        highWaterRowKey: '1000:e-1',
        policyCutoffMs: 0,
        status: 'completed',
        startedAtMs: 1000,
      })
      .run()
    db.insert(schema.analyticsNormalizationRejections)
      .values({ utcDay: '2023-11-14', sourceEventType: 'llm_usage_event', reason: 'invalid_value', count: 1 })
      .run()
    db.insert(schema.analyticsBackfillAggregateContributions)
      .values({
        runId: 'run-rb',
        aggregateCellKey: '2023-11-14|llm_usage_events|rejected',
        metric: 'rejected:invalid_value',
        delta: 0,
        sourceRefKey: 'v1.ref-rb',
      })
      .run()

    const removed = rollbackBackfillRun({ runId: 'run-rb' }, { getDrizzleDb: () => db })
    expect(removed.removedContributions).toBe(1)
    expect(db.select().from(schema.analyticsNormalizationRejections).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsBackfillRuns).all()).toHaveLength(0)
    expect(db.select().from(schema.analyticsBackfillAggregateContributions).all()).toHaveLength(0)
  })
})
