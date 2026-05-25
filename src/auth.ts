// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isAuthorizedGroup } from './authorized-groups.js'
import { toScopedContextId, toScopedThreadContextId } from './chat/scoped-context.js'
import type { AuthorizationResult, ContextType } from './chat/types.js'
import { isGroupMember } from './groups.js'
import { isAdmin } from './instances/admin-store.js'
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
    | [contextId: string, contextType: ContextType, threadId: string | undefined, platformInstanceId: string]
): string {
  const [contextId, contextType, threadId, platformInstanceId] = args
  if (platformInstanceId !== undefined) {
    const input = { platformInstanceId, nativeContextId: contextId }
    if (contextType === 'dm') return toScopedContextId(input)
    return toScopedThreadContextId({ ...input, threadId })
  }
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
  platformInstanceId: string,
): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: true,
  isGroupAdmin: isPlatformAdmin,
  storageContextId: getThreadScopedStorageContextId(contextId, contextType, threadId, platformInstanceId),
  configContextId: getThreadScopedStorageContextId(contextId, contextType, undefined, platformInstanceId),
})

const getGroupMemberAuth = (
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
  platformInstanceId: string,
): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: isPlatformAdmin,
  storageContextId: getThreadScopedStorageContextId(contextId, contextType, threadId, platformInstanceId),
  configContextId: getThreadScopedStorageContextId(contextId, contextType, undefined, platformInstanceId),
})

const getUnauthorizedGroupAuth = (
  contextId: string,
  threadId: string | undefined,
  platformInstanceId: string,
  reason: 'group_not_allowed' | 'group_member_not_allowed',
): AuthorizationResult => ({
  allowed: false,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: getThreadScopedStorageContextId(contextId, 'group', threadId, platformInstanceId),
  configContextId: getThreadScopedStorageContextId(contextId, 'group', undefined, platformInstanceId),
  reason,
})

const getDmUserAuth = (userId: string, platformInstanceId: string): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: getThreadScopedStorageContextId(userId, 'dm', undefined, platformInstanceId),
  configContextId: getThreadScopedStorageContextId(userId, 'dm', undefined, platformInstanceId),
})

const getUnauthorizedDmAuth = (userId: string, platformInstanceId: string): AuthorizationResult => ({
  allowed: false,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: getThreadScopedStorageContextId(userId, 'dm', undefined, platformInstanceId),
  configContextId: getThreadScopedStorageContextId(userId, 'dm', undefined, platformInstanceId),
  reason: 'dm_not_allowed',
})

const getGroupConfigContextId = (contextId: string, platformInstanceId: string): string =>
  getThreadScopedStorageContextId(contextId, 'group', undefined, platformInstanceId)

const maybeAuthorizeDemoModeUser = (
  userId: string,
  username: string | null,
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  platformInstanceId: string,
): AuthorizationResult | null => {
  if (process.env['DEMO_MODE'] !== 'true' || isAuthorized(userId, platformInstanceId) || contextType !== 'dm') {
    return null
  }

  log.info({ userId, username }, 'Demo mode: auto-adding user')
  if (username === null) {
    addUser({ userId, platformInstanceId, addedBy: 'demo-auto' })
  } else {
    addUser({ userId, platformInstanceId, addedBy: 'demo-auto', username })
  }
  return getGroupMemberAuth(contextId, contextType, threadId, false, platformInstanceId)
}

const getAuthorizedUserAuth = (
  userId: string,
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
  platformInstanceId: string,
): AuthorizationResult => {
  if (contextType === 'dm' && isDemoUser(userId, platformInstanceId)) {
    return getGroupMemberAuth(contextId, contextType, threadId, false, platformInstanceId)
  }
  if (contextType === 'dm') {
    return getDmUserAuth(userId, platformInstanceId)
  }
  return getGroupMemberAuth(contextId, contextType, threadId, isPlatformAdmin, platformInstanceId)
}

const getUnauthenticatedGroupAuth = (
  userId: string,
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
  platformInstanceId: string,
): AuthorizationResult => {
  if (isPlatformAdmin) {
    return getGroupMemberAuth(contextId, contextType, threadId, true, platformInstanceId)
  }

  if (isGroupMember(getGroupConfigContextId(contextId, platformInstanceId), userId)) {
    return getGroupMemberAuth(contextId, contextType, threadId, isPlatformAdmin, platformInstanceId)
  }
  return getUnauthorizedGroupAuth(contextId, threadId, platformInstanceId, 'group_member_not_allowed')
}

export const checkAuthorizationExtended = (
  userId: string,
  username: string | null,
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
  platformInstanceId: string,
): AuthorizationResult => {
  log.debug({ userId, contextId, contextType, threadId }, 'Checking authorization')

  if (contextType === 'group' && !isAuthorizedGroup(getGroupConfigContextId(contextId, platformInstanceId))) {
    return getUnauthorizedGroupAuth(contextId, threadId, platformInstanceId, 'group_not_allowed')
  }

  const demoModeAuth = maybeAuthorizeDemoModeUser(
    userId,
    username,
    contextId,
    contextType,
    threadId,
    platformInstanceId,
  )
  if (demoModeAuth !== null) {
    return demoModeAuth
  }

  if (isAdmin(userId, platformInstanceId)) {
    return getBotAdminAuth(contextId, contextType, threadId, isPlatformAdmin, platformInstanceId)
  }

  if (isAuthorized(userId, platformInstanceId)) {
    return getAuthorizedUserAuth(userId, contextId, contextType, threadId, isPlatformAdmin, platformInstanceId)
  }

  if (contextType === 'group') {
    return getUnauthenticatedGroupAuth(userId, contextId, contextType, threadId, isPlatformAdmin, platformInstanceId)
  }

  if (username !== null && resolveUserByUsername(userId, username, platformInstanceId)) {
    return getDmUserAuth(userId, platformInstanceId)
  }

  return getUnauthorizedDmAuth(userId, platformInstanceId)
}
