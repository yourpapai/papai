// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isAuthorizedGroup, isGuestModeEnabled } from './authorized-groups.js'
import { toScopedContextId, toScopedThreadContextId } from './chat/scoped-context.js'
import type { AuthorizationResult, ContextType } from './chat/types.js'
import { listManageableGroups } from './group-settings/access.js'
import { isGroupMember } from './groups.js'
import { isAdmin } from './instances/admin-store.js'
import { isOpenDmAccessEnabled } from './instances/platform-store.js'
import { logger } from './logger.js'
import { addUser, isAuthorized, isBlocked, resolveUserByUsername } from './users.js'

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

const getBotAdminDmAuth = (userId: string, platformInstanceId: string): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: true,
  isGroupAdmin: false,
  storageContextId: getThreadScopedStorageContextId(userId, 'dm', undefined, platformInstanceId),
  configContextId: getThreadScopedStorageContextId(userId, 'dm', undefined, platformInstanceId),
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

const getGuestGroupAuth = (
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  platformInstanceId: string,
): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: false,
  isGuest: true,
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

const getUnauthorizedDmAuth = (
  userId: string,
  platformInstanceId: string,
  configCommandAllowed: boolean,
): AuthorizationResult => ({
  allowed: false,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: getThreadScopedStorageContextId(userId, 'dm', undefined, platformInstanceId),
  configContextId: getThreadScopedStorageContextId(userId, 'dm', undefined, platformInstanceId),
  reason: 'dm_not_allowed',
  ...(configCommandAllowed ? { configCommandAllowed: true } : {}),
})

const getGroupConfigContextId = (contextId: string, platformInstanceId: string): string =>
  getThreadScopedStorageContextId(contextId, 'group', undefined, platformInstanceId)

const getAuthorizedUserAuth = (
  userId: string,
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
  platformInstanceId: string,
): AuthorizationResult => {
  if (contextType === 'dm') {
    return getDmUserAuth(userId, platformInstanceId)
  }
  return getGroupMemberAuth(contextId, contextType, threadId, isPlatformAdmin, platformInstanceId)
}

const getBlockedAuth = (
  userId: string,
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  platformInstanceId: string,
): AuthorizationResult => {
  const base = contextType === 'dm' ? userId : contextId
  return {
    allowed: false,
    isBotAdmin: false,
    isGroupAdmin: false,
    storageContextId: getThreadScopedStorageContextId(base, contextType, threadId, platformInstanceId),
    configContextId: getThreadScopedStorageContextId(base, contextType, undefined, platformInstanceId),
    reason: 'user_blocked',
  }
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
  if (isGuestModeEnabled(getGroupConfigContextId(contextId, platformInstanceId))) {
    return getGuestGroupAuth(contextId, contextType, threadId, platformInstanceId)
  }
  return getUnauthorizedGroupAuth(contextId, threadId, platformInstanceId, 'group_member_not_allowed')
}

const getAdminAuth = (
  userId: string,
  contextId: string,
  contextType: ContextType,
  threadId: string | undefined,
  isPlatformAdmin: boolean,
  platformInstanceId: string,
): AuthorizationResult => {
  // In a DM the chat layer passes the DM *channel* id as contextId, which is
  // not the user id on Mattermost/Discord/Kontur. Key the admin's DM context
  // off the user id so it matches the user-keyed personal context the settings
  // UI binds (and that non-admin DM users already get); otherwise an admin's
  // DM never sees its bound task instance / per-user config.
  if (contextType === 'dm') {
    return getBotAdminDmAuth(userId, platformInstanceId)
  }

  return getBotAdminAuth(contextId, contextType, threadId, isPlatformAdmin, platformInstanceId)
}

/**
 * Open DM access: when enabled for the instance, auto-provision an unknown DM user
 * and grant normal DM auth. Returns null when open access is off (caller continues).
 */
const tryOpenDmAccessAuth = (
  userId: string,
  username: string | null,
  platformInstanceId: string,
): AuthorizationResult | null => {
  if (!isOpenDmAccessEnabled(platformInstanceId)) return null
  log.info({ userId, platformInstanceId }, 'Open DM access: auto-adding user')
  if (username === null) {
    addUser({ userId, platformInstanceId, addedBy: 'open-access' })
  } else {
    addUser({ userId, platformInstanceId, addedBy: 'open-access', username })
  }
  return getDmUserAuth(userId, platformInstanceId)
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

  if (isAdmin(userId, platformInstanceId)) {
    return getAdminAuth(userId, contextId, contextType, threadId, isPlatformAdmin, platformInstanceId)
  }

  if (isBlocked(userId, platformInstanceId)) {
    return getBlockedAuth(userId, contextId, contextType, threadId, platformInstanceId)
  }

  const authorized = isAuthorized(userId, platformInstanceId)

  if (contextType === 'dm' && !authorized) {
    const openDmAuth = tryOpenDmAccessAuth(userId, username, platformInstanceId)
    if (openDmAuth) return openDmAuth
  }

  if (authorized) {
    return getAuthorizedUserAuth(userId, contextId, contextType, threadId, isPlatformAdmin, platformInstanceId)
  }

  if (contextType === 'group') {
    return getUnauthenticatedGroupAuth(userId, contextId, contextType, threadId, isPlatformAdmin, platformInstanceId)
  }

  if (username !== null && resolveUserByUsername(userId, username, platformInstanceId)) {
    return getDmUserAuth(userId, platformInstanceId)
  }

  // A DM user who is not otherwise authorized may still launch /config when they
  // can manage at least one group in the settings UI (i.e. they are a group admin
  // of an authorized group). The settings UI already scopes them to those groups.
  const canManageGroup = listManageableGroups(userId, platformInstanceId).length > 0
  return getUnauthorizedDmAuth(userId, platformInstanceId, canManageGroup)
}
