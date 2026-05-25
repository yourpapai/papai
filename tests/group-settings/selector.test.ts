// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { addAuthorizedGroup } from '../../src/authorized-groups.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import type { ChatButton } from '../../src/chat/types.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../src/group-settings/registry.js'
import {
  handleGroupSettingsSelectorCallback,
  handleGroupSettingsSelectorMessage,
  startGroupSettingsSelection,
} from '../../src/group-settings/selector.js'
import { deleteGroupSettingsSession, getActiveGroupSettingsTarget } from '../../src/group-settings/state.js'
import type { GroupSettingsSelectorResult } from '../../src/group-settings/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const getResponse = (
  result: GroupSettingsSelectorResult,
): Extract<GroupSettingsSelectorResult, { handled: true; response: string }> => {
  if (!('response' in result)) {
    throw new Error('Expected a selector response')
  }
  return result
}

const getButtons = (result: GroupSettingsSelectorResult): ChatButton[] => {
  const response = getResponse(result)
  if (!('buttons' in response) || response.buttons === undefined) {
    throw new Error('Expected selector buttons')
  }
  return response.buttons
}

describe('group settings selector', () => {
  const scopedUser1 = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'user-1' })
  const scopedGroup1 = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group-1' })

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    deleteGroupSettingsSession('user-1')
    deleteGroupSettingsSession('user-1', 'telegram-default')
  })

  test('starts with a personal/group scope picker', () => {
    const result = startGroupSettingsSelection('user-1', 'config', true, 'telegram-default')
    const buttons = getButtons(result)
    const response = getResponse(result)

    expect(result.handled).toBe(true)
    expect(response.response).toContain('What do you want to configure?')
    expect(buttons.map((button) => button.callbackData)).toContain('gsel:scope:personal')
    expect(buttons.map((button) => button.callbackData)).toContain('gsel:scope:group')
  })

  test('returns the DM user id when personal settings are selected', () => {
    startGroupSettingsSelection('user-1', 'config', true, 'telegram-default')
    const result = handleGroupSettingsSelectorCallback('user-1', 'gsel:scope:personal', 'telegram-default')

    expect(result).toEqual({
      handled: true,
      continueWith: { command: 'config', targetContextId: scopedUser1 },
    })
    expect(getActiveGroupSettingsTarget('user-1', 'telegram-default')).toBeNull()
  })

  test('returns guidance when the user has no known manageable groups', () => {
    startGroupSettingsSelection('user-1', 'config', false, 'telegram-default')
    const result = handleGroupSettingsSelectorMessage('user-1', 'group', false, 'telegram-default')
    const response = getResponse(result)

    expect(result.handled).toBe(true)
    expect(response.response).toContain("I don't know any groups where you're an admin yet.")
  })

  test('returns a continuation when the user selects a manageable group', () => {
    upsertKnownGroupContext({
      contextId: 'group-1',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })
    addAuthorizedGroup(scopedGroup1, 'admin-id')
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })

    startGroupSettingsSelection('user-1', 'config', true, 'telegram-default')
    handleGroupSettingsSelectorCallback('user-1', 'gsel:scope:group', 'telegram-default')
    const result = handleGroupSettingsSelectorMessage('user-1', 'Operations', true, 'telegram-default')

    expect(result).toEqual({
      handled: true,
      continueWith: { command: 'config', targetContextId: scopedGroup1 },
    })
    expect(getActiveGroupSettingsTarget('user-1', 'telegram-default')).toBe(scopedGroup1)
  })

  test('does not double-scope an already-scoped manageable group context', () => {
    upsertKnownGroupContext({
      contextId: scopedGroup1,
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })
    addAuthorizedGroup(scopedGroup1, 'admin-id')
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: scopedGroup1,
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })

    startGroupSettingsSelection('user-1', 'setup', true, 'telegram-default')
    handleGroupSettingsSelectorCallback('user-1', 'gsel:scope:group', 'telegram-default')
    const result = handleGroupSettingsSelectorMessage('user-1', 'Operations', true, 'telegram-default')

    expect(result).toEqual({
      handled: true,
      continueWith: { command: 'setup', targetContextId: scopedGroup1 },
    })
    expect(getActiveGroupSettingsTarget('user-1', 'telegram-default')).toBe(scopedGroup1)
  })
})
