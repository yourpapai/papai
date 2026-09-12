// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import migration079 from '../../../src/db/migrations/079_tool_call_duration_normalize.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type DurationRow = { event_id: string; duration_ms: number | null; type: string }

type UntouchedColumns = {
  occurred_at: number
  tool_name: string
  success: number
  args_bytes: number | null
}

describe('migration 079: normalize tool_call_events duration_ms', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  // Raw SQL seeding/assertions so REAL-typed values and SQLite storage types
  // are guaranteed regardless of driver coercion.
  const seed = (eventId: string, durationMs: number | null): void => {
    getDrizzleDb().$client.run(
      `INSERT INTO tool_call_events (event_id, turn_id, occurred_at, storage_context_id, context_type,
        chat_user_id, model, model_role, tool_name, tool_call_id, success, duration_ms)
       VALUES (?, 'turn-1', 1000, 'ctx-1', 'dm', 'user-1', 'm', 'main', 'get_task', ?, 1, ?)`,
      [eventId, eventId, durationMs],
    )
  }

  const rows = (): DurationRow[] =>
    getDrizzleDb()
      .$client.query<{ event_id: string; duration_ms: number | null; type: string }, []>(
        `SELECT event_id, duration_ms, typeof(duration_ms) AS type FROM tool_call_events ORDER BY event_id`,
      )
      .all()

  test('rounds fractional, clamps negative, keeps integer and NULL durations untouched', () => {
    seed('frac', 465.23)
    seed('neg', -3)
    seed('int', 321)
    seed('null', null)

    migration079.up(getDrizzleDb().$client)

    expect(rows()).toEqual([
      { event_id: 'frac', duration_ms: 465, type: 'integer' },
      { event_id: 'int', duration_ms: 321, type: 'integer' },
      { event_id: 'neg', duration_ms: 0, type: 'integer' },
      { event_id: 'null', duration_ms: null, type: 'null' },
    ])
  })

  test('touches only duration_ms: other columns keep their values', () => {
    seed('frac', 465.23)

    migration079.up(getDrizzleDb().$client)

    const row = getDrizzleDb()
      .$client.query<UntouchedColumns, []>(
        `SELECT occurred_at, tool_name, success, args_bytes FROM tool_call_events WHERE event_id = 'frac'`,
      )
      .get()
    expect(row).toEqual({ occurred_at: 1000, tool_name: 'get_task', success: 1, args_bytes: null })
  })

  test('idempotent: a second run changes nothing', () => {
    seed('frac', 465.23)
    seed('neg', -3)
    seed('int', 321)

    migration079.up(getDrizzleDb().$client)
    const first = rows()
    migration079.up(getDrizzleDb().$client)

    expect(rows()).toEqual(first)
  })
})
