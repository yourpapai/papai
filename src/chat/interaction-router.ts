// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import {
  formatDecisionConfirmation,
  peekPermissionRequest,
  resolvePermissionRequest,
  type PermissionDecision,
} from './permission-prompt.js'
import type { AuthorizationResult, IncomingInteraction, PromptHandle, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:interaction-router' })
const PERMISSION_CALLBACK_PATTERN = /^perm:(a|d):([A-Za-z0-9_-]+)$/u

const permissionDecisionFromCode = (code: string): PermissionDecision => (code === 'a' ? 'allow' : 'deny')

async function finalizePermissionDecision(
  reply: ReplyFn,
  toolName: string,
  sourceMessageText: string | undefined,
  decision: PermissionDecision,
  handle: PromptHandle | undefined,
): Promise<void> {
  const confirmation = formatDecisionConfirmation(toolName, decision)
  // Ephemeral path: delete the prompt, confirm with a non-persistent toast.
  if (reply.ephemeralConfirm !== undefined && handle !== undefined) {
    try {
      await handle.remove()
    } catch (error) {
      log.warn({ toolName, error: error instanceof Error ? error.message : String(error) }, 'Failed to remove prompt')
    }
    await reply.ephemeralConfirm(confirmation)
    return
  }
  // Fallback: edit the prompt in place (current behavior), now with the tool name.
  const content = sourceMessageText === undefined ? confirmation : `${sourceMessageText.trimEnd()}\n\n${confirmation}`
  if (reply.replaceText !== undefined) {
    try {
      await reply.replaceText(content)
      return
    } catch {
      await reply.text(content)
      return
    }
  }
  await reply.text(content)
}

/**
 * The config-flow callbacks were retired with the move to the settings web UI.
 * This router authorizes the actor and handles exactly one prefix — `perm:a:`/`perm:d:`,
 * the allow/deny decision for an `ask`-gated tool prompt (see `finalizePermissionDecision`).
 * Any other callback is a safe-sink no-op, so adapters that still emit interaction
 * events have a single, harmless entry point.
 */
export async function routeInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  auth: AuthorizationResult,
): Promise<boolean> {
  if (!auth.allowed) {
    await reply.text('You are not authorized to use this bot.')
    return true
  }

  const permissionMatch = PERMISSION_CALLBACK_PATTERN.exec(interaction.callbackData)
  if (permissionMatch !== null) {
    const decision = permissionDecisionFromCode(permissionMatch[1]!)
    const id = permissionMatch[2]!
    const pending = peekPermissionRequest(id)
    if (pending === null || pending.contextId !== auth.storageContextId) {
      await reply.text('Action is no longer available.')
      return true
    }
    const result = resolvePermissionRequest(id, decision)
    if (!result.resolved) {
      await reply.text('Action is no longer available.')
      return true
    }
    await finalizePermissionDecision(reply, pending.toolName, interaction.sourceMessageText, decision, result.handle)
    return true
  }

  log.debug({ callbackData: interaction.callbackData }, 'No route matched for interaction callback')
  return false
}
