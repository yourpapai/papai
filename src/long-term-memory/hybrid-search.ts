// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { fuseByRank } from './fusion.js'
import { searchLexical } from './lexical-search.js'
import { rankRecordsBySimilarity } from './semantic-search.js'
import type { MemoryKind, MemoryRecord, MemoryScope, MemoryStatus } from './types.js'

export type HybridSearchInput = MemoryScope &
  Readonly<{
    query: string
    queryEmbedding: readonly number[] | null
    /** Identity of the querying config context; null disables the dense channel. */
    embeddingVersion: string | null
    statuses: readonly MemoryStatus[]
    kind?: MemoryKind
    threadContextId?: string
    excludeThreadContextId?: string
    limit: number
    now?: string
  }>

/**
 * Runs the lexical and dense channels independently and fuses them by rank.
 * Neither channel is a precondition for the other: a record with no compatible
 * embedding stays reachable lexically, and a query with no usable tokens still
 * returns dense hits.
 * @public -- consumed by all three recall-cascade layers.
 */
export function searchHybrid(input: HybridSearchInput): readonly MemoryRecord[] {
  const scope: MemoryScope = { scopeId: input.scopeId, scopeType: input.scopeType }

  // searchLexical over-fetches bm25 candidates before post-filtering by status/kind/
  // thread/validity, so under heavy filtering it can legitimately return fewer than
  // `limit` results even when more filter-passing matches rank beyond that window.
  const lexical = searchLexical({
    ...scope,
    query: input.query,
    statuses: input.statuses,
    kind: input.kind,
    threadContextId: input.threadContextId,
    excludeThreadContextId: input.excludeThreadContextId,
    limit: input.limit,
    now: input.now,
  })

  const dense =
    input.queryEmbedding === null
      ? []
      : rankRecordsBySimilarity(scope, input.queryEmbedding, {
          statuses: input.statuses,
          kind: input.kind,
          threadContextId: input.threadContextId,
          excludeThreadContextId: input.excludeThreadContextId,
          embeddingVersion: input.embeddingVersion,
          limit: input.limit,
          now: input.now,
        })

  return fuseByRank(lexical, dense, input.limit)
}
