// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { MIGRATIONS } from '../../../src/db/index.js'
import { runMigrations } from '../../../src/db/migrate.js'
import { migration075MemoryRecallShadowLog } from '../../../src/db/migrations/075_memory_recall_shadow_log.js'
import { memoryRecallShadowLog } from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

const migrationsThrough074 = (): readonly (typeof MIGRATIONS)[number][] => {
  const shadowLogIndex = MIGRATIONS.findIndex((m) => m.id === '075_memory_recall_shadow_log')
  if (shadowLogIndex <= 0) throw new Error('075_memory_recall_shadow_log not found after a prior migration')
  return MIGRATIONS.slice(0, shadowLogIndex)
}

const EXPECTED_COLUMNS = [
  'id',
  'created_at',
  'scope_hash',
  'context_hash',
  'turn_ref',
  'reader_model_id',
  'active_record_count',
  'shadow_query_hash',
  'shadow_query_len_bucket',
  'shadow_hit_count',
  'shadow_top_score',
  'shadow_top_provenance',
  'shadow_top_record_hash',
  'model_pulled',
  'pull_count',
  'pull_query_hash',
  'pull_result_count',
  'shadow_pull_overlap',
  'skipped_reason',
]

describe('migration 075 memory recall shadow log', () => {
  test('migration id is 075_memory_recall_shadow_log', () => {
    expect(migration075MemoryRecallShadowLog.id).toBe('075_memory_recall_shadow_log')
  })

  test('creates the memory_recall_shadow_log table with the expected columns', async () => {
    await setupTestDb()

    const cols = getDrizzleDb()
      .$client.query<{ name: string }, []>('PRAGMA table_info(memory_recall_shadow_log)')
      .all()
      .map((c) => c.name)

    for (const expected of EXPECTED_COLUMNS) {
      expect(cols).toContain(expected)
    }
  })

  test('inserting a hash-only row round-trips', async () => {
    await setupTestDb()

    const db = getDrizzleDb()
    db.insert(memoryRecallShadowLog)
      .values({
        id: 'shadow-1',
        createdAt: 1_753_315_200,
        scopeHash: 'scope-hash-abc',
        contextHash: 'context-hash-abc',
        turnRef: 'turn-ref-abc',
        readerModelId: 'gpt-test',
        activeRecordCount: 12,
        shadowQueryHash: 'query-hash-abc',
        shadowQueryLenBucket: 'medium',
        shadowHitCount: 3,
        shadowTopScore: 0.87,
        shadowTopProvenance: 'current',
        shadowTopRecordHash: 'record-hash-abc',
        modelPulled: true,
        pullCount: 1,
        pullQueryHash: 'pull-query-hash-abc',
        pullResultCount: 2,
        shadowPullOverlap: 1,
        skippedReason: null,
      })
      .run()

    const row = db.$client
      .query<
        {
          id: string
          scope_hash: string
          model_pulled: number
          shadow_top_score: number
          skipped_reason: string | null
        },
        [string]
      >('SELECT * FROM memory_recall_shadow_log WHERE id = ?')
      .get('shadow-1')

    expect(row?.id).toBe('shadow-1')
    expect(row?.scope_hash).toBe('scope-hash-abc')
    expect(row?.model_pulled).toBe(1)
    expect(row?.shadow_top_score).toBeCloseTo(0.87)
    expect(row?.skipped_reason).toBeNull()
  })

  test('has an index on (reader_model_id, created_at)', async () => {
    await setupTestDb()

    const indexes = getDrizzleDb()
      .$client.query<{ name: string }, []>('PRAGMA index_list(memory_recall_shadow_log)')
      .all()
      .map((i) => i.name)

    expect(indexes.some((name) => name.includes('reader_model'))).toBe(true)
  })

  test('applies on a pre-075 database', () => {
    // Reproduce a real upgrade: migrate a fresh DB only through 074 (the state before this
    // feature shipped), then apply the full set.
    const db = new Database(':memory:')
    runMigrations(db, migrationsThrough074())

    const tablesBefore = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((t) => t.name)
    expect(tablesBefore).not.toContain('memory_recall_shadow_log')

    runMigrations(db, MIGRATIONS)

    const tablesAfter = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((t) => t.name)
    expect(tablesAfter).toContain('memory_recall_shadow_log')
  })
})
