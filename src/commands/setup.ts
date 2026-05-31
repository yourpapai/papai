// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { provisionAndConfigure, type ProvisionOutcome } from '../../plugins/task-provider-kaneo/provision.js'
import { isAuthorizedGroup } from '../authorized-groups.js'
import { supportsInteractiveButtons, supportsMessageDeletion } from '../chat/capabilities.js'
import { getNativeContextId, toScopedContextId } from '../chat/scoped-context.js'
import { resolveSourceChatProvider } from '../chat/source-instance.js'
import type { AuthorizationResult, ChatProvider, CommandHandler, ReplyFn } from '../chat/types.js'
import { getConfigValue } from '../config.js'
import { startGroupSettingsSelection } from '../group-settings/selector.js'
import { getContextSettings } from '../instances/context-store.js'
import { getTaskInstance } from '../instances/task-store.js'
import { isBuiltinTaskType } from '../instances/types.js'
import type { TaskInstanceType } from '../instances/types.js'
import { logger } from '../logger.js'
import { startTaskInstanceSelection } from '../setup/task-instance-selection.js'
import { KANEO_PLUGIN_CREDENTIAL_KEY, KANEO_PLUGIN_WORKSPACE_KEY } from '../types/config.js'
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
  getConfigValue: (contextId: string, key: string) => string | null
  provisionAndConfigure: typeof provisionAndConfigure
  createWizard: typeof createWizard
  getContextSettings: typeof getContextSettings
  getTaskInstance: typeof getTaskInstance
  startTaskInstanceSelection: typeof startTaskInstanceSelection
}

const defaultDeps: SetupCommandDeps = {
  isAuthorizedGroup,
  getConfigValue,
  provisionAndConfigure,
  createWizard,
  getContextSettings,
  getTaskInstance,
  startTaskInstanceSelection,
}

function isFirstTimeKaneoGroupSetup(targetContextId: string, deps: SetupCommandDeps): boolean {
  if (deps.getConfigValue(targetContextId, KANEO_PLUGIN_CREDENTIAL_KEY) === null) {
    return true
  }

  return deps.getConfigValue(targetContextId, KANEO_PLUGIN_WORKSPACE_KEY) === null
}

function getTaskInstancePublicUrl(config: Readonly<Record<string, string>>): string | undefined {
  return config['baseUrl']
}

function getTaskInstanceInternalUrl(config: Readonly<Record<string, string>>): string | undefined {
  return config['internalUrl']
}

function getKaneoProvisionConfig(
  targetContextId: string,
  deps: SetupCommandDeps,
): { publicUrl: string | undefined; internalUrl: string | undefined } | null {
  const settings = deps.getContextSettings(targetContextId)
  if (settings === null) return null
  const taskInstance = deps.getTaskInstance(settings.taskInstanceId)
  if (taskInstance === null || taskInstance.status !== 'active' || taskInstance.type !== 'kaneo') return null
  const publicUrl = getTaskInstancePublicUrl(taskInstance.config)
  return { publicUrl, internalUrl: getTaskInstanceInternalUrl(taskInstance.config) }
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
  const config = getKaneoProvisionConfig(targetContextId, deps)
  if (config === null) return false
  return replyForProvisionOutcome(reply, await deps.provisionAndConfigure(targetContextId, null, config))
}

export async function startWizardForAssignedTask(
  userId: string,
  reply: ReplyFn,
  targetContextId: string,
  taskProvider: TaskInstanceType,
  isGroupTarget: boolean,
  ...rest: [] | [SetupCommandDeps]
): Promise<void> {
  // Contributed provider types have no wizard-managed credentials; instance config is used directly
  if (!isBuiltinTaskType(taskProvider)) return
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
  const scopedPersonalTarget = toScopedContextId({ platformInstanceId, nativeContextId: userId })
  const isGroupTarget = targetContextId !== userId && targetContextId !== scopedPersonalTarget

  if (
    isGroupTarget &&
    !deps.isAuthorizedGroup(targetContextId) &&
    !deps.isAuthorizedGroup(getNativeContextId(targetContextId))
  ) {
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
  const selection = startGroupSettingsSelection(userId, 'setup', interactiveButtons, platformInstanceId)
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

export function registerSetupCommand(chat: ChatProvider, ..._rest: [] | [_checkAuthorization: unknown]): void {
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
    const sourceChat = resolveSourceChatProvider(chat, msg.platformInstanceId)
    if (!supportsMessageDeletion(sourceChat)) {
      await reply.text(NO_DELETE_WARNING)
    }
    await replyWithSetupSelection(reply, msg.user.id, msg.platformInstanceId, supportsInteractiveButtons(sourceChat))
  }

  chat.registerCommand('setup', handler)
}
