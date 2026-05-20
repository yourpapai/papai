// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration037ToolCallEvents } from '../../../src/db/migrations/037_tool_call_events.js'
import { mockLogger } from '../../utils/test-helpers.js'

const getNames = (db: Database, type: 'table' | 'index'): string[] =>
  db
    .query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE type = ?')
    .all(type)
    .map((row) => row.name)

interface ToolCallEventRow {
  event_id: string
  turn_id: string
  occurred_at: number
  storage_context_id: string
  context_type: string
  chat_user_id: string
  model: string
  model_role: string
  tool_name: string
  tool_call_id: string
  success: number
  duration_ms: number | null
  error_type: string | null
  error_code: string | null
  retryable: number | null
  recovered: number | null
  args_bytes: number | null
  result_bytes: number | null
  response_id: string | null
  forwarded_at: number | null
  forward_attempts: number
  forward_error: string | null
}

const insertRow = (
  db: Database,
  overrides: Partial<Record<keyof ToolCallEventRow, string | number | null>> = {},
): void => {
  const row: Record<keyof ToolCallEventRow, string | number | null> = {
    event_id: 'evt-1',
    turn_id: 'turn-1',
    occurred_at: 1_700_000_000_000,
    storage_context_id: 'ctx-1',
    context_type: 'dm',
    chat_user_id: 'user-1',
    model: 'main-model',
    model_role: 'main',
    tool_name: 'create_task',
    tool_call_id: 'call-1',
    success: 1,
    duration_ms: 25,
    error_type: null,
    error_code: null,
    retryable: null,
    recovered: null,
    args_bytes: 100,
    result_bytes: 200,
    response_id: 'resp-1',
    forwarded_at: null,
    forward_attempts: 0,
    forward_error: null,
    ...overrides,
  }
  db.run(
    `INSERT INTO tool_call_events
       (event_id, turn_id, occurred_at, storage_context_id, context_type,
        chat_user_id, model, model_role, tool_name, tool_call_id, success,
        duration_ms, error_type, error_code, retryable, recovered,
        args_bytes, result_bytes, response_id, forwarded_at,
        forward_attempts, forward_error)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      row.event_id,
      row.turn_id,
      row.occurred_at,
      row.storage_context_id,
      row.context_type,
      row.chat_user_id,
      row.model,
      row.model_role,
      row.tool_name,
      row.tool_call_id,
      row.success,
      row.duration_ms,
      row.error_type,
      row.error_code,
      row.retryable,
      row.recovered,
      row.args_bytes,
      row.result_bytes,
      row.response_id,
      row.forwarded_at,
      row.forward_attempts,
      row.forward_error,
    ],
  )
}

describe('migration037ToolCallEvents', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('creates the tool_call_events table', () => {
    migration037ToolCallEvents.up(db)

    expect(getNames(db, 'table')).toContain('tool_call_events')
  })

  test('creates the five expected indexes', () => {
    migration037ToolCallEvents.up(db)

    const indexes = getNames(db, 'index')
    expect(indexes).toContain('idx_tool_call_subject')
    expect(indexes).toContain('idx_tool_call_chat_user')
    expect(indexes).toContain('idx_tool_call_turn')
    expect(indexes).toContain('idx_tool_call_tool')
    expect(indexes).toContain('idx_tool_call_outbox')
  })

  test('outbox index is a partial index on forwarded_at IS NULL', () => {
    migration037ToolCallEvents.up(db)

    const row = db
      .query<{ sql: string }, [string]>('SELECT sql FROM sqlite_master WHERE type = "index" AND name = ?')
      .get('idx_tool_call_outbox')
    expect(row?.sql).toContain('forwarded_at IS NULL')
  })

  test('round-trips a fully populated row', () => {
    migration037ToolCallEvents.up(db)

    insertRow(db)

    const rows = db.query<ToolCallEventRow, []>('SELECT * FROM tool_call_events').all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      event_id: 'evt-1',
      turn_id: 'turn-1',
      occurred_at: 1_700_000_000_000,
      storage_context_id: 'ctx-1',
      context_type: 'dm',
      chat_user_id: 'user-1',
      model: 'main-model',
      model_role: 'main',
      tool_name: 'create_task',
      tool_call_id: 'call-1',
      success: 1,
      duration_ms: 25,
      error_type: null,
      error_code: null,
      retryable: null,
      recovered: null,
      args_bytes: 100,
      result_bytes: 200,
      response_id: 'resp-1',
      forwarded_at: null,
      forward_attempts: 0,
      forward_error: null,
    })
  })

  test('rejects duplicate event_id (primary key)', () => {
    migration037ToolCallEvents.up(db)

    insertRow(db, { event_id: 'evt-dup' })

    expect(() => {
      insertRow(db, { event_id: 'evt-dup', tool_call_id: 'call-2' })
    }).toThrow()
  })

  test('rejects NULL in NOT NULL columns', () => {
    migration037ToolCallEvents.up(db)

    const notNullColumns: Array<keyof ToolCallEventRow> = [
      'turn_id',
      'occurred_at',
      'storage_context_id',
      'context_type',
      'chat_user_id',
      'model',
      'model_role',
      'tool_name',
      'tool_call_id',
      'success',
    ]
    const expectNullRejected = (column: keyof ToolCallEventRow): void => {
      expect(() => {
        insertRow(db, { event_id: `evt-${column}`, [column]: null })
      }).toThrow()
    }
    notNullColumns.forEach(expectNullRejected)
  })

  test('accepts NULL in nullable columns', () => {
    migration037ToolCallEvents.up(db)

    insertRow(db, {
      event_id: 'evt-nulls',
      duration_ms: null,
      error_type: null,
      error_code: null,
      retryable: null,
      recovered: null,
      args_bytes: null,
      result_bytes: null,
      response_id: null,
      forwarded_at: null,
      forward_error: null,
    })

    const row = db
      .query<ToolCallEventRow, [string]>('SELECT * FROM tool_call_events WHERE event_id = ?')
      .get('evt-nulls')
    expect(row?.duration_ms).toBeNull()
    expect(row?.error_type).toBeNull()
    expect(row?.error_code).toBeNull()
    expect(row?.retryable).toBeNull()
    expect(row?.recovered).toBeNull()
    expect(row?.args_bytes).toBeNull()
    expect(row?.result_bytes).toBeNull()
    expect(row?.response_id).toBeNull()
    expect(row?.forwarded_at).toBeNull()
    expect(row?.forward_error).toBeNull()
  })

  test('forward_attempts defaults to 0', () => {
    migration037ToolCallEvents.up(db)

    db.run(
      `INSERT INTO tool_call_events
         (event_id, turn_id, occurred_at, storage_context_id, context_type,
          chat_user_id, model, model_role, tool_name, tool_call_id, success)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ['evt-default', 'turn-1', 1_700_000_000_000, 'ctx', 'dm', 'user', 'm', 'main', 'noop', 'call', 1],
    )

    const row = db
      .query<ToolCallEventRow, [string]>('SELECT * FROM tool_call_events WHERE event_id = ?')
      .get('evt-default')
    expect(row?.forward_attempts).toBe(0)
    expect(row?.forwarded_at).toBeNull()
  })

  test('running the migration twice is idempotent', () => {
    migration037ToolCallEvents.up(db)

    expect(() => {
      migration037ToolCallEvents.up(db)
    }).not.toThrow()

    expect(getNames(db, 'table')).toContain('tool_call_events')
    const indexes = getNames(db, 'index')
    expect(indexes).toContain('idx_tool_call_subject')
    expect(indexes).toContain('idx_tool_call_outbox')
  })
})
