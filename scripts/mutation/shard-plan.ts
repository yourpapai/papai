// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CoverageMap } from './coverage-map.js'
import type { ReusedScore } from './incremental-run.js'
import { assignTargets } from './shard-assign.js'
import type { ShardAssignment } from './shard-assign.js'
import {
  DEFAULT_SHARD_CAP,
  DEFAULT_SINGLE_SHARD_THRESHOLD_SECONDS,
  DEFAULT_TARGET_WALL_SECONDS,
  resolveShardBudgetSeconds,
  resolveShardCount,
} from './shard-sizing.js'
import { estimateWeights } from './shard-weights.js'
import type { WeightDeps } from './shard-weights.js'

/** Bumped when the manifest shape changes; a consumer reading another version must refuse it. */
export const SHARD_PLAN_VERSION = 1

/** What the plan sized against, recorded so a run's division is auditable after the fact. */
export interface ShardPlanBudget {
  readonly targetWallSeconds: number
  /** Measured cost of building the coverage map in this run — the run's own shared preparation. */
  readonly preparationSeconds: number
  readonly budgetSeconds: number
  readonly cap: number
  readonly singleShardThresholdSeconds: number
}

/**
 * The contract between the plan job and everything downstream.
 *
 * `targets` is the whole branch diff and is what the gate must ultimately judge; `toMeasure` is
 * the subset this run will actually measure. The gate reconciles received results against
 * `toMeasure` — that is what makes a lost shard a failure rather than a silently narrower gate.
 */
export interface ShardPlanManifest {
  readonly version: number
  readonly baseRef: string
  readonly targets: readonly string[]
  readonly toMeasure: readonly string[]
  readonly reused: readonly ReusedScore[]
  readonly shardCount: number
  readonly shards: readonly ShardAssignment[]
  readonly coverageMap: CoverageMap
  readonly budget: ShardPlanBudget
}

export interface ShardPlanDeps {
  readonly selectTargets: (baseRef: string, projectRoot: string) => readonly string[]
  /** Reuse split, or undefined to measure every target — matching `--no-score-cache`. */
  readonly planIncremental:
    | ((targets: readonly string[]) => {
        readonly toMeasure: readonly string[]
        readonly reused: readonly ReusedScore[]
      })
    | undefined
  readonly buildCoverageMap: (sourceFiles: readonly string[]) => CoverageMap
  readonly weightDeps: WeightDeps
  readonly now: () => number
  readonly log: (message: string) => void
}

export interface ShardPlanInput {
  readonly projectRoot: string
  readonly baseRef: string
  readonly cap?: number
  readonly targetWallSeconds?: number
  readonly singleShardThresholdSeconds?: number
  readonly deps: ShardPlanDeps
}

interface SizingLimits {
  readonly cap: number
  readonly targetWallSeconds: number
  readonly singleShardThresholdSeconds: number
}

const emptyBudget = (limits: SizingLimits): ShardPlanBudget => ({
  targetWallSeconds: limits.targetWallSeconds,
  preparationSeconds: 0,
  budgetSeconds: resolveShardBudgetSeconds({ targetWallSeconds: limits.targetWallSeconds, preparationSeconds: 0 }),
  cap: limits.cap,
  singleShardThresholdSeconds: limits.singleShardThresholdSeconds,
})

/**
 * Build the run's shared preparation and time it. The measurement is not instrumentation: it is
 * what sets the shard budget, because preparation is serial work every shard waits behind.
 */
const prepareCoverage = (
  toMeasure: readonly string[],
  deps: ShardPlanDeps,
): { readonly coverageMap: CoverageMap; readonly preparationSeconds: number } => {
  const startedAt = deps.now()
  const coverageMap = deps.buildCoverageMap(toMeasure)
  const preparationSeconds = Math.max(0, (deps.now() - startedAt) / 1000)
  deps.log(`Built coverage map for ${toMeasure.length} target(s) in ${preparationSeconds.toFixed(1)}s`)
  return { coverageMap, preparationSeconds }
}

/** Size the matrix and lay the targets out across it, reporting the estimate it committed to. */
const divide = (
  toMeasure: readonly string[],
  preparationSeconds: number,
  limits: SizingLimits,
  deps: ShardPlanDeps,
): { readonly shards: readonly ShardAssignment[]; readonly budget: ShardPlanBudget } => {
  const weights = estimateWeights(toMeasure, deps.weightDeps)
  const budgetSeconds = resolveShardBudgetSeconds({
    targetWallSeconds: limits.targetWallSeconds,
    preparationSeconds,
  })
  const shardCount = resolveShardCount({
    weights: [...weights.values()],
    budgetSeconds,
    cap: limits.cap,
    singleShardThresholdSeconds: limits.singleShardThresholdSeconds,
  })
  const shards = assignTargets(toMeasure, weights, shardCount)
  for (const shard of shards) {
    deps.log(`  shard ${shard.index}: ${shard.targets.length} target(s), est ${shard.estimatedSeconds.toFixed(0)}s`)
  }
  return {
    shards,
    budget: {
      targetWallSeconds: limits.targetWallSeconds,
      preparationSeconds,
      budgetSeconds,
      cap: limits.cap,
      singleShardThresholdSeconds: limits.singleShardThresholdSeconds,
    },
  }
}

/**
 * Decide what this run measures and how it divides that work.
 *
 * Deliberately does no measuring: the plan job must be cheap, and the expensive part it does pay
 * for — the coverage map — is preparation every shard would otherwise duplicate. Building it once
 * here is worth ~9% of total wall against shards rebuilding it (design.md D4), and it doubles as
 * the run's own measurement of how much preparation cost, which is what sets the shard budget.
 */
export const buildShardPlan = (input: ShardPlanInput): ShardPlanManifest => {
  const { deps } = input
  const limits: SizingLimits = {
    cap: input.cap ?? DEFAULT_SHARD_CAP,
    targetWallSeconds: input.targetWallSeconds ?? DEFAULT_TARGET_WALL_SECONDS,
    singleShardThresholdSeconds: input.singleShardThresholdSeconds ?? DEFAULT_SINGLE_SHARD_THRESHOLD_SECONDS,
  }

  const targets = deps.selectTargets(input.baseRef, input.projectRoot)
  const split = deps.planIncremental?.(targets) ?? { toMeasure: targets, reused: [] }
  deps.log(
    `Whole-branch mutation targets: ${targets.length} file(s) — measured now: ${split.toMeasure.length}, reused: ${split.reused.length}`,
  )

  const base = { version: SHARD_PLAN_VERSION, baseRef: input.baseRef, targets, reused: split.reused }
  if (split.toMeasure.length === 0) {
    return { ...base, toMeasure: [], shardCount: 1, shards: [], coverageMap: {}, budget: emptyBudget(limits) }
  }

  const { coverageMap, preparationSeconds } = prepareCoverage(split.toMeasure, deps)
  const { shards, budget } = divide(split.toMeasure, preparationSeconds, limits, deps)
  return { ...base, toMeasure: split.toMeasure, shardCount: shards.length, shards, coverageMap, budget }
}
