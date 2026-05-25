// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listManageableGroups } from '../group-settings/access.js'
import { deleteGroupSettingsSession, getActiveGroupSettingsTarget } from '../group-settings/state.js'
import { getMissingGroupTargetMessage } from '../group-settings/target-validation.js'
import { replyTextPreferReplace } from './interaction-router-replies.js'
import type { ReplyFn } from './types.js'

function getValidatedDmTargetContextId(userId: string): string | null {
  const activeGroupTarget = getActiveGroupSettingsTarget(userId)
  if (activeGroupTarget === null) return null

  const hasAccess = listManageableGroups(userId).some((group) => group.contextId === activeGroupTarget)
  if (hasAccess) {
    return activeGroupTarget
  }

  deleteGroupSettingsSession(userId)
  return null
}

export function getValidatedDmCallbackTargetContextId(userId: string, targetContextId: string): string | null {
  if (targetContextId === userId) return targetContextId

  const hasAccess = listManageableGroups(userId).some((group) => group.contextId === targetContextId)
  if (hasAccess) {
    return targetContextId
  }

  deleteGroupSettingsSession(userId)
  return null
}

export async function validateImplicitDmConfigTarget(userId: string, reply: ReplyFn): Promise<boolean> {
  if (getActiveGroupSettingsTarget(userId) === null) return true

  const previousActiveTarget = getActiveGroupSettingsTarget(userId)
  const validatedTargetContextId = getValidatedDmTargetContextId(userId)
  if (validatedTargetContextId !== null) return true

  const message =
    previousActiveTarget === null
      ? 'That group is no longer available. Run /config or /setup again.'
      : getMissingGroupTargetMessage(userId, previousActiveTarget)
  await replyTextPreferReplace(reply, message)
  return false
}
