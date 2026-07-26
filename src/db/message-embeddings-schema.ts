// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { blob, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const messageEmbeddings = sqliteTable(
  'message_embeddings',
  {
    contextId: text('context_id').notNull(),
    messageId: text('message_id').notNull(),
    embedding: blob('embedding'),
    embeddingModel: text('embedding_model'),
    embeddingDim: integer('embedding_dim'),
    embeddedAt: text('embedded_at'),
  },
  (table) => [primaryKey({ columns: [table.contextId, table.messageId] })],
)
