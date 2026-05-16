// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.
import { beforeEach, describe, expect, test } from 'bun:test'

import {
  createGroupSettingsSession,
  deleteGroupSettingsSession,
  updateGroupSettingsSession,
} from '../../src/group-settings/state.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('group_settings events', () => {
  beforeEach(() => {
    mockLogger()
    deleteGroupSettingsSession('user-1')
  })

  test('updateGroupSettingsSession emits group_settings:target_changed when target changes', async () => {
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    createGroupSettingsSession({ userId: 'user-1', command: 'config', stage: 'choose_scope' })
    updateGroupSettingsSession('user-1', { stage: 'active', targetContextId: 'group-1' })

    const targetEvent = events.find((e) => e.type === 'group_settings:target_changed')
    expect(targetEvent).toBeDefined()
    expect(targetEvent?.data['groupId']).toBe('group-1')
    expect(targetEvent?.data['target']).toBe('group-1')
  })

  test('updateGroupSettingsSession does not emit target_changed when no target change', async () => {
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    createGroupSettingsSession({ userId: 'user-1', command: 'config', stage: 'choose_scope' })
    updateGroupSettingsSession('user-1', { stage: 'choose_group' })

    const targetEvent = events.find((e) => e.type === 'group_settings:target_changed')
    expect(targetEvent).toBeUndefined()
  })
})
