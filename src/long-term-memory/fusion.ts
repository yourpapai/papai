// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MemoryRecord } from './types.js'

// Ported verbatim from the measured `corrected-hybrid` benchmark candidate
// (scripts/memory-research/candidates/corrected-hybrid.ts). These are frozen
// experiment parameters, not tuning knobs.
export const RANK_FUSION_OFFSET = 60
export const LEXICAL_FUSION_WEIGHT = 2
export const DENSE_FUSION_WEIGHT = 1

type Accumulator = { record: MemoryRecord; score: number }

const accumulate = (into: Map<string, Accumulator>, ranked: readonly MemoryRecord[], weight: number): void => {
  ranked.forEach((record, index) => {
    const contribution = weight / (RANK_FUSION_OFFSET + index + 1)
    const existing = into.get(record.id)
    if (existing === undefined) {
      into.set(record.id, { record, score: contribution })
      return
    }
    existing.score += contribution
  })
}

/**
 * Weighted reciprocal rank fusion over two independently ranked channels.
 * A record present in only one channel still scores, which is what keeps an
 * unembedded record reachable when other records do produce semantic hits.
 * @public -- consumed by the hybrid search orchestrator.
 */
export function fuseByRank(
  lexical: readonly MemoryRecord[],
  dense: readonly MemoryRecord[],
  limit: number,
): readonly MemoryRecord[] {
  const scores = new Map<string, Accumulator>()
  accumulate(scores, lexical, LEXICAL_FUSION_WEIGHT)
  accumulate(scores, dense, DENSE_FUSION_WEIGHT)

  return [...scores.values()]
    .sort((left, right) =>
      right.score === left.score ? left.record.id.localeCompare(right.record.id) : right.score - left.score,
    )
    .slice(0, limit)
    .map((entry) => entry.record)
}
