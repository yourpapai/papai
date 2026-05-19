// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool, cosineSimilarity } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { tryGetEmbedding } from '../embeddings.js'
import { logger } from '../logger.js'
import type { Memo } from '../memos.js'
import { keywordSearchMemos, loadEmbeddingsForUser, getMemo } from '../memos.js'
import { getSystemConfig } from '../system-config.js'

const log = logger.child({ scope: 'tool:memo' })

const SIMILARITY_THRESHOLD = 0.65
const DEFAULT_LIMIT = 5

type SearchResult = { results: readonly (Memo & { score?: number })[]; mode: string }

function trySemanticSearch(userId: string, queryVec: number[], limit: number): readonly (Memo & { score: number })[] {
  const stored = loadEmbeddingsForUser(userId)
  if (stored.length === 0) return []

  const scored = stored
    .map((r) => ({ id: r.id, score: cosineSimilarity(queryVec, Array.from(r.embedding)) }))
    .filter((r) => r.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return scored
    .map((s) => {
      const memo = getMemo(userId, s.id)
      return memo === null ? null : { ...memo, score: s.score }
    })
    .filter((r): r is Memo & { score: number } => r !== null)
}

export function makeSearchMemosTool(userId: string): ToolSet[string] {
  return tool({
    description:
      'Search personal notes by keyword or meaning. Use "auto" mode (default) to try semantic search first and fall back to keyword search.',
    inputSchema: z.object({
      query: z.string().min(1).describe('The search query'),
      mode: z
        .enum(['keyword', 'semantic', 'auto'])
        .default('auto')
        .describe('Search mode: keyword (FTS5), semantic (embedding similarity), or auto'),
      limit: z.number().int().min(1).max(20).default(DEFAULT_LIMIT).describe('Maximum number of results'),
    }),
    execute: async ({ query, mode, limit }): Promise<SearchResult> => {
      log.debug({ userId, query, mode, limit }, 'search_memos called')

      if (mode === 'keyword') {
        return doKeywordSearch(userId, query, limit, 'keyword')
      }

      const semantic = await trySemanticMode(userId, query, limit)

      if (semantic.available) {
        if (mode === 'semantic' || semantic.result.results.length > 0) {
          return semantic.result
        }
        return doKeywordSearch(userId, query, limit, 'keyword_fallback')
      }

      if (mode === 'semantic') {
        log.warn({ userId, query }, 'Semantic search unavailable')
        return { results: [], mode: 'semantic' }
      }

      return doKeywordSearch(userId, query, limit, 'keyword_fallback')
    },
  })
}

function doKeywordSearch(userId: string, query: string, limit: number, mode: string): SearchResult {
  const results = keywordSearchMemos(userId, query, limit)
  log.info({ userId, query, mode, resultCount: results.length }, 'Keyword search completed')
  return { results, mode }
}

async function trySemanticMode(
  userId: string,
  query: string,
  limit: number,
): Promise<{ available: true; result: SearchResult } | { available: false }> {
  const apiKey = getSystemConfig('llm_apikey')
  const baseUrl = getSystemConfig('llm_baseurl')
  const embeddingModel = getSystemConfig('embedding_model')
  if (apiKey === null || baseUrl === null || embeddingModel === null) return { available: false }

  const queryVec = await tryGetEmbedding(query, apiKey, baseUrl, embeddingModel)
  if (queryVec === null) return { available: false }

  const results = trySemanticSearch(userId, queryVec, limit)
  log.info({ userId, query, mode: 'semantic', resultCount: results.length }, 'Semantic search completed')
  return { available: true, result: { results, mode: 'semantic' } }
}
