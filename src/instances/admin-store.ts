// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, or } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { admins } from '../db/schema.js'
import { logger } from '../logger.js'
import type { AdminRecord } from './types.js'

const log = logger.child({ scope: 'instances:admin-store' })

export const SUPER_ADMIN_PLATFORM_ID = '__super__'

const rowToRecord = (row: typeof admins.$inferSelect): AdminRecord => ({
  userId: row.userId,
  platformInstanceId: row.platformInstanceId,
  createdAt: row.createdAt,
})

export const addAdmin = (userId: string, platformInstanceId: string): void => {
  getDrizzleDb()
    .insert(admins)
    .values({ userId, platformInstanceId })
    .onConflictDoNothing({ target: [admins.userId, admins.platformInstanceId] })
    .run()
  log.info({ userId, platformInstanceId }, 'admin added')
}

export const removeAdmin = (userId: string, platformInstanceId: string): void => {
  getDrizzleDb()
    .delete(admins)
    .where(and(eq(admins.userId, userId), eq(admins.platformInstanceId, platformInstanceId)))
    .run()
  log.info({ userId, platformInstanceId }, 'admin removed')
}

const hasAdminRow = (userId: string, platformInstanceId: string): boolean => {
  const row = getDrizzleDb()
    .select({ userId: admins.userId })
    .from(admins)
    .where(and(eq(admins.userId, userId), eq(admins.platformInstanceId, platformInstanceId)))
    .get()
  return row !== undefined
}

export const isSuperAdmin = (userId: string): boolean => hasAdminRow(userId, SUPER_ADMIN_PLATFORM_ID)

export const isPlatformAdmin = (userId: string, platformInstanceId: string): boolean =>
  hasAdminRow(userId, platformInstanceId)

export const isAdmin = (userId: string, platformInstanceId: string): boolean => {
  const row = getDrizzleDb()
    .select({ userId: admins.userId })
    .from(admins)
    .where(
      and(
        eq(admins.userId, userId),
        or(eq(admins.platformInstanceId, SUPER_ADMIN_PLATFORM_ID), eq(admins.platformInstanceId, platformInstanceId)),
      ),
    )
    .get()
  return row !== undefined
}

export const listAdminsForPlatform = (platformInstanceId: string): AdminRecord[] => {
  const rows = getDrizzleDb().select().from(admins).where(eq(admins.platformInstanceId, platformInstanceId)).all()
  return rows.map((row) => rowToRecord(row))
}
