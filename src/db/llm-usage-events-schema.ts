// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

export const llmUsageEvents = sqliteTable(
  'llm_usage_events',
  {
    eventId: text('event_id').primaryKey(),
    occurredAt: integer('occurred_at').notNull(),
    turnId: text('turn_id'),
    storageContextId: text('storage_context_id').notNull(),
    contextType: text('context_type').notNull(),
    chatUserId: text('chat_user_id').notNull(),
    model: text('model').notNull(),
    modelRole: text('model_role').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    stepCount: integer('step_count').notNull().default(0),
    toolCallCount: integer('tool_call_count').notNull().default(0),
    messageCount: integer('message_count').notNull().default(0),
    finishReason: text('finish_reason'),
    durationMs: integer('duration_ms').notNull(),
    responseId: text('response_id'),
    error: text('error'),
    forwardedAt: integer('forwarded_at'),
    forwardAttempts: integer('forward_attempts').notNull().default(0),
    forwardError: text('forward_error'),
  },
  (table) => [
    index('idx_llm_usage_subject').on(table.storageContextId, table.occurredAt),
    index('idx_llm_usage_chat_user').on(table.chatUserId, table.occurredAt),
    index('idx_llm_usage_turn').on(table.turnId),
    index('idx_llm_usage_occurred').on(table.occurredAt),
  ],
)

export type LlmUsageEventRow = typeof llmUsageEvents.$inferSelect
