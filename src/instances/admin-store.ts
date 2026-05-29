// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { platformAdmins, superAdmins } from '../db/schema.js'
import { logger } from '../logger.js'
import type { AdminRecord } from './types.js'

const log = logger.child({ scope: 'instances:admin-store' })

export const SUPER_ADMIN_PLATFORM_ID = '__super__'

const superRowToRecord = (row: typeof superAdmins.$inferSelect): AdminRecord => ({
  userId: row.userId,
  platformInstanceId: SUPER_ADMIN_PLATFORM_ID,
  createdAt: row.createdAt,
})

const platformRowToRecord = (row: typeof platformAdmins.$inferSelect): AdminRecord => ({
  userId: row.userId,
  platformInstanceId: row.platformInstanceId,
  createdAt: row.createdAt,
})

export const addAdmin = (userId: string, platformInstanceId: string): void => {
  if (platformInstanceId === SUPER_ADMIN_PLATFORM_ID) {
    getDrizzleDb().insert(superAdmins).values({ userId }).onConflictDoNothing({ target: superAdmins.userId }).run()
  } else {
    getDrizzleDb()
      .insert(platformAdmins)
      .values({ userId, platformInstanceId })
      .onConflictDoNothing({ target: [platformAdmins.userId, platformAdmins.platformInstanceId] })
      .run()
  }
  log.info({ userId, platformInstanceId }, 'admin added')
}

export const removeAdmin = (userId: string, platformInstanceId: string): void => {
  if (platformInstanceId === SUPER_ADMIN_PLATFORM_ID) {
    getDrizzleDb().delete(superAdmins).where(eq(superAdmins.userId, userId)).run()
  } else {
    getDrizzleDb()
      .delete(platformAdmins)
      .where(and(eq(platformAdmins.userId, userId), eq(platformAdmins.platformInstanceId, platformInstanceId)))
      .run()
  }
  log.info({ userId, platformInstanceId }, 'admin removed')
}

export const isSuperAdmin = (userId: string): boolean =>
  getDrizzleDb()
    .select({ userId: superAdmins.userId })
    .from(superAdmins)
    .where(eq(superAdmins.userId, userId))
    .get() !== undefined

export const isPlatformAdmin = (userId: string, platformInstanceId: string): boolean =>
  getDrizzleDb()
    .select({ userId: platformAdmins.userId })
    .from(platformAdmins)
    .where(and(eq(platformAdmins.userId, userId), eq(platformAdmins.platformInstanceId, platformInstanceId)))
    .get() !== undefined

export const isAdmin = (userId: string, platformInstanceId: string): boolean => {
  if (isSuperAdmin(userId)) return true
  return isPlatformAdmin(userId, platformInstanceId)
}

export const listAdmins = (): AdminRecord[] => {
  const superRows = getDrizzleDb()
    .select()
    .from(superAdmins)
    .all()
    .map((row) => superRowToRecord(row))
  const platformRows = getDrizzleDb()
    .select()
    .from(platformAdmins)
    .all()
    .map((row) => platformRowToRecord(row))
  return [...superRows, ...platformRows]
}

export const listAdminsForPlatform = (platformInstanceId: string): AdminRecord[] => {
  const rows = getDrizzleDb()
    .select()
    .from(platformAdmins)
    .where(eq(platformAdmins.platformInstanceId, platformInstanceId))
    .all()
  return rows.map((row) => platformRowToRecord(row))
}
