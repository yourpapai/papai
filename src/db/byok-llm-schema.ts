// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const byokLlmCredentials = sqliteTable(
  'byok_llm_credentials',
  {
    contextId: text('context_id').primaryKey(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    encryptedConfig: text('encrypted_config'),
    updatedAt: integer('updated_at').notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  (table) => [index('idx_byok_llm_credentials_updated_at').on(table.updatedAt)],
)

export type ByokLlmCredentialRow = typeof byokLlmCredentials.$inferSelect
