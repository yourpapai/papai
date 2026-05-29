// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const settingsAuthCodes = sqliteTable(
  'settings_auth_codes',
  {
    codeHash: text('code_hash').primaryKey(),
    platformInstanceId: text('platform_instance_id').notNull(),
    platformUserId: text('platform_user_id').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
  },
  (table) => [index('idx_settings_auth_codes_principal').on(table.platformInstanceId, table.platformUserId)],
)

export const settingsSessions = sqliteTable(
  'settings_sessions',
  {
    sessionIdHash: text('session_id_hash').primaryKey(),
    platformInstanceId: text('platform_instance_id').notNull(),
    platformUserId: text('platform_user_id').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    csrfTokenHash: text('csrf_token_hash').notNull(),
  },
  (table) => [index('idx_settings_sessions_principal').on(table.platformInstanceId, table.platformUserId)],
)

export const settingsRateLimit = sqliteTable(
  'settings_rate_limit',
  {
    bucket: text('bucket').notNull(),
    actorId: text('actor_id').notNull(),
    windowStart: integer('window_start').notNull(),
    count: integer('count').notNull(),
  },
  (table) => [primaryKey({ columns: [table.bucket, table.actorId, table.windowStart] })],
)

export type SettingsAuthCodeRow = typeof settingsAuthCodes.$inferSelect
export type SettingsSessionRow = typeof settingsSessions.$inferSelect
