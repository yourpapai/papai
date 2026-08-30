// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { BaselineMap, PerFileScore } from './baseline.js'
import { resolveChangedFilesGates } from './gates.js'
import type { GateVerdict } from './gates.js'
import { combineIncrementalResult, formatIncrementalPlan, logFirstMeasurements } from './incremental-run.js'
import type { ErroredFile, SkippedFile } from './paired-run.js'
import type { ShardResult } from './shard-measure.js'
import type { ShardPlanManifest } from './shard-plan.js'

/** What the shards collectively reported, plus what the plan expected and never got back. */
export interface ShardReconciliation {
  readonly perFile: readonly PerFileScore[]
  readonly skipped: readonly SkippedFile[]
  readonly errored: readonly ErroredFile[]
  /** Planned targets no shard accounted for — a lost, cancelled or partly-crashed shard. */
  readonly missing: readonly string[]
}

export interface ShardGateDeps {
  /** Persist measurements. Called BEFORE the verdict, and never with a skipped or errored file. */
  readonly record: (entries: readonly PerFileScore[]) => void
  readonly log: (message: string) => void
}

export interface ShardGateInput {
  readonly plan: ShardPlanManifest
  readonly results: readonly ShardResult[]
  readonly baseline: BaselineMap
  readonly threshold: number
  readonly noRatchet: boolean
  readonly deps: ShardGateDeps
}

/**
 * Account for every target the plan said it would measure.
 *
 * Accounting is per TARGET, not per shard, which is what catches both failure shapes with one
 * rule: a shard that never reported at all, and a shard that reported but died partway through
 * its list. A target is accounted for once it appears in some shard's scores, skips or errors —
 * an unmeasurable file is a known outcome the gate acts on; an absent one is not.
 */
export const reconcileShardResults = (
  plan: ShardPlanManifest,
  results: readonly ShardResult[],
): ShardReconciliation => {
  const perFile = new Map<string, PerFileScore>()
  const skipped = new Map<string, SkippedFile>()
  const errored = new Map<string, ErroredFile>()
  for (const result of results) {
    for (const entry of result.perFile) perFile.set(entry.sourceFile, entry)
    for (const entry of result.skipped) skipped.set(entry.sourceFile, entry)
    for (const entry of result.errored) errored.set(entry.sourceFile, entry)
  }

  const accounted = new Set([...perFile.keys(), ...skipped.keys(), ...errored.keys()])
  return {
    perFile: [...perFile.values()],
    skipped: [...skipped.values()],
    errored: [...errored.values()],
    missing: plan.toMeasure.filter((target) => !accounted.has(target)),
  }
}

const reportDrift = (input: ShardGateInput): void => {
  for (const result of input.results) {
    input.deps.log(
      `  shard ${result.shardIndex}: est ${result.estimatedSeconds.toFixed(0)}s, actual ${result.durationSeconds.toFixed(0)}s`,
    )
  }
}

/**
 * Combine every shard's results into the whole-branch verdict.
 *
 * Order is load-bearing twice over. Measurements are recorded BEFORE gating, so a failing run
 * still persists what it measured and the next push does not re-measure the regression that made
 * this one red (ADR-0424). And the missing-target check runs BEFORE the score checks, because a
 * lost shard is not a low score — it is the absence of evidence, and reporting a ratchet verdict
 * over a partial file set is exactly the fake-green this check exists to prevent.
 */
export const runShardedGate = (input: ShardGateInput): GateVerdict => {
  const reconciliation = reconcileShardResults(input.plan, input.results)

  formatIncrementalPlan({ toMeasure: input.plan.toMeasure, reused: input.plan.reused }).forEach((line) => {
    input.deps.log(line)
  })
  reportDrift(input)

  // Record first: a failing verdict must never cost the measurements this run paid for.
  input.deps.record(reconciliation.perFile)

  if (reconciliation.missing.length > 0) {
    return {
      exitCode: 1,
      message: `Mutation run never reported a result for ${reconciliation.missing.length} planned target(s), so they were never scored: ${reconciliation.missing.join(', ')}`,
    }
  }

  const result = combineIncrementalResult({ fresh: reconciliation, reused: input.plan.reused })
  logFirstMeasurements(result.perFile, input.baseline, input.deps.log)
  return resolveChangedFilesGates({
    result,
    threshold: input.threshold,
    noRatchet: input.noRatchet,
    baseline: input.baseline,
  })
}
