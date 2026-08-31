// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { agentWritePath, type AgentRunResult } from '../../review-loop/src/agent-runner.js'
import { headSha, type DiffStats } from '../../review-loop/src/diff-stats.js'
import type { MergeResult } from '../../review-loop/src/worktree.js'
import { bumpScore, type BaselineMap } from './baseline.js'
import type { CappedRegistryStore } from './capped-registry.js'
import type { MutationImproveConfig } from './config.js'
import { recordFailure, type FailureEntry } from './failure-recorder.js'
import { gatePhase, measurementOf, type GateOutcome, type PhaseResult } from './gate.js'
import { formatIterLine, ITER_SLOT_KEY } from './iter-line.js'
import { branchFor, runIdFor, worktreeFor } from './iter-paths.js'
import { reportMergeDiff } from './merge-stats.js'
import { buildImprovePrompt, buildSelectPrompt } from './prompt-templates.js'
import { ResultSchema, type Result } from './result-schema.js'
import { iterDir, type MutationImproveRunState } from './run-state.js'
import type { MeasuredScore } from './score-reader.js'
import { SelectionSchema, type Selection } from './selection-schema.js'
import { ratchetVerifiedSkip } from './skip-ratchet.js'

export interface IterationResult {
  iter: number
  outcome: 'improved' | 'skipped' | 'failed' | 'capped'
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
  runBuildCheck: (worktreePath: string) => Promise<{ passed: boolean; stdout: string; stderr: string }>
  measureScore: (worktreePath: string, srcFile: string) => Promise<MeasuredScore>
  readBaseline: (repoRoot: string) => Promise<BaselineMap>
  writeBaseline: (repoRoot: string, map: BaselineMap) => Promise<void>
  runSelectAgent: (worktreePath: string, prompt: string, outputPath: string) => Promise<AgentRunResult<Selection>>
  runImproveAgent: (worktreePath: string, prompt: string, outputPath: string) => Promise<AgentRunResult<Result>>
  cappedRegistry: CappedRegistryStore
  saveRunState: (state: MutationImproveRunState) => Promise<void>
  log: {
    log: (msg: string) => void
    issue?: unknown
    diff?: (label: string, diff: DiffStats) => void
    slot?: (key: string, line: string | null) => void
    commit?: (key: string, line?: string) => void
  }
}

// ① SELECT — runner reads baseline; agent only suggests. Reject picks not in baseline
// (nothing to improve), already done (would re-do work), already failed this run
// (same gates, same model — a re-pick almost certainly re-fails and burns an
// iteration), or capped by an earlier run (its tests-only ceiling is already
// merged; re-picking can only re-discover it). All four are agent mistakes.
async function selectPhase(
  deps: PipelineDeps,
  worktreePath: string,
  iterPath: string,
): Promise<PhaseResult<{ selection: Selection; baseline: BaselineMap }>> {
  const baseline = await deps.readBaseline(deps.config.repoRoot)
  const failedFiles = deps.runState.failed.flatMap((f) => (f.file === undefined ? [] : [f.file]))
  const selectOut = path.join(iterPath, 'selection.json')
  const selectRes = await deps.runSelectAgent(
    worktreePath,
    buildSelectPrompt({
      doneSet: deps.runState.doneSet,
      failedFiles,
      cappedFiles: deps.cappedRegistry.entries,
      baselineSummary: JSON.stringify(baseline),
      outputPath: agentWritePath(worktreePath, selectOut),
    }),
    selectOut,
  )
  const selection = SelectionSchema.parse(selectRes.value)
  if (deps.runState.doneSet.includes(selection.file) || baseline[selection.file] === undefined) {
    return { ok: false, gate: 'select', reason: 'selection file not in baseline or already done', file: selection.file }
  }
  if (failedFiles.includes(selection.file)) {
    return { ok: false, gate: 'select', reason: 'selection file already failed this run', file: selection.file }
  }
  if (deps.cappedRegistry.entries.some((e) => e.file === selection.file)) {
    return {
      ok: false,
      gate: 'select',
      reason: 'selection file already capped at its declared residual ceiling',
      file: selection.file,
    }
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
      outputPath: agentWritePath(worktreePath, improveOut),
    }),
    improveOut,
  )
  return ResultSchema.parse(improveRes.value)
}

// C1: write the baseline bump into the WORKTREE (not repoRoot) and commit the
// agent's spec/plan/test outputs together with the bump on the worktree
// branch BEFORE mergeWorktree. Without this, mergeWorktree merges an empty
// branch ("Already up to date"), writeBaseline never propagates to base, and
// removeWorktree --force discards the agent's uncommitted files.
async function commitRatchet(
  deps: PipelineDeps,
  worktreePath: string,
  file: string,
  afterScore: number,
  bumped: BaselineMap,
): Promise<void> {
  await deps.writeBaseline(worktreePath, bumped)
  await deps.execGit(worktreePath, ['add', '-A'])
  await deps.execGit(worktreePath, [
    'commit',
    '--allow-empty',
    '-m',
    `chore(mutation): ratchet ${file} baseline to ${afterScore}`,
  ])
}

// ⑥ RATCHET (runner-owned) → ⑦ MERGE. The baseline bump is written into the
// worktree and committed there together with the agent's spec/plan/test work,
// so mergeWorktree propagates ALL of it to base. On merge conflict the bump
// stays on the unmerged iteration branch (kept for inspection) and does NOT
// advance base; the run aborts (gate:'merge') so no later iteration chains
// off a stale base.
async function finalizePhase(
  deps: PipelineDeps,
  iter: number,
  worktreePath: string,
  file: string,
  baseline: BaselineMap,
  beforeScore: number,
  gate: GateOutcome,
): Promise<IterationResult> {
  const { afterScore, result } = gate
  await commitRatchet(deps, worktreePath, file, afterScore, bumpScore(baseline, file, measurementOf(gate)))
  const beforeSha = await headSha(deps.execGit, deps.config.repoRoot)
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
  await reportMergeDiff(deps, iter, beforeSha)
  // Record the cap only after the merge landed: an aborted run keeps the bump
  // on the unmerged iteration branch, and a persisted cap would wrongly block
  // the file in later runs whose baseline never received the tests.
  if (gate.capped) await deps.cappedRegistry.record(file, afterScore)
  await deps.removeWorktree(deps.config.repoRoot, worktreePath, runIdFor(deps, iter), deps.config.prBranchPrefix)
  deps.runState.doneSet.push(file)
  deps.runState.merged.push({
    file,
    beforeScore,
    afterScore,
    iter,
    residuals: result.residuals,
    ...(gate.capped ? { capped: true } : {}),
  })
  return { iter, outcome: gate.capped ? 'capped' : 'improved', file, beforeScore, afterScore }
}

async function failIter(
  deps: PipelineDeps,
  iter: number,
  worktreePath: string,
  gate: string,
  reason: string,
  file?: string,
): Promise<IterationResult> {
  const entry: FailureEntry = await recordFailure(deps.runState, iter, gate, reason, file)
  await deps.resetWorktree(worktreePath)
  await deps.removeWorktree(deps.config.repoRoot, worktreePath, runIdFor(deps, iter), deps.config.prBranchPrefix)
  return { ...entry, outcome: 'failed' }
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
  // C2: wrap the body so any unexpected throw (AgentRunError, git failure,
  // stryker crash) still routes through the single cleanup path. Without this,
  // a thrown exception bypasses failIter entirely: the worktree and its
  // `mutation-improve/<runId>-iterN` branch are leaked, runState.failed gains
  // no entry, and the next createWorktree for the same path fails.
  let worktreeCreated = false
  let file: string | undefined
  try {
    await deps.createWorktree(deps.config.repoRoot, worktreePath, runIdFor(deps, iter), deps.config.prBranchPrefix)
    worktreeCreated = true

    const sel = await selectPhase(deps, worktreePath, iterPath)
    if (!sel.ok) return await failIter(deps, iter, worktreePath, sel.gate, sel.reason, sel.file)
    const { selection, baseline } = sel.value
    file = selection.file

    // ② CAPTURE BEFORE (runner-owned). Already at threshold → nothing to do.
    const before = await deps.measureScore(worktreePath, selection.file)
    const beforeScore = before.score
    if (beforeScore >= deps.config.threshold) {
      deps.runState.doneSet.push(selection.file)
      await ratchetVerifiedSkip(deps, baseline, selection.file, before)
      return await skipIter(deps, iter, worktreePath, selection.file, beforeScore)
    }

    const improved = await improvePhase(deps, worktreePath, iterPath, selection.file, beforeScore)

    const gate = await gatePhase(deps, iterPath, worktreePath, selection.file, beforeScore, improved)
    if (!gate.ok) return await failIter(deps, iter, worktreePath, gate.gate, gate.reason, file)

    return await finalizePhase(deps, iter, worktreePath, selection.file, baseline, beforeScore, gate.value)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    // If createWorktree itself threw there is nothing to reset/remove; record
    // the failure (no file — selection never ran) so the run is not dropped.
    if (!worktreeCreated) {
      await recordFailure(deps.runState, iter, 'exception', reason)
      return { iter, outcome: 'failed', gate: 'exception', reason }
    }
    return failIter(deps, iter, worktreePath, 'exception', reason, file)
  }
}

export async function runPipeline(deps: PipelineDeps): Promise<{ results: IterationResult[]; aborted: boolean }> {
  const results: IterationResult[] = []
  // Recurse instead of `for + await` so we don't trip no-await-in-loop. Sequential
  // iteration is required: each iter observes the prior iter's baseline bump and
  // doneSet mutation, so Promise.all parallelism would race the shared runState.
  const runFrom = async (iter: number, aborted: boolean): Promise<{ results: IterationResult[]; aborted: boolean }> => {
    if (aborted || iter > deps.config.count) return { results, aborted }
    deps.runState.currentIteration = iter
    const iterStart = Date.now()
    const outcome = await runIteration(deps, iter)
    deps.log.commit?.(ITER_SLOT_KEY, formatIterLine(outcome, Date.now() - iterStart))
    results.push(outcome)
    if (outcome.gate === 'merge') {
      deps.runState.status = 'aborted'
      await deps.saveRunState(deps.runState)
      return { results, aborted: true }
    }
    await deps.saveRunState(deps.runState)
    return runFrom(iter + 1, false)
  }
  const final = await runFrom(deps.runState.currentIteration + 1, false)
  if (!final.aborted) deps.runState.status = 'completed'
  return final
}
