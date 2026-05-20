// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { groupMembers, groupUserObservations, stagedFiles, userIdentityMappings, users } from '../db/schema.js'
import type { GroupBlockStats, StagedFileStats, UserBlockStats } from './types.js'

export function identityForSubject(storageContextId: string): Record<string, number> {
  const rows = getDrizzleDb()
    .select({ providerName: userIdentityMappings.providerName })
    .from(userIdentityMappings)
    .where(eq(userIdentityMappings.contextId, storageContextId))
    .all()
  const out: Record<string, number> = {}
  for (const r of rows) out[r.providerName] = (out[r.providerName] ?? 0) + 1
  return out
}

export function stagedForSubject(storageContextId: string): StagedFileStats {
  const rows = getDrizzleDb()
    .select({ status: stagedFiles.status, size: stagedFiles.size })
    .from(stagedFiles)
    .where(eq(stagedFiles.contextId, storageContextId))
    .all()

  let bytesTotal = 0
  const byStatus: Record<string, number> = {}
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    if (r.size !== null) bytesTotal += r.size
  }
  return { total: rows.length, byStatus, bytesTotal }
}

export function userBlockForSubject(storageContextId: string): UserBlockStats | null {
  const row = getDrizzleDb()
    .select({
      addedAt: users.addedAt,
      addedBy: users.addedBy,
      kaneoWorkspaceId: users.kaneoWorkspaceId,
    })
    .from(users)
    .where(eq(users.platformUserId, storageContextId))
    .all()

  const r = row[0]
  if (r === undefined) return null
  return {
    addedAt: r.addedAt,
    addedByPresent: r.addedBy.length > 0,
    kaneoWorkspacePresent: r.kaneoWorkspaceId !== null && r.kaneoWorkspaceId !== '',
  }
}

export function groupBlockForSubject(storageContextId: string): GroupBlockStats | null {
  const memberRows = getDrizzleDb()
    .select({ userId: groupMembers.userId, addedBy: groupMembers.addedBy })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, storageContextId))
    .all()
  const obsRows = getDrizzleDb()
    .select({ userId: groupUserObservations.userId })
    .from(groupUserObservations)
    .where(eq(groupUserObservations.contextId, storageContextId))
    .all()

  if (memberRows.length === 0 && obsRows.length === 0) return null

  const addedBy = new Set<string>()
  for (const r of memberRows) addedBy.add(r.addedBy)

  return {
    memberCount: memberRows.length,
    distinctAddedBy: addedBy.size,
    observationCount: obsRows.length,
  }
}
