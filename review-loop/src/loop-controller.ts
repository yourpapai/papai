// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { agentWritePath, runAgent, type SpawnFn } from './agent-runner.js'
import { runBuildCheck, type BuildCheckResult, type ShellExecFn } from './build-checker.js'
import type { ReviewLoopConfig } from './config.js'
import {
  applyMatchedIssues,
  closeUnreportedFixed,
  recordFixAttempt,
  recordVerification,
  saveIssueLedger,
  type IssueLedger,
  type LedgerIssueRecord,
} from './issue-ledger.js'
import { matchIssues } from './issue-matcher.js'
import { FixerResultSchema, ReviewerIssuesSchema } from './issue-schema.js'
import type { FixerResult, ReviewerIssue } from './issue-schema.js'
import { formatDuration, withLivePhase } from './live-renderer.js'
import type { ProgressReporter } from './progress-log.js'
import { buildFixPrompt, buildReviewPrompt, buildRetryFixPrompt } from './prompt-templates.js'
import { saveRunState, type RunState } from './run-state.js'
import { execGit } from './worktree.js'

const TERMINAL_STATUSES = new Set<LedgerIssueRecord['status']>(['rejected', 'already_fixed', 'needs_human'])

export interface ReviewLoopDeps {
  config: ReviewLoopConfig
  runState: RunState
  ledger: IssueLedger
  spawn: SpawnFn
  exec: ShellExecFn
  log: ProgressReporter
}

export interface ReviewLoopResult {
  doneReason: 'clean' | 'max_rounds' | 'no_progress'
  rounds: number
  ledger: IssueLedger['snapshot']
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength - 1)}\u2026`
}

function shortTitle(record: LedgerIssueRecord): string {
  return truncate(record.issue.title, 60)
}

function terminalResult(
  deps: ReviewLoopDeps,
  doneReason: ReviewLoopResult['doneReason'],
  round: number,
): ReviewLoopResult {
  return { doneReason, rounds: round, ledger: deps.ledger.snapshot }
}

function runFixer(deps: ReviewLoopDeps, prompt: string, label: string): Promise<FixerResult> {
  return runAgent({
    spawn: deps.spawn,
    model: deps.config.fixer.model,
    cwd: deps.runState.worktreePath,
    prompt,
    outputPath: deps.runState.resultPath,
    outputSchema: FixerResultSchema,
    label,
    reporter: deps.log,
    logPath: deps.runState.logPath,
    extraArgs: deps.config.fixer.extraArgs,
    timeoutMs: deps.config.agentTimeoutMs,
  })
}

async function runBuildWithLogging(deps: ReviewLoopDeps): Promise<BuildCheckResult> {
  const phase = await withLivePhase(deps.log, 'build', () => runBuildCheck({ exec: deps.exec }))
  deps.log.event(`[build] ${phase.result.passed ? 'passed' : 'FAILED'} \u00B7 ${formatDuration(phase.durationMs)}`)
  return phase.result
}

async function retryFixAfterBuildFailure(
  record: LedgerIssueRecord,
  deps: ReviewLoopDeps,
  buildError: string,
  baselineSha: string,
): Promise<boolean> {
  deps.log.log(`[fix] build failed, retrying...`)

  const result = await runFixer(
    deps,
    buildRetryFixPrompt(record.issue, agentWritePath(deps.runState.resultPath), buildError, deps.config.checkCommand),
    'fixer-retry',
  )

  if (!result.fixed || result.verdict !== 'valid') {
    await execGit(deps.runState.worktreePath, ['reset', '--hard', baselineSha])
    recordVerification(deps.ledger, record.id, {
      verdict: result.verdict,
      fixability: result.fixability,
      reasoning: result.reasoning,
      targetFiles: result.targetFiles,
    })
    deps.log.log(`[fix] "${shortTitle(record)}" \u2192 ${result.verdict} (after retry)`)
    return false
  }

  const retryBuild = await runBuildWithLogging(deps)

  if (retryBuild.passed) {
    await ensureFixerChangesCommitted(deps, record)
    recordFixAttempt(deps.ledger, record.id)
    deps.log.log(`[fix] "${shortTitle(record)}" \u2192 fixed (after retry)`)
    return true
  }

  await execGit(deps.runState.worktreePath, ['reset', '--hard', baselineSha])
  recordVerification(deps.ledger, record.id, {
    verdict: 'needs_human',
    fixability: 'manual',
    reasoning: `Build failed after retry: ${retryBuild.stderr}`,
    targetFiles: result.targetFiles,
  })
  deps.log.log(`[fix] "${shortTitle(record)}" → needs_human (build failed)`)
  return false
}

async function ensureFixerChangesCommitted(deps: ReviewLoopDeps, record: LedgerIssueRecord): Promise<void> {
  const status = (await execGit(deps.runState.worktreePath, ['status', '--porcelain'])).stdout.trim()
  if (status.length === 0) {
    return
  }
  await execGit(deps.runState.worktreePath, ['add', '-A'])
  await execGit(deps.runState.worktreePath, ['commit', '-m', `fix(review-loop): ${record.issue.title}`])
  deps.log.log(`[fix] "${shortTitle(record)}" \u2192 auto-committed uncommitted changes`)
}

async function processIssue(record: LedgerIssueRecord, deps: ReviewLoopDeps): Promise<{ fixed: boolean }> {
  deps.log.log(`[fix] "${shortTitle(record)}" — verifying...`)

  const baselineSha = (await execGit(deps.runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()

  const result = await runFixer(
    deps,
    buildFixPrompt(record.issue, agentWritePath(deps.runState.resultPath), deps.config.checkCommand),
    'fixer',
  )

  recordVerification(deps.ledger, record.id, {
    verdict: result.verdict,
    fixability: result.fixability,
    reasoning: result.reasoning,
    targetFiles: result.targetFiles,
  })

  if (!result.fixed || result.verdict !== 'valid') {
    await execGit(deps.runState.worktreePath, ['reset', '--hard', baselineSha])
    deps.log.log(`[fix] "${shortTitle(record)}" → ${result.verdict}`)
    return { fixed: false }
  }

  const buildResult = await runBuildWithLogging(deps)

  if (buildResult.passed) {
    await ensureFixerChangesCommitted(deps, record)
    recordFixAttempt(deps.ledger, record.id)
    deps.log.log(`[fix] "${shortTitle(record)}" \u2192 fixed`)
    return { fixed: true }
  }

  const fixed = await retryFixAfterBuildFailure(record, deps, buildResult.stderr, baselineSha)
  return { fixed }
}

async function processNextIssue(
  pending: readonly LedgerIssueRecord[],
  index: number,
  deps: ReviewLoopDeps,
  fixed: number,
): Promise<number> {
  if (index >= pending.length) {
    return fixed
  }
  const result = await processIssue(pending[index]!, deps)
  await saveIssueLedger(deps.ledger)
  return processNextIssue(pending, index + 1, deps, result.fixed ? fixed + 1 : fixed)
}

function filterActionable(records: readonly LedgerIssueRecord[]): readonly LedgerIssueRecord[] {
  return records.filter((r) => !TERMINAL_STATUSES.has(r.status))
}

async function runReviewStep(deps: ReviewLoopDeps): Promise<readonly ReviewerIssue[]> {
  deps.log.log(`[round ${deps.runState.currentRound}/${deps.config.maxRounds}] Reviewing...`)

  const reviewResult = await runAgent({
    spawn: deps.spawn,
    model: deps.config.reviewer.model,
    cwd: deps.runState.worktreePath,
    prompt: buildReviewPrompt(deps.runState.planPath, agentWritePath(deps.runState.issuesPath)),
    outputPath: deps.runState.issuesPath,
    outputSchema: ReviewerIssuesSchema,
    label: 'reviewer',
    reporter: deps.log,
    logPath: deps.runState.logPath,
    extraArgs: deps.config.reviewer.extraArgs,
    timeoutMs: deps.config.agentTimeoutMs,
  })

  return reviewResult.issues
}

async function runMatchAndRecord(
  deps: ReviewLoopDeps,
  round: number,
  newIssues: readonly ReviewerIssue[],
): Promise<readonly LedgerIssueRecord[]> {
  const existingRecords = Object.values(deps.ledger.snapshot.issues)

  const matches = await matchIssues({
    spawn: deps.spawn,
    newIssues,
    existingRecords,
    outputPath: deps.runState.matchesPath,
    logPath: deps.runState.logPath,
    cwd: deps.runState.worktreePath,
    model: deps.config.matcher.model,
    extraArgs: deps.config.matcher.extraArgs,
    reporter: deps.log,
    timeoutMs: deps.config.agentTimeoutMs,
  })

  const roundRecords = applyMatchedIssues(deps.ledger, round, newIssues, matches)
  closeUnreportedFixed(
    deps.ledger,
    roundRecords.map((r) => r.id),
  )
  await saveIssueLedger(deps.ledger)

  return roundRecords
}

async function runRound(round: number, deps: ReviewLoopDeps): Promise<ReviewLoopResult> {
  deps.runState.currentRound = round
  const newIssues = await runReviewStep(deps)

  if (newIssues.length === 0 && round === 1) {
    deps.log.log(`[done] clean — no issues found`)
    await saveRunState(deps.runState)
    return terminalResult(deps, 'clean', round)
  }

  const roundRecords = await runMatchAndRecord(deps, round, newIssues)

  if (newIssues.length === 0) {
    deps.log.log(`[done] clean after ${round} round${round === 1 ? '' : 's'}`)
    await saveRunState(deps.runState)
    return terminalResult(deps, 'clean', round)
  }

  deps.log.log(`[round ${round}] Found ${newIssues.length} issues`)

  const pending = filterActionable(roundRecords)
  const fixedThisRound = await processNextIssue(pending, 0, deps, 0)

  deps.log.log(`[round ${round}] Fixed ${fixedThisRound}/${pending.length} issues`)

  const newNoProgress = fixedThisRound === 0 ? deps.runState.noProgressRounds + 1 : 0
  deps.runState.noProgressRounds = newNoProgress
  await saveRunState(deps.runState)
  await saveIssueLedger(deps.ledger)

  if (newNoProgress >= deps.config.maxNoProgressRounds) {
    deps.log.log(`[done] no_progress`)
    return terminalResult(deps, 'no_progress', round)
  }

  if (round >= deps.config.maxRounds) {
    deps.log.log(`[done] max_rounds`)
    return terminalResult(deps, 'max_rounds', round)
  }

  return runRound(round + 1, deps)
}

export function runReviewLoop(deps: ReviewLoopDeps): Promise<ReviewLoopResult> {
  const nextRound = deps.runState.currentRound + 1
  if (nextRound > deps.config.maxRounds) {
    return Promise.resolve(terminalResult(deps, 'max_rounds', deps.runState.currentRound))
  }
  return runRound(nextRound, deps)
}
