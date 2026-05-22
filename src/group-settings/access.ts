// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isAuthorizedGroup } from '../authorized-groups.js'
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
  if (group.parentName === null) {
    return [group.displayName, '', group.displayName]
  }

  return [group.displayName, group.parentName, `${group.parentName} / ${group.displayName}`]
}

export function listManageableGroups(userId: string): KnownGroupContext[] {
  log.debug({ userId }, 'listManageableGroups called')

  const groups = listAdminGroupContextsForUser(userId).filter((group) => isAuthorizedGroup(group.contextId))

  log.debug({ userId, groupCount: groups.length }, 'Listed manageable groups')
  return groups
}

export function validateGroupTargetAccess(userId: string, groupId: string): GroupTargetAccessResult {
  const adminGroups = listAdminGroupContextsForUser(userId)
  const isKnownAdmin = adminGroups.some((group) => group.contextId === groupId)
  if (!isKnownAdmin) {
    return { kind: 'not_admin' }
  }

  if (!isAuthorizedGroup(groupId)) {
    return { kind: 'not_authorized' }
  }

  return { kind: 'ok' }
}

export function matchManageableGroup(userId: string, query: string): GroupMatchResult {
  const normalized = query.trim().toLowerCase()

  log.debug({ userId, normalizedQuery: normalized }, 'matchManageableGroup called')

  if (normalized.length === 0) {
    return { kind: 'not_found' }
  }

  const groups = listManageableGroups(userId)
  const exactId = groups.find((group) => group.contextId.toLowerCase() === normalized)
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
