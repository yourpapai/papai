// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  handleEditorCallback,
  matchesCallbackTargetTag,
  parseCallbackData,
  resolveCallbackKey,
  serializeCallbackData,
} from '../config-editor/index.js'
import { getActiveGroupSettingsTarget } from '../group-settings/state.js'
import { getMissingGroupTargetMessage } from '../group-settings/target-validation.js'
import { logger } from '../logger.js'
import { replyButtonsPreferReplace, replyTextPreferReplace } from './interaction-router-replies.js'
import {
  getConfigCallbackStorageContextId,
  getResponseText,
  getTargetContextId,
  getValidatedDmCallbackTargetContextId,
  getValidatedDmTargetContextId,
} from './interaction-router-support.js'
import type { IncomingInteraction, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:interaction-router-config' })

function getEditorCallbackKey(
  key: ReturnType<typeof parseCallbackData>['key'],
  targetContextId: string,
): Parameters<typeof handleEditorCallback>[3] {
  return resolveCallbackKey(key, targetContextId) ?? undefined
}

async function replyConfigEditorResult(
  reply: ReplyFn,
  targetContextId: string,
  result: ReturnType<typeof handleEditorCallback>,
): Promise<void> {
  const response = getResponseText(result.response)
  if (result.buttons !== undefined && result.buttons.length > 0) {
    await replyButtonsPreferReplace(
      reply,
      response,
      result.buttons.map((btn) => ({
        text: btn.text,
        callbackData: serializeCallbackData(btn, targetContextId),
      })),
    )
    return
  }
  await replyTextPreferReplace(reply, response)
}

async function validateImplicitDmConfigTarget(
  userId: string,
  platformInstanceId: string,
  reply: ReplyFn,
): Promise<string | true | null> {
  if (getActiveGroupSettingsTarget(userId, platformInstanceId) === null) return true

  const previousActiveTarget = getActiveGroupSettingsTarget(userId, platformInstanceId)
  const validatedTargetContextId = getValidatedDmTargetContextId(userId, platformInstanceId)
  if (validatedTargetContextId !== null) return validatedTargetContextId

  const message =
    previousActiveTarget === null
      ? 'That group is no longer available. Run /config or /setup again.'
      : getMissingGroupTargetMessage(userId, previousActiveTarget, platformInstanceId)
  await replyTextPreferReplace(reply, message)
  return null
}

async function replyUnknownConfigAction(reply: ReplyFn, callbackData: string): Promise<true> {
  log.warn({ callbackData }, 'Unknown config editor callback data')
  await replyTextPreferReplace(reply, 'This action is no longer valid. Please start over with /config.')
  return true
}

function isLegacyUnboundDmConfigCallback(parsed: ReturnType<typeof parseCallbackData>): boolean {
  return parsed.targetContextId === undefined && parsed.targetTag === undefined
}

async function getDmConfigTargetContextId(
  interaction: IncomingInteraction,
  targetContextId: string,
  callbackTargetContextId: string | undefined,
  reply: ReplyFn,
): Promise<string | true> {
  if (interaction.contextType !== 'dm') return targetContextId
  if (callbackTargetContextId === undefined) {
    const validatedTargetContextId = await validateImplicitDmConfigTarget(
      interaction.user.id,
      interaction.platformInstanceId,
      reply,
    )
    if (validatedTargetContextId === null) return true
    if (validatedTargetContextId === true) return targetContextId
    return validatedTargetContextId
  }

  const validatedTargetContextId = getValidatedDmCallbackTargetContextId(
    interaction.user.id,
    targetContextId,
    interaction.platformInstanceId,
  )
  if (validatedTargetContextId === null) {
    await replyTextPreferReplace(
      reply,
      getMissingGroupTargetMessage(interaction.user.id, targetContextId, interaction.platformInstanceId),
    )
    return true
  }
  return getConfigCallbackStorageContextId(interaction.user.id, targetContextId, validatedTargetContextId)
}

export async function defaultHandleConfigInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
): Promise<boolean> {
  const { callbackData, user } = interaction
  if (!callbackData.startsWith('cfg:')) return false

  const parsed = parseCallbackData(callbackData)
  if (parsed.action === null) return replyUnknownConfigAction(reply, callbackData)
  if (interaction.contextType === 'dm' && isLegacyUnboundDmConfigCallback(parsed)) {
    return replyUnknownConfigAction(reply, callbackData)
  }

  const targetContextId = await getDmConfigTargetContextId(
    interaction,
    getTargetContextId(parsed.targetContextId, interaction),
    parsed.targetContextId,
    reply,
  )
  if (targetContextId === true) return true
  if (!matchesCallbackTargetTag(parsed.targetTag, targetContextId)) {
    return replyUnknownConfigAction(reply, callbackData)
  }

  log.debug(
    { userId: user.id, contextId: targetContextId, action: parsed.action, key: parsed.key },
    'Handling config editor callback',
  )

  const key = getEditorCallbackKey(parsed.key, targetContextId)
  if (parsed.key?.startsWith('#') === true && key === undefined) {
    return replyUnknownConfigAction(reply, callbackData)
  }
  const result = handleEditorCallback(user.id, targetContextId, parsed.action, key, parsed.sessionToken)

  if (!result.handled) {
    log.warn({ action: parsed.action, key: parsed.key }, 'Config editor callback not handled')
    await replyTextPreferReplace(reply, 'This action is no longer valid. Please start over with /config.')
    return true
  }

  await replyConfigEditorResult(reply, targetContextId, result)
  return true
}
