// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listManageableGroups } from '../group-settings/access.js'
import { deleteGroupSettingsSession, getActiveGroupSettingsTarget } from '../group-settings/state.js'
import { toScopedContextId } from './scoped-context.js'
import type { IncomingInteraction } from './types.js'

const toScopedGroupTarget = (platformInstanceId: string, nativeContextId: string): string =>
  toScopedContextId({ platformInstanceId, nativeContextId })

export function getValidatedDmTargetContextId(userId: string, platformInstanceId: string): string | null {
  const activeGroupTarget = getActiveGroupSettingsTarget(userId)
  if (activeGroupTarget === null) return null

  const hasAccess = listManageableGroups(userId, platformInstanceId).some(
    (group) => toScopedGroupTarget(platformInstanceId, group.contextId) === activeGroupTarget,
  )
  if (hasAccess) return activeGroupTarget

  deleteGroupSettingsSession(userId)
  return null
}

export function getValidatedDmCallbackTargetContextId(
  userId: string,
  targetContextId: string,
  platformInstanceId: string,
): string | null {
  if (targetContextId === toScopedContextId({ platformInstanceId, nativeContextId: userId })) return targetContextId

  const hasAccess = listManageableGroups(userId, platformInstanceId).some(
    (group) => toScopedGroupTarget(platformInstanceId, group.contextId) === targetContextId,
  )
  if (hasAccess) return targetContextId

  deleteGroupSettingsSession(userId)
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

  const activeGroupTarget = getActiveGroupSettingsTarget(interaction.user.id)
  if (activeGroupTarget === undefined || activeGroupTarget === null) {
    return interaction.storageContextId
  }

  return activeGroupTarget
}

export function getResponseText(response: string | undefined): string {
  if (response === undefined) {
    return ''
  }

  return response
}
