// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listManageableGroups } from '../group-settings/access.js'
import { getEditorSession } from '../config-editor/state.js'
import { deleteGroupSettingsSession, getActiveGroupSettingsTarget } from '../group-settings/state.js'
import { getWizardSession } from '../wizard/state.js'
import { getNativeContextId, isScopedContextId, toScopedContextId } from './scoped-context.js'
import type { IncomingInteraction } from './types.js'

const toScopedGroupTarget = (platformInstanceId: string, nativeContextId: string): string =>
  isScopedContextId(nativeContextId) ? nativeContextId : toScopedContextId({ platformInstanceId, nativeContextId })

const isSameContextTarget = (platformInstanceId: string, candidateContextId: string, targetContextId: string): boolean => {
  if (candidateContextId === targetContextId) return true
  if (getNativeContextId(candidateContextId) === targetContextId) return true
  return toScopedGroupTarget(platformInstanceId, candidateContextId) === targetContextId
}

const getValidatedGroupTargetContextId = (
  userId: string,
  targetContextId: string,
  platformInstanceId: string,
): string | null => {
  const group = listManageableGroups(userId, platformInstanceId).find((candidate) =>
    isSameContextTarget(platformInstanceId, candidate.contextId, targetContextId),
  )
  if (group === undefined) return null
  return toScopedGroupTarget(platformInstanceId, group.contextId)
}

const getValidatedPersonalTargetContextId = (
  userId: string,
  targetContextId: string,
  platformInstanceId: string,
): string | null => {
  const scopedUserTarget = toScopedContextId({ platformInstanceId, nativeContextId: userId })
  if (targetContextId === userId || targetContextId === scopedUserTarget) return scopedUserTarget
  return null
}

export function getValidatedDmTargetContextId(userId: string, platformInstanceId: string): string | null {
  const activeGroupTarget = getActiveGroupSettingsTarget(userId, platformInstanceId)
  if (activeGroupTarget === null) return null

  const validatedTargetContextId = getValidatedGroupTargetContextId(userId, activeGroupTarget, platformInstanceId)
  if (validatedTargetContextId !== null) return validatedTargetContextId

  deleteGroupSettingsSession(userId, platformInstanceId)
  return null
}

export function getValidatedDmCallbackTargetContextId(
  userId: string,
  targetContextId: string,
  platformInstanceId: string,
): string | null {
  const personalTargetContextId = getValidatedPersonalTargetContextId(userId, targetContextId, platformInstanceId)
  if (personalTargetContextId !== null) return personalTargetContextId

  const groupTargetContextId = getValidatedGroupTargetContextId(userId, targetContextId, platformInstanceId)
  if (groupTargetContextId !== null) return groupTargetContextId

  deleteGroupSettingsSession(userId, platformInstanceId)
  return null
}

export function getTargetContextId(
  parsedTargetContextId: string | undefined,
  interaction: IncomingInteraction,
): string {
  if (parsedTargetContextId !== undefined) {
    return parsedTargetContextId
  }

  if (interaction.contextType !== 'dm') {
    return interaction.storageContextId
  }

  const activeGroupTarget = getActiveGroupSettingsTarget(interaction.user.id, interaction.platformInstanceId)
  if (activeGroupTarget === undefined || activeGroupTarget === null) {
    return interaction.storageContextId
  }

  return activeGroupTarget
}

export function getConfigCallbackStorageContextId(
  userId: string,
  callbackTargetContextId: string,
  validatedTargetContextId: string,
): string {
  if (callbackTargetContextId === userId && getEditorSession(userId, callbackTargetContextId) !== null) {
    return callbackTargetContextId
  }
  return validatedTargetContextId
}

export function getWizardCallbackStorageContextId(
  userId: string,
  callbackTargetContextId: string,
  validatedTargetContextId: string,
  callbackData: string,
): string {
  if (callbackTargetContextId !== userId) return validatedTargetContextId
  if (getNativeContextId(callbackTargetContextId) !== userId) return validatedTargetContextId
  if (callbackData === 'wizard_edit' && getWizardSession(userId, callbackTargetContextId) !== null) return callbackTargetContextId
  if (callbackData === 'wizard_confirm' && getWizardSession(userId, callbackTargetContextId) !== null)
    return callbackTargetContextId
  if (callbackData === 'wizard_cancel' && getWizardSession(userId, callbackTargetContextId) !== null)
    return callbackTargetContextId
  if (callbackData === 'wizard_restart' && getWizardSession(userId, callbackTargetContextId) !== null)
    return callbackTargetContextId
  return validatedTargetContextId
}

export function parseWizardContextId(callbackData: string): { action: string; targetContextId: string | undefined } {
  const atIdx = callbackData.indexOf('@')
  if (atIdx === -1) return { action: callbackData, targetContextId: undefined }
  try {
    const encoded = callbackData.slice(atIdx + 1)
    return { action: callbackData.slice(0, atIdx), targetContextId: Buffer.from(encoded, 'base64url').toString('utf8') }
  } catch {
    return { action: callbackData, targetContextId: undefined }
  }
}

export function getResponseText(response: string | undefined): string {
  if (response === undefined) {
    return ''
  }

  return response
}
