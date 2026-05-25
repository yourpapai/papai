// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  createGroupSettingsSession,
  deleteGroupSettingsSession,
  getActiveGroupSettingsTarget,
  getGroupSettingsSession,
  updateGroupSettingsSession,
} from '../../src/group-settings/state.js'

describe('group settings state', () => {
  beforeEach(() => {
    deleteGroupSettingsSession('user-1')
    deleteGroupSettingsSession('user-1', 'telegram-default')
    deleteGroupSettingsSession('user-1', 'discord-default')
  })

  test('stores one selector session per DM user and exposes active group target only in active stage', () => {
    createGroupSettingsSession({ userId: 'user-1', command: 'config', stage: 'choose_scope' })
    expect(getActiveGroupSettingsTarget('user-1')).toBeNull()

    updateGroupSettingsSession('user-1', { stage: 'active', targetContextId: 'group-1' })

    expect(getGroupSettingsSession('user-1')).toMatchObject({ targetContextId: 'group-1' })
    expect(getActiveGroupSettingsTarget('user-1')).toBe('group-1')
  })

  test('expires selector sessions after the 30 minute TTL', () => {
    const session = createGroupSettingsSession({ userId: 'user-1', command: 'config', stage: 'choose_scope' })
    session.startedAt = new Date(Date.now() - 31 * 60 * 1000)

    expect(getGroupSettingsSession('user-1')).toBeNull()
  })

  test('isolates selector sessions for the same native user across platform instances', () => {
    createGroupSettingsSession({
      userId: 'user-1',
      command: 'config',
      stage: 'choose_scope',
      platformInstanceId: 'telegram-default',
    })
    createGroupSettingsSession({
      userId: 'user-1',
      command: 'setup',
      stage: 'choose_scope',
      platformInstanceId: 'discord-default',
    })

    updateGroupSettingsSession(
      'user-1',
      { stage: 'active', targetContextId: 'telegram-group' },
      'telegram-default',
    )
    updateGroupSettingsSession('user-1', { stage: 'active', targetContextId: 'discord-group' }, 'discord-default')

    expect(getActiveGroupSettingsTarget('user-1', 'telegram-default')).toBe('telegram-group')
    expect(getActiveGroupSettingsTarget('user-1', 'discord-default')).toBe('discord-group')

    expect(deleteGroupSettingsSession('user-1', 'telegram-default')).toBe(true)
    expect(getGroupSettingsSession('user-1', 'telegram-default')).toBeNull()
    expect(getActiveGroupSettingsTarget('user-1', 'discord-default')).toBe('discord-group')
  })
})
