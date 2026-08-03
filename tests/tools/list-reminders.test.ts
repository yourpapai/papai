// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { makeListRemindersTool } from '../../src/tools/list-reminders.js'
import { schemaValidates } from '../utils/test-helpers.js'

describe('makeListRemindersTool', () => {
  test('description is user-friendly (no "deferred prompt")', () => {
    const tool = makeListRemindersTool('user-1')
    expect(tool.description).not.toContain('deferred prompt')
  })

  test('accepts an empty filter', () => {
    const tool = makeListRemindersTool('user-1')
    expect(schemaValidates(tool, {})).toBe(true)
  })
})
