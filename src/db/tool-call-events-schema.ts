// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const toolCallEvents = sqliteTable(
  'tool_call_events',
  {
    eventId: text('event_id').primaryKey(),
    turnId: text('turn_id').notNull(),
    occurredAt: integer('occurred_at').notNull(),
    storageContextId: text('storage_context_id').notNull(),
    contextType: text('context_type').notNull(),
    chatUserId: text('chat_user_id').notNull(),
    model: text('model').notNull(),
    modelRole: text('model_role').notNull(),
    toolName: text('tool_name').notNull(),
    toolCallId: text('tool_call_id').notNull(),
    success: integer('success').notNull(),
    durationMs: integer('duration_ms'),
    errorType: text('error_type'),
    errorCode: text('error_code'),
    retryable: integer('retryable'),
    recovered: integer('recovered'),
    argsBytes: integer('args_bytes'),
    resultBytes: integer('result_bytes'),
    responseId: text('response_id'),
    forwardedAt: integer('forwarded_at'),
    forwardAttempts: integer('forward_attempts').notNull().default(0),
    forwardError: text('forward_error'),
  },
  (table) => [
    index('idx_tool_call_subject').on(table.storageContextId, table.occurredAt),
    index('idx_tool_call_chat_user').on(table.chatUserId, table.occurredAt),
    index('idx_tool_call_turn').on(table.turnId),
    index('idx_tool_call_tool').on(table.toolName, table.occurredAt),
  ],
)

export type ToolCallEventRow = typeof toolCallEvents.$inferSelect
