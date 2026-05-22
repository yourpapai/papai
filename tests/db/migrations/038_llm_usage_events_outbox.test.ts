// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration035LlmUsageEvents } from '../../../src/db/migrations/035_llm_usage_events.js'
import { migration038LlmUsageEventsOutbox } from '../../../src/db/migrations/038_llm_usage_events_outbox.js'
import { mockLogger } from '../../utils/test-helpers.js'

interface ColumnInfo {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

const getColumns = (db: Database, table: string): ColumnInfo[] =>
  db.query<ColumnInfo, []>(`PRAGMA table_info(${table})`).all()

const getIndexes = (db: Database): { name: string; sql: string | null }[] =>
  db.query<{ name: string; sql: string | null }, []>('SELECT name, sql FROM sqlite_master WHERE type = "index"').all()

describe('migration038LlmUsageEventsOutbox', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    migration035LlmUsageEvents.up(db)
  })

  afterEach(() => {
    db.close()
  })

  test('adds forwarded_at, forward_attempts, forward_error columns', () => {
    migration038LlmUsageEventsOutbox.up(db)

    const columns = getColumns(db, 'llm_usage_events')
    const names = columns.map((c) => c.name)
    expect(names).toContain('forwarded_at')
    expect(names).toContain('forward_attempts')
    expect(names).toContain('forward_error')
  })

  test('forward_attempts is NOT NULL with default 0', () => {
    migration038LlmUsageEventsOutbox.up(db)

    const columns = getColumns(db, 'llm_usage_events')
    const fa = columns.find((c) => c.name === 'forward_attempts')
    expect(fa?.notnull).toBe(1)
    expect(fa?.dflt_value).toBe('0')
  })

  test('forwarded_at and forward_error are nullable', () => {
    migration038LlmUsageEventsOutbox.up(db)

    const columns = getColumns(db, 'llm_usage_events')
    const at = columns.find((c) => c.name === 'forwarded_at')
    const err = columns.find((c) => c.name === 'forward_error')
    expect(at?.notnull).toBe(0)
    expect(err?.notnull).toBe(0)
  })

  test('creates a partial index on forwarded_at IS NULL', () => {
    migration038LlmUsageEventsOutbox.up(db)

    const indexes = getIndexes(db)
    const outbox = indexes.find((i) => i.name === 'idx_llm_usage_outbox')
    expect(outbox).toBeDefined()
    expect(outbox?.sql).toContain('forwarded_at IS NULL')
  })

  test('newly inserted rows default forward_attempts to 0 and forwarded_at to NULL', () => {
    migration038LlmUsageEventsOutbox.up(db)

    db.run(
      `INSERT INTO llm_usage_events
         (event_id, occurred_at, storage_context_id, context_type,
          chat_user_id, model, model_role, duration_ms)
       VALUES (?,?,?,?,?,?,?,?)`,
      ['evt-1', 1_700_000_000_000, 'ctx', 'dm', 'user', 'm', 'main', 10],
    )

    const row = db
      .query<{ forwarded_at: number | null; forward_attempts: number; forward_error: string | null }, [string]>(
        'SELECT forwarded_at, forward_attempts, forward_error FROM llm_usage_events WHERE event_id = ?',
      )
      .get('evt-1')
    expect(row?.forwarded_at).toBeNull()
    expect(row?.forward_attempts).toBe(0)
    expect(row?.forward_error).toBeNull()
  })

  test('preserves existing row data when adding columns', () => {
    db.run(
      `INSERT INTO llm_usage_events
         (event_id, occurred_at, storage_context_id, context_type,
          chat_user_id, model, model_role, duration_ms)
       VALUES (?,?,?,?,?,?,?,?)`,
      ['evt-existing', 1_700_000_000_000, 'ctx', 'dm', 'user', 'm', 'main', 10],
    )

    migration038LlmUsageEventsOutbox.up(db)

    const row = db
      .query<{ forward_attempts: number; forwarded_at: number | null }, [string]>(
        'SELECT forward_attempts, forwarded_at FROM llm_usage_events WHERE event_id = ?',
      )
      .get('evt-existing')
    expect(row?.forward_attempts).toBe(0)
    expect(row?.forwarded_at).toBeNull()
  })
})
