import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

export const stagedFiles = sqliteTable(
  'staged_files',
  {
    stagedId: text('staged_id').primaryKey(),
    contextId: text('context_id').notNull(),
    messageId: text('message_id'),
    senderId: text('sender_id').notNull(),
    senderUsername: text('sender_username'),
    filename: text('filename').notNull(),
    mimeType: text('mime_type'),
    size: integer('size'),
    platformFileId: text('platform_file_id').notNull(),
    sourceProvider: text('source_provider').notNull(),
    status: text('status').notNull().default('staged'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    index('idx_staged_context_sender').on(table.contextId, table.senderId, table.expiresAt),
    index('idx_staged_context_message').on(table.contextId, table.messageId),
    index('idx_staged_expires_at').on(table.expiresAt),
  ],
)
export type StagedFileRow = typeof stagedFiles.$inferSelect
