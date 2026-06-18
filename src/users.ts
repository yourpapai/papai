// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm'

import { evictUser } from './cache.js'
import { toScopedContextId } from './chat/scoped-context.js'
import { getDrizzleDb } from './db/drizzle.js'
import { recurringTaskOccurrences, recurringTasks, users } from './db/schema.js'
import { isAdmin } from './instances/admin-store.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'users' })

const scopedUserContextId = (platformInstanceId: string, userId: string): string =>
  toScopedContextId({ platformInstanceId, nativeContextId: userId })

const isPlaceholderUserId = (userId: string): boolean => userId.startsWith('placeholder-')

export interface UserRecord {
  platform_user_id: string
  platform_instance_id: string
  username: string | null
  added_at: string
  added_by: string
  blocked_at: string | null
}

type AddUserInputWithoutUsername = Readonly<Record<never, never>>

export type AddUserInput = Readonly<{
  userId: string
  platformInstanceId: string
  addedBy: string
}> &
  (Readonly<{ username: string | undefined }> | AddUserInputWithoutUsername)

export type AddPendingUserInput = Readonly<{
  username: string
  platformInstanceId: string
  addedBy: string
}>

export type AddPendingUserResult = 'created' | 'pending_exists' | 'already_resolved' | 'invalid'

const usernameMatchesInsensitive = (username: string): SQL => sql`lower(${users.username}) = ${username.toLowerCase()}`

/**
 * Authorize a user the platform cannot resolve to an ID yet (e.g. Telegram @username).
 * Stores a placeholder row that resolveUserByUsername() rebinds on first DM contact.
 */
export function addPendingUser(input: AddPendingUserInput): AddPendingUserResult {
  const stripped = input.username.startsWith('@') ? input.username.slice(1) : input.username
  const username = stripped.trim()
  if (username === '') {
    log.warn({ platformInstanceId: input.platformInstanceId }, 'addPendingUser called with empty username')
    return 'invalid'
  }
  const db = getDrizzleDb()
  const existing = db
    .select({ platformUserId: users.platformUserId })
    .from(users)
    .where(and(eq(users.platformInstanceId, input.platformInstanceId), usernameMatchesInsensitive(username)))
    .get()
  if (existing !== undefined) {
    if (isPlaceholderUserId(existing.platformUserId)) {
      log.info({ platformInstanceId: input.platformInstanceId }, 'Pending user already present')
      return 'pending_exists'
    }
    log.info({ platformInstanceId: input.platformInstanceId }, 'Username already held by resolved user')
    return 'already_resolved'
  }
  db.insert(users)
    .values({
      platformUserId: `placeholder-${crypto.randomUUID()}`,
      platformInstanceId: input.platformInstanceId,
      username,
      addedBy: input.addedBy,
    })
    .run()
  log.info({ platformInstanceId: input.platformInstanceId }, 'Pending user added')
  return 'created'
}

export function addUser(input: AddUserInput): void {
  const username = 'username' in input && input.username !== undefined ? input.username : null
  log.debug({ platformInstanceId: input.platformInstanceId, hasUsername: username !== null }, 'addUser called')
  const db = getDrizzleDb()

  if (username !== null) {
    const existing = db
      .select({ platformUserId: users.platformUserId })
      .from(users)
      .where(and(eq(users.platformInstanceId, input.platformInstanceId), eq(users.username, username)))
      .get()
    if (existing !== undefined) {
      log.info({ platformInstanceId: input.platformInstanceId, hasUsername: true }, 'User already added')
      return
    }
  }

  db.insert(users)
    .values({
      platformUserId: input.userId,
      platformInstanceId: input.platformInstanceId,
      username,
      addedBy: input.addedBy,
    })
    .onConflictDoUpdate({
      target: [users.platformInstanceId, users.platformUserId],
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
      and(
        eq(users.platformInstanceId, platformInstanceId),
        or(eq(users.username, identifier), eq(users.platformUserId, identifier)),
      ),
    )
    .returning({ platformUserId: users.platformUserId })
    .all()

  const removed = deleted.length > 0
  if (removed) {
    const deletedIds = deleted.map((row) => scopedUserContextId(platformInstanceId, row.platformUserId))
    db.delete(recurringTaskOccurrences)
      .where(
        inArray(
          recurringTaskOccurrences.templateId,
          db.select({ id: recurringTasks.id }).from(recurringTasks).where(inArray(recurringTasks.userId, deletedIds)),
        ),
      )
      .run()
    db.delete(recurringTasks).where(inArray(recurringTasks.userId, deletedIds)).run()
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
    .select({ platformUserId: users.platformUserId, platformInstanceId: users.platformInstanceId })
    .from(users)
    .where(and(usernameMatchesInsensitive(username), eq(users.platformInstanceId, platformInstanceId)))
    .get()

  if (row === undefined) return false
  if (row.platformUserId === userId) return true
  if (!isPlaceholderUserId(row.platformUserId)) return false

  db.update(users)
    .set({ platformUserId: userId })
    .where(and(eq(users.platformInstanceId, row.platformInstanceId), eq(users.platformUserId, row.platformUserId)))
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
      blocked_at: users.blockedAt,
    })
    .from(users)

  if (platformInstanceId === undefined) return query.all()
  return query.where(eq(users.platformInstanceId, platformInstanceId)).all()
}

export function blockUser(userId: string, platformInstanceId: string): boolean {
  log.debug({ platformInstanceId }, 'blockUser called')
  const db = getDrizzleDb()
  const updated = db
    .update(users)
    .set({ blockedAt: sql`(datetime('now'))` })
    .where(and(eq(users.platformUserId, userId), eq(users.platformInstanceId, platformInstanceId)))
    .returning({ platformUserId: users.platformUserId })
    .all()
  if (updated.length > 0) evictUser(userId)
  return updated.length > 0
}

export function unblockUser(userId: string, platformInstanceId: string): boolean {
  log.debug({ platformInstanceId }, 'unblockUser called')
  const db = getDrizzleDb()
  const updated = db
    .update(users)
    .set({ blockedAt: null })
    .where(and(eq(users.platformUserId, userId), eq(users.platformInstanceId, platformInstanceId)))
    .returning({ platformUserId: users.platformUserId })
    .all()
  if (updated.length > 0) evictUser(userId)
  return updated.length > 0
}

export function isBlocked(userId: string, platformInstanceId: string): boolean {
  log.debug({ platformInstanceId }, 'isBlocked called')
  const db = getDrizzleDb()
  const row = db
    .select({ blockedAt: users.blockedAt })
    .from(users)
    .where(and(eq(users.platformUserId, userId), eq(users.platformInstanceId, platformInstanceId)))
    .get()
  return row !== undefined && row.blockedAt !== null
}
