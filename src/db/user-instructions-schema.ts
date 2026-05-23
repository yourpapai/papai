// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const userInstructions = sqliteTable(
  'user_instructions',
  {
    id: text('id').primaryKey(),
    contextId: text('context_id').notNull(),
    text: text('text').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_user_instructions_context').on(table.contextId)],
)

export type UserInstruction = typeof userInstructions.$inferSelect
