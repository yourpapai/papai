// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { getScopeKey } from '../chat/context-scope.js'
import type { ContextType } from '../chat/types.js'
import { logger } from '../logger.js'
import { searchMessages, type MessageScope, type SearchFilters } from '../message-cache/store.js'

const log = logger.child({ scope: 'tool:search-chat-history' })

const toScope = (storageContextId: string, chatUserId: string, contextType: ContextType): MessageScope =>
  contextType === 'group'
    ? { kind: 'group', groupContextId: getScopeKey('group', { storageContextId, chatUserId, contextType }) }
    : { kind: 'dm', contextId: storageContextId }

type SearchChatHistoryInput = Readonly<{
  query: string
  limit: number
  author?: string | undefined
  contextId?: string | undefined
  since?: string | undefined
  until?: string | undefined
}>

type SearchChatHistoryOutput = { results: unknown[]; total: number; mode: 'keyword'; hasMore: boolean }

function executeSearch(
  scope: MessageScope,
  { query, limit, author, contextId, since, until }: SearchChatHistoryInput,
): SearchChatHistoryOutput {
  log.debug({ query, limit, author, contextId, since, until }, 'search_chat_history called')
  const filters: SearchFilters = {
    ...(author === undefined ? {} : { author }),
    ...(contextId === undefined ? {} : { contextId }),
    ...(since === undefined ? {} : { since: Date.parse(since) }),
    ...(until === undefined ? {} : { until: Date.parse(until) }),
  }
  const results = searchMessages(scope, query, filters, limit).map((m) => ({
    messageId: m.messageId,
    authorUsername: m.authorUsername ?? null,
    text: m.text ?? '',
    timestamp: m.timestamp,
    contextId: m.contextId,
    ...(m.replyToMessageId === undefined ? {} : { replyToMessageId: m.replyToMessageId }),
  }))
  log.info({ resultCount: results.length }, 'search_chat_history completed')
  return { results, total: results.length, mode: 'keyword', hasMore: results.length === limit }
}

export function makeSearchChatHistoryTool(
  chatUserId: string,
  storageContextId: string,
  contextType: ContextType,
): Tool {
  const scope = toScope(storageContextId, chatUserId, contextType)
  return tool({
    description:
      'Search past chat messages in this context by keyword. Use to recall decisions, find who said what, or locate a prior discussion. Returns matching messages with author, text, timestamp, and thread contextId.',
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe('Search query. Multi-word queries match the exact phrase; use single keywords for broader matching.'),
      limit: z.number().int().min(1).max(20).default(5).describe('Max results (default 5, max 20)'),
      author: z.string().optional().describe('Filter by author username or id'),
      contextId: z
        .string()
        .optional()
        .describe('Narrow to one thread-scoped context within the group (from a prior result)'),
      since: z.iso.datetime().optional().describe('ISO8601 lower bound (exclusive) on message time'),
      until: z.iso.datetime().optional().describe('ISO8601 upper bound (exclusive) on message time'),
    }),
    execute: (input): SearchChatHistoryOutput => executeSearch(scope, input),
  })
}
