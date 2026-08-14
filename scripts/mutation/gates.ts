// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolveRatchet } from './baseline.js'
import type { BaselineMap, PerFileScore } from './baseline.js'
import { resolvePairedRunExitCode } from './paired-run-cli.js'
import type { ErroredFile, SkippedFile } from './paired-run.js'
import type { MergedScore } from './score-merger.js'

/**
 * What the gates judge. Deliberately `PerFileScore`-shaped rather than
 * `PairedRunFileResult`-shaped: a score carried over from an earlier run has no `testFiles`,
 * `configPath` or `reportPath`, and synthesizing those would put fabricated paths into the
 * one data structure the gate's verdict is computed from.
 */
export interface GateInput {
  readonly merged: MergedScore
  readonly perFile: readonly PerFileScore[]
  readonly skipped: readonly SkippedFile[]
  readonly errored: readonly ErroredFile[]
}

export interface GateVerdict {
  readonly exitCode: 0 | 1
  readonly message: string | null
}

export interface GateInputOptions {
  readonly result: GateInput
  readonly threshold: number
  readonly noRatchet: boolean
  readonly baseline: BaselineMap
}

const PASS: GateVerdict = { exitCode: 0, message: null }

/**
 * Gate on files whose Stryker run errored. Such a file produces no per-file score, so it
 * appears in neither the merged threshold check nor the ratchet — an unmeasurable file would
 * otherwise pass the gate by not showing up at all, which is the one outcome a mutation gate
 * must never allow. It is also why an errored file is never recorded as a carried-over score:
 * it has to stay retryable.
 */
export const resolveErroredGate = (errored: readonly ErroredFile[]): GateVerdict => {
  if (errored.length === 0) return PASS
  const detail = errored.map((e) => `${e.sourceFile}: ${e.error}`).join('; ')
  return {
    exitCode: 1,
    message: `Mutation run errored for ${errored.length} file(s), so they were never scored: ${detail}`,
  }
}

/**
 * Apply the three gates in order — unscorable files, merged threshold, per-file ratchet —
 * returning the first failure. Pure: the caller prints. That keeps the whole-branch verdict
 * (including a regression inherited from an earlier commit) assertable without driving `main`.
 */
export const resolveChangedFilesGates = (input: GateInputOptions): GateVerdict => {
  const { result, threshold, noRatchet, baseline } = input
  const errored = resolveErroredGate(result.errored)
  if (errored.exitCode === 1) return errored
  if (resolvePairedRunExitCode(result.merged, threshold) === 1) {
    return { exitCode: 1, message: `Mutation score ${result.merged.score} is below threshold ${threshold}` }
  }
  if (noRatchet) return PASS
  const ratchet = resolveRatchet(result.perFile, baseline)
  if (ratchet.exitCode === 0) return PASS
  const detail = ratchet.regressions
    .map((r) => `${r.sourceFile} ${r.score.toFixed(4)} < ${r.threshold.toFixed(4)}`)
    .join(', ')
  return { exitCode: 1, message: `Mutation ratchet regression: ${detail}` }
}
