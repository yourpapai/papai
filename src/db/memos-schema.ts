// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'
import { blob, index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const memos = sqliteTable(
  'memos',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    content: text('content').notNull(),
    summary: text('summary'),
    tags: text('tags').notNull().default('[]'),
    embedding: blob('embedding'),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_memos_user_status_created').on(table.userId, table.status, table.createdAt)],
)

export const memoLinks = sqliteTable(
  'memo_links',
  {
    id: text('id').primaryKey(),
    sourceMemoId: text('source_memo_id').notNull(),
    targetMemoId: text('target_memo_id'),
    targetTaskId: text('target_task_id'),
    relationType: text('relation_type').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_memo_links_source').on(table.sourceMemoId),
    index('idx_memo_links_target_memo').on(table.targetMemoId),
  ],
)
