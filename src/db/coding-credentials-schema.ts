// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const codingSessionCredentials = sqliteTable(
  'coding_session_credentials',
  {
    contextId: text('context_id').notNull(),
    namespace: text('namespace').notNull(),
    encryptedConfig: text('encrypted_config').notNull(),
    updatedAt: integer('updated_at').notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.contextId, table.namespace] }),
    index('idx_coding_session_credentials_updated_at').on(table.updatedAt),
  ],
)

export type CodingSessionCredentialRow = typeof codingSessionCredentials.$inferSelect
