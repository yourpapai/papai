// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { BaselineRecord } from './baseline.js'
import { runBuildGateWithRetries } from './build-gate.js'
import { runDiffGuard } from './diff-guard.js'
import type { PipelineDeps } from './pipeline.js'
import type { Result } from './result-schema.js'

export type PhaseOk<T> = { ok: true; value: T }
export type PhaseFail = { ok: false; gate: string; reason: string; file?: string }
export type PhaseResult<T> = PhaseOk<T> | PhaseFail

export interface GateOutcome {
  afterScore: number
  // The counts behind afterScore, from the same measurement — the record-level
  // baseline bump writes them beside the score so the committed record stays
  // arithmetically consistent with what was measured.
  killed: number
  timeout: number
  scored: number
  result: Result
  capped: boolean
}

/**
 * The record-level bump measurement for an outcome: the after-score plus the
 * killed/timeout/scored counts from the same report it was computed from —
 * never a bare number, so the committed record stays arithmetically consistent
 * with what was measured.
 */
export const measurementOf = (gate: GateOutcome): BaselineRecord => ({
  score: gate.afterScore,
  killed: gate.killed,
  timeout: gate.timeout,
  scored: gate.scored,
})

// Set equality, not subset: a declared id that is not an actual survivor means
// the agent's bookkeeping is wrong (or padded) — fail closed. An empty
// surviving set can never cap (a below-threshold score implies survivors).
function coversAllSurvivors(result: Result, survivingMutantIds: readonly string[]): boolean {
  const declared = new Set(result.residuals.flatMap((r) => r.mutantIds))
  const surviving = new Set(survivingMutantIds)
  return surviving.size > 0 && declared.size === surviving.size && [...declared].every((id) => surviving.has(id))
}

// ④a DIFF-GUARD → ④b BUILD → ⑤ VERIFY. Diff-guard runs BEFORE verify so any agent
// attempt to edit baseline.json or src/ is caught before the runner spends a
// mutation-score run on tampered inputs. The after-score is runner-measured.
// Three below-threshold outcomes:
//   - residual escape hatch (unchanged): residuals declared AND score within
//     epsilon of the threshold → passes as 'improved'.
//   - capped: score improved AND the declared residual mutant ids exactly equal
//     the runner-measured surviving ids → merges at the measured ceiling as
//     'capped' (the file is provably at its tests-only limit; failing would
//     discard real coverage gains and invite endless re-picks).
//   - otherwise the iteration fails the score gate.
// Build-gate failures are fed back to the agent for up to config.buildFixAttempts
// fix-and-re-gate cycles (see runBuildGateWithRetries in build-gate.ts) before
// failing.
export async function gatePhase(
  deps: PipelineDeps,
  iterPath: string,
  worktreePath: string,
  file: string,
  beforeScore: number,
  improved: Result,
): Promise<PhaseResult<GateOutcome>> {
  const diff = await runDiffGuard(deps.execGit, worktreePath)
  if (!diff.ok) {
    return { ok: false, gate: 'diff-scope', reason: `forbidden paths changed: ${diff.violations.join(', ')}` }
  }
  const buildGate = await runBuildGateWithRetries(
    { execGit: deps.execGit, runBuildCheck: deps.runBuildCheck, runImproveAgent: deps.runImproveAgent, log: deps.log },
    { iterPath, worktreePath, file, attempt: 1, maxAttempts: deps.config.buildFixAttempts, improved },
  )
  if (!buildGate.ok) return buildGate
  const result = buildGate.value
  const measured = await deps.measureScore(worktreePath, file)
  const { score: afterScore, killed, timeout, scored } = measured
  const counts = { killed, timeout, scored }
  const justified = result.residuals.length > 0 && afterScore >= deps.config.threshold - deps.config.epsilon
  if (afterScore >= deps.config.threshold || justified) {
    return { ok: true, value: { afterScore, ...counts, result, capped: false } }
  }
  if (afterScore > beforeScore && coversAllSurvivors(result, measured.survivingMutantIds)) {
    return { ok: true, value: { afterScore, ...counts, result, capped: true } }
  }
  return { ok: false, gate: 'score', reason: `afterScore ${afterScore} < threshold ${deps.config.threshold}` }
}
