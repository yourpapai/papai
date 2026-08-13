// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const contextVaultTokens = sqliteTable(
  'context_vault_tokens',
  {
    configContextId: text('config_context_id').notNull(),
    tokenId: text('token_id').notNull(),
    label: text('label').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at'),
    revokedAt: integer('revoked_at'),
  },
  (t) => [
    primaryKey({ columns: [t.configContextId, t.tokenId] }),
    index('idx_context_vault_tokens_token_hash').on(t.tokenHash),
  ],
)

export type ContextVaultTokenRow = typeof contextVaultTokens.$inferSelect

export const contextVaultSpecs = sqliteTable(
  'context_vault_specs',
  {
    configContextId: text('config_context_id').notNull(),
    id: text('id').notNull(),
    repo: text('repo').notNull(),
    changeName: text('change_name').notNull(),
    oneLine: text('one_line').notNull(),
    summary: text('summary'),
    outline: text('outline'),
    stage: text('stage').notNull(),
    progressPct: integer('progress_pct').notNull(),
    mtime: integer('mtime').notNull(),
    sourceHash: text('source_hash').notNull(),
  },
  (t) => [primaryKey({ columns: [t.configContextId, t.id] })],
)

export type ContextVaultSpecRow = typeof contextVaultSpecs.$inferSelect

export const contextVaultFiles = sqliteTable(
  'context_vault_files',
  {
    configContextId: text('config_context_id').notNull(),
    specId: text('spec_id').notNull(),
    path: text('path').notNull(),
    kind: text('kind').notNull(),
    hash: text('hash').notNull(),
    mtime: integer('mtime').notNull(),
  },
  (t) => [primaryKey({ columns: [t.configContextId, t.specId, t.path] })],
)

export type ContextVaultFileRow = typeof contextVaultFiles.$inferSelect

export const contextVaultIndexerState = sqliteTable('context_vault_indexer_state', {
  configContextId: text('config_context_id').primaryKey(),
  lastPushAt: integer('last_push_at').notNull(),
})

export type ContextVaultIndexerStateRow = typeof contextVaultIndexerState.$inferSelect
