// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isAuthorizedGroup } from './authorized-groups.js'
import type { AuthorizationResult, ContextType } from './chat/types.js'
import { isGroupMember } from './groups.js'
import { logger } from './logger.js'
import { addUser, isAuthorized, isDemoUser, resolveUserByUsername } from './users.js'

const log = logger.child({ scope: 'auth' })

/**
 * Generates storage context ID with thread scoping.
 * - DMs: userId
 * - Main chat: groupId
 * - Thread: groupId:threadId
 */
export function getThreadScopedStorageContextId(
  ...args:
    | [contextId: string, contextType: ContextType]
    | [contextId: string, contextType: ContextType, threadId: string | undefined]
): string {
  const [contextId, contextType, threadId] = args
  if (contextType === 'dm') return contextId
  // Main chat: use groupId
  if (threadId === undefined) return contextId
  // Thread: use groupId:threadId for history isolation
  return `${contextId}:${threadId}`
}

const getBotAdminAuth = (
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: true,
  isGroupAdmin: isPlatformAdmin,
  storageContextId: getThreadScopedStorageContextId(contextId, contextType, threadId),
  configContextId: contextId,
})

const isConfiguredBotAdmin = (userId: string): boolean => userId === process.env['ADMIN_USER_ID']

const getGroupMemberAuth = (
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: isPlatformAdmin,
  storageContextId: getThreadScopedStorageContextId(contextId, contextType, threadId),
  configContextId: contextId,
})

const getUnauthorizedGroupAuth = (
  contextId: string,
  reason: 'group_not_allowed' | 'group_member_not_allowed',
): AuthorizationResult => ({
  allowed: false,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: contextId,
  configContextId: contextId,
  reason,
})

const getDmUserAuth = (userId: string): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: userId === process.env['ADMIN_USER_ID'],
  isGroupAdmin: false,
  storageContextId: userId,
  configContextId: userId,
})

const getUnauthorizedDmAuth = (userId: string): AuthorizationResult => ({
  allowed: false,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: userId,
  configContextId: userId,
  reason: 'dm_not_allowed',
})

const maybeAuthorizeDemoModeUser = (
  userId: string,
  username: string | null,
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
): AuthorizationResult | null => {
  if (process.env['DEMO_MODE'] !== 'true' || isAuthorized(userId) || contextType !== 'dm') {
    return null
  }

  log.info({ userId, username }, 'Demo mode: auto-adding user')
  if (username === null) {
    addUser(userId, 'demo-auto')
  } else {
    addUser(userId, 'demo-auto', username)
  }
  return getGroupMemberAuth(contextId, contextType, threadId, false)
}

export const checkAuthorizationExtended = (
  userId: string,
  username: string | null,
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
): AuthorizationResult => {
  log.debug({ userId, contextId, contextType, threadId }, 'Checking authorization')

  if (contextType === 'group' && !isAuthorizedGroup(contextId)) {
    return getUnauthorizedGroupAuth(contextId, 'group_not_allowed')
  }

  const demoModeAuth = maybeAuthorizeDemoModeUser(userId, username, contextId, contextType, threadId)
  if (demoModeAuth !== null) {
    return demoModeAuth
  }

  if (isAuthorized(userId)) {
    if (contextType === 'dm' && isDemoUser(userId)) {
      return getGroupMemberAuth(contextId, contextType, threadId, false)
    }
    if (contextType === 'dm') {
      return getDmUserAuth(userId)
    }
    return isConfiguredBotAdmin(userId)
      ? getBotAdminAuth(contextId, contextType, threadId, isPlatformAdmin)
      : getGroupMemberAuth(contextId, contextType, threadId, isPlatformAdmin)
  }

  if (contextType === 'group') {
    if (isPlatformAdmin) {
      return getGroupMemberAuth(contextId, contextType, threadId, true)
    }

    if (isGroupMember(contextId, userId)) {
      return getGroupMemberAuth(contextId, contextType, threadId, isPlatformAdmin)
    }
    return getUnauthorizedGroupAuth(contextId, 'group_member_not_allowed')
  }

  if (username !== null && resolveUserByUsername(userId, username)) {
    return getDmUserAuth(userId)
  }

  return getUnauthorizedDmAuth(userId)
}
