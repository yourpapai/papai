// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { makeCreateAlertTool } from '../../src/tools/create-alert.js'
import { schemaValidates } from '../utils/test-helpers.js'

const USER_ID = 'create-alert-user'
const condition = { field: 'task.status', op: 'eq', value: 'Done' }

describe('makeCreateAlertTool', () => {
  test('description is user-friendly (no "deferred prompt")', () => {
    const tool = makeCreateAlertTool(USER_ID, USER_ID, 'dm')
    expect(tool.description).not.toContain('deferred prompt')
  })

  test('rejects a schedule field (alerts are condition-based only)', () => {
    const tool = makeCreateAlertTool(USER_ID, USER_ID, 'dm')
    expect(
      schemaValidates(tool, { prompt: 'x', condition, schedule: { fire_at: { date: '2030-01-01', time: '09:00' } } }),
    ).toBe(false)
  })

  test('rejects a missing condition', () => {
    const tool = makeCreateAlertTool(USER_ID, USER_ID, 'dm')
    expect(schemaValidates(tool, { prompt: 'x' })).toBe(false)
  })

  test('accepts a condition', () => {
    const tool = makeCreateAlertTool(USER_ID, USER_ID, 'dm')
    expect(schemaValidates(tool, { prompt: 'x', condition })).toBe(true)
  })
})
