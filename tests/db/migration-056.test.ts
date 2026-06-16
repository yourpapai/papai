// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../src/db/index.js'
import { runMigrations } from '../../src/db/migrate.js'

const columnNames = (db: Database, table: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name)

const tableExists = (db: Database, table: string): boolean =>
  db.query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table) !==
  null

describe('migration 056', () => {
  test('adds thread_context_id and memory_extraction_state', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(columnNames(db, 'memory_records')).toContain('thread_context_id')
    expect(tableExists(db, 'memory_extraction_state')).toBe(true)
    const extractionStateCols = columnNames(db, 'memory_extraction_state')
    expect(extractionStateCols).toContain('context_id')
    expect(extractionStateCols).toContain('context_type')
    expect(extractionStateCols).toContain('config_context_id')
    expect(extractionStateCols).toContain('last_activity_at')
    expect(extractionStateCols).toContain('last_extracted_at')
    expect(extractionStateCols).toContain('last_history_len')
  })
})
