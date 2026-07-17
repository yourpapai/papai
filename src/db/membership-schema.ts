// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const taskProviderMembers = sqliteTable(
  'task_provider_members',
  {
    groupContextId: text('group_context_id').notNull(),
    chatUserId: text('chat_user_id').notNull(),
    providerName: text('provider_name').notNull().default('kaneo'),
    providerUserId: text('provider_user_id').notNull(),
    login: text('login').notNull(),
    status: text('status', { enum: ['active', 'inactive', 'failed'] })
      .notNull()
      .default('active'),
    encryptedPassword: text('encrypted_password'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.groupContextId, table.chatUserId, table.providerName] })],
)

export type TaskProviderMember = typeof taskProviderMembers.$inferSelect
