// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { addAuthorizedGroup, removeAuthorizedGroup } from '../authorized-groups.js'
import { resolveChatUserDisplayLabel } from '../chat/group-display-resolution.js'
import { toStorageContextId } from '../chat/scoped-context.js'
import type { AuthorizationResult, ChatProvider, IncomingMessage, ReplyFn, ResolveUserContext } from '../chat/types.js'
import { addGroupMember, listGroupMembers, removeGroupMember } from '../groups.js'
import { logger } from '../logger.js'
import { listAuthorizedGroupDisplayLines } from './group-authorized-list.js'
import { extractGroupUserId } from './group-user-id.js'

const log = logger.child({ scope: 'commands:group' })
const GROUP_CHAT_USAGE = 'Usage: /group adduser <user-id|@username> | /group deluser <user-id|@username> | /group users'
const DM_ADMIN_USAGE = 'Usage: /group add <group-id> | /group remove <group-id> | /groups'
const MAX_CONCURRENT_LABEL_LOOKUPS = 5

type LabelResolverContext = {
  readonly chat: ChatProvider
  readonly contextId: string
  readonly contextType: 'dm' | 'group'
  readonly platformInstanceId: string | undefined
}

type ScheduleLookup = (lookup: () => Promise<string | null>) => Promise<string | null>

function makeDisplayLabel(label: string | null, fallback: string): string {
  if (label === null) return fallback
  return label
}

function getGroupStorageContextId(auth: AuthorizationResult): string {
  if (auth.configContextId !== undefined) return auth.configContextId
  return auth.storageContextId
}

function resolveUserContextForLabelLookup(resolverContext: LabelResolverContext): ResolveUserContext {
  return resolverContext.platformInstanceId === undefined
    ? { contextId: resolverContext.contextId, contextType: resolverContext.contextType }
    : {
        contextId: resolverContext.contextId,
        contextType: resolverContext.contextType,
        platformInstanceId: resolverContext.platformInstanceId,
      }
}
function resolveUserLabelCached(
  resolverContext: LabelResolverContext,
  userId: string,
  cache: Map<string, Promise<string | null>>,
  scheduleLookup: ScheduleLookup,
): Promise<string | null> {
  const cacheKey = `${resolverContext.contextType}:${resolverContext.contextId}:${userId}`
  const existing = cache.get(cacheKey)
  if (existing !== undefined) return existing
  const pending = scheduleLookup(() =>
    resolveChatUserDisplayLabel(resolverContext.chat, userId, resolveUserContextForLabelLookup(resolverContext)).catch(
      (error: unknown): string | null => {
        log.warn(
          {
            userId,
            contextId: resolverContext.contextId,
            contextType: resolverContext.contextType,
            error: error instanceof Error ? error.message : String(error),
          },
          'User label lookup failed in group command',
        )
        return null
      },
    ),
  )

  cache.set(cacheKey, pending)
  return pending
}

export function registerGroupCommand(chat: ChatProvider): void {
  chat.registerCommand('group', async (msg: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult) => {
    if (msg.contextType === 'dm') {
      await handleAuthorizedGroupCommand(msg, reply, auth)
      return
    }
    await handleGroupMemberCommand(chat, msg, reply, auth)
  })
  chat.registerCommand('groups', async (msg: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult) => {
    if (msg.contextType !== 'dm') {
      await reply.text('This command is only available in direct messages.')
      return
    }
    if (!auth.isBotAdmin) {
      await reply.text('Only bot admins can list authorized groups.')
      return
    }
    const lines = await listAuthorizedGroupDisplayLines(chat)
    if (lines.length === 0) {
      await reply.text('No authorized groups.')
      return
    }
    await reply.text(`Authorized groups:\n${lines.join('\n')}`)
  })
}

async function handleGroupMemberCommand(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
): Promise<void> {
  const match = typeof msg.commandMatch === 'string' ? msg.commandMatch.trim() : ''
  if (!match) {
    await reply.text(GROUP_CHAT_USAGE)
    return
  }

  const [subcommand, ...args] = match.split(/\s+/u)
  const targetUser = args[0]

  switch (subcommand) {
    case 'adduser':
      await handleGroupMemberUpdate(chat, msg, reply, auth, targetUser, 'add')
      break
    case 'deluser':
      await handleGroupMemberUpdate(chat, msg, reply, auth, targetUser, 'remove')
      break
    case 'users':
      await handleListUsers(chat, msg, reply, auth)
      break
    case '':
    case undefined:
      await reply.text(GROUP_CHAT_USAGE)
      break
    default:
      await reply.text(`Unknown subcommand. ${GROUP_CHAT_USAGE}`)
  }
}

async function handleAuthorizedGroupCommand(
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
): Promise<void> {
  if (!auth.isBotAdmin) {
    await reply.text('Only bot admins can manage authorized groups.')
    return
  }

  const match = typeof msg.commandMatch === 'string' ? msg.commandMatch.trim() : ''
  if (!match) {
    await reply.text(DM_ADMIN_USAGE)
    return
  }

  const [subcommand, groupId] = match.split(/\s+/u, 2)

  if (groupId === undefined || groupId === '') {
    await reply.text(DM_ADMIN_USAGE)
    return
  }

  const storageGroupId = toStorageContextId(msg.platformInstanceId, groupId)

  if (subcommand === 'add') {
    addAuthorizedGroup(storageGroupId, msg.user.id)
    await reply.text(`Group ${groupId} authorized.`)
    log.info({ groupId: storageGroupId, nativeGroupId: groupId, userId: msg.user.id }, 'Authorized group added')
    return
  }

  if (subcommand === 'remove') {
    const removed = removeAuthorizedGroup(storageGroupId)
    await reply.text(removed ? `Group ${groupId} removed.` : `Group ${groupId} was not authorized.`)
    log.info({ groupId: storageGroupId, nativeGroupId: groupId, userId: msg.user.id, removed }, 'Authorized group removal attempted')
    return
  }

  await reply.text(`Unknown subcommand. ${DM_ADMIN_USAGE}`)
}

async function handleGroupMemberUpdate(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  targetUser: string | undefined,
  action: 'add' | 'remove',
): Promise<void> {
  if (!msg.user.isAdmin) {
    await reply.text(action === 'add' ? 'Only group admins can add users.' : 'Only group admins can remove users.')
    return
  }

  if (targetUser === undefined) {
    await reply.text(
      action === 'add' ? 'Usage: /group adduser <user-id|@username>' : 'Usage: /group deluser <user-id|@username>',
    )
    return
  }

  const result = await extractGroupUserId(chat, targetUser, {
    contextId: msg.contextId,
    contextType: msg.contextType,
    platformInstanceId: msg.platformInstanceId,
  })
  if (result.kind === 'error') {
    await reply.text(result.message)
    return
  }

  const { userId } = result
  const storageGroupId = getGroupStorageContextId(auth)
  if (action === 'add') {
    addGroupMember(storageGroupId, userId, msg.user.id)
    await reply.text(`User ${targetUser} added to this group.`)
    log.info({ groupId: storageGroupId, nativeGroupId: msg.contextId, userId }, 'Group member added')
    return
  }

  removeGroupMember(storageGroupId, userId)
  await reply.text(`User ${targetUser} removed from this group.`)
  log.info({ groupId: storageGroupId, nativeGroupId: msg.contextId, userId }, 'Group member removed')
}

async function handleListUsers(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
): Promise<void> {
  const members = listGroupMembers(getGroupStorageContextId(auth))

  if (members.length === 0) {
    await reply.text('No members in this group yet.')
    return
  }
  const userLabelCache = new Map<string, Promise<string | null>>()
  const limit = pLimit(MAX_CONCURRENT_LABEL_LOOKUPS)
  const resolverContext: LabelResolverContext = {
    chat,
    contextId: msg.contextId,
    contextType: msg.contextType,
    platformInstanceId: msg.platformInstanceId,
  }
  const lines = await Promise.all(
    members.map(async (member) => {
      const [resolvedMemberLabel, resolvedAdderLabel] = await Promise.all([
        resolveUserLabelCached(resolverContext, member.user_id, userLabelCache, limit),
        resolveUserLabelCached(resolverContext, member.added_by, userLabelCache, limit),
      ])

      const memberLabel = makeDisplayLabel(resolvedMemberLabel, member.user_id)
      const adderLabel = makeDisplayLabel(resolvedAdderLabel, member.added_by)
      return `- ${memberLabel} (added by ${adderLabel})`
    }),
  )
  await reply.text(`Group members:\n${lines.join('\n')}`)
}
