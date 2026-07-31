// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration072AnalyticsFoundation } from '../../../src/db/migrations/072_analytics_foundation.js'

const getTableNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name)

const getIndexNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='index'")
    .all()
    .map((r) => r.name)

const FOUNDATION_TABLES = [
  'analytics_process_epochs',
  'analytics_events',
  'analytics_daily_counters',
  'analytics_daily_histograms',
  'analytics_epoch_source_counters',
  'analytics_aggregate_epoch_contributions',
  'analytics_normalization_rejections',
  'analytics_backfill_runs',
  'analytics_backfill_event_map',
  'analytics_backfill_aggregate_contributions',
]

const FOUNDATION_INDEXES = [
  'idx_analytics_events_gen_occurred',
  'idx_analytics_events_gen_actor_occurred',
  'idx_analytics_events_gen_conversation_occurred',
  'idx_analytics_events_gen_turn',
  'idx_analytics_events_gen_name_occurred',
]

describe('migration 072_analytics_foundation', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('exports a migration with the expected id', () => {
    expect(migration072AnalyticsFoundation.id).toBe('072_analytics_foundation')
    expect(typeof migration072AnalyticsFoundation.up).toBe('function')
  })

  test('all foundation tables are absent before up and present after up', () => {
    const beforeTables = getTableNames(db)
    for (const table of FOUNDATION_TABLES) {
      expect(beforeTables).not.toContain(table)
    }

    migration072AnalyticsFoundation.up(db)

    const afterTables = getTableNames(db)
    for (const table of FOUNDATION_TABLES) {
      expect(afterTables).toContain(table)
    }
  })

  test('all canonical indexes are absent before up and present after up', () => {
    const beforeIndexes = getIndexNames(db)
    for (const index of FOUNDATION_INDEXES) {
      expect(beforeIndexes).not.toContain(index)
    }

    migration072AnalyticsFoundation.up(db)

    const afterIndexes = getIndexNames(db)
    for (const index of FOUNDATION_INDEXES) {
      expect(afterIndexes).toContain(index)
    }
  })
})
