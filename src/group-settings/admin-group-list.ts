// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { groupAdminObservations, knownGroupContexts } from '../db/schema.js'
import { logger } from '../logger.js'
import { getAdminLookupScope, matchesAdminPlatformInstance } from './admin-scope.js'
import type { KnownGroupContext } from './types.js'

const log = logger.child({ scope: 'group-settings:admin-group-list' })

const toKnownGroupContext = (row: typeof knownGroupContexts.$inferSelect): KnownGroupContext => ({
  contextId: row.contextId,
  provider: row.provider,
  displayName: row.displayName,
  parentName: row.parentName,
  firstSeenAt: row.firstSeenAt,
  lastSeenAt: row.lastSeenAt,
})

export function listAdminGroupContextsForUser(
  userId: string,
  ...args: [] | [platformInstanceId: string]
): KnownGroupContext[] {
  const scope = getAdminLookupScope(userId, args[0])
  log.debug({ userId, platformInstanceId: scope.platformInstanceId }, 'listAdminGroupContextsForUser called')

  const groups = getDrizzleDb()
    .select({
      contextId: knownGroupContexts.contextId,
      provider: knownGroupContexts.provider,
      displayName: knownGroupContexts.displayName,
      parentName: knownGroupContexts.parentName,
      firstSeenAt: knownGroupContexts.firstSeenAt,
      lastSeenAt: knownGroupContexts.lastSeenAt,
    })
    .from(knownGroupContexts)
    .innerJoin(
      groupAdminObservations,
      and(
        eq(knownGroupContexts.provider, groupAdminObservations.provider),
        eq(knownGroupContexts.contextId, groupAdminObservations.contextId),
        eq(groupAdminObservations.userId, scope.nativeUserId),
        eq(groupAdminObservations.isAdmin, true),
      ),
    )
    .all()
    .map((row) => toKnownGroupContext(row))
    .filter((group) => matchesAdminPlatformInstance(group.contextId, scope.platformInstanceId))
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName))

  log.debug(
    { userId, platformInstanceId: scope.platformInstanceId, count: groups.length },
    'Listed admin group contexts for user',
  )
  return groups
}
