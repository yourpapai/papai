// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'
import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const platformInstances = sqliteTable('platform_instances', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  config: text('config').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const taskInstances = sqliteTable('task_instances', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  config: text('config').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const contextSettings = sqliteTable(
  'context_settings',
  {
    contextId: text('context_id').primaryKey(),
    taskInstanceId: text('task_instance_id')
      .notNull()
      .references(() => taskInstances.id, { onDelete: 'cascade' }),
    platformInstanceId: text('platform_instance_id')
      .notNull()
      .references(() => platformInstances.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('idx_context_settings_task_instance').on(table.taskInstanceId),
    index('idx_context_settings_platform_instance').on(table.platformInstanceId),
  ],
)

export const superAdmins = sqliteTable('super_admins', {
  userId: text('user_id').primaryKey(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const platformAdmins = sqliteTable(
  'platform_admins',
  {
    userId: text('user_id').notNull(),
    platformInstanceId: text('platform_instance_id')
      .notNull()
      .references(() => platformInstances.id, { onDelete: 'cascade' }),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.platformInstanceId] })],
)

export type PlatformInstanceRow = typeof platformInstances.$inferSelect
export type TaskInstanceRow = typeof taskInstances.$inferSelect
export type ContextSettingsRow = typeof contextSettings.$inferSelect
export type SuperAdminRow = typeof superAdmins.$inferSelect
export type PlatformAdminRow = typeof platformAdmins.$inferSelect
