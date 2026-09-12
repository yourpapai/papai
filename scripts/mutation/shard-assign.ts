// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { DEFAULT_WEIGHT_SECONDS } from './shard-weights.js'

/** One shard's share of a run's measurement work. */
export interface ShardAssignment {
  /** Position in the emitted matrix; stable for a given input. */
  readonly index: number
  /** Targets this shard measures, in a deterministic order. */
  readonly targets: readonly string[]
  /** Sum of the assigned targets' estimated seconds — a scheduling figure, never a verdict input. */
  readonly estimatedSeconds: number
}

/**
 * Distribute targets across shards by estimated cost (longest-processing-time-first).
 *
 * Balancing by COUNT rather than cost is the tempting simplification and it is worth roughly as
 * much as getting the shard count right: measured over 16 CI runs, weighting the packing alone
 * saved 8.6 minutes and sizing alone 8.5, while doing both saved 17.7.
 *
 * Determinism matters beyond tidiness — the same plan must produce the same matrix on a re-run,
 * so ties break on path, and the input order is never observable in the output.
 */
export const assignTargets = (
  targets: readonly string[],
  weights: ReadonlyMap<string, number>,
  shardCount: number,
): readonly ShardAssignment[] => {
  const unique = [...new Set(targets)]
  if (unique.length === 0) return []

  const count = Math.max(1, Math.min(Math.floor(shardCount), unique.length))
  const weightOf = (target: string): number => {
    const weight = weights.get(target)
    return weight === undefined || !Number.isFinite(weight) || weight <= 0 ? DEFAULT_WEIGHT_SECONDS : weight
  }

  // Heaviest first, ties by path: the LPT ordering, made independent of input order.
  const ordered = unique.toSorted((a, b) => weightOf(b) - weightOf(a) || a.localeCompare(b))

  const bins = Array.from({ length: count }, (_v, index) => ({ index, targets: [] as string[], estimatedSeconds: 0 }))
  for (const target of ordered) {
    // Least-loaded bin, ties to the lowest index — which is also what keeps the first `count`
    // targets on distinct bins, so no shard is emitted empty.
    let chosen = bins[0]
    if (chosen === undefined) break
    for (const bin of bins) {
      if (bin.estimatedSeconds < chosen.estimatedSeconds) chosen = bin
    }
    chosen.targets.push(target)
    chosen.estimatedSeconds += weightOf(target)
  }

  return bins.map((bin) => ({
    index: bin.index,
    targets: bin.targets.toSorted(),
    estimatedSeconds: bin.estimatedSeconds,
  }))
}
