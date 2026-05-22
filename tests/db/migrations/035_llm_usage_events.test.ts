// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration035LlmUsageEvents } from '../../../src/db/migrations/035_llm_usage_events.js'
import { mockLogger } from '../../utils/test-helpers.js'

const getNames = (db: Database, type: 'table' | 'index'): string[] =>
  db
    .query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE type = ?')
    .all(type)
    .map((row) => row.name)

interface LlmUsageEventRow {
  event_id: string
  occurred_at: number
  turn_id: string | null
  storage_context_id: string
  context_type: string
  chat_user_id: string
  model: string
  model_role: string
  input_tokens: number | null
  output_tokens: number | null
  step_count: number
  tool_call_count: number
  message_count: number
  finish_reason: string | null
  duration_ms: number
  response_id: string | null
  error: string | null
}

const insertRow = (
  db: Database,
  overrides: Partial<Record<keyof LlmUsageEventRow, string | number | null>> = {},
): void => {
  const row: Record<keyof LlmUsageEventRow, string | number | null> = {
    event_id: 'evt-1',
    occurred_at: 1_700_000_000_000,
    turn_id: 'turn-1',
    storage_context_id: 'ctx-1',
    context_type: 'dm',
    chat_user_id: 'user-1',
    model: 'main-model',
    model_role: 'main',
    input_tokens: 100,
    output_tokens: 200,
    step_count: 1,
    tool_call_count: 0,
    message_count: 3,
    finish_reason: 'stop',
    duration_ms: 1234,
    response_id: 'resp-1',
    error: null,
    ...overrides,
  }
  db.run(
    `INSERT INTO llm_usage_events
       (event_id, occurred_at, turn_id, storage_context_id, context_type,
        chat_user_id, model, model_role, input_tokens, output_tokens,
        step_count, tool_call_count, message_count, finish_reason,
        duration_ms, response_id, error)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      row.event_id,
      row.occurred_at,
      row.turn_id,
      row.storage_context_id,
      row.context_type,
      row.chat_user_id,
      row.model,
      row.model_role,
      row.input_tokens,
      row.output_tokens,
      row.step_count,
      row.tool_call_count,
      row.message_count,
      row.finish_reason,
      row.duration_ms,
      row.response_id,
      row.error,
    ],
  )
}

describe('migration035LlmUsageEvents', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('creates the llm_usage_events table', () => {
    migration035LlmUsageEvents.up(db)

    expect(getNames(db, 'table')).toContain('llm_usage_events')
  })

  test('creates the four expected indexes', () => {
    migration035LlmUsageEvents.up(db)

    const indexes = getNames(db, 'index')
    expect(indexes).toContain('idx_llm_usage_subject')
    expect(indexes).toContain('idx_llm_usage_chat_user')
    expect(indexes).toContain('idx_llm_usage_turn')
    expect(indexes).toContain('idx_llm_usage_occurred')
  })

  test('round-trips a fully populated row', () => {
    migration035LlmUsageEvents.up(db)

    insertRow(db)

    const rows = db.query<LlmUsageEventRow, []>('SELECT * FROM llm_usage_events').all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      event_id: 'evt-1',
      occurred_at: 1_700_000_000_000,
      turn_id: 'turn-1',
      storage_context_id: 'ctx-1',
      context_type: 'dm',
      chat_user_id: 'user-1',
      model: 'main-model',
      model_role: 'main',
      input_tokens: 100,
      output_tokens: 200,
      step_count: 1,
      tool_call_count: 0,
      message_count: 3,
      finish_reason: 'stop',
      duration_ms: 1234,
      response_id: 'resp-1',
      error: null,
    })
  })

  test('rejects duplicate event_id (primary key)', () => {
    migration035LlmUsageEvents.up(db)

    insertRow(db, { event_id: 'evt-dup' })

    expect(() => {
      insertRow(db, { event_id: 'evt-dup', storage_context_id: 'ctx-2' })
    }).toThrow()
  })

  test('rejects NULL in NOT NULL columns', () => {
    migration035LlmUsageEvents.up(db)

    // event_id is PRIMARY KEY but SQLite historically allows NULL in a
    // non-INTEGER PK; matches the migration 034 convention which exercises
    // NOT NULL on payload columns only.
    const notNullColumns: Array<keyof LlmUsageEventRow> = [
      'occurred_at',
      'storage_context_id',
      'context_type',
      'chat_user_id',
      'model',
      'model_role',
      'duration_ms',
    ]
    const expectNullRejected = (column: keyof LlmUsageEventRow): void => {
      expect(() => {
        insertRow(db, { event_id: `evt-${column}`, [column]: null })
      }).toThrow()
    }
    notNullColumns.forEach(expectNullRejected)
  })

  test('accepts NULL in nullable columns', () => {
    migration035LlmUsageEvents.up(db)

    insertRow(db, {
      event_id: 'evt-nulls',
      turn_id: null,
      input_tokens: null,
      output_tokens: null,
      finish_reason: null,
      response_id: null,
      error: null,
    })

    const row = db
      .query<LlmUsageEventRow, [string]>('SELECT * FROM llm_usage_events WHERE event_id = ?')
      .get('evt-nulls')
    expect(row?.turn_id).toBeNull()
    expect(row?.input_tokens).toBeNull()
    expect(row?.output_tokens).toBeNull()
    expect(row?.finish_reason).toBeNull()
    expect(row?.response_id).toBeNull()
    expect(row?.error).toBeNull()
  })

  test('step_count, tool_call_count, message_count default to 0', () => {
    migration035LlmUsageEvents.up(db)

    db.run(
      `INSERT INTO llm_usage_events
         (event_id, occurred_at, storage_context_id, context_type,
          chat_user_id, model, model_role, duration_ms)
       VALUES (?,?,?,?,?,?,?,?)`,
      ['evt-defaults', 1_700_000_000_000, 'ctx', 'dm', 'user', 'm', 'main', 10],
    )

    const row = db
      .query<LlmUsageEventRow, [string]>('SELECT * FROM llm_usage_events WHERE event_id = ?')
      .get('evt-defaults')
    expect(row?.step_count).toBe(0)
    expect(row?.tool_call_count).toBe(0)
    expect(row?.message_count).toBe(0)
  })

  test('running the migration twice is idempotent', () => {
    migration035LlmUsageEvents.up(db)

    expect(() => {
      migration035LlmUsageEvents.up(db)
    }).not.toThrow()

    expect(getNames(db, 'table')).toContain('llm_usage_events')
    const indexes = getNames(db, 'index')
    expect(indexes).toContain('idx_llm_usage_subject')
    expect(indexes).toContain('idx_llm_usage_chat_user')
    expect(indexes).toContain('idx_llm_usage_turn')
    expect(indexes).toContain('idx_llm_usage_occurred')
  })
})
