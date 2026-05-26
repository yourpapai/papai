// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getActiveGroupSettingsTarget } from '../group-settings/state.js'
import { getMissingGroupTargetMessage } from '../group-settings/target-validation.js'
import { replyTextPreferReplace } from './interaction-router-replies.js'
import { getValidatedDmCallbackTargetContextId, getValidatedDmTargetContextId } from './interaction-router-support.js'
import type { ReplyFn } from './types.js'

export { getValidatedDmCallbackTargetContextId }

export async function validateImplicitDmConfigTarget(
  userId: string,
  platformInstanceId: string,
  reply: ReplyFn,
): Promise<boolean> {
  if (getActiveGroupSettingsTarget(userId, platformInstanceId) === null) return true

  const previousActiveTarget = getActiveGroupSettingsTarget(userId, platformInstanceId)
  const validatedTargetContextId = getValidatedDmTargetContextId(userId, platformInstanceId)
  if (validatedTargetContextId !== null) return true

  const message =
    previousActiveTarget === null
      ? 'That group is no longer available. Run /config or /setup again.'
      : getMissingGroupTargetMessage(userId, previousActiveTarget, platformInstanceId)
  await replyTextPreferReplace(reply, message)
  return false
}
