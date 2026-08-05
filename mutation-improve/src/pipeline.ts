// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import type { AgentRunResult } from '../../review-loop/src/agent-runner.js'
import type { MergeResult } from '../../review-loop/src/worktree.js'
import { bumpScore, type BaselineMap } from './baseline.js'
import type { MutationImproveConfig } from './config.js'
import { runDiffGuard } from './diff-guard.js'
import { buildImprovePrompt, buildSelectPrompt } from './prompt-templates.js'
import type { Result } from './result-schema.js'
import { ResultSchema } from './result-schema.js'
import type { MutationImproveRunState } from './run-state.js'
import { iterDir } from './run-state.js'
import { SelectionSchema } from './selection-schema.js'
import type { Selection } from './selection-schema.js'

export interface IterationResult {
  iter: number
  outcome: 'improved' | 'skipped' | 'failed'
  file?: string
  beforeScore?: number
  afterScore?: number
  gate?: string
  reason?: string
}

export interface PipelineDeps {
  config: MutationImproveConfig
  runState: MutationImproveRunState
  spawn: unknown
  createWorktree: (repoRoot: string, worktreePath: string, runId: string, branchPrefix: string) => Promise<void>
  resetWorktree: (worktreePath: string) => Promise<void>
  removeWorktree: (repoRoot: string, worktreePath: string, runId: string, branchPrefix: string) => Promise<void>
  mergeWorktree: (repoRoot: string, branchName: string) => Promise<MergeResult>
  execGit: (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>
  runBuildCheck: () => Promise<{ passed: boolean; stdout: string; stderr: string }>
  measureScore: (worktreePath: string, srcFile: string) => Promise<number>
  readBaseline: (repoRoot: string) => Promise<BaselineMap>
  writeBaseline: (repoRoot: string, map: BaselineMap) => Promise<void>
  runSelectAgent: (worktreePath: string, prompt: string) => Promise<AgentRunResult<Selection>>
  runImproveAgent: (worktreePath: string, prompt: string) => Promise<AgentRunResult<Result>>
  log: { log: (msg: string) => void; issue?: unknown }
}

type PhaseOk<T> = { ok: true; value: T }
type PhaseFail = { ok: false; gate: string; reason: string }
type PhaseResult<T> = PhaseOk<T> | PhaseFail

function branchFor(deps: PipelineDeps, iter: number): string {
  return `${deps.config.prBranchPrefix}/${deps.runState.runId}-iter${iter}`
}

function worktreeFor(deps: PipelineDeps, iter: number): string {
  return path.join(deps.config.workDir, 'worktrees', `${deps.runState.runId}-iter${iter}`)
}

function runIdFor(deps: PipelineDeps, iter: number): string {
  return `${deps.runState.runId}-iter${iter}`
}

// ① SELECT — runner reads baseline; agent only suggests. Reject picks not in baseline
// (nothing to improve) or already done (would re-do work). Both are agent mistakes.
async function selectPhase(
  deps: PipelineDeps,
  worktreePath: string,
  iterPath: string,
): Promise<PhaseResult<{ selection: Selection; baseline: BaselineMap }>> {
  const baseline = await deps.readBaseline(deps.config.repoRoot)
  const selectOut = path.join(iterPath, 'selection.json')
  const selectRes = await deps.runSelectAgent(
    worktreePath,
    buildSelectPrompt({
      doneSet: deps.runState.doneSet,
      baselineSummary: JSON.stringify(baseline),
      outputPath: selectOut,
    }),
  )
  const selection = SelectionSchema.parse(selectRes.value)
  if (deps.runState.doneSet.includes(selection.file) || baseline[selection.file] === undefined) {
    return { ok: false, gate: 'select', reason: 'selection file not in baseline or already done' }
  }
  return { ok: true, value: { selection, baseline } }
}

// ③ IMPROVE — agent writes spec/plan/tests; runner only parses its declared result.
// The agent's own score claims are NEVER trusted; only the runner-measured score
// from ⑤ counts. We parse here to fail fast on a malformed agent output.
async function improvePhase(
  deps: PipelineDeps,
  worktreePath: string,
  iterPath: string,
  file: string,
  beforeScore: number,
): Promise<Result> {
  const improveOut = path.join(iterPath, 'result.json')
  const improveRes = await deps.runImproveAgent(
    worktreePath,
    buildImprovePrompt({
      file,
      beforeScore,
      threshold: deps.config.threshold,
      date: new Date().toISOString().slice(0, 10),
      outputPath: improveOut,
    }),
  )
  return ResultSchema.parse(improveRes.value)
}

// ④a DIFF-GUARD → ④b BUILD → ⑤ VERIFY. Diff-guard runs BEFORE verify so any agent
// attempt to edit baseline.json or src/ is caught before the runner spends a
// mutation-score run on tampered inputs. The after-score is runner-measured;
// the residual escape hatch only opens when the agent declared residuals AND
// the measured score lands within epsilon of the threshold.
async function gatePhase(
  deps: PipelineDeps,
  worktreePath: string,
  file: string,
  improved: Result,
): Promise<PhaseResult<number>> {
  const diff = await runDiffGuard(deps.execGit, worktreePath)
  if (!diff.ok) {
    return { ok: false, gate: 'diff-scope', reason: `forbidden paths changed: ${diff.violations.join(', ')}` }
  }
  const build = await deps.runBuildCheck()
  if (!build.passed) {
    return { ok: false, gate: 'build', reason: build.stderr || build.stdout }
  }
  const afterScore = await deps.measureScore(worktreePath, file)
  const justified = improved.residuals.length > 0 && afterScore >= deps.config.threshold - deps.config.epsilon
  if (afterScore < deps.config.threshold && !justified) {
    return { ok: false, gate: 'score', reason: `afterScore ${afterScore} < threshold ${deps.config.threshold}` }
  }
  return { ok: true, value: afterScore }
}

// ⑥ RATCHET (runner-owned) → ⑦ MERGE. Baseline bump happens BEFORE merge so a
// merge conflict still leaves the persisted baseline advanced (the work is
// done; only the integration failed). Merge-conflict returns gate:'merge',
// which runPipeline treats as abort.
async function finalizePhase(
  deps: PipelineDeps,
  iter: number,
  worktreePath: string,
  file: string,
  baseline: BaselineMap,
  beforeScore: number,
  afterScore: number,
  improved: Result,
): Promise<IterationResult> {
  const bumped = bumpScore(baseline, file, afterScore)
  // C1: write the baseline bump into the WORKTREE (not repoRoot) and commit the
  // agent's spec/plan/test outputs together with the bump on the worktree
  // branch BEFORE mergeWorktree. Without this, mergeWorktree merges an empty
  // branch ("Already up to date"), writeBaseline never propagates to base, and
  // removeWorktree --force discards the agent's uncommitted files.
  await deps.writeBaseline(worktreePath, bumped)
  await deps.execGit(worktreePath, ['add', '-A'])
  await deps.execGit(worktreePath, ['commit', '-m', `chore(mutation): ratchet ${file} baseline to ${afterScore}`])
  const merge = await deps.mergeWorktree(deps.config.repoRoot, branchFor(deps, iter))
  if (!merge.ok) {
    return {
      iter,
      outcome: 'failed',
      file,
      beforeScore,
      afterScore,
      gate: 'merge',
      reason: `conflict: ${merge.conflictFiles.join(', ')}`,
    }
  }
  await deps.removeWorktree(deps.config.repoRoot, worktreePath, runIdFor(deps, iter), deps.config.prBranchPrefix)
  deps.runState.doneSet.push(file)
  deps.runState.merged.push({
    file,
    beforeScore,
    afterScore,
    iter,
    specPath: improved.specPath,
    planPath: improved.planPath,
  })
  return { iter, outcome: 'improved', file, beforeScore, afterScore }
}

async function failIter(
  deps: PipelineDeps,
  iter: number,
  worktreePath: string,
  gate: string,
  reason: string,
): Promise<IterationResult> {
  await deps.resetWorktree(worktreePath)
  await deps.removeWorktree(deps.config.repoRoot, worktreePath, runIdFor(deps, iter), deps.config.prBranchPrefix)
  deps.runState.failed.push({ iter, gate, reason })
  return { iter, outcome: 'failed', gate, reason }
}

function skipIter(
  deps: PipelineDeps,
  iter: number,
  worktreePath: string,
  file: string,
  beforeScore: number,
): Promise<IterationResult> {
  return deps
    .removeWorktree(deps.config.repoRoot, worktreePath, runIdFor(deps, iter), deps.config.prBranchPrefix)
    .then((): IterationResult => ({ iter, outcome: 'skipped', file, beforeScore }))
}

export async function runIteration(deps: PipelineDeps, iter: number): Promise<IterationResult> {
  const worktreePath = worktreeFor(deps, iter)
  const iterPath = iterDir(deps.runState.runDir, iter)
  await mkdir(iterPath, { recursive: true })
  await deps.createWorktree(deps.config.repoRoot, worktreePath, runIdFor(deps, iter), deps.config.prBranchPrefix)

  const sel = await selectPhase(deps, worktreePath, iterPath)
  if (!sel.ok) return failIter(deps, iter, worktreePath, sel.gate, sel.reason)
  const { selection, baseline } = sel.value

  // ② CAPTURE BEFORE (runner-owned). Already at threshold → nothing to do.
  const beforeScore = await deps.measureScore(worktreePath, selection.file)
  if (beforeScore >= deps.config.threshold) {
    deps.runState.doneSet.push(selection.file)
    return skipIter(deps, iter, worktreePath, selection.file, beforeScore)
  }

  const improved = await improvePhase(deps, worktreePath, iterPath, selection.file, beforeScore)

  const gate = await gatePhase(deps, worktreePath, selection.file, improved)
  if (!gate.ok) return failIter(deps, iter, worktreePath, gate.gate, gate.reason)

  return finalizePhase(deps, iter, worktreePath, selection.file, baseline, beforeScore, gate.value, improved)
}

export async function runPipeline(deps: PipelineDeps): Promise<{ results: IterationResult[]; aborted: boolean }> {
  const results: IterationResult[] = []
  // Recurse instead of `for + await` so we don't trip no-await-in-loop. Sequential
  // iteration is required: each iter observes the prior iter's baseline bump and
  // doneSet mutation, so Promise.all parallelism would race the shared runState.
  const runFrom = async (iter: number, aborted: boolean): Promise<{ results: IterationResult[]; aborted: boolean }> => {
    if (aborted || iter > deps.config.count) return { results, aborted }
    deps.runState.currentIteration = iter
    const outcome = await runIteration(deps, iter)
    results.push(outcome)
    if (outcome.gate === 'merge') {
      deps.runState.status = 'aborted'
      return { results, aborted: true }
    }
    return runFrom(iter + 1, false)
  }
  const final = await runFrom(deps.runState.currentIteration + 1, false)
  if (!final.aborted) deps.runState.status = 'completed'
  return final
}
