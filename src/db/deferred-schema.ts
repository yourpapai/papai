// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const scheduledPrompts = sqliteTable(
  'scheduled_prompts',
  {
    id: text('id').primaryKey(),
    createdByUserId: text('created_by_user_id').notNull(),
    createdByUsername: text('created_by_username'),
    deliveryContextId: text('delivery_context_id'),
    deliveryContextType: text('delivery_context_type'),
    deliveryThreadId: text('delivery_thread_id'),
    audience: text('audience').notNull().default('personal'),
    mentionUserIds: text('mention_user_ids').notNull().default('[]'),
    prompt: text('prompt').notNull(),
    fireAt: text('fire_at').notNull(),
    rrule: text('rrule'),
    dtstartUtc: text('dtstart_utc'),
    timezone: text('timezone'),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    lastExecutedAt: text('last_executed_at'),
    executionMetadata: text('execution_metadata').notNull().default('{}'),
  },
  (table) => [
    index('idx_scheduled_prompts_creator').on(table.createdByUserId),
    index('idx_scheduled_prompts_status_fire').on(table.status, table.fireAt),
  ],
)

export const alertPrompts = sqliteTable(
  'alert_prompts',
  {
    id: text('id').primaryKey(),
    createdByUserId: text('created_by_user_id').notNull(),
    createdByUsername: text('created_by_username'),
    deliveryContextId: text('delivery_context_id'),
    deliveryContextType: text('delivery_context_type'),
    deliveryThreadId: text('delivery_thread_id'),
    audience: text('audience').notNull().default('personal'),
    mentionUserIds: text('mention_user_ids').notNull().default('[]'),
    prompt: text('prompt').notNull(),
    condition: text('condition').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    lastTriggeredAt: text('last_triggered_at'),
    cooldownMinutes: integer('cooldown_minutes').notNull().default(60),
    executionMetadata: text('execution_metadata').notNull().default('{}'),
  },
  (table) => [
    index('idx_alert_prompts_creator').on(table.createdByUserId),
    index('idx_alert_prompts_status').on(table.status),
  ],
)

export const taskSnapshots = sqliteTable(
  'task_snapshots',
  {
    userId: text('user_id').notNull(),
    taskId: text('task_id').notNull(),
    field: text('field').notNull(),
    value: text('value').notNull(),
    capturedAt: text('captured_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.taskId, table.field] }),
    index('idx_task_snapshots_user').on(table.userId),
  ],
)

export type ScheduledPromptRow = typeof scheduledPrompts.$inferSelect
export type AlertPromptRow = typeof alertPrompts.$inferSelect
