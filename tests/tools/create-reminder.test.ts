// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { makeCreateReminderTool } from '../../src/tools/create-reminder.js'
import { schemaValidates } from '../utils/test-helpers.js'

const USER_ID = 'create-reminder-user'
const schedule = { fire_at: { date: '2030-01-01', time: '09:00' } }

describe('makeCreateReminderTool', () => {
  test('description is user-friendly (no "deferred prompt")', () => {
    const tool = makeCreateReminderTool(USER_ID, USER_ID, 'dm')
    expect(tool.description).not.toContain('deferred prompt')
    expect(tool.description).toMatch(/reminder|follow-up/iu)
  })

  test('rejects a condition field (reminders are time-based only)', () => {
    const tool = makeCreateReminderTool(USER_ID, USER_ID, 'dm')
    expect(
      schemaValidates(tool, {
        prompt: 'x',
        schedule,
        condition: { field: 'task.status', op: 'eq', value: 'Done' },
      }),
    ).toBe(false)
  })

  test('rejects a missing schedule', () => {
    const tool = makeCreateReminderTool(USER_ID, USER_ID, 'dm')
    expect(schemaValidates(tool, { prompt: 'x' })).toBe(false)
  })

  test('accepts a one-time schedule', () => {
    const tool = makeCreateReminderTool(USER_ID, USER_ID, 'dm')
    expect(schemaValidates(tool, { prompt: 'x', schedule })).toBe(true)
  })
})
