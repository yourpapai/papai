// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { formatPermissionDecisionText, resolvePermissionRequest, type PermissionDecision } from './permission-prompt.js'
import type { AuthorizationResult, IncomingInteraction, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:interaction-router' })
const PERMISSION_CALLBACK_PATTERN = /^perm:(a|d):([A-Za-z0-9_-]+)$/u

const permissionDecisionFromCode = (code: string): PermissionDecision => (code === 'a' ? 'allow' : 'deny')

async function replyToPermissionDecision(
  reply: ReplyFn,
  sourceMessageText: string | undefined,
  decision: PermissionDecision,
): Promise<void> {
  const fallback = decision === 'allow' ? 'Allowed.' : 'Denied.'
  const content = sourceMessageText === undefined ? fallback : formatPermissionDecisionText(sourceMessageText, decision)
  if (reply.replaceText !== undefined) {
    await reply.replaceText(content)
    return
  }
  await reply.text(content)
}

/**
 * Interactive chat callbacks were retired with the move to the settings web UI.
 * No callback prefixes are produced anymore; this router authorizes the actor and
 * otherwise matches nothing. Kept as the single interaction entry point so adapters
 * that still emit interaction events have a safe sink.
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
    if (!resolvePermissionRequest(id, decision)) {
      await reply.text('Action is no longer available.')
      return true
    }
    await replyToPermissionDecision(reply, interaction.sourceMessageText, decision)
    return true
  }

  log.debug({ callbackData: interaction.callbackData }, 'No route matched for interaction callback')
  return false
}
