// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { cosineSimilarity } from './semantic-search.js'
import type { MemoryRecord } from './types.js'

const RECALL_SIMILARITY_THRESHOLD = 0.65

export type RankOptions = Readonly<{ threshold?: number; limit?: number }>

const tokenize = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/gu) ?? []

const keywordScore = (query: string, content: string): number => {
  const q = new Set(tokenize(query))
  if (q.size === 0) return 0
  const tokens = tokenize(content)
  let hits = 0
  for (const token of tokens) if (q.has(token)) hits += 1
  return hits / q.size
}

/** @public -- consumed by the recall cascade (Plan 2 T4). */
export function rankCandidatesByQuery(
  records: readonly MemoryRecord[],
  query: string,
  queryEmbedding: readonly number[] | null,
  options: RankOptions,
): readonly MemoryRecord[] {
  const threshold = options.threshold ?? RECALL_SIMILARITY_THRESHOLD
  const limit = options.limit ?? 10

  const scored =
    queryEmbedding === null
      ? records
          .map((record) => ({ record, score: keywordScore(query, record.content) }))
          .filter((entry) => entry.score > 0)
      : records
          .map((record) => ({
            record,
            score: record.embedding ? cosineSimilarity(queryEmbedding, record.embedding) : 0,
          }))
          .filter((entry) => entry.score >= threshold)

  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.record)
}
