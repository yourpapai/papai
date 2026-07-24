// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { migration068AlertMatchedTaskIds } from '../../../src/db/migrations/068_alert_matched_task_ids.js'
import { alertPrompts } from '../../../src/db/schema.js'
import { createAlertPrompt } from '../../../src/deferred-prompts/alerts.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

describe('migration 068: alert matched task ids', () => {
  test('migration id is 068_alert_matched_task_ids', () => {
    expect(migration068AlertMatchedTaskIds.id).toBe('068_alert_matched_task_ids')
  })

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('matched_task_ids column defaults to empty JSON array', () => {
    const db = getDrizzleDb()
    db.insert(alertPrompts)
      .values({
        id: 'ap1',
        createdByUserId: 'u1',
        prompt: 'notify',
        condition: '{"field":"task.status","op":"eq","value":"done"}',
      })
      .run()

    const row = db.select().from(alertPrompts).where(eq(alertPrompts.id, 'ap1')).get()
    expect(row).not.toBeUndefined()
    expect(row!.matchedTaskIds).toBe('[]')
  })

  test('domain mapping parses matched task ids', () => {
    const alert = createAlertPrompt('u1', 'notify', { field: 'task.status', op: 'eq', value: 'done' })
    expect(alert.matchedTaskIds).toEqual([])
  })
})
