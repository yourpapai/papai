import { beforeEach, describe, expect, test } from 'bun:test'

import { addAuthorizedGroup } from '../../src/authorized-groups.js'
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
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    deleteGroupSettingsSession('user-1')
  })

  test('starts with a personal/group scope picker', () => {
    const result = startGroupSettingsSelection('user-1', 'config', true)
    const buttons = getButtons(result)
    const response = getResponse(result)

    expect(result.handled).toBe(true)
    expect(response.response).toContain('What do you want to configure?')
    expect(buttons.map((button) => button.callbackData)).toContain('gsel:scope:personal')
    expect(buttons.map((button) => button.callbackData)).toContain('gsel:scope:group')
  })

  test('returns the DM user id when personal settings are selected', () => {
    startGroupSettingsSelection('user-1', 'config', true)
    const result = handleGroupSettingsSelectorCallback('user-1', 'gsel:scope:personal')

    expect(result).toEqual({
      handled: true,
      continueWith: { command: 'config', targetContextId: 'user-1' },
    })
    expect(getActiveGroupSettingsTarget('user-1')).toBeNull()
  })

  test('returns guidance when the user has no known manageable groups', () => {
    startGroupSettingsSelection('user-1', 'config', false)
    const result = handleGroupSettingsSelectorMessage('user-1', 'group', false)
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
    addAuthorizedGroup('group-1', 'admin-id')
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })

    startGroupSettingsSelection('user-1', 'config', true)
    handleGroupSettingsSelectorCallback('user-1', 'gsel:scope:group')
    const result = handleGroupSettingsSelectorMessage('user-1', 'Operations', true)

    expect(result).toEqual({
      handled: true,
      continueWith: { command: 'config', targetContextId: 'group-1' },
    })
    expect(getActiveGroupSettingsTarget('user-1')).toBe('group-1')
  })
})
