// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseAiOutputCallbackData } from '../ai-output-config-ui.js'
import { handleEditorCallback, parseCallbackData, serializeCallbackData } from '../config-editor/index.js'
import { dispatchGroupSelectorResult } from '../group-settings/dispatch.js'
import { handleGroupSettingsSelectorCallback } from '../group-settings/selector.js'
import { getMissingGroupTargetMessage } from '../group-settings/target-validation.js'
import { logger } from '../logger.js'
import { cancelWizard, getNextPrompt } from '../wizard/engine.js'
import { validateAndSaveWizardConfig } from '../wizard/save.js'
import { getWizardSession, hasActiveWizard, resetWizardSession } from '../wizard/state.js'
import { handleAiOutputConfigInteraction } from './ai-output-config-interaction.js'
import { getValidatedDmCallbackTargetContextId, validateImplicitDmConfigTarget } from './config-target-validation.js'
import { replyButtonsPreferReplace, replyTextPreferReplace } from './interaction-router-replies.js'
import { getResponseText, getTargetContextId } from './interaction-router-support.js'
import { handlePluginInteraction } from './plugin-interaction-handler.js'
import type { AuthorizationResult, IncomingInteraction, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:interaction-router' })

type ParsedEditorCallbackData = ReturnType<typeof parseCallbackData> & {
  action: Exclude<ReturnType<typeof parseCallbackData>['action'], null>
}

function getEditorCallbackKey(
  key: ReturnType<typeof parseCallbackData>['key'],
): Parameters<typeof handleEditorCallback>[3] {
  if (key === null) return undefined
  return key
}

function isParsedEditorCallbackData(parsed: ReturnType<typeof parseCallbackData>): parsed is ParsedEditorCallbackData {
  return parsed.action !== null
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

export type InteractionRouteDeps = {
  handleGroupSettingsInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
  handleConfigInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
  handleWizardInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
  handlePluginInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
}
function defaultHandleGroupSettingsInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const result = handleGroupSettingsSelectorCallback(interaction.user.id, interaction.callbackData)
  return dispatchGroupSelectorResult(result, reply, interaction.user.id)
}

async function replyUnknownConfigAction(reply: ReplyFn, callbackData: string): Promise<true> {
  log.warn({ callbackData }, 'Unknown config editor callback data')
  await replyTextPreferReplace(reply, 'This action is no longer valid. Please start over with /config.')
  return true
}

async function handleEditorConfigInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  parsed: ParsedEditorCallbackData,
): Promise<boolean> {
  const targetContextId = getTargetContextId(parsed.targetContextId, interaction)
  if (
    interaction.contextType === 'dm' &&
    parsed.targetContextId === undefined &&
    !(await validateImplicitDmConfigTarget(interaction.user.id, reply))
  ) {
    return true
  }
  if (interaction.contextType === 'dm' && parsed.targetContextId !== undefined) {
    const validatedTargetContextId = getValidatedDmCallbackTargetContextId(interaction.user.id, targetContextId)
    if (validatedTargetContextId === null) {
      await replyTextPreferReplace(reply, getMissingGroupTargetMessage(interaction.user.id, targetContextId))
      return true
    }
  }
  log.debug(
    { userId: interaction.user.id, contextId: targetContextId, action: parsed.action, key: parsed.key },
    'Handling config editor callback',
  )

  const key = getEditorCallbackKey(parsed.key)
  const result = handleEditorCallback(interaction.user.id, targetContextId, parsed.action, key)

  if (!result.handled) {
    log.warn({ action: parsed.action, key: parsed.key }, 'Config editor callback not handled')
    await replyTextPreferReplace(reply, 'This action is no longer valid. Please start over with /config.')
    return true
  }

  await replyConfigEditorResult(reply, targetContextId, result)
  return true
}

function defaultHandleConfigInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const { callbackData } = interaction
  if (!callbackData.startsWith('cfg:')) return Promise.resolve(false)

  const aiOutputCallback = parseAiOutputCallbackData(callbackData)
  if (aiOutputCallback !== null) {
    return handleAiOutputConfigInteraction(interaction, reply, aiOutputCallback, replyUnknownConfigAction)
  }

  const parsed = parseCallbackData(callbackData)

  if (!isParsedEditorCallbackData(parsed)) {
    return replyUnknownConfigAction(reply, callbackData)
  }

  return handleEditorConfigInteraction(interaction, reply, parsed)
}

async function replyWithWizardButtons(
  reply: ReplyFn,
  response: string | undefined,
  buttons: Array<{ text: string; action: string }> | undefined,
  targetContextId: string | undefined,
): Promise<void> {
  const contextSuffix = targetContextId === undefined ? '' : `@${Buffer.from(targetContextId).toString('base64url')}`
  if (buttons !== undefined && buttons.length > 0) {
    const content = getResponseText(response)
    await replyButtonsPreferReplace(
      reply,
      content,
      buttons.map((button) => ({
        text: button.text,
        callbackData: `wizard_${button.action}${contextSuffix}`,
      })),
    )
    return
  }

  const content = getResponseText(response)
  await replyTextPreferReplace(reply, content)
}

async function handleWizardEdit(userId: string, storageContextId: string, reply: ReplyFn): Promise<boolean> {
  const session = getWizardSession(userId, storageContextId)
  if (session === null) {
    await replyTextPreferReplace(reply, 'No active setup session. Type /setup to start.')
    return true
  }

  resetWizardSession(userId, storageContextId)
  await reply.text(`🔧 Editing configuration from the beginning...\n\n${getNextPrompt(userId, storageContextId)}`)
  return true
}

function parseWizardContextId(callbackData: string): { action: string; targetContextId: string | undefined } {
  const atIdx = callbackData.indexOf('@')
  if (atIdx === -1) return { action: callbackData, targetContextId: undefined }
  try {
    const encoded = callbackData.slice(atIdx + 1)
    return { action: callbackData.slice(0, atIdx), targetContextId: Buffer.from(encoded, 'base64url').toString('utf8') }
  } catch {
    return { action: callbackData, targetContextId: undefined }
  }
}

async function defaultHandleWizardInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const { callbackData, user } = interaction
  if (!callbackData.startsWith('wizard_')) return false

  const userId = user.id
  const { action, targetContextId: callbackContextId } = parseWizardContextId(callbackData)
  const storageContextId = getTargetContextId(callbackContextId, interaction)

  if (interaction.contextType === 'dm' && callbackContextId !== undefined) {
    const validatedTargetContextId = getValidatedDmCallbackTargetContextId(userId, storageContextId)
    if (validatedTargetContextId === null) {
      await replyTextPreferReplace(reply, getMissingGroupTargetMessage(userId, storageContextId))
      return true
    }
  }

  switch (action) {
    case 'wizard_confirm': {
      const result = await validateAndSaveWizardConfig(userId, storageContextId)
      await replyWithWizardButtons(reply, result.message, result.buttons, storageContextId)
      return true
    }
    case 'wizard_cancel': {
      if (!hasActiveWizard(userId, storageContextId)) {
        await replyTextPreferReplace(reply, 'No active setup session. Type /setup to start.')
        return true
      }
      cancelWizard(userId, storageContextId)
      await reply.text('❌ Wizard cancelled. Type /setup to restart.')
      return true
    }
    case 'wizard_restart': {
      if (!hasActiveWizard(userId, storageContextId)) {
        await replyTextPreferReplace(reply, 'No active setup session. Type /setup to start.')
        return true
      }
      cancelWizard(userId, storageContextId)
      await reply.text('Restarting wizard... Type /setup to begin.')
      return true
    }
    case 'wizard_edit':
      return handleWizardEdit(userId, storageContextId, reply)
    default:
      return false
  }
}

const defaultDeps: InteractionRouteDeps = {
  handleGroupSettingsInteraction: defaultHandleGroupSettingsInteraction,
  handleConfigInteraction: defaultHandleConfigInteraction,
  handleWizardInteraction: defaultHandleWizardInteraction,
  handlePluginInteraction,
}

export function routeInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  auth: AuthorizationResult,
  ...rest: [] | [InteractionRouteDeps]
): Promise<boolean> {
  const deps = rest[0]
  let resolvedDeps = defaultDeps
  if (deps !== undefined) {
    resolvedDeps = deps
  }
  if (!auth.allowed) {
    return reply.text('You are not authorized to use this bot.').then(() => true)
  }
  const { callbackData } = interaction

  if (callbackData.startsWith('gsel:')) {
    return resolvedDeps.handleGroupSettingsInteraction(interaction, reply)
  }

  if (callbackData.startsWith('cfg:')) {
    if (callbackData.startsWith('cfg:ai:') && interaction.contextType === 'group' && !auth.isGroupAdmin) {
      return reply.text('Only group admins can change AI output visibility for this group.').then(() => true)
    }
    return resolvedDeps.handleConfigInteraction(interaction, reply)
  }

  if (callbackData.startsWith('wizard_')) {
    return resolvedDeps.handleWizardInteraction(interaction, reply)
  }

  if (callbackData.startsWith('plg:')) {
    return resolvedDeps.handlePluginInteraction(interaction, reply)
  }

  log.debug({ callbackData }, 'No route matched for interaction callback')
  return Promise.resolve(false)
}
