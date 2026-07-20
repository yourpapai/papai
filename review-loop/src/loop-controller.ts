// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { agentWritePath, runAgent, type SpawnFn } from './agent-runner.js'
import type { ShellExecFn } from './build-checker.js'
import type { ReviewLoopConfig } from './config.js'
import {
  applyMatchedIssues,
  closeUnreportedFixed,
  saveIssueLedger,
  type IssueLedger,
  type LedgerIssueRecord,
} from './issue-ledger.js'
import { matchIssues } from './issue-matcher.js'
import { processPendingIssues } from './issue-processor.js'
import { ReviewerIssuesSchema } from './issue-schema.js'
import type { ReviewerIssue } from './issue-schema.js'
import {
  emitLoopEnd,
  emitMatchComplete,
  emitReviewComplete,
  emitRoundStart,
  emitRoundSummary,
  newCollector,
  tallyPhaseMs,
  tallyReviewerIssues,
  tallyUsage,
  type RoundCollector,
} from './loop-trace.js'
import type { ProgressReporter } from './progress-log.js'
import { buildReviewPrompt } from './prompt-templates.js'
import { saveRunState, type RunState } from './run-state.js'
import type { RoundMetric, TraceLogger } from './trace-log.js'
import type { WorkerPool } from './worker-pool.js'

const TERMINAL_STATUSES = new Set<LedgerIssueRecord['status']>(['rejected', 'already_fixed', 'needs_human'])

const MATCHER_RECENT_ROUNDS = 2

export interface ReviewLoopDeps {
  config: ReviewLoopConfig
  runState: RunState
  ledger: IssueLedger
  spawn: SpawnFn
  exec: ShellExecFn
  log: ProgressReporter
  trace: TraceLogger
  pool: WorkerPool
  inspect: boolean
}

export interface ReviewLoopResult {
  doneReason: 'clean' | 'max_rounds' | 'no_progress'
  rounds: number
  ledger: IssueLedger['snapshot']
  metrics?: RoundMetric[]
}

function countOpen(deps: ReviewLoopDeps): number {
  return Object.values(deps.ledger.snapshot.issues).filter((r) => !TERMINAL_STATUSES.has(r.status)).length
}

function terminalResult(
  deps: ReviewLoopDeps,
  doneReason: ReviewLoopResult['doneReason'],
  round: number,
  metrics: RoundMetric[],
): ReviewLoopResult {
  return { doneReason, rounds: round, ledger: deps.ledger.snapshot, metrics }
}

function pushRoundMetric(
  deps: ReviewLoopDeps,
  metrics: RoundMetric[],
  round: number,
  newCount: number,
  collector: RoundCollector,
): void {
  const metric: RoundMetric = {
    round,
    newIssues: newCount,
    cumulativeOpen: countOpen(deps),
    noProgressRounds: deps.runState.noProgressRounds,
    decisions: collector.decisions,
    reviewerSeverity: collector.reviewerSeverity,
    fixerSeverity: collector.fixerSeverity,
    inspector: collector.inspector,
    phaseMs: collector.phaseMs,
    usage: collector.usage,
  }
  metrics.push(metric)
  emitRoundSummary(deps.trace, metric)
}

function finishRound(
  deps: ReviewLoopDeps,
  metrics: RoundMetric[],
  round: number,
  newCount: number,
  collector: RoundCollector,
  doneReason: ReviewLoopResult['doneReason'],
): ReviewLoopResult {
  pushRoundMetric(deps, metrics, round, newCount, collector)
  emitLoopEnd(deps.trace, round, doneReason, metrics)
  return terminalResult(deps, doneReason, round, metrics)
}

function filterActionable(records: readonly LedgerIssueRecord[]): readonly LedgerIssueRecord[] {
  return records.filter((r) => !TERMINAL_STATUSES.has(r.status))
}

async function runReviewStep(deps: ReviewLoopDeps, collector: RoundCollector): Promise<readonly ReviewerIssue[]> {
  deps.log.log(`[round ${deps.runState.currentRound}/${deps.config.maxRounds}] Reviewing...`)

  const reviewStart = Date.now()
  const reviewResult = await runAgent({
    spawn: deps.spawn,
    model: deps.config.reviewer.model,
    cwd: deps.runState.worktreePath,
    prompt: buildReviewPrompt(
      deps.runState.planPath,
      agentWritePath(deps.runState.worktreePath, deps.runState.issuesPath),
    ),
    outputPath: deps.runState.issuesPath,
    outputSchema: ReviewerIssuesSchema,
    label: 'reviewer',
    reporter: deps.log,
    logPath: deps.runState.logPath,
    extraArgs: deps.config.reviewer.extraArgs,
    timeoutMs: deps.config.reviewer.timeoutMs ?? deps.config.agentTimeoutMs,
  })
  tallyPhaseMs(collector, 'review', Date.now() - reviewStart)
  tallyUsage(collector, reviewResult.usage)

  return reviewResult.value.issues
}

async function runMatchAndRecord(
  deps: ReviewLoopDeps,
  round: number,
  newIssues: readonly ReviewerIssue[],
  collector: RoundCollector,
): Promise<{ records: readonly LedgerIssueRecord[]; newCount: number; matchedCount: number }> {
  const existingRecords = Object.values(deps.ledger.snapshot.issues).filter((r) => {
    if (!TERMINAL_STATUSES.has(r.status)) return true
    return round - r.latestSeenRound <= MATCHER_RECENT_ROUNDS
  })

  const matchStart = Date.now()
  const { matches, usage } = await matchIssues({
    spawn: deps.spawn,
    newIssues,
    existingRecords,
    outputPath: deps.runState.matchesPath,
    logPath: deps.runState.logPath,
    cwd: deps.runState.worktreePath,
    model: deps.config.matcher.model,
    extraArgs: deps.config.matcher.extraArgs,
    reporter: deps.log,
    timeoutMs: deps.config.matcher.timeoutMs ?? deps.config.agentTimeoutMs,
  })
  tallyPhaseMs(collector, 'match', Date.now() - matchStart)
  tallyUsage(collector, usage)

  const newCount = matches.filter((m) => m.existingId === null).length
  const matchedCount = matches.length - newCount

  const roundRecords = applyMatchedIssues(deps.ledger, round, newIssues, matches)
  closeUnreportedFixed(
    deps.ledger,
    roundRecords.map((r) => r.id),
  )
  await saveIssueLedger(deps.ledger)

  return { records: roundRecords, newCount, matchedCount }
}

function runProcessPendingIssues(
  deps: ReviewLoopDeps,
  round: number,
  collector: RoundCollector,
  pending: readonly LedgerIssueRecord[],
): Promise<number> {
  return processPendingIssues(
    {
      config: deps.config,
      runState: deps.runState,
      ledger: deps.ledger,
      spawn: deps.spawn,
      exec: deps.exec,
      log: deps.log,
      trace: deps.trace,
      pool: deps.pool,
      inspect: deps.inspect,
    },
    round,
    collector,
    pending,
  )
}

async function runRound(round: number, deps: ReviewLoopDeps, metrics: RoundMetric[]): Promise<ReviewLoopResult> {
  deps.runState.currentRound = round
  await saveRunState(deps.runState)
  emitRoundStart(deps.trace, round, deps.config.maxRounds, deps.config.maxNoProgressRounds, deps.config.checkCommand)
  const collector = newCollector()

  const newIssues = await runReviewStep(deps, collector)
  tallyReviewerIssues(collector, newIssues)
  emitReviewComplete(deps.trace, round, newIssues)

  if (newIssues.length === 0 && round === 1) {
    deps.log.log(`[done] clean — no issues found`)
    await saveRunState(deps.runState)
    return finishRound(deps, metrics, round, 0, collector, 'clean')
  }

  const matched = await runMatchAndRecord(deps, round, newIssues, collector)
  emitMatchComplete(deps.trace, round, matched.newCount, matched.matchedCount)

  if (newIssues.length === 0) {
    deps.log.log(`[done] clean after ${round} round${round === 1 ? '' : 's'}`)
    await saveRunState(deps.runState)
    return finishRound(deps, metrics, round, matched.newCount, collector, 'clean')
  }

  deps.log.log(`[round ${round}] Found ${newIssues.length} issues`)
  const pending = filterActionable(matched.records)
  const fixedThisRound = await runProcessPendingIssues(deps, round, collector, pending)
  deps.log.log(`[round ${round}] Fixed ${fixedThisRound}/${pending.length} issues`)

  const newNoProgress = fixedThisRound === 0 ? deps.runState.noProgressRounds + 1 : 0
  deps.runState.noProgressRounds = newNoProgress
  await saveRunState(deps.runState)
  await saveIssueLedger(deps.ledger)

  if (newNoProgress >= deps.config.maxNoProgressRounds) {
    deps.log.log(`[done] no_progress`)
    return finishRound(deps, metrics, round, matched.newCount, collector, 'no_progress')
  }

  if (round >= deps.config.maxRounds) {
    deps.log.log(`[done] max_rounds`)
    return finishRound(deps, metrics, round, matched.newCount, collector, 'max_rounds')
  }

  pushRoundMetric(deps, metrics, round, matched.newCount, collector)
  return runRound(round + 1, deps, metrics)
}

export function runReviewLoop(deps: ReviewLoopDeps): Promise<ReviewLoopResult> {
  const nextRound = deps.runState.currentRound + 1
  if (nextRound > deps.config.maxRounds) {
    emitLoopEnd(deps.trace, deps.runState.currentRound, 'max_rounds', [])
    return Promise.resolve(terminalResult(deps, 'max_rounds', deps.runState.currentRound, []))
  }
  return runRound(nextRound, deps, [])
}
