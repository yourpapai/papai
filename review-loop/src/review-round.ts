// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { agentWritePath, runAgent, type SpawnFn } from './agent-runner.js'
import type { ReviewLoopConfig } from './config.js'
import { applyMatchedIssues, closeUnreportedFixed, saveIssueLedger } from './issue-ledger.js'
import type { IssueLedger, LedgerIssueRecord } from './issue-ledger.js'
import { matchIssues } from './issue-matcher.js'
import { ReviewerIssuesSchema } from './issue-schema.js'
import type { IssueMatch, ReviewerIssue } from './issue-schema.js'
import { tallyPhaseMs, tallyUsage, type RoundCollector } from './loop-trace.js'
import type { ProgressReporter } from './progress-log.js'
import { buildReviewPrompt } from './prompt-templates.js'
import type { RunState } from './run-state.js'
import type { TraceLogger } from './trace-log.js'

/**
 * The two agent steps every round opens with: look at the tree, then work out
 * which of what was found is already known.
 *
 * Split from `loop-controller.ts`, which is about a round's *control flow* — when
 * a round starts, what ends the loop, which reason is recorded. These two are the
 * work a round does before any of that applies, and they answer to a smaller set
 * of dependencies ({@link RoundAgentDeps}) than the loop as a whole: no worker
 * pool, no build gate, no stop. Keeping the narrower need visible in the type is
 * half the point of the seam.
 */

/** Everything the reviewing half of a round touches, and nothing else. */
export interface RoundAgentDeps {
  config: ReviewLoopConfig
  runState: RunState
  ledger: IssueLedger
  spawn: SpawnFn
  log: ProgressReporter
  trace: TraceLogger
}

/** Statuses no further round will act on, so nothing re-dispatches them. */
export const TERMINAL_STATUSES = new Set<LedgerIssueRecord['status']>(['rejected', 'already_fixed', 'needs_human'])

const MATCHER_RECENT_ROUNDS = 2

/**
 * Severity grades what happens *if* the code is reached. Code that is merely
 * more than it needs to be does not lose data, breach security or crash, so a
 * cleanup graded above medium is a mis-grade rather than an emergency.
 *
 * Clamped here rather than trusted from the prompt, for the reason `exposure`
 * is a citation instead of a rating: severity is this loop's standing proof
 * that a self-assigned grade inflates. The prompt states the rule; this is what
 * makes it true.
 *
 * Applied at ingest, before matching and before the ledger, so a resumed run
 * never re-reads an ungraded cleanup and nothing downstream needs to know.
 */
export function capCleanupSeverity(issues: readonly ReviewerIssue[]): readonly ReviewerIssue[] {
  return issues.map((issue) =>
    issue.kind === 'cleanup' && (issue.severity === 'critical' || issue.severity === 'high')
      ? { ...issue, severity: 'medium' }
      : issue,
  )
}

export function filterActionable(records: readonly LedgerIssueRecord[]): readonly LedgerIssueRecord[] {
  return records.filter((r) => !TERMINAL_STATUSES.has(r.status))
}

function emitFoundEvents(
  deps: RoundAgentDeps,
  matches: readonly IssueMatch[],
  roundRecords: readonly LedgerIssueRecord[],
): void {
  for (const match of matches) {
    if (match.existingId !== null) {
      continue
    }
    const record = roundRecords[match.newIssueIndex]
    if (record === undefined) {
      continue
    }
    deps.log.issue?.({
      type: 'found',
      id: record.id,
      severity: record.issue.severity,
      file: record.issue.file,
      line: record.issue.lineStart,
      title: record.issue.title,
    })
  }
}

export async function runReviewStep(
  deps: RoundAgentDeps,
  collector: RoundCollector,
): Promise<readonly ReviewerIssue[]> {
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

  return capCleanupSeverity(reviewResult.value.issues)
}

export async function runMatchAndRecord(
  deps: RoundAgentDeps,
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

  emitFoundEvents(deps, matches, roundRecords)

  return { records: roundRecords, newCount, matchedCount }
}
