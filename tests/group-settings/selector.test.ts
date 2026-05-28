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
import { addAdmin } from '../../src/instances/admin-store.js'
import { insertPlatformInstance } from '../../src/instances/platform-store.js'
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
    process.env['INSTANCE_CONFIG_KEY'] = '1'.repeat(64)
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

    startGroupSettingsSelection('user-1', 'config', true, 'telegram-default')
    handleGroupSettingsSelectorCallback('user-1', 'gsel:scope:group', 'telegram-default')
    const result = handleGroupSettingsSelectorMessage('user-1', 'Operations', true, 'telegram-default')

    expect(result).toEqual({
      handled: true,
      continueWith: { command: 'config', targetContextId: scopedGroup1 },
    })
    expect(getActiveGroupSettingsTarget('user-1', 'telegram-default')).toBe(scopedGroup1)
  })

  test('shows a newly authorized scoped group in DM selection before any observation exists and can continue with it', () => {
    const scopedGroupId = toScopedContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: '-10012345',
    })

    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't' }, status: 'active' })
    addAdmin('admin-id', 'telegram-default')
    addAuthorizedGroup(scopedGroupId, 'admin-id')

    startGroupSettingsSelection('admin-id', 'config', false, 'telegram-default')
    const listResult = handleGroupSettingsSelectorMessage('admin-id', 'group', false, 'telegram-default')
    const response = getResponse(listResult)
    const selectionResult = handleGroupSettingsSelectorMessage('admin-id', '-10012345', false, 'telegram-default')

    expect(response.response).toContain('-10012345')
    expect(selectionResult).toEqual({
      handled: true,
      continueWith: { command: 'config', targetContextId: scopedGroupId },
    })
    expect(getActiveGroupSettingsTarget('admin-id', 'telegram-default')).toBe(scopedGroupId)
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
