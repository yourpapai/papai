// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const stagedFiles = sqliteTable(
  'staged_files',
  {
    stagedId: text('staged_id').primaryKey(),
    contextId: text('context_id').notNull(),
    groupContextId: text('group_context_id'),
    messageId: text('message_id'),
    senderId: text('sender_id').notNull(),
    senderUsername: text('sender_username'),
    filename: text('filename').notNull(),
    mimeType: text('mime_type'),
    size: integer('size'),
    platformFileId: text('platform_file_id').notNull(),
    sourceProvider: text('source_provider').notNull(),
    sourcePlatformInstanceId: text('source_platform_instance_id').notNull().default(''),
    status: text('status').notNull().default('staged'),
    attachmentId: text('attachment_id'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    origin: text('origin'),
    forwardedFrom: text('forwarded_from'),
  },
  (table) => [
    index('idx_staged_context_sender').on(table.contextId, table.senderId, table.expiresAt),
    index('idx_staged_context_message').on(table.contextId, table.messageId),
    index('idx_staged_expires_at').on(table.expiresAt),
    uniqueIndex('idx_staged_platform_context').on(table.platformFileId, table.contextId),
  ],
)
export type StagedFileRow = typeof stagedFiles.$inferSelect
