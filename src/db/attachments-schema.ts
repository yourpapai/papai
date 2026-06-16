// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const attachments = sqliteTable(
  'attachments',
  {
    attachmentId: text('attachment_id').primaryKey(),
    contextId: text('context_id').notNull(),
    groupContextId: text('group_context_id'),
    sourceProvider: text('source_provider').notNull(),
    sourceMessageId: text('source_message_id'),
    sourceFileId: text('source_file_id'),
    filename: text('filename').notNull(),
    mimeType: text('mime_type'),
    size: integer('size'),
    checksum: text('checksum').notNull(),
    blobKey: text('blob_key').notNull(),
    status: text('status').notNull(),
    isActive: integer('is_active').notNull().default(1),
    createdAt: text('created_at').notNull(),
    clearedAt: text('cleared_at'),
    lastUsedAt: text('last_used_at'),
    origin: text('origin'),
    forwardedFrom: text('forwarded_from'),
  },
  (table) => [
    index('idx_attachments_context_active').on(table.contextId, table.isActive, table.createdAt),
    index('idx_attachments_context_checksum').on(table.contextId, table.checksum),
  ],
)
