// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { dispatchGroupSelectorResult } from '../group-settings/dispatch.js'
import { handleGroupSettingsSelectorCallback } from '../group-settings/selector.js'
import { getMissingGroupTargetMessage } from '../group-settings/target-validation.js'
import { logger } from '../logger.js'
import { cancelWizard, getNextPrompt } from '../wizard/engine.js'
import { validateAndSaveWizardConfig } from '../wizard/save.js'
import { getWizardSession, hasActiveWizard, resetWizardSession } from '../wizard/state.js'
import { defaultHandleConfigInteraction } from './interaction-router-config.js'
import { replyButtonsPreferReplace, replyTextPreferReplace } from './interaction-router-replies.js'
import {
  getResponseText,
  getTargetContextId,
  getValidatedDmCallbackTargetContextId,
  getWizardCallbackStorageContextId,
  parseWizardContextId,
} from './interaction-router-support.js'
import { handlePluginInteraction } from './plugin-interaction-handler.js'
import type { AuthorizationResult, IncomingInteraction, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:interaction-router' })

export type InteractionRouteDeps = {
  handleGroupSettingsInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
  handleConfigInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
  handleWizardInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
  handlePluginInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>
}
function defaultHandleGroupSettingsInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const result = handleGroupSettingsSelectorCallback(
    interaction.user.id,
    interaction.callbackData,
    interaction.platformInstanceId,
  )
  return dispatchGroupSelectorResult(result, reply, interaction.user.id, interaction.platformInstanceId)
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

async function getDmWizardStorageContextId(
  interaction: IncomingInteraction,
  callbackContextId: string | undefined,
  callbackData: string,
  reply: ReplyFn,
): Promise<string | null> {
  let storageContextId = getTargetContextId(callbackContextId, interaction)
  if (interaction.contextType !== 'dm' || callbackContextId === undefined) return storageContextId

  const validatedTargetContextId = getValidatedDmCallbackTargetContextId(
    interaction.user.id,
    storageContextId,
    interaction.platformInstanceId,
  )
  if (validatedTargetContextId === null) {
    await replyTextPreferReplace(
      reply,
      getMissingGroupTargetMessage(interaction.user.id, storageContextId, interaction.platformInstanceId),
    )
    return null
  }
  storageContextId = getWizardCallbackStorageContextId(
    interaction.user.id,
    storageContextId,
    validatedTargetContextId,
    callbackData,
  )
  return storageContextId
}

async function defaultHandleWizardInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const { callbackData, user } = interaction
  if (!callbackData.startsWith('wizard_')) return false

  const userId = user.id
  const { action, targetContextId: callbackContextId } = parseWizardContextId(callbackData)
  const storageContextId = await getDmWizardStorageContextId(interaction, callbackContextId, action, reply)
  if (storageContextId === null) return true

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

function getRoutedInteraction(interaction: IncomingInteraction, auth: AuthorizationResult): IncomingInteraction {
  return { ...interaction, storageContextId: auth.storageContextId }
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
  const routedInteraction = getRoutedInteraction(interaction, auth)
  const { callbackData } = routedInteraction

  if (callbackData.startsWith('gsel:')) {
    return resolvedDeps.handleGroupSettingsInteraction(routedInteraction, reply)
  }

  if (callbackData.startsWith('cfg:')) {
    return resolvedDeps.handleConfigInteraction(routedInteraction, reply)
  }

  if (callbackData.startsWith('wizard_')) {
    return resolvedDeps.handleWizardInteraction(routedInteraction, reply)
  }

  if (callbackData.startsWith('plg:')) {
    return resolvedDeps.handlePluginInteraction(routedInteraction, reply)
  }

  log.debug({ callbackData }, 'No route matched for interaction callback')
  return Promise.resolve(false)
}
