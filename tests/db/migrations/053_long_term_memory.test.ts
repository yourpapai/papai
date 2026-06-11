// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { migration053LongTermMemory } from '../../../src/db/migrations/053_long_term_memory.js'

const tableNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type IN ('table', 'index', 'trigger')`)
    .all()
    .map((r) => r.name)

describe('migration053LongTermMemory', () => {
  test('creates long-term memory profile and record storage', () => {
    const db = new Database(':memory:')
    migration053LongTermMemory.up(db)

    const names = tableNames(db)
    expect(names).toContain('memory_profiles')
    expect(names).toContain('memory_records')
    expect(names).toContain('memory_records_fts')
    expect(names).toContain('idx_memory_profiles_scope')
    expect(names).toContain('idx_memory_records_scope_status_seen')
    expect(names).toContain('idx_memory_records_scope_kind_status')
    expect(names).toContain('memory_records_ai')
    expect(names).toContain('memory_records_au')
    expect(names).toContain('memory_records_ad')
  })

  test('keeps FTS rows in sync with memory records', () => {
    const db = new Database(':memory:')
    migration053LongTermMemory.up(db)

    db.run(
      `INSERT INTO memory_records
        (id, scope_id, scope_type, kind, content, summary, tags, confidence, status, source, evidence, created_at, updated_at, last_seen_at)
       VALUES
        ('mem-1', 'scope-1', 'personal', 'preference', 'User prefers concise replies', 'Concise replies', '["style"]', 0.9, 'active', 'explicit', '{}', '2026-06-11T00:00:00.000Z', '2026-06-11T00:00:00.000Z', '2026-06-11T00:00:00.000Z')`,
    )

    const found = db
      .query<{ id: string }, []>(
        `SELECT m.id
         FROM memory_records m
         JOIN memory_records_fts f ON m.rowid = f.rowid
         WHERE f.memory_records_fts MATCH 'concise'`,
      )
      .all()
    expect(found).toEqual([{ id: 'mem-1' }])
  })
})
