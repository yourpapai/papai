// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * How many shards a mutation run asks for, given the estimated cost of what it must measure.
 *
 * `k = clamp(ceil(W / max(budget, slowest)), 1, cap)`, additionally bounded by the target count.
 *
 * The `max(budget, slowest)` term is the one that is easy to omit and expensive to omit: an
 * LPT makespan is bounded below by the largest single item, so shards past `W / slowest` cannot
 * make the run finish sooner. Measured on the three 38-target CI runs, dropping the term
 * oversizes by roughly 40% — 18-19 shards asked for where 13 is the knee.
 */
export interface ShardSizingInput {
  /** Estimated seconds per target, for the targets this run must MEASURE (not the branch diff). */
  readonly weights: readonly number[]
  /** Seconds of measurement one shard should carry. See {@link resolveShardBudgetSeconds}. */
  readonly budgetSeconds: number
  /** Upper bound on shard count, sized against the runner's concurrent-job allowance. */
  readonly cap: number
  /** Below this much total estimated work, measure in one shard rather than dividing. */
  readonly singleShardThresholdSeconds: number
}

export interface ShardBudgetInput {
  /** Wall-clock the mutation gate should aim to finish within. */
  readonly targetWallSeconds?: number
  /** Measured cost of the run's shared preparation (the coverage-map build), in seconds. */
  readonly preparationSeconds: number
}

/**
 * Maximum shards. 12 is the measured knee: bin-packing 226 real per-file timings shows no
 * improvement at 16 or 24 because the slowest single file (5.6 min) floors the makespan.
 * Lower this where the runner's concurrent-job allowance is tight — 8 costs ~1.5 min on the
 * worst measured run.
 */
export const DEFAULT_SHARD_CAP = 12

/**
 * Fixed cost of the fan-out shape itself: the extra plan and gate jobs, plus one shard's setup,
 * minus the single job they replace. Measured at 46s across 23 CI job logs (job setup 12.0s
 * median, teardown 2.8s, artifact transfer ~3s); rounded up.
 */
export const ORCHESTRATION_OVERHEAD_SECONDS = 60

/**
 * Wall-clock the gate aims for. Sits just above the next-longest CI job (Hermetic Full-Stack
 * Stories, 3m39s), so the mutation gate stops being the critical path without chasing a target
 * the slowest single file (5.6 min) makes unreachable anyway.
 */
export const DEFAULT_TARGET_WALL_SECONDS = 360

/**
 * Below this much estimated work, dividing is not worth its own overhead. Break-even for two
 * shards is ~90s of work; this threshold targets a saving of at least two minutes. No measured
 * run fell between 1.7 and 15.5 minutes of work, so this is an analytic choice rather than a
 * fitted one — see design.md, Open Questions.
 */
export const DEFAULT_SINGLE_SHARD_THRESHOLD_SECONDS = 330

/** Smallest budget we will ever divide against, so a pathological preparation cost cannot zero it. */
const MIN_BUDGET_SECONDS = 30

/** Seconds of measurement one shard should carry, given what preparation actually cost this run. */
export const resolveShardBudgetSeconds = (input: ShardBudgetInput): number => {
  const target = input.targetWallSeconds ?? DEFAULT_TARGET_WALL_SECONDS
  const preparation = Number.isFinite(input.preparationSeconds) ? Math.max(0, input.preparationSeconds) : 0
  const budget = target - ORCHESTRATION_OVERHEAD_SECONDS - preparation
  return budget < MIN_BUDGET_SECONDS ? MIN_BUDGET_SECONDS : budget
}

const positiveOr = (value: number, fallback: number): number => (Number.isFinite(value) && value > 0 ? value : fallback)

export const resolveShardCount = (input: ShardSizingInput): number => {
  const count = input.weights.length
  if (count <= 1) return 1

  const total = input.weights.reduce((sum, weight) => sum + (Number.isFinite(weight) ? Math.max(0, weight) : 0), 0)
  // Zero is a legitimate value meaning "no floor", so this cannot use `positiveOr`: silently
  // restoring the default there would ignore a caller that explicitly asked to always divide.
  const threshold =
    Number.isFinite(input.singleShardThresholdSeconds) && input.singleShardThresholdSeconds >= 0
      ? input.singleShardThresholdSeconds
      : DEFAULT_SINGLE_SHARD_THRESHOLD_SECONDS
  if (total < threshold) return 1

  const slowest = input.weights.reduce((max, weight) => (Number.isFinite(weight) && weight > max ? weight : max), 0)
  const budget = positiveOr(input.budgetSeconds, MIN_BUDGET_SECONDS)
  // Never ask for shards that the slowest single target already makes useless.
  const perShard = Math.max(budget, slowest)
  const wanted = Math.ceil(total / perShard)

  const cap = Math.max(1, Math.floor(positiveOr(input.cap, DEFAULT_SHARD_CAP)))
  return Math.max(1, Math.min(wanted, cap, count))
}
