// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isAuthorizedGroup, listAuthorizedGroups } from '../authorized-groups.js'
import {
  getNativeContextId,
  isScopedContextId,
  parseScopedContextId,
  toScopedContextId,
} from '../chat/scoped-context.js'
import { isAdmin } from '../instances/admin-store.js'
import { logger } from '../logger.js'
import { listAdminGroupContextsForUser } from './registry.js'
import type { KnownGroupContext } from './types.js'

const log = logger.child({ scope: 'group-settings:access' })
const FALLBACK_PROVIDER = 'unknown'

export type GroupMatchResult =
  | { kind: 'match'; group: KnownGroupContext }
  | { kind: 'ambiguous'; matches: KnownGroupContext[] }
  | { kind: 'not_found' }

export type GroupTargetAccessResult = { kind: 'ok' } | { kind: 'not_admin' } | { kind: 'not_authorized' }

const getMatchCandidates = (group: KnownGroupContext): readonly string[] => {
  const nativeContextId = getNativeContextId(group.contextId)
  if (group.parentName === null) {
    return [group.displayName, '', group.displayName, nativeContextId]
  }

  return [group.displayName, group.parentName, `${group.parentName} / ${group.displayName}`, nativeContextId]
}

const getAuthorizedGroupId = (group: KnownGroupContext, platformInstanceId: string | undefined): string => {
  if (isScopedContextId(group.contextId)) return group.contextId
  if (platformInstanceId === undefined) return group.contextId
  return toScopedContextId({ platformInstanceId, nativeContextId: group.contextId })
}

const isAuthorizedGroupContext = (group: KnownGroupContext, platformInstanceId: string | undefined): boolean => {
  if (isAuthorizedGroup(getAuthorizedGroupId(group, platformInstanceId))) return true
  if (platformInstanceId !== undefined) return false
  return isAuthorizedGroup(getNativeContextId(group.contextId))
}

const fallbackKnownGroupContext = (contextId: string): KnownGroupContext => {
  const now = new Date().toISOString()
  return {
    contextId,
    provider: FALLBACK_PROVIDER,
    displayName: getNativeContextId(contextId),
    parentName: null,
    firstSeenAt: now,
    lastSeenAt: now,
    source: 'authorized-fallback',
  }
}

const appendAuthorizedFallbackGroups = (
  groups: readonly KnownGroupContext[],
  userId: string,
  platformInstanceId: string | undefined,
): KnownGroupContext[] => {
  if (platformInstanceId === undefined || !isAdmin(userId, platformInstanceId)) {
    return [...groups]
  }

  const existing = new Set(groups.map((group) => group.contextId))
  const fallbackGroups = listAuthorizedGroups()
    .map((row) => row.group_id)
    .filter((groupId) => {
      if (existing.has(groupId) || !isScopedContextId(groupId)) {
        return false
      }

      const parsed = parseScopedContextId(groupId)
      return parsed?.platformInstanceId === platformInstanceId
    })
    .map((groupId) => fallbackKnownGroupContext(groupId))

  return [...groups, ...fallbackGroups].toSorted((left, right) => left.displayName.localeCompare(right.displayName))
}

export function listManageableGroups(userId: string, ...args: [] | [platformInstanceId: string]): KnownGroupContext[] {
  const platformInstanceId = args[0]
  log.debug({ userId }, 'listManageableGroups called')

  const groups = listAdminGroupContextsForUser(userId, ...args).filter((group) =>
    isAuthorizedGroupContext(group, platformInstanceId),
  )

  const mergedGroups = appendAuthorizedFallbackGroups(groups, userId, platformInstanceId)

  log.debug({ userId, groupCount: mergedGroups.length }, 'Listed manageable groups')
  return mergedGroups
}

export function validateGroupTargetAccess(
  userId: string,
  groupId: string,
  ...args: [] | [platformInstanceId: string]
): GroupTargetAccessResult {
  const platformInstanceId = args[0]
  const adminGroups = listAdminGroupContextsForUser(userId, ...args)
  const manageableGroups = appendAuthorizedFallbackGroups(adminGroups, userId, platformInstanceId)
  const group = manageableGroups.find((candidate) => {
    if (candidate.contextId === groupId) return true
    return getAuthorizedGroupId(candidate, platformInstanceId) === groupId
  })
  if (group === undefined) {
    return { kind: 'not_admin' }
  }

  if (!isAuthorizedGroupContext(group, platformInstanceId)) {
    return { kind: 'not_authorized' }
  }

  return { kind: 'ok' }
}

export function matchManageableGroup(
  userId: string,
  query: string,
  ...args: [] | [platformInstanceId: string]
): GroupMatchResult {
  const platformInstanceId = args[0]
  const normalized = query.trim().toLowerCase()

  log.debug({ userId, normalizedQuery: normalized }, 'matchManageableGroup called')

  if (normalized.length === 0) {
    return { kind: 'not_found' }
  }

  const groups =
    platformInstanceId === undefined ? listManageableGroups(userId) : listManageableGroups(userId, platformInstanceId)
  const exactId = groups.find((group) => {
    if (group.contextId.toLowerCase() === normalized) return true
    return getNativeContextId(group.contextId).toLowerCase() === normalized
  })
  if (exactId !== undefined) {
    return { kind: 'match', group: exactId }
  }

  const matches = groups.filter((group) =>
    getMatchCandidates(group).some((candidate) => candidate.toLowerCase().includes(normalized)),
  )

  if (matches.length === 1) {
    return { kind: 'match', group: matches[0]! }
  }
  if (matches.length > 1) {
    return { kind: 'ambiguous', matches }
  }
  return { kind: 'not_found' }
}
