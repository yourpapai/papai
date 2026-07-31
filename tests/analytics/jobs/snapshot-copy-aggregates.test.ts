// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { copyAggregateTables } from '../../../src/analytics/jobs/snapshot-copy-aggregates.js'
import { createSnapshotSchema } from '../../../src/analytics/jobs/snapshot-schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

describe('copyAggregateTables', () => {
  test('copies daily counters, histograms, and normalization rejections verbatim', async () => {
    const db = await setupTestDb()
    db.$client.run(
      `INSERT INTO analytics_daily_counters (
         utc_day, definition_version, platform, context_type, actor_role, task_provider, app_version,
         metric, value, finalized, partial_day, restart_gap_detected, late_event_count,
         reconciliation_status, disclosure_scope, contributor_basis, contributor_count, threshold
       ) VALUES ('2026-02-10', 1, 'telegram', 'dm', 'admin', 'none', '6.10.0', 'turn_completed', 12, 1, 0, 0, 0,
                 'complete_epoch', 'public', 'actors', 10, 5)`,
    )
    db.$client.run(
      `INSERT INTO analytics_daily_histograms (
         utc_day, definition_version, platform, context_type, actor_role, task_provider, app_version,
         metric, fixed_buckets_json, counts_json, sum, sample_count, finalized, partial_day,
         restart_gap_detected, late_event_count, reconciliation_status, disclosure_scope,
         contributor_basis, contributor_count, threshold
       ) VALUES ('2026-02-10', 1, 'telegram', 'dm', 'admin', 'none', '6.10.0', 'tool_duration_ms', '[]', '[]', 5000, 5,
                 1, 0, 0, 0, 'complete_epoch', 'public', 'actors', 10, 5)`,
    )
    db.$client.run(
      `INSERT INTO analytics_normalization_rejections (utc_day, source_event_type, reason, count)
       VALUES ('2026-02-10', 'tool_completed', 'missing_outcome', 3)`,
    )

    const publishDb = new Database(':memory:')
    createSnapshotSchema(publishDb, 'aggregate_only')
    const counts = copyAggregateTables(db, publishDb)
    expect(counts).toEqual({
      analytics_daily_counters: 1,
      analytics_daily_histograms: 1,
      analytics_normalization_rejections: 1,
    })
    const counter = publishDb
      .query<{ metric: string; value: number }, []>(`SELECT metric, value FROM analytics_daily_counters`)
      .get()
    expect(counter).toEqual({ metric: 'turn_completed', value: 12 })
    const histogram = publishDb
      .query<{ metric: string; sample_count: number }, []>(
        `SELECT metric, sample_count FROM analytics_daily_histograms`,
      )
      .get()
    expect(histogram).toEqual({ metric: 'tool_duration_ms', sample_count: 5 })
    const rejection = publishDb
      .query<{ reason: string; count: number }, []>(`SELECT reason, count FROM analytics_normalization_rejections`)
      .get()
    expect(rejection).toEqual({ reason: 'missing_outcome', count: 3 })
    publishDb.close()
  })
})
