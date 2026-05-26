// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { handleConfigEditorMessage } from './chat/config-editor-integration.js'
import { toScopedContextId, toStorageContextId } from './chat/scoped-context.js'
import type { AuthorizationResult, IncomingMessage, ReplyFn } from './chat/types.js'
import { startWizardForAssignedTask } from './commands/setup.js'
import { listManageableGroups } from './group-settings/access.js'
import { dispatchGroupSelectorResult } from './group-settings/dispatch.js'
import { handleGroupSettingsSelectorMessage } from './group-settings/selector.js'
import { deleteGroupSettingsSession, getActiveGroupSettingsTarget } from './group-settings/state.js'
import { getMissingGroupTargetMessage } from './group-settings/target-validation.js'
import { handleTaskInstanceSelectionMessage } from './setup/task-instance-selection.js'
import { handleWizardMessage } from './wizard-integration.js'

function maybeDispatchGroupSelector(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  interactiveButtons: boolean,
  isCommand: boolean,
): Promise<boolean> {
  if (isCommand || !auth.allowed || msg.contextType !== 'dm') return Promise.resolve(false)
  const selection = handleGroupSettingsSelectorMessage(
    msg.user.id,
    msg.text,
    interactiveButtons,
    msg.platformInstanceId,
  )
  return dispatchGroupSelectorResult(selection, reply, msg.user.id, msg.platformInstanceId, interactiveButtons)
}

function getConfigTargetContextId(auth: AuthorizationResult): string {
  if (auth.configContextId !== undefined) return auth.configContextId
  return auth.storageContextId
}

async function validateActiveGroupSettingsTarget(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
): Promise<string | null> {
  if (msg.contextType !== 'dm' || !auth.allowed) return null
  const activeTarget = getActiveGroupSettingsTarget(msg.user.id, msg.platformInstanceId)
  if (activeTarget === null) return null
  if (
    listManageableGroups(msg.user.id, msg.platformInstanceId).some(
      (group) => toStorageContextId(msg.platformInstanceId, group.contextId) === activeTarget,
    )
  ) {
    return activeTarget
  }
  deleteGroupSettingsSession(msg.user.id, msg.platformInstanceId)
  await reply.text(getMissingGroupTargetMessage(msg.user.id, activeTarget, msg.platformInstanceId))
  return '__deleted__'
}

function getSettingsTargetContextId(
  msg: IncomingMessage,
  auth: AuthorizationResult,
  activeGroupSettingsTarget: string | null,
): string {
  const configTargetContextId = getConfigTargetContextId(auth)
  if (msg.contextType !== 'dm') return configTargetContextId
  if (activeGroupSettingsTarget !== null) return activeGroupSettingsTarget
  return configTargetContextId
}

function isPersonalSettingsTarget(msg: IncomingMessage, settingsTargetContextId: string): boolean {
  return (
    settingsTargetContextId ===
    toScopedContextId({ platformInstanceId: msg.platformInstanceId, nativeContextId: msg.user.id })
  )
}

async function maybeHandleTaskInstanceSelection(
  msg: IncomingMessage,
  reply: ReplyFn,
  settingsTargetContextId: string,
): Promise<boolean> {
  if (msg.contextType !== 'dm') return false
  const selection = handleTaskInstanceSelectionMessage(msg.user.id, settingsTargetContextId, msg.text)
  if (selection.status === 'not-handled') return false
  if (selection.status === 'assigned') {
    await startWizardForAssignedTask(
      msg.user.id,
      reply,
      settingsTargetContextId,
      selection.taskProvider,
      !isPersonalSettingsTarget(msg, settingsTargetContextId),
    )
    return true
  }
  if (selection.status === 'pending' || selection.status === 'aborted') {
    await reply.text(selection.response)
    return true
  }
  return false
}

async function maybeHandleSetupFlows(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  interactiveButtons: boolean,
  isCommand: boolean,
  settingsTargetContextId: string,
  autoStartWizardIfNeeded: (
    userId: string,
    storageContextId: string,
    platformInstanceId: string,
    reply: ReplyFn,
  ) => Promise<boolean>,
): Promise<boolean> {
  if (isCommand || !auth.allowed) return false
  if (await maybeHandleTaskInstanceSelection(msg, reply, settingsTargetContextId)) return true
  if (await handleConfigEditorMessage(msg.user.id, settingsTargetContextId, msg.text, reply, msg.messageId)) return true
  if (
    await handleWizardMessage(
      msg.user.id,
      settingsTargetContextId,
      msg.text,
      reply,
      interactiveButtons,
      settingsTargetContextId,
      msg.messageId,
    )
  ) {
    return true
  }
  if (msg.contextType !== 'dm') return false
  return autoStartWizardIfNeeded(msg.user.id, settingsTargetContextId, msg.platformInstanceId, reply)
}

export async function maybeInterceptWizard(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  interactiveButtons: boolean,
  autoStartWizardIfNeeded: (
    userId: string,
    storageContextId: string,
    platformInstanceId: string,
    reply: ReplyFn,
  ) => Promise<boolean>,
): Promise<boolean> {
  const isCommand = msg.text.startsWith('/')
  if (await maybeDispatchGroupSelector(msg, reply, auth, interactiveButtons, isCommand)) return true

  const activeTarget = await validateActiveGroupSettingsTarget(msg, reply, auth)
  if (activeTarget === '__deleted__') return true

  const settingsTargetContextId = getSettingsTargetContextId(msg, auth, activeTarget)
  return maybeHandleSetupFlows(
    msg,
    reply,
    auth,
    interactiveButtons,
    isCommand,
    settingsTargetContextId,
    autoStartWizardIfNeeded,
  )
}
