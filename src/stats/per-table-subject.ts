// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { parseScopedContextId } from '../chat/scoped-context.js'
import { getDrizzleDb } from '../db/drizzle.js'
import {
  groupMembers,
  groupUserObservations,
  stagedFiles,
  userConfig,
  userIdentityMappings,
  users,
} from '../db/schema.js'
import { KANEO_WORKSPACE_CONFIG_KEY } from '../types/config.js'
import type { GroupBlockStats, StagedFileStats, UserBlockStats } from './types.js'

export function identityForSubject(storageContextId: string): Record<string, number> {
  const rows = getDrizzleDb()
    .select({ providerName: userIdentityMappings.providerName })
    .from(userIdentityMappings)
    .where(eq(userIdentityMappings.contextId, storageContextId))
    .all()
  const out: Record<string, number> = {}
  for (const r of rows) {
    const current = out[r.providerName]
    out[r.providerName] = current === undefined ? 1 : current + 1
  }
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
    const current = byStatus[r.status]
    byStatus[r.status] = current === undefined ? 1 : current + 1
    if (r.size !== null) bytesTotal += r.size
  }
  return { total: rows.length, byStatus, bytesTotal }
}

export function userBlockForSubject(storageContextId: string): UserBlockStats | null {
  const scoped = parseScopedContextId(storageContextId)
  if (scoped !== null && scoped.threadId !== undefined) return null

  const row = getDrizzleDb()
    .select({
      addedAt: users.addedAt,
      addedBy: users.addedBy,
    })
    .from(users)
    .where(
      scoped === null
        ? eq(users.platformUserId, storageContextId)
        : and(
            eq(users.platformInstanceId, scoped.platformInstanceId),
            eq(users.platformUserId, scoped.nativeContextId),
          ),
    )
    .all()

  const r = row[0]
  if (r === undefined) return null

  const workspace = getDrizzleDb()
    .select({ value: userConfig.value })
    .from(userConfig)
    .where(and(eq(userConfig.userId, storageContextId), eq(userConfig.key, KANEO_WORKSPACE_CONFIG_KEY)))
    .get()

  return {
    addedAt: r.addedAt,
    addedByPresent: r.addedBy.length > 0,
    kaneoWorkspacePresent: workspace !== undefined && workspace.value !== '',
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
