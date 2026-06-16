// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'

import { migration056ProvisionalMemory } from '../../../src/db/migrations/056_provisional_memory.js'

describe('migration 056_provisional_memory', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.run(`
      CREATE TABLE memory_records (
        id TEXT PRIMARY KEY,
        scope_id TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        evidence TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        valid_from TEXT,
        valid_until TEXT,
        expires_at TEXT,
        embedding BLOB
      )
    `)
    db.run(`CREATE VIRTUAL TABLE memory_records_fts
      USING fts5(content, summary, tags, content='memory_records', content_rowid='rowid')`)
  })

  test('has correct id', () => {
    expect(migration056ProvisionalMemory.id).toBe('056_provisional_memory')
  })

  test('up adds thread_context_id column to memory_records', () => {
    migration056ProvisionalMemory.up(db)

    const cols = db
      .query<{ name: string }, []>(`PRAGMA table_info(memory_records)`)
      .all()
      .map((r) => r.name)
    expect(cols).toContain('thread_context_id')
  })

  test('up creates memory_extraction_state table with correct columns', () => {
    migration056ProvisionalMemory.up(db)

    const tableRow = db
      .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get('memory_extraction_state')
    expect(tableRow).not.toBeNull()

    const cols = db
      .query<{ name: string }, []>(`PRAGMA table_info(memory_extraction_state)`)
      .all()
      .map((r) => r.name)
    expect(cols).toContain('context_id')
    expect(cols).toContain('context_type')
    expect(cols).toContain('config_context_id')
    expect(cols).toContain('last_activity_at')
    expect(cols).toContain('last_extracted_at')
    expect(cols).toContain('last_history_len')
  })

  test('up creates idx_memory_records_thread index', () => {
    migration056ProvisionalMemory.up(db)

    const indexes = db
      .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memory_records'`)
      .all()
    const indexNames = indexes.map((i) => i.name)
    expect(indexNames).toContain('idx_memory_records_thread')
  })

  test('up is idempotent', () => {
    migration056ProvisionalMemory.up(db)
    expect(() => migration056ProvisionalMemory.up(db)).not.toThrow()
  })
})
