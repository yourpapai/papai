// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PerFileScore } from './baseline.js'
import { defaultPairedRunDeps } from './paired-run.js'
import type { ErroredFile, PairedRunInput, PairedRunResult, SkippedFile } from './paired-run.js'
import { coverageMapReaderFor } from './shard-io.js'
import type { ShardPlanManifest } from './shard-plan.js'

/** Bumped when the shard-result shape changes; the gate refuses any other version. */
export const SHARD_RESULT_VERSION = 1

/**
 * What one shard hands back.
 *
 * `targets` is what the shard was ASKED to measure, and it is not derivable from `perFile` —
 * a target can legitimately end up in `skipped` or `errored` instead. The gate needs the asked
 * set to tell "this shard measured nothing because it had nothing to do" apart from "this shard
 * died before reporting".
 */
export interface ShardResult {
  readonly version: number
  readonly shardIndex: number
  readonly targets: readonly string[]
  readonly perFile: readonly PerFileScore[]
  readonly skipped: readonly SkippedFile[]
  readonly errored: readonly ErroredFile[]
  readonly durationSeconds: number
  /** What the plan predicted this shard would cost, carried through so the gate can log drift. */
  readonly estimatedSeconds: number
}

export interface ShardMeasureDeps {
  readonly runPaired: (input: PairedRunInput) => Promise<PairedRunResult>
  readonly now: () => number
  readonly log: (message: string) => void
}

export interface ShardMeasureInput {
  readonly projectRoot: string
  readonly reportDir: string
  readonly shardIndex: number
  readonly plan: ShardPlanManifest
  readonly verbose?: boolean
  readonly deps: ShardMeasureDeps
}

export const defaultShardMeasureDeps = (runPaired: ShardMeasureDeps['runPaired']): ShardMeasureDeps => ({
  runPaired,
  now: () => Date.now(),
  log: (message) => {
    console.log(message)
  },
})

const empty = (shardIndex: number, estimatedSeconds: number): ShardResult => ({
  version: SHARD_RESULT_VERSION,
  shardIndex,
  targets: [],
  perFile: [],
  skipped: [],
  errored: [],
  durationSeconds: 0,
  estimatedSeconds,
})

/**
 * Measure one shard's share of a run. Measures — never judges: the exit code is independent of
 * the scores (see {@link resolveShardExitCode}), because a shard that failed its job on a low
 * score would stop the gate from ever rendering the whole-branch verdict.
 */
export const measureShard = async (input: ShardMeasureInput): Promise<ShardResult> => {
  const assignment = input.plan.shards.find((shard) => shard.index === input.shardIndex)
  if (assignment === undefined || assignment.targets.length === 0) {
    input.deps.log(`Shard ${input.shardIndex}: nothing assigned; measuring nothing.`)
    return empty(input.shardIndex, assignment?.estimatedSeconds ?? 0)
  }

  input.deps.log(
    `Shard ${input.shardIndex}: measuring ${assignment.targets.length} target(s), est ${assignment.estimatedSeconds.toFixed(0)}s`,
  )
  const startedAt = input.deps.now()
  const paired = await input.deps.runPaired({
    projectRoot: input.projectRoot,
    reportDir: input.reportDir,
    sourceFiles: assignment.targets,
    verbose: input.verbose,
    // Consume the plan's published attribution so this shard spawns no coverage runs of its own.
    // A missing or unreadable plan yields no reader, and pairedRun then builds its own map.
    deps: { ...defaultPairedRunDeps, buildMap: coverageMapReaderFor(input.plan) },
  })
  const durationSeconds = Math.max(0, (input.deps.now() - startedAt) / 1000)

  return {
    version: SHARD_RESULT_VERSION,
    shardIndex: input.shardIndex,
    targets: assignment.targets,
    perFile: paired.perFile.map(({ sourceFile, merged }) => ({ sourceFile, merged })),
    skipped: paired.skipped,
    errored: paired.errored,
    durationSeconds,
    estimatedSeconds: assignment.estimatedSeconds,
  }
}

/**
 * Always 0. Scores, skips and errors are all DATA the gate acts on, not shard failures — a shard
 * exiting non-zero would fail the job before the results were ever combined. A shard that truly
 * cannot run fails by crashing, which leaves no result file, which the gate reconciles as a lost
 * shard and fails on.
 */
export const resolveShardExitCode = (_result: ShardResult): 0 => 0
