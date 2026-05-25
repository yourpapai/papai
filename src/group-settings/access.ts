// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isAuthorizedGroup } from '../authorized-groups.js'
import { getNativeContextId, isScopedContextId, toScopedContextId } from '../chat/scoped-context.js'
import { logger } from '../logger.js'
import { listAdminGroupContextsForUser } from './registry.js'
import type { KnownGroupContext } from './types.js'

const log = logger.child({ scope: 'group-settings:access' })

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

export function listManageableGroups(userId: string, ...args: [] | [platformInstanceId: string]): KnownGroupContext[] {
  const platformInstanceId = args[0]
  log.debug({ userId }, 'listManageableGroups called')

  const groups = listAdminGroupContextsForUser(userId, ...args).filter((group) =>
    isAuthorizedGroupContext(group, platformInstanceId),
  )

  log.debug({ userId, groupCount: groups.length }, 'Listed manageable groups')
  return groups
}

export function validateGroupTargetAccess(
  userId: string,
  groupId: string,
  ...args: [] | [platformInstanceId: string]
): GroupTargetAccessResult {
  const platformInstanceId = args[0]
  const adminGroups = listAdminGroupContextsForUser(userId, ...args)
  const group = adminGroups.find(
    (candidate) => {
      if (candidate.contextId === groupId) return true
      return getAuthorizedGroupId(candidate, platformInstanceId) === groupId
    },
  )
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

  const groups = platformInstanceId === undefined ? listManageableGroups(userId) : listManageableGroups(userId, platformInstanceId)
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
