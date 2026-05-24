// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isAuthorizedGroup } from '../authorized-groups.js'
import { supportsInteractiveButtons, supportsMessageDeletion } from '../chat/capabilities.js'
import type { AuthorizationResult, ChatProvider, CommandHandler, ReplyFn } from '../chat/types.js'
import { getConfig } from '../config.js'
import { startGroupSettingsSelection } from '../group-settings/selector.js'
import { getContextSettings } from '../instances/context-store.js'
import { getTaskInstance } from '../instances/task-store.js'
import type { TaskInstanceType } from '../instances/types.js'
import { logger } from '../logger.js'
import { provisionAndConfigure, type ProvisionOutcome } from '../providers/kaneo/provision.js'
import { startTaskInstanceSelection } from '../setup/task-instance-selection.js'
import { getKaneoWorkspace } from '../users.js'
import { createWizard } from '../wizard/engine.js'

const log = logger.child({ scope: 'commands:setup' })
const GROUP_SETUP_REDIRECT =
  'Group settings are configured in direct messages with the bot. Open a DM with me and run /setup.'
const GROUP_SETUP_ADMIN_ONLY =
  'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.'
const NO_DELETE_WARNING =
  '⚠️ This platform does not support automatic deletion of messages containing secrets. Please manually delete your messages after entering API keys and tokens.\n\n'

function getUnauthorizedReplyText(auth: AuthorizationResult, groupId: string): string {
  if (auth.reason === 'group_not_allowed') {
    return `This group is not authorized to use this bot. Ask the bot admin to run \`/group add ${groupId}\` in a DM with the bot.`
  }
  if (auth.reason === 'group_member_not_allowed') {
    return "You're not authorized to use this bot in this group. Ask a group admin to add you with `/group adduser <user-id|@username>`"
  }
  return 'You are not authorized to use this bot.'
}

function isKaneoAutoProvisionEnabled(): boolean {
  return process.env['KANEO_AUTO_PROVISION'] !== 'false'
}

export interface SetupCommandDeps {
  isAuthorizedGroup: (groupId: string) => boolean
  getConfig: typeof getConfig
  getKaneoWorkspace: typeof getKaneoWorkspace
  provisionAndConfigure: typeof provisionAndConfigure
  createWizard: typeof createWizard
  getContextSettings: typeof getContextSettings
  getTaskInstance: typeof getTaskInstance
  startTaskInstanceSelection: typeof startTaskInstanceSelection
}

const defaultDeps: SetupCommandDeps = {
  isAuthorizedGroup,
  getConfig,
  getKaneoWorkspace,
  provisionAndConfigure,
  createWizard,
  getContextSettings,
  getTaskInstance,
  startTaskInstanceSelection,
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

async function maybeProvisionKaneoGroup(
  reply: ReplyFn,
  targetContextId: string,
  taskProvider: TaskInstanceType,
  isGroupTarget: boolean,
  deps: SetupCommandDeps,
): Promise<boolean> {
  if (!isGroupTarget || taskProvider !== 'kaneo' || !isFirstTimeKaneoGroupSetup(targetContextId, deps)) return false
  return replyForProvisionOutcome(reply, await deps.provisionAndConfigure(targetContextId, null))
}

export async function startWizardForAssignedTask(
  userId: string,
  reply: ReplyFn,
  targetContextId: string,
  taskProvider: TaskInstanceType,
  isGroupTarget: boolean,
  ...rest: [] | [SetupCommandDeps]
): Promise<void> {
  const deps = rest.length === 0 ? defaultDeps : rest[0]
  if (await maybeProvisionKaneoGroup(reply, targetContextId, taskProvider, isGroupTarget, deps)) return
  const result = deps.createWizard(userId, targetContextId, taskProvider)
  await reply.text(result.prompt)
}

async function startCredentialWizard(
  userId: string,
  reply: ReplyFn,
  targetContextId: string,
  platformInstanceId: string,
  isGroupTarget: boolean,
  deps: SetupCommandDeps,
): Promise<void> {
  const settings = deps.getContextSettings(targetContextId)
  if (settings === null) {
    const selection = deps.startTaskInstanceSelection(userId, targetContextId, platformInstanceId)
    if (selection.status === 'assigned') {
      await startWizardForAssignedTask(userId, reply, targetContextId, selection.taskProvider, isGroupTarget, deps)
      return
    }
    if (selection.status === 'pending' || selection.status === 'aborted') {
      await reply.text(selection.response)
      return
    }
    await reply.text('Failed to start setup. Please try again.')
    return
  }

  const taskInstance = deps.getTaskInstance(settings.taskInstanceId)
  if (taskInstance === null || taskInstance.status !== 'active') {
    const selection = deps.startTaskInstanceSelection(userId, targetContextId, platformInstanceId)
    if (selection.status === 'assigned') {
      await startWizardForAssignedTask(userId, reply, targetContextId, selection.taskProvider, isGroupTarget, deps)
      return
    }
    if (selection.status === 'pending' || selection.status === 'aborted') {
      await reply.text(selection.response)
      return
    }
    await reply.text('Failed to start setup. Please try again.')
    return
  }

  await startWizardForAssignedTask(userId, reply, targetContextId, taskInstance.type, isGroupTarget, deps)
}

export async function startSetupForTarget(
  userId: string,
  reply: ReplyFn,
  targetContextId: string,
  platformInstanceId: string,
  ...rest: [] | [SetupCommandDeps]
): Promise<void> {
  const deps = rest.length === 0 ? defaultDeps : rest[0]
  const isGroupTarget = targetContextId !== userId

  if (isGroupTarget && !deps.isAuthorizedGroup(targetContextId)) {
    await reply.text(
      `This group is not authorized yet. Ask the bot admin to run \`/group add ${targetContextId}\` in DM first.`,
    )
    return
  }

  await startCredentialWizard(userId, reply, targetContextId, platformInstanceId, isGroupTarget, deps)
}

async function replyWithSetupSelection(
  reply: ReplyFn,
  userId: string,
  platformInstanceId: string,
  interactiveButtons: boolean,
): Promise<void> {
  const selection = startGroupSettingsSelection(userId, 'setup', interactiveButtons)
  if ('continueWith' in selection) {
    await startSetupForTarget(userId, reply, selection.continueWith.targetContextId, platformInstanceId)
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
      await reply.text(getUnauthorizedReplyText(auth, msg.contextId))
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
    await replyWithSetupSelection(reply, msg.user.id, msg.platformInstanceId, supportsInteractiveButtons(chat))
  }

  chat.registerCommand('setup', handler)
}
