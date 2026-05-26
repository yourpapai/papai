// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getNativeContextId, isScopedContextId, toScopedContextId } from '../chat/scoped-context.js'
import type { ChatButton } from '../chat/types.js'
import { logger } from '../logger.js'
import { listManageableGroups, matchManageableGroup } from './access.js'
import {
  createGroupSettingsSession,
  deleteGroupSettingsSession,
  getGroupSettingsSession,
  updateGroupSettingsSession,
} from './state.js'
import type { GroupSettingsCommand, GroupSettingsSelectorResult, KnownGroupContext } from './types.js'

const log = logger.child({ scope: 'group-settings:selector' })
const GROUP_BUTTON_LIMIT = 10

const formatGroupLabel = (group: KnownGroupContext): string =>
  group.parentName === null ? group.displayName : `${group.parentName} / ${group.displayName}`

const displayContextId = (contextId: string): string => getNativeContextId(contextId)

type GroupSelectorCallbackParams =
  | Readonly<{ action: 'cancel' }>
  | Readonly<{ action: 'scope' | 'group'; value: string }>

const serializeGroupSettingsCallbackData = (params: GroupSelectorCallbackParams): string => {
  if (params.action === 'cancel') {
    return 'gsel:cancel'
  }
  return `gsel:${params.action}:${params.value}`
}

const buildGroupButtons = (groups: readonly KnownGroupContext[]): ChatButton[] =>
  groups.slice(0, GROUP_BUTTON_LIMIT).map((group) => ({
    text: formatGroupLabel(group),
    callbackData: serializeGroupSettingsCallbackData({ action: 'group', value: group.contextId }),
    style: 'primary',
  }))

const toTargetContextId = (platformInstanceId: string, nativeContextId: string): string => {
  if (isScopedContextId(nativeContextId)) return nativeContextId
  return toScopedContextId({ platformInstanceId, nativeContextId })
}

const buildScopeResponse = (interactiveButtons: boolean): GroupSettingsSelectorResult => {
  const buttons: ChatButton[] = [
    {
      text: '👤 Personal settings',
      callbackData: serializeGroupSettingsCallbackData({ action: 'scope', value: 'personal' }),
      style: 'primary',
    },
    {
      text: '👥 Group settings',
      callbackData: serializeGroupSettingsCallbackData({ action: 'scope', value: 'group' }),
      style: 'secondary',
    },
    {
      text: '❌ Cancel',
      callbackData: serializeGroupSettingsCallbackData({ action: 'cancel' }),
      style: 'danger',
    },
  ]

  return {
    handled: true,
    response: 'What do you want to configure?\n\nChoose personal settings or pick a group to manage from DM.',
    ...(interactiveButtons ? { buttons } : {}),
  }
}

const buildGroupResponse = (
  userId: string,
  interactiveButtons: boolean,
  platformInstanceId: string,
): GroupSettingsSelectorResult => {
  const groups = listManageableGroups(userId, platformInstanceId)
  if (groups.length === 0) {
    deleteGroupSettingsSession(userId, platformInstanceId)
    return {
      handled: true,
      response:
        "I don't know any groups where you're an admin yet.\n\nUse the bot in the target group first, then retry this command in DM.",
    }
  }

  const lines = [
    'Choose a group to configure.',
    '',
    ...groups.map((group) => `${formatGroupLabel(group)} - ${displayContextId(group.contextId)}`),
    '',
    'Reply with the group name or context ID if you do not want to tap a button.',
  ]

  return {
    handled: true,
    response: lines.join('\n'),
    ...(interactiveButtons
      ? {
          buttons: [
            ...buildGroupButtons(groups),
            {
              text: '❌ Cancel',
              callbackData: serializeGroupSettingsCallbackData({ action: 'cancel' }),
              style: 'danger' as const,
            },
          ],
        }
      : {}),
  }
}

const continueWithTarget = (
  userId: string,
  command: GroupSettingsCommand,
  targetContextId: string,
  source: 'callback' | 'text',
  platformInstanceId: string,
): GroupSettingsSelectorResult => {
  updateGroupSettingsSession(userId, { stage: 'active', targetContextId }, platformInstanceId)
  log.info({ userId, command, targetContextId, source }, 'Selected group settings target')
  return { handled: true, continueWith: { command, targetContextId } }
}

const handleChooseScopeMessage = (
  userId: string,
  command: GroupSettingsCommand,
  normalizedText: string,
  interactiveButtons: boolean,
  platformInstanceId: string,
): GroupSettingsSelectorResult => {
  if (normalizedText === 'personal' || normalizedText === 'personal settings') {
    deleteGroupSettingsSession(userId, platformInstanceId)
    return { handled: true, continueWith: { command, targetContextId: toTargetContextId(platformInstanceId, userId) } }
  }
  if (normalizedText === 'group' || normalizedText === 'group settings') {
    updateGroupSettingsSession(userId, { stage: 'choose_group' }, platformInstanceId)
    return buildGroupResponse(userId, interactiveButtons, platformInstanceId)
  }
  return { handled: true, response: 'Reply with "personal" or "group".' }
}

const handleChooseGroupMessage = (
  userId: string,
  command: GroupSettingsCommand,
  text: string,
  platformInstanceId: string,
): GroupSettingsSelectorResult => {
  const match = matchManageableGroup(userId, text, platformInstanceId)
  if (match.kind === 'match') {
    return continueWithTarget(
      userId,
      command,
      toTargetContextId(platformInstanceId, match.group.contextId),
      'text',
      platformInstanceId,
    )
  }
  if (match.kind === 'ambiguous') {
    return {
      handled: true,
      response: [
        'That matches more than one group. Reply with the exact group name or context ID:',
        '',
        ...match.matches.map((group) => `${formatGroupLabel(group)} - ${displayContextId(group.contextId)}`),
      ].join('\n'),
    }
  }
  return {
    handled: true,
    response:
      'No manageable group matched that value. Reply with the exact group name or context ID from the list above.',
  }
}

export function startGroupSettingsSelection(
  userId: string,
  command: GroupSettingsCommand,
  interactiveButtons: boolean,
  platformInstanceId: string,
): GroupSettingsSelectorResult {
  log.debug({ userId, command, interactiveButtons }, 'startGroupSettingsSelection called')

  createGroupSettingsSession({ userId, platformInstanceId, command, stage: 'choose_scope' })
  return buildScopeResponse(interactiveButtons)
}

export function handleGroupSettingsSelectorCallback(
  userId: string,
  callbackData: string,
  platformInstanceId: string,
): GroupSettingsSelectorResult {
  log.debug({ userId, callbackData }, 'handleGroupSettingsSelectorCallback called')

  const session = getGroupSettingsSession(userId, platformInstanceId)
  if (session === null || !callbackData.startsWith('gsel:')) {
    return { handled: false }
  }
  if (callbackData === 'gsel:cancel') {
    deleteGroupSettingsSession(userId, platformInstanceId)
    return { handled: true, response: 'Cancelled group settings selection.' }
  }
  if (callbackData === 'gsel:scope:personal') {
    deleteGroupSettingsSession(userId, platformInstanceId)
    return {
      handled: true,
      continueWith: { command: session.command, targetContextId: toTargetContextId(platformInstanceId, userId) },
    }
  }
  if (callbackData === 'gsel:scope:group') {
    updateGroupSettingsSession(userId, { stage: 'choose_group' }, platformInstanceId)
    return buildGroupResponse(userId, true, platformInstanceId)
  }
  if (!callbackData.startsWith('gsel:group:')) {
    return { handled: false }
  }

  const match = matchManageableGroup(userId, callbackData.slice('gsel:group:'.length), platformInstanceId)
  if (match.kind !== 'match') {
    return {
      handled: true,
      response: 'That group is no longer available. Run /config or /setup again.',
    }
  }

  return continueWithTarget(
    userId,
    session.command,
    toTargetContextId(platformInstanceId, match.group.contextId),
    'callback',
    platformInstanceId,
  )
}

export function handleGroupSettingsSelectorMessage(
  userId: string,
  text: string,
  interactiveButtons: boolean,
  platformInstanceId: string,
): GroupSettingsSelectorResult {
  log.debug({ userId, interactiveButtons }, 'handleGroupSettingsSelectorMessage called')

  const session = getGroupSettingsSession(userId, platformInstanceId)
  if (session === null) {
    return { handled: false }
  }

  const normalizedText = text.trim().toLowerCase()
  if (session.stage === 'choose_scope') {
    return handleChooseScopeMessage(userId, session.command, normalizedText, interactiveButtons, platformInstanceId)
  }

  if (session.stage !== 'choose_group') {
    return { handled: false }
  }

  return handleChooseGroupMessage(userId, session.command, text, platformInstanceId)
}
