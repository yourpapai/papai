// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, or } from 'drizzle-orm'

import { evictUser, getCachedWorkspace, setCachedWorkspace } from './cache.js'
import { getDrizzleDb } from './db/drizzle.js'
import { users } from './db/schema.js'
import { isAdmin } from './instances/admin-store.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'users' })

export interface UserRecord {
  platform_user_id: string
  platform_instance_id: string | null
  username: string | null
  added_at: string
  added_by: string
}

type AddUserInputWithoutUsername = Readonly<Record<never, never>>

export type AddUserInput = Readonly<{
  userId: string
  platformInstanceId: string
  addedBy: string
}> &
  (Readonly<{ username: string | undefined }> | AddUserInputWithoutUsername)

export function addUser(input: AddUserInput): void {
  const username = 'username' in input && input.username !== undefined ? input.username : null
  log.debug({ platformInstanceId: input.platformInstanceId, hasUsername: username !== null }, 'addUser called')
  const db = getDrizzleDb()

  db.insert(users)
    .values({
      platformUserId: input.userId,
      platformInstanceId: input.platformInstanceId,
      username,
      addedBy: input.addedBy,
    })
    .onConflictDoUpdate({
      target: users.platformUserId,
      set: { platformInstanceId: input.platformInstanceId, username },
    })
    .run()

  log.info({ platformInstanceId: input.platformInstanceId, hasUsername: username !== null }, 'User added')
}

export function removeUser(identifier: string, platformInstanceId: string): boolean {
  log.debug({ platformInstanceId }, 'removeUser called')
  const db = getDrizzleDb()

  const deleted = db
    .delete(users)
    .where(
      and(eq(users.platformInstanceId, platformInstanceId), or(eq(users.username, identifier), eq(users.platformUserId, identifier))),
    )
    .returning({ platformUserId: users.platformUserId })
    .all()

  const removed = deleted.length > 0
  if (removed) {
    for (const row of deleted) {
      evictUser(row.platformUserId)
    }
    log.info('User removed')
  } else {
    log.info('User not found for removal')
  }
  return removed
}

export function isAuthorized(userId: string, platformInstanceId: string): boolean {
  log.debug({ platformInstanceId }, 'isAuthorized called')
  if (isAdmin(userId, platformInstanceId)) return true

  const db = getDrizzleDb()

  const row = db
    .select({ platformUserId: users.platformUserId })
    .from(users)
    .where(and(eq(users.platformUserId, userId), eq(users.platformInstanceId, platformInstanceId)))
    .get()

  return row !== undefined
}

export function resolveUserByUsername(userId: string, username: string, platformInstanceId: string): boolean {
  log.debug({ platformInstanceId }, 'resolveUserByUsername called')
  const db = getDrizzleDb()

  const row = db
    .select({ platformUserId: users.platformUserId })
    .from(users)
    .where(and(eq(users.username, username), eq(users.platformInstanceId, platformInstanceId)))
    .get()

  if (row === undefined) return false
  if (row.platformUserId === userId) return true

  db.update(users)
    .set({ platformUserId: userId })
    .where(and(eq(users.username, username), eq(users.platformInstanceId, platformInstanceId)))
    .run()

  log.info('User platform_user_id resolved from username')
  return true
}

export function listUsers(...args: [] | [platformInstanceId: string]): UserRecord[] {
  const platformInstanceId = args[0]
  log.debug({ platformInstanceId }, 'listUsers called')
  const db = getDrizzleDb()
  const query = db
    .select({
      platform_user_id: users.platformUserId,
      platform_instance_id: users.platformInstanceId,
      username: users.username,
      added_at: users.addedAt,
      added_by: users.addedBy,
    })
    .from(users)

  if (platformInstanceId === undefined) return query.all()
  return query.where(eq(users.platformInstanceId, platformInstanceId)).all()
}

export function isDemoUser(userId: string): boolean {
  log.debug({ userId }, 'isDemoUser called')
  const db = getDrizzleDb()
  const row = db.select({ addedBy: users.addedBy }).from(users).where(eq(users.platformUserId, userId)).get()
  return row === undefined ? false : row.addedBy === 'demo-auto'
}

export function getKaneoWorkspace(userId: string): string | null {
  log.debug('getKaneoWorkspace called')
  return getCachedWorkspace(userId)
}

export function setKaneoWorkspace(userId: string, workspaceId: string): void {
  log.debug('setKaneoWorkspace called')
  setCachedWorkspace(userId, workspaceId)
  log.info('Kaneo workspace ID stored (DB sync in background)')
}
