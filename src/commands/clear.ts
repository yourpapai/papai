// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AuthorizationResult, ChatProvider, CommandHandler, ReplyFn } from '../chat/types.js'
import { clearHistory } from '../history.js'
import { isSuperAdmin } from '../instances/admin-store.js'
import { logger } from '../logger.js'
import { clearFacts, clearSummary } from '../memory.js'
import { isAuthorized, listUsers } from '../users.js'

const log = logger.child({ scope: 'commands:clear' })

function clearContext(contextId: string): void {
  clearHistory(contextId)
  clearSummary(contextId)
  clearFacts(contextId)
}

async function clearSelf(msg: { user: { id: string } }, reply: ReplyFn, auth: AuthorizationResult): Promise<boolean> {
  clearContext(auth.storageContextId)
  log.info(
    { userId: msg.user.id, storageContextId: auth.storageContextId },
    '/clear command executed — conversation history, memory, and facts cleared',
  )
  await reply.text('Conversation history, memory, and facts cleared.')
  return true
}

async function clearAll(
  msg: { user: { id: string } },
  reply: ReplyFn,
  platformInstanceId: string | null,
): Promise<boolean> {
  const users = platformInstanceId === null ? listUsers() : listUsers(platformInstanceId)
  users.forEach((user) => {
    clearContext(user.platform_user_id)
  })
  log.info({ userId: msg.user.id, clearedCount: users.length }, '/clear all executed')
  await reply.text(`Cleared history, memory, and facts for all ${users.length} users.`)
  return true
}

async function clearUser(msg: { user: { id: string } }, reply: ReplyFn, targetId: string): Promise<boolean> {
  clearContext(targetId)
  log.info({ userId: msg.user.id, targetId }, '/clear <user_id> executed')
  await reply.text(`Cleared history, memory, and facts for user ${targetId}.`)
  return true
}

export function registerClearCommand(chat: ChatProvider, _checkAuthorization: unknown, _adminUserId: string): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) return

    if (msg.contextType === 'group' && !auth.isBotAdmin && !auth.isGroupAdmin) {
      await reply.text('Only group admins can run this command.')
      return
    }

    log.debug({ userId: msg.user.id, storageContextId: auth.storageContextId }, '/clear command called')
    const commandMatch = typeof msg.commandMatch === 'string' ? msg.commandMatch : ''
    const arg = commandMatch.trim()

    if (arg === '') {
      await clearSelf(msg, reply, auth)
      return
    }

    if (!auth.isBotAdmin) {
      await reply.text("Only the admin can clear other users' history.")
      return
    }

    const isGlobalAdmin = isSuperAdmin(msg.user.id)

    if (arg === 'all') {
      await clearAll(msg, reply, isGlobalAdmin ? null : msg.platformInstanceId)
      return
    }

    if (!isGlobalAdmin && !isAuthorized(arg, msg.platformInstanceId)) {
      await reply.text('Target user is not authorized on this platform.')
      return
    }

    await clearUser(msg, reply, arg)
  }

  chat.registerCommand('clear', handler)
}
