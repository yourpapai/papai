// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

/**
 * Per-target cost estimate, in seconds, for dividing a mutation run's measurement work.
 *
 * The estimate is a SCHEDULING input only. A wrong estimate makes a run slower or spawns more
 * shards than it needed; it can never change which files are gated or what verdict is reached
 * (see the `mutation-shard-planning` spec, "Division choices never affect the verdict").
 *
 * The fit comes from 226 measured per-file Stryker runs across 16 CI jobs: source line count
 * against wall-clock duration gives `≈12s + 0.505s/line` (Pearson 0.517, Spearman 0.597).
 * Mutant count is the better predictor (Spearman 0.773) and is already persisted in
 * `score-cache.json` as `MergedScore.total`, but reading it means reading past the score
 * fingerprint — deliberately deferred, see design.md D3.
 */
export interface WeightDeps {
  /** Lines in the source file, or null when it cannot be read. Never throws. */
  readonly countLines: (relPath: string) => number | null
}

/** Intercept of the measured line-count fit, in seconds. */
export const WEIGHT_INTERCEPT_SECONDS = 12

/** Slope of the measured line-count fit, in seconds per line. */
export const WEIGHT_SECONDS_PER_LINE = 0.505

/**
 * Weight for a target whose source cannot be read. The pooled mean per-file cost over the same
 * 226 measurements; a target with no usable estimate is still assigned and measured.
 */
export const DEFAULT_WEIGHT_SECONDS = 107

/**
 * Lower bound on any weight. A zero or negative weight would make the packer's least-loaded-bin
 * choice arbitrary and would let a shard absorb targets without its estimated load growing.
 */
export const MIN_WEIGHT_SECONDS = 1

const clampWeight = (seconds: number): number => (seconds < MIN_WEIGHT_SECONDS ? MIN_WEIGHT_SECONDS : seconds)

/** Estimate one target's cost in seconds. Always finite and at least {@link MIN_WEIGHT_SECONDS}. */
export const estimateWeight = (srcFile: string, deps: WeightDeps): number => {
  const lines = deps.countLines(srcFile)
  if (lines === null || !Number.isFinite(lines) || lines < 0) return DEFAULT_WEIGHT_SECONDS
  return clampWeight(WEIGHT_INTERCEPT_SECONDS + WEIGHT_SECONDS_PER_LINE * lines)
}

/** Estimate every target's cost, keyed by path. A repeated path is weighed once. */
export const estimateWeights = (srcFiles: readonly string[], deps: WeightDeps): ReadonlyMap<string, number> => {
  const weights = new Map<string, number>()
  for (const srcFile of srcFiles) {
    if (weights.has(srcFile)) continue
    weights.set(srcFile, estimateWeight(srcFile, deps))
  }
  return weights
}

/**
 * Production deps: count lines off disk. Reads fail open to null — an unreadable source costs a
 * default weight, never an aborted plan.
 */
export const createDefaultWeightDeps = (projectRoot: string): WeightDeps => ({
  countLines: (relPath) => {
    try {
      const abs = path.resolve(projectRoot, relPath)
      if (!fs.statSync(abs).isFile()) return null
      const content = fs.readFileSync(abs, 'utf8')
      if (content === '') return 0
      return content.split('\n').length - (content.endsWith('\n') ? 1 : 0)
    } catch {
      return null
    }
  },
})
