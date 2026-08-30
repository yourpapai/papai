// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { BaselineMap, PerFileScore } from './baseline.js'
import type { GateInput } from './gates.js'
import type { ErroredFile, PairedRunInput, PairedRunResult, SkippedFile } from './paired-run.js'
import { openScoreCache, SCORE_CACHE_FILE } from './score-cache.js'
import type { ScoreCache } from './score-cache.js'
import {
  computeSourceFingerprint,
  computeToolchainFingerprint,
  createDefaultFingerprintDeps,
} from './score-fingerprint.js'
import { combineMergedScores } from './score-merger.js'

/** A score recorded by an earlier run and still valid for the content on disk now. */
export interface ReusedScore extends PerFileScore {
  readonly measuredAt: number
}

export interface IncrementalPlan {
  readonly toMeasure: readonly string[]
  readonly reused: readonly ReusedScore[]
}

export interface PlanInput {
  readonly targets: readonly string[]
  readonly cache: ScoreCache
  readonly fingerprintOf: (srcFile: string) => string
}

/**
 * The parts of a run `combineIncrementalResult` actually reads. Deliberately narrower than
 * `PairedRunResult`: a run measured across several shards arrives as per-file scores with no
 * `testFiles`, `configPath` or `reportPath`, and synthesizing those would put fabricated paths
 * into the structure the verdict is computed from — the same reason `GateInput` is
 * `PerFileScore`-shaped. A whole `PairedRunResult` still satisfies this.
 */
export interface CombinableRun {
  readonly perFile: readonly PerFileScore[]
  readonly skipped: readonly SkippedFile[]
  readonly errored: readonly ErroredFile[]
}

export interface CombineInput {
  readonly fresh: CombinableRun
  readonly reused: readonly ReusedScore[]
}

export interface IncrementalDeps {
  readonly plan: (targets: readonly string[]) => IncrementalPlan
  /** Record this run's measurements and persist. Never called with errored files. */
  readonly record: (fresh: readonly PerFileScore[]) => void
}

/**
 * Split the whole-branch target list into what this run must measure and what it may carry
 * over. Every target lands in exactly one bucket, so the gate still sees the entire branch
 * diff — the split decides only what Stryker is asked to do, never what is judged.
 */
export const planIncrementalRun = (input: PlanInput): IncrementalPlan => {
  const toMeasure: string[] = []
  const reused: ReusedScore[] = []
  for (const sourceFile of input.targets) {
    const entry = input.cache.get(sourceFile, input.fingerprintOf(sourceFile))
    if (entry === undefined) toMeasure.push(sourceFile)
    else reused.push({ sourceFile, merged: entry.merged, measuredAt: entry.measuredAt })
  }
  return { toMeasure, reused }
}

/**
 * Assemble the gate's input from files measured now plus files carried over. The aggregate
 * pools mutants rather than averaging file scores, so the summary reads exactly as it would
 * have if every file had been measured in this run. `errored` and `skipped` come from the
 * fresh run alone: neither is ever recorded, so neither can arrive by way of the cache.
 */
export const combineIncrementalResult = (input: CombineInput): GateInput => {
  const perFile: PerFileScore[] = [
    ...input.fresh.perFile.map(({ sourceFile, merged }) => ({ sourceFile, merged })),
    ...input.reused.map(({ sourceFile, merged }) => ({ sourceFile, merged })),
  ]
  return {
    merged: combineMergedScores(perFile.map((entry) => entry.merged)),
    perFile,
    skipped: input.fresh.skipped,
    errored: input.fresh.errored,
  }
}

/**
 * Render the measured/reused split. A run that reuses most of its targets is still a
 * whole-branch verdict, and this is what lets a reader confirm that from the log rather than
 * take it on trust — hence the per-file score and measurement time on every reused entry.
 */
export const formatIncrementalPlan = (plan: IncrementalPlan): readonly string[] => {
  const total = plan.toMeasure.length + plan.reused.length
  const lines = [
    `Whole-branch mutation targets: ${total} file(s) — measured now: ${plan.toMeasure.length}, reused: ${plan.reused.length}`,
  ]
  for (const entry of plan.reused) {
    const when = new Date(entry.measuredAt).toISOString().slice(0, 16)
    lines.push(`  reused ${entry.sourceFile}: score ${entry.merged.score.toFixed(4)} (measured ${when}Z)`)
  }
  return lines
}

/**
 * Production wiring. Opens the store once and computes the toolchain fingerprint once, so a
 * batch reads the mutation runner and the lockfile a single time rather than per file.
 */
export const createIncrementalDeps = (input: {
  readonly projectRoot: string
  readonly reportDir: string
}): IncrementalDeps => {
  const cache = openScoreCache(path.join(input.reportDir, SCORE_CACHE_FILE))
  const fingerprintDeps = createDefaultFingerprintDeps(input.projectRoot)
  const toolchain = computeToolchainFingerprint(fingerprintDeps)
  const fingerprintOf = (srcFile: string): string =>
    computeSourceFingerprint({ srcFile, toolchain, deps: fingerprintDeps })

  return {
    plan: (targets) => planIncrementalRun({ targets, cache, fingerprintOf }),
    record: (fresh) => {
      for (const entry of fresh) {
        cache.set(entry.sourceFile, fingerprintOf(entry.sourceFile), entry.merged)
      }
      // Always flush, including for an empty run: the CI save step needs a file to save.
      cache.flush()
    },
  }
}

const EMPTY_RUN: PairedRunResult = {
  merged: {
    killed: 0,
    survived: 0,
    noCoverage: 0,
    timeout: 0,
    compileError: 0,
    ignored: 0,
    runtimeError: 0,
    pending: 0,
    total: 0,
    scored: 0,
    score: 0,
  },
  perFile: [],
  skipped: [],
  errored: [],
}

export interface MeasureInput {
  readonly runPaired: (input: PairedRunInput) => Promise<PairedRunResult>
  readonly projectRoot: string
  readonly reportDir: string
  readonly verbose: boolean
  readonly toMeasure: readonly string[]
}

/**
 * Run Stryker over the files that actually need measuring — and skip the call entirely when
 * that list is empty. `pairedRun` builds a coverage map from the files it is handed, so an
 * empty call would still pay that per-test prelude for no result.
 */
export const measureOnlyWhatIsNeeded = (input: MeasureInput): Promise<PairedRunResult> => {
  if (input.toMeasure.length === 0) return Promise.resolve(EMPTY_RUN)
  return input.runPaired({
    projectRoot: input.projectRoot,
    reportDir: input.reportDir,
    sourceFiles: input.toMeasure,
    verbose: input.verbose,
    deps: undefined,
  })
}

/**
 * Announce files that have no recorded floor yet. Driven from the COMBINED per-file list, so
 * a carried-over file that is still unbaselined keeps saying so on every push rather than
 * going quiet the moment its score stops being re-measured.
 */
export const logFirstMeasurements = (
  perFile: readonly PerFileScore[],
  baseline: BaselineMap,
  log: (message: string) => void,
): void => {
  for (const entry of perFile) {
    if (entry.merged.scored === 0) continue
    if (baseline[entry.sourceFile] !== undefined) continue
    log(
      `First measurement for ${entry.sourceFile}: score ${entry.merged.score.toFixed(4)} — seeded; future PRs enforce ≥ this.`,
    )
  }
}
