// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import type { ChatProvider, CommandHandler, IncomingMessage, ReplyFn } from '../chat/types.js'
import { dmTarget } from '../chat/types.js'
import { isAdmin, isSuperAdmin } from '../instances/admin-store.js'
import { logger } from '../logger.js'
import { addUser, listUsers, removeUser } from '../users.js'

const MAX_CONCURRENT_SENDS = 5

const log = logger.child({ scope: 'admin' })

const checkAdmin = (userId: string, platformInstanceId: string): boolean => isAdmin(userId, platformInstanceId)

const parseUserIdentifier = (
  input: string,
): { type: 'id'; value: string } | { type: 'username'; value: string } | null => {
  const trimmed = input.trim()
  if (trimmed.startsWith('@')) return { type: 'username', value: trimmed.slice(1) }
  // Numeric string ID
  if (/^\d+$/u.test(trimmed)) return { type: 'id', value: trimmed }
  // Alphanumeric username without @
  if (/^[a-zA-Z0-9_-]+$/u.test(trimmed)) return { type: 'username', value: trimmed }
  return null
}

export function registerAdminCommands(chat: ChatProvider, adminUserId: string, ..._args: [] | [unknown]): void {
  const userHandler: CommandHandler = async (msg, reply) => {
    // Reject in groups - these commands are only available in direct messages
    if (msg.contextType === 'group') {
      await reply.text('This command is only available in direct messages.')
      return
    }
    if (!checkAdmin(msg.user.id, msg.platformInstanceId)) {
      await reply.text('Only the admin can manage users.')
      return
    }
    await handleUserCommand(msg, reply, msg.user.id, adminUserId, msg.platformInstanceId)
  }

  const usersHandler: CommandHandler = async (msg, reply) => {
    // Reject in groups - these commands are only available in direct messages
    if (msg.contextType === 'group') {
      await reply.text('This command is only available in direct messages.')
      return
    }
    if (!checkAdmin(msg.user.id, msg.platformInstanceId)) {
      await reply.text('Only the admin can list users.')
      return
    }
    await handleUsersCommand(reply, msg.user.id, adminUserId, msg.platformInstanceId)
  }

  const announceHandler: CommandHandler = async (msg, reply) => {
    if (msg.contextType === 'group') {
      await reply.text('This command is only available in direct messages.')
      return
    }
    if (!checkAdmin(msg.user.id, msg.platformInstanceId)) {
      await reply.text('Only the admin can send announcements.')
      return
    }
    await handleAnnounce(chat, reply, msg)
  }

  chat.registerCommand('user', userHandler)
  chat.registerCommand('users', usersHandler)
  chat.registerCommand('announce', announceHandler)
}

async function handleUserCommand(
  msg: IncomingMessage,
  reply: ReplyFn,
  userId: string,
  adminUserId: string,
  platformInstanceId: string,
): Promise<void> {
  const matchStr = msg.commandMatch
  if (matchStr === undefined || matchStr === null) {
    await reply.text('Usage: /user add <id|@username> or /user remove <id|@username>')
    return
  }
  const args = matchStr.trim().split(/\s+/u)
  const subcommand = args[0]
  const identifier = args[1]
  if (subcommand === 'add') {
    await handleUserAdd(reply, userId, identifier, platformInstanceId)
  } else if (subcommand === 'remove') {
    await handleUserRemove(reply, userId, identifier, adminUserId, platformInstanceId)
  } else {
    await reply.text('Usage: /user add <id|@username> or /user remove <id|@username>')
  }
}

async function handleUsersCommand(
  reply: ReplyFn,
  userId: string,
  adminUserId: string,
  platformInstanceId: string,
): Promise<void> {
  const users = isSuperAdmin(userId) ? listUsers() : listUsers(platformInstanceId)
  if (users.length === 0) {
    await reply.text('No authorized users.')
    return
  }
  const lines = users.map((u) => {
    const admin = u.platform_user_id === adminUserId ? ' (admin)' : ''
    const username = u.username === null ? '' : ` (@${u.username})`
    return `${u.platform_user_id}${username}${admin} — added ${u.added_at}`
  })
  log.info({ userId }, '/users command executed')
  await reply.text(lines.join('\n'))
}

async function handleUserAdd(
  reply: ReplyFn,
  adminId: string,
  identifier: string | undefined,
  platformInstanceId: string,
): Promise<void> {
  if (identifier === undefined || identifier === '') {
    await reply.text('Usage: /user add <user_id|@username>')
    return
  }

  const parsed = parseUserIdentifier(identifier)
  if (parsed === null) {
    await reply.text('Invalid identifier. Use numeric ID or @username.')
    return
  }

  if (parsed.type === 'id') {
    addUser({ userId: parsed.value, platformInstanceId, addedBy: adminId })
    log.info({ adminId, newUserId: parsed.value }, '/user add command executed')
    await reply.text(`User ${parsed.value} authorized.`)
  } else {
    const placeholderId = `placeholder-${crypto.randomUUID()}`
    addUser({
      userId: placeholderId,
      platformInstanceId,
      addedBy: adminId,
      username: parsed.value,
    })
    log.info({ adminId, username: parsed.value }, '/user add command executed')
    await reply.text(`User @${parsed.value} authorized.`)
  }
}

async function handleUserRemove(
  reply: ReplyFn,
  adminId: string,
  identifier: string | undefined,
  adminUserId: string,
  platformInstanceId: string,
): Promise<void> {
  if (identifier === undefined || identifier === '') {
    await reply.text('Usage: /user remove <user_id|@username>')
    return
  }

  const parsed = parseUserIdentifier(identifier)
  if (parsed === null) {
    await reply.text('Invalid identifier. Use numeric ID or @username.')
    return
  }

  // Block removal of admin user (check both ID and username matches)
  if (parsed.value === adminUserId) {
    await reply.text('Cannot remove the admin user.')
    return
  }

  const removed = removeUser(parsed.value, platformInstanceId)
  if (removed) {
    log.info({ adminId, identifier: parsed.value }, '/user remove command executed')
    await reply.text(`User ${identifier} removed.`)
  } else {
    log.info({ adminId, identifier: parsed.value }, '/user remove command - user not found')
    await reply.text(`User ${identifier} not found.`)
  }
}

async function handleAnnounce(chat: ChatProvider, reply: ReplyFn, msg: IncomingMessage): Promise<void> {
  const commandMatch = msg.commandMatch
  if (commandMatch === undefined || commandMatch === null) {
    await reply.text('Usage: /announce <message>')
    return
  }
  const message = commandMatch.trim()
  if (message === '') {
    await reply.text('Usage: /announce <message>')
    return
  }

  const users = listUsers(msg.platformInstanceId).filter((u) => !u.platform_user_id.startsWith('placeholder-'))
  if (users.length === 0) {
    await reply.text('No authorized users to announce to.')
    return
  }

  const limit = pLimit(MAX_CONCURRENT_SENDS)
  const results = await Promise.allSettled(
    users.map((user) =>
      limit(async () => {
        const result = await chat.sendMessage(msg.platformInstanceId, dmTarget(user.platform_user_id), message)
        return result !== false
      }),
    ),
  )

  const successCount = results.filter((r) => r.status === 'fulfilled' && r.value).length
  const failCount = results.length - successCount

  // Log individual failures at warn level
  results.forEach((result) => {
    if (result.status === 'rejected') {
      const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason)
      log.warn({ userId: msg.user.id, error: errorMsg }, 'Failed to send announcement')
    }
  })

  log.info({ userId: msg.user.id, successCount, failCount, totalUsers: users.length }, '/announce command executed')

  if (failCount === 0) {
    await reply.text(`Announcement sent to ${successCount} user(s).`)
  } else {
    await reply.text(`Announcement sent to ${successCount} user(s). Failed to deliver to ${failCount} user(s).`)
  }
}
