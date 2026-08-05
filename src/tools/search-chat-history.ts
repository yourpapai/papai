// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { getScopeKey } from '../chat/context-scope.js'
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { ContextType } from '../chat/types.js'
import { getEmbeddingForContext, type EmbeddingCallContext } from '../embeddings.js'
import { logger } from '../logger.js'
import {
  type SearchFilters,
  type MessageScope,
  type CachedMessage,
  searchMessages,
  getMessage,
} from '../message-cache/index.js'
import { searchKnn } from '../message-cache/vector-store.js'

const log = logger.child({ scope: 'tool:search-chat-history' })

const toScope = (storageContextId: string, chatUserId: string, contextType: ContextType): MessageScope =>
  contextType === 'group'
    ? { kind: 'group', groupContextId: getScopeKey('group', { storageContextId, chatUserId, contextType }) }
    : { kind: 'dm', contextId: storageContextId }

type SearchMode = 'keyword' | 'semantic' | 'auto'
type ResultMode = 'keyword' | 'semantic' | 'keyword_fallback' | 'semantic_unavailable'

type SearchChatHistoryInput = Readonly<{
  query: string
  limit: number
  mode: SearchMode
  author?: string | undefined
  contextId?: string | undefined
  since?: string | undefined
  until?: string | undefined
}>

type ResultRow = {
  messageId: string
  authorUsername: string | null
  text: string
  timestamp: number
  contextId: string
  replyToMessageId?: string
  score?: number
}

type SearchChatHistoryOutput = {
  results: ResultRow[]
  total: number
  mode: ResultMode
  hasMore: boolean
}

const toFilters = ({
  author,
  contextId,
  since,
  until,
}: Omit<SearchChatHistoryInput, 'query' | 'limit' | 'mode'>): SearchFilters => ({
  ...(author === undefined ? {} : { author }),
  ...(contextId === undefined ? {} : { contextId }),
  ...(since === undefined ? {} : { since: Date.parse(since) }),
  ...(until === undefined ? {} : { until: Date.parse(until) }),
})

const toResultRow = (m: CachedMessage, score?: number): ResultRow => ({
  messageId: m.messageId,
  authorUsername: m.authorUsername ?? null,
  text: m.text ?? '',
  timestamp: m.timestamp,
  contextId: m.contextId,
  ...(m.replyToMessageId === undefined ? {} : { replyToMessageId: m.replyToMessageId }),
  ...(score === undefined ? {} : { score }),
})

function doKeywordSearch(
  scope: MessageScope,
  input: SearchChatHistoryInput,
  mode: ResultMode,
): SearchChatHistoryOutput {
  const results = searchMessages(scope, input.query, toFilters(input), input.limit).map((m) => toResultRow(m))
  log.info({ resultCount: results.length, mode }, 'keyword search completed')
  return { results, total: results.length, mode, hasMore: results.length === input.limit }
}

/** Turn KNN ids+scores into full message rows via the scope-checked store. */
function resolveRows(scope: MessageScope, knn: { messageId: string; score: number }[]): ResultRow[] {
  return knn
    .map(({ messageId, score }) => {
      const m = getMessage(scope, messageId)
      return m === undefined ? null : toResultRow(m, score)
    })
    .filter((r): r is ResultRow => r !== null)
}

function doSemanticSearch(
  scope: MessageScope,
  input: SearchChatHistoryInput,
  queryVec: number[],
): SearchChatHistoryOutput {
  const rows = resolveRows(scope, searchKnn(queryVec, scope, toFilters(input), input.limit))
  log.info({ resultCount: rows.length, mode: 'semantic' }, 'semantic search completed')
  return { results: rows, total: rows.length, mode: 'semantic', hasMore: rows.length === input.limit }
}

async function executeSearch(
  scope: MessageScope,
  configContextId: string,
  embeddingCtx: EmbeddingCallContext,
  input: SearchChatHistoryInput,
): Promise<SearchChatHistoryOutput> {
  log.debug(
    { queryLengthChars: input.query.length, mode: input.mode, limit: input.limit },
    'search_chat_history called',
  )
  if (input.mode === 'keyword') return doKeywordSearch(scope, input, 'keyword')

  const queryVec = await getEmbeddingForContext(input.query, configContextId, embeddingCtx)
  if (queryVec === null) {
    if (input.mode === 'semantic') {
      log.info('semantic unavailable; no embedding model resolved')
      return { results: [], total: 0, mode: 'semantic_unavailable', hasMore: false }
    }
    return doKeywordSearch(scope, input, 'keyword_fallback')
  }

  if (input.mode === 'semantic') return doSemanticSearch(scope, input, queryVec)

  const semantic = doSemanticSearch(scope, input, queryVec)
  if (semantic.results.length > 0) return semantic
  return doKeywordSearch(scope, input, 'keyword_fallback')
}

export function makeSearchChatHistoryTool(
  chatUserId: string,
  storageContextId: string,
  contextType: ContextType,
): Tool {
  const scope = toScope(storageContextId, chatUserId, contextType)
  const configContextId = getConfigContextIdFromStorageContextId(storageContextId)
  const embeddingCtx: EmbeddingCallContext = { storageContextId, contextType, chatUserId }
  return tool({
    description:
      'Search past chat messages in this context by keyword (exact) or meaning (semantic). ' +
      'Use mode "auto" (default) for semantic-first with keyword fallback, "keyword" for exact FTS5, ' +
      'or "semantic" for meaning-only. Use to recall decisions, find who said what, or locate prior discussion.',
    inputSchema: z.object({
      query: z.string().min(1).describe('Search query. In keyword mode multi-word queries match the exact phrase.'),
      mode: z
        .enum(['keyword', 'semantic', 'auto'])
        .default('auto')
        .describe('keyword = exact FTS5; semantic = embedding similarity; auto = semantic-first with keyword fallback'),
      limit: z.number().int().min(1).max(20).default(5).describe('Max results (default 5, max 20)'),
      author: z.string().optional().describe('Filter by author username or id'),
      contextId: z
        .string()
        .optional()
        .describe('Narrow to one thread-scoped context within the group (from a prior result)'),
      since: z.iso.datetime().optional().describe('ISO8601 lower bound (exclusive) on message time'),
      until: z.iso.datetime().optional().describe('ISO8601 upper bound (exclusive) on message time'),
    }),
    execute: (input: SearchChatHistoryInput): Promise<SearchChatHistoryOutput> =>
      executeSearch(scope, configContextId, embeddingCtx, input),
  })
}
