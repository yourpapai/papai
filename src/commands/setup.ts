// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isAuthorizedGroup } from '../authorized-groups.js'
import { supportsInteractiveButtons, supportsMessageDeletion } from '../chat/capabilities.js'
import type { AuthorizationResult, ChatProvider, CommandHandler, ReplyFn } from '../chat/types.js'
import { getConfig } from '../config.js'
import { startGroupSettingsSelection } from '../group-settings/selector.js'
import { logger } from '../logger.js'
import { provisionAndConfigure, type ProvisionOutcome } from '../providers/kaneo/provision.js'
import { getKaneoWorkspace } from '../users.js'
import { createWizard } from '../wizard/engine.js'

const log = logger.child({ scope: 'commands:setup' })
const GROUP_SETUP_REDIRECT =
  'Group settings are configured in direct messages with the bot. Open a DM with me and run /setup.'
const GROUP_SETUP_ADMIN_ONLY =
  'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.'
const NO_DELETE_WARNING =
  '⚠️ This platform does not support automatic deletion of messages containing secrets. Please manually delete your messages after entering API keys and tokens.\n\n'

function getUnauthorizedReplyText(auth: AuthorizationResult): string {
  if (auth.reason === 'group_not_allowed') {
    return 'This group is not authorized to use this bot. Ask the bot admin to run `/group add <group-id>` in a DM with the bot.'
  }
  if (auth.reason === 'group_member_not_allowed') {
    return "You're not authorized to use this bot in this group. Ask a group admin to add you with `/group adduser <user-id|@username>`"
  }
  return 'You are not authorized to use this bot.'
}

function isKaneoAutoProvisionEnabled(): boolean {
  return process.env['KANEO_AUTO_PROVISION'] !== 'false'
}

function getTaskProvider(): 'kaneo' | 'youtrack' {
  const provider = process.env['TASK_PROVIDER']
  if (provider === 'kaneo' || provider === 'youtrack') {
    return provider
  }
  return 'kaneo'
}

const TASK_PROVIDER = getTaskProvider()

export interface SetupCommandDeps {
  isAuthorizedGroup: (groupId: string) => boolean
  getConfig: typeof getConfig
  getKaneoWorkspace: typeof getKaneoWorkspace
  provisionAndConfigure: typeof provisionAndConfigure
  createWizard: typeof createWizard
}

const defaultDeps: SetupCommandDeps = {
  isAuthorizedGroup,
  getConfig,
  getKaneoWorkspace,
  provisionAndConfigure,
  createWizard,
}

function isFirstTimeKaneoGroupSetup(targetContextId: string, deps: SetupCommandDeps): boolean {
  if (deps.getConfig(targetContextId, 'kaneo_apikey') === null) {
    return true
  }

  return deps.getKaneoWorkspace(targetContextId) === null
}

async function replyForProvisionOutcome(reply: ReplyFn, outcome: ProvisionOutcome): Promise<boolean> {
  if (outcome.status === 'provisioned') {
    const shouldStop = isKaneoAutoProvisionEnabled()
    const nextStep = shouldStop
      ? 'Run /setup again when you are ready to continue the setup process.'
      : 'Continuing with the setup process now.'
    await reply.text(
      `✅ The group Kaneo account has been created.\n🌐 ${outcome.kaneoUrl}\n📧 Email: ${outcome.email}\n🔑 Password: ${outcome.password}\n\n${nextStep}`,
    )
    return shouldStop
  }

  if (outcome.status === 'registration_disabled') {
    await reply.text(
      'Kaneo account could not be created for this group because registration is disabled on this instance.',
    )
    return true
  }

  await reply.text(`Kaneo account could not be created for this group: ${outcome.error}`)
  return true
}

export async function startSetupForTarget(
  ...args:
    | [userId: string, reply: ReplyFn, targetContextId: string]
    | [userId: string, reply: ReplyFn, targetContextId: string, deps: SetupCommandDeps | undefined]
): Promise<void> {
  const [userId, reply, targetContextId, deps] = args
  let resolvedDeps = defaultDeps
  if (deps !== undefined) {
    resolvedDeps = deps
  }
  const isGroupTarget = targetContextId !== userId

  if (isGroupTarget && !resolvedDeps.isAuthorizedGroup(targetContextId)) {
    await reply.text('This group is not authorized yet. Ask the bot admin to run `/group add <group-id>` in DM first.')
    return
  }

  if (isGroupTarget && TASK_PROVIDER === 'kaneo' && isFirstTimeKaneoGroupSetup(targetContextId, resolvedDeps)) {
    const shouldStop = await replyForProvisionOutcome(
      reply,
      await resolvedDeps.provisionAndConfigure(targetContextId, null),
    )
    if (shouldStop) {
      return
    }
  }

  const result = resolvedDeps.createWizard(userId, targetContextId, TASK_PROVIDER)
  if (result.success) {
    await reply.text(result.prompt)
    return
  }
  if (result.prompt === undefined) {
    await reply.text('Failed to start wizard. Please try again.')
    return
  }
  await reply.text(result.prompt)
}

async function replyWithSetupSelection(reply: ReplyFn, userId: string, interactiveButtons: boolean): Promise<void> {
  const selection = startGroupSettingsSelection(userId, 'setup', interactiveButtons)
  if ('continueWith' in selection) {
    await startSetupForTarget(userId, reply, selection.continueWith.targetContextId)
    return
  }
  if ('buttons' in selection && selection.buttons !== undefined) {
    await reply.buttons(selection.response, { buttons: selection.buttons })
    return
  }
  if ('response' in selection) {
    await reply.text(selection.response)
  }
}

export function registerSetupCommand(
  chat: ChatProvider,
  _checkAuthorization: (userId: string, username: string | null | undefined) => boolean,
): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) {
      await reply.text(getUnauthorizedReplyText(auth))
      return
    }

    if (msg.contextType === 'group') {
      await reply.text(auth.isGroupAdmin ? GROUP_SETUP_REDIRECT : GROUP_SETUP_ADMIN_ONLY)
      return
    }

    log.info({ userId: msg.user.id, contextId: auth.storageContextId }, '/setup command executed')
    if (!supportsMessageDeletion(chat)) {
      await reply.text(NO_DELETE_WARNING)
    }
    await replyWithSetupSelection(reply, msg.user.id, supportsInteractiveButtons(chat))
  }

  chat.registerCommand('setup', handler)
}
