// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ShellExecFn } from './build-checker.js'
import { saveIssueLedger, type IssueLedger, type LedgerIssueRecord } from './issue-ledger.js'
import { processPendingIssues } from './issue-processor.js'
import {
  emitLoopEnd,
  emitMatchComplete,
  emitReviewComplete,
  emitRoundStart,
  emitRoundSummary,
  newCollector,
  tallyReviewerIssues,
  type RoundCollector,
} from './loop-trace.js'
import {
  filterActionable,
  runMatchAndRecord,
  runReviewStep,
  TERMINAL_STATUSES,
  type RoundAgentDeps,
} from './review-round.js'
import { saveRunState } from './run-state.js'
import type { StopController } from './stop-controller.js'
import type { RoundMetric } from './trace-log.js'
import type { WorkerPool } from './worker-pool.js'

export interface ReviewLoopDeps extends RoundAgentDeps {
  exec: ShellExecFn
  pool: WorkerPool
  inspect: boolean
  /**
   * The run's own bound, when it has one — see `stop-controller.ts`.
   *
   * Consulted between rounds and between issues, which are the two boundaries
   * where everything in hand is committed and the ledger is on disk. Optional,
   * because a run with no budget and no signal handler behaves exactly as it did
   * before this existed.
   */
  stop?: StopController
}

export interface ReviewLoopResult {
  /**
   * `stopped` is not a failure and not a verdict on the code: it says the run
   * reached a bound outside itself — its budget, or a signal — with findings it
   * had not got to. Every other reason means the loop decided it was finished.
   */
  doneReason: 'clean' | 'max_rounds' | 'no_progress' | 'stopped'
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
      stop: deps.stop,
    },
    round,
    collector,
    pending,
  )
}

async function runRound(round: number, deps: ReviewLoopDeps, metrics: RoundMetric[]): Promise<ReviewLoopResult> {
  deps.runState.currentRound = round
  await saveRunState(deps.runState)
  deps.log.issue?.({ type: 'round', round, maxRounds: deps.config.maxRounds })
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

  // Asked here as well as at the end of the round, because the reviewer is the
  // long pole — seven minutes in the run this comes from — so the budget most
  // often runs out *inside* it. Everything past this line spawns another agent or
  // waits on one, and a loop that has agreed to stop must not start either: the
  // slice its caller held back pays for publishing and finalizing, not for a
  // matcher whose answer nothing left in this run will read.
  if ((deps.stop?.requested() ?? null) !== null) {
    return finishRound(deps, metrics, round, 0, collector, 'stopped')
  }

  const matched = await runMatchAndRecord(deps, round, newIssues, collector)
  emitMatchComplete(deps.trace, round, matched.newCount, matched.matchedCount)

  if (newIssues.length === 0) {
    deps.log.log(`[done] clean after ${round} round${round === 1 ? '' : 's'}`)
    await saveRunState(deps.runState)
    return finishRound(deps, metrics, round, matched.newCount, collector, 'clean')
  }

  const pending = filterActionable(matched.records)
  const fixedThisRound = await runProcessPendingIssues(deps, round, collector, pending)
  deps.log.log(`[round ${round}] Fixed ${fixedThisRound}/${pending.length} issues`)

  const ending = roundEnding(deps, round, await recordProgress(deps, fixedThisRound))
  if (ending !== null) return finishRound(deps, metrics, round, matched.newCount, collector, ending)

  pushRoundMetric(deps, metrics, round, matched.newCount, collector)
  return runRound(round + 1, deps, metrics)
}

/**
 * Persists what the round changed and answers how many rounds have now fixed
 * nothing — the figure {@link roundEnding} judges.
 *
 * Both writes happen here rather than at the end of the run, and that is what a
 * resumed run reads: the cursor and the ledger on disk are the whole of what
 * survives this process.
 */
async function recordProgress(deps: ReviewLoopDeps, fixedThisRound: number): Promise<number> {
  const noProgressRounds = fixedThisRound === 0 ? deps.runState.noProgressRounds + 1 : 0
  deps.runState.noProgressRounds = noProgressRounds
  await saveRunState(deps.runState)
  await saveIssueLedger(deps.ledger)
  return noProgressRounds
}

/**
 * Which ending this round is, or `null` for "run another one".
 *
 * The stop is asked **first**, and that order is the whole reason this is one
 * function rather than three ifs. A round the stop cut short fixed fewer issues
 * than it found, which is indistinguishable from a fixer that could not fix them
 * — so asked second, it would be reported as `no_progress`, a verdict on the
 * fixer, when what happened was a verdict on the clock.
 */
function roundEnding(
  deps: ReviewLoopDeps,
  round: number,
  noProgressRounds: number,
): ReviewLoopResult['doneReason'] | null {
  const stopped = deps.stop?.requested() ?? null
  if (stopped !== null) {
    deps.log.log(`[done] stopped — ${stopped === 'budget' ? 'out of time for this run' : 'asked to stop'}`)
    return 'stopped'
  }
  if (noProgressRounds >= deps.config.maxNoProgressRounds) {
    deps.log.log(`[done] no_progress`)
    return 'no_progress'
  }
  if (round >= deps.config.maxRounds) {
    deps.log.log(`[done] max_rounds`)
    return 'max_rounds'
  }
  return null
}

export async function runReviewLoop(deps: ReviewLoopDeps): Promise<ReviewLoopResult> {
  const nextRound = deps.runState.currentRound + 1
  // A stop that is already asked for when the run is entered — a resume onto a
  // runner with minutes left, a signal during startup — must not open a reviewer
  // whose findings nothing will have time to fix.
  if ((deps.stop?.requested() ?? null) !== null) {
    emitLoopEnd(deps.trace, deps.runState.currentRound, 'stopped', [])
    return terminalResult(deps, 'stopped', deps.runState.currentRound, [])
  }
  if (nextRound > deps.config.maxRounds) {
    emitLoopEnd(deps.trace, deps.runState.currentRound, 'max_rounds', [])
    return terminalResult(deps, 'max_rounds', deps.runState.currentRound, [])
  }

  const metrics: RoundMetric[] = []
  try {
    return await runRound(nextRound, deps, metrics)
  } catch (error) {
    return failedOrStopped(deps, metrics, error)
  }
}

/**
 * A throw during a stop is the stop, not a failure.
 *
 * The stop is honoured at boundaries, so something is nearly always **running**
 * when the budget expires — and what happens to it next is that its own timeout,
 * capped by that same budget, kills it and `runAgent` throws. Let that escape and
 * the run exits 1 with no summary, no metrics and no exit code its caller can
 * tell from a broken loop: an hour of published fixes reported as a crash.
 *
 * Narrow on purpose. With no stop asked for, the throw is what it has always been
 * and leaves by the same door, because a reviewer that cannot start and a run that
 * ran out of time are not the same news. The metrics of the rounds that finished
 * ride out with it — they are already on disk in the trace, and dropping them here
 * would make the summary of a stopped run poorer than the trace beside it.
 */
function failedOrStopped(deps: ReviewLoopDeps, metrics: RoundMetric[], error: unknown): ReviewLoopResult {
  if ((deps.stop?.requested() ?? null) === null) throw error

  deps.log.log(`[done] stopped — the run was cut short: ${error instanceof Error ? error.message : String(error)}`)
  emitLoopEnd(deps.trace, deps.runState.currentRound, 'stopped', metrics)
  return terminalResult(deps, 'stopped', deps.runState.currentRound, metrics)
}
