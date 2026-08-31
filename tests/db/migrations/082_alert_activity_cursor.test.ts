// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { migration082AlertActivityCursor } from '../../../src/db/migrations/082_alert_activity_cursor.js'
import { alertPrompts } from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

interface TableColumn {
  name: string
  type: string
  notnull: number
}

const lastActivityCursorColumn = (): TableColumn | undefined =>
  getDrizzleDb()
    .$client.query<TableColumn, []>(`PRAGMA table_info(alert_prompts)`)
    .all()
    .find((row) => row.name === 'last_activity_cursor')

describe('migration 082: alert activity cursor', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('migration id is 082_alert_activity_cursor', () => {
    expect(migration082AlertActivityCursor.id).toBe('082_alert_activity_cursor')
  })

  test('last_activity_cursor is added to alert_prompts as nullable', () => {
    expect(lastActivityCursorColumn()).toMatchObject({
      name: 'last_activity_cursor',
      notnull: 0,
    })
  })

  test('alert rows keep a null last_activity_cursor', () => {
    const db = getDrizzleDb()
    db.insert(alertPrompts)
      .values({
        id: 'ap1',
        createdByUserId: 'u1',
        prompt: 'notify',
        condition: '{"field":"task.status","op":"eq","value":"done"}',
      })
      .run()

    const row = db.$client
      .query<{ last_activity_cursor: string | null }, []>(
        `SELECT last_activity_cursor FROM alert_prompts WHERE id = 'ap1'`,
      )
      .get()
    expect(row?.last_activity_cursor).toBeNull()
  })

  test('up is idempotent (safe to re-run)', () => {
    expect(() => migration082AlertActivityCursor.up(getDrizzleDb().$client)).not.toThrow()
    expect(lastActivityCursorColumn()).toMatchObject({ notnull: 0 })
  })
})
