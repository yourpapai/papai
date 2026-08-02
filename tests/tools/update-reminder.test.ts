// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { makeUpdateReminderTool } from '../../src/tools/update-reminder.js'
import { schemaValidates } from '../utils/test-helpers.js'

describe('makeUpdateReminderTool', () => {
  test('description is user-friendly (no "deferred prompt")', () => {
    const tool = makeUpdateReminderTool('user-1')
    expect(tool.description).not.toContain('deferred prompt')
  })

  test('requires an id', () => {
    const tool = makeUpdateReminderTool('user-1')
    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { id: 'r-1' })).toBe(true)
  })
})
