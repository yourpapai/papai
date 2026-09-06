// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  updateAlertActivityState,
  updateAlertBaseline,
  updateAlertMatchState,
  updateAlertMatchedTaskIds,
} from '../../src/deferred-prompts/alert-state.js'
import { createAlertPrompt, getAlertPrompt } from '../../src/deferred-prompts/alerts.js'
import type { AlertCondition } from '../../src/deferred-prompts/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const condition: AlertCondition = { field: 'task.status', op: 'eq', value: 'done' }

beforeEach(() => {
  mockLogger()
})

describe('alert state mutators', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('updateAlertMatchedTaskIds updates match set without touching trigger time', () => {
    const created = createAlertPrompt('user1', 'Alert', condition)

    updateAlertMatchedTaskIds(created.id, 'user1', ['task-1', 'task-2'])

    const found = getAlertPrompt(created.id, 'user1')
    expect(found).not.toBeNull()
    expect(found!.matchedTaskIds).toEqual(['task-1', 'task-2'])
    expect(found!.lastTriggeredAt).toBeNull()
  })

  test('updateAlertMatchState updates trigger time and match set together', () => {
    const created = createAlertPrompt('user1', 'Alert', condition)
    const now = new Date().toISOString()

    updateAlertMatchState(created.id, 'user1', now, ['task-1'])

    const found = getAlertPrompt(created.id, 'user1')
    expect(found).not.toBeNull()
    expect(found!.lastTriggeredAt).toBe(now)
    expect(found!.matchedTaskIds).toEqual(['task-1'])
  })

  test('updateAlertActivityState writes the cursor and lastTriggeredAt', () => {
    const created = createAlertPrompt('user1', 'Alert', condition)
    const firedAt = '2026-08-27T10:00:00.000Z'
    const cursor = '2026-08-27T09:59:00.000Z'

    updateAlertActivityState(created.id, 'user1', firedAt, cursor)

    const reloaded = getAlertPrompt(created.id, 'user1')
    expect(reloaded?.lastActivityCursor).toBe(cursor)
    expect(reloaded?.lastTriggeredAt).toBe(firedAt)
  })

  test('updateAlertBaseline writes the match set and baselined-at cursor, leaving lastTriggeredAt null', () => {
    const created = createAlertPrompt('user1', 'Alert', condition)
    const baselinedAt = '2026-09-06T12:00:00.000Z'

    updateAlertBaseline(created.id, 'user1', ['task-1'], baselinedAt)

    const found = getAlertPrompt(created.id, 'user1')
    expect(found!.matchedTaskIds).toEqual(['task-1'])
    expect(found!.lastActivityCursor).toBe(baselinedAt)
    expect(found!.lastTriggeredAt).toBeNull()
  })

  test('updateAlertBaseline replaces a prior baseline after a condition edit re-arms it', () => {
    const created = createAlertPrompt('user1', 'Alert', condition)
    updateAlertBaseline(created.id, 'user1', ['task-1'], '2026-09-06T12:00:00.000Z')

    updateAlertBaseline(created.id, 'user1', ['task-2'], '2026-09-06T12:05:00.000Z')

    const found = getAlertPrompt(created.id, 'user1')
    expect(found!.matchedTaskIds).toEqual(['task-2'])
    expect(found!.lastActivityCursor).toBe('2026-09-06T12:05:00.000Z')
  })
})
