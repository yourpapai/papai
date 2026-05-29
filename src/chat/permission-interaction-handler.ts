// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listManageableGroups } from '../group-settings/access.js'
import { getMissingGroupTargetMessage } from '../group-settings/target-validation.js'
import { logger } from '../logger.js'
import { replyTextPreferReplace } from './interaction-router-replies.js'
import { peekPermissionRequest, resolvePermissionRequest } from './permission-prompt.js'
import type { PermissionDecision } from './permission-prompt.js'
import type { IncomingInteraction, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:permission-interaction' })

function canManageTargetContext(interaction: IncomingInteraction, targetStorageContextId: string): boolean {
  if (targetStorageContextId === interaction.storageContextId) return true
  if (interaction.contextType === 'dm') {
    return listManageableGroups(interaction.user.id).some((group) => group.contextId === targetStorageContextId)
  }
  return false
}

function parseDecision(code: string): PermissionDecision | null {
  if (code === 'a') return 'allow'
  if (code === 'd') return 'deny'
  return null
}

export async function handlePermissionInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const { callbackData } = interaction
  if (!callbackData.startsWith('perm:')) return false

  const match = /^perm:([ad]):([A-Za-z0-9_-]{8})$/u.exec(callbackData)
  if (match === null) {
    log.warn({ callbackData }, 'Malformed permission callback')
    await replyTextPreferReplace(reply, 'Invalid permission action.')
    return true
  }
  const decision = parseDecision(match[1]!)
  if (decision === null) {
    log.warn({ callbackData }, 'Malformed permission callback decision code')
    await replyTextPreferReplace(reply, 'Invalid permission action.')
    return true
  }
  const id = match[2]!

  const pendingMeta = peekPermissionRequest(id)
  if (pendingMeta === null) {
    await replyTextPreferReplace(reply, '🕘 This permission request has expired.')
    return true
  }

  if (!canManageTargetContext(interaction, pendingMeta.contextId)) {
    await replyTextPreferReplace(reply, getMissingGroupTargetMessage(interaction.user.id, pendingMeta.contextId))
    return true
  }

  return applyPermissionDecision(id, decision, pendingMeta, interaction.user.id, reply)
}

async function applyPermissionDecision(
  id: string,
  decision: PermissionDecision,
  pendingMeta: { contextId: string; toolName: string },
  userId: string,
  reply: ReplyFn,
): Promise<boolean> {
  const resolved = resolvePermissionRequest(id, decision)
  if (!resolved) {
    await replyTextPreferReplace(reply, '🕘 This permission request has expired.')
    return true
  }

  log.info(
    { id, decision, contextId: pendingMeta.contextId, toolName: pendingMeta.toolName, userId },
    'Permission decision recorded',
  )
  await replyTextPreferReplace(
    reply,
    decision === 'allow' ? `✅ Allowed \`${pendingMeta.toolName}\`.` : `🚫 Denied \`${pendingMeta.toolName}\`.`,
  )
  return true
}
