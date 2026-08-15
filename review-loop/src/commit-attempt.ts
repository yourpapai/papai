// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { measureDiffPathsSince, touchedTestPath, type ExecGitFn } from './diff-stats.js'
import { recordFixAttempt, recordNeedsHuman, type LedgerIssueRecord } from './issue-ledger.js'
import { sanitizeSubject, shortTitle } from './issue-processor.js'
import type { IssueProcessorDeps } from './issue-processor.js'
import type { FixerResult } from './issue-schema.js'
import {
  emitFixComplete,
  exposureKind,
  tallyCheckBehind,
  tallyDecision,
  tallyExposure,
  tallyFixerSeverity,
  tallyPhaseMs,
  type RoundCollector,
} from './loop-trace.js'
import { emitDecision } from './progress-log.js'
import type { Worker } from './worker-pool.js'
import { execGit } from './worktree.js'

/**
 * Whether an accepted fix left a runnable check behind — `unmeasured` when the
 * diff could not be read at all, which is deliberately not the same answer as
 * "no check". Never throws: this is a report about a fix that has already been
 * accepted, and losing the fix to a failed measurement would be absurd.
 */
export type CheckBehind = 'with-check' | 'without-check' | 'unmeasured'

export async function measureCheckBehind(execGitFn: ExecGitFn, cwd: string, baselineSha: string): Promise<CheckBehind> {
  try {
    const paths = await measureDiffPathsSince(execGitFn, cwd, baselineSha)
    return touchedTestPath(paths) ? 'with-check' : 'without-check'
  } catch {
    return 'unmeasured'
  }
}

export async function ensureFixerChangesCommitted(
  deps: IssueProcessorDeps,
  worker: Worker,
  record: LedgerIssueRecord,
  commitMessage: string | undefined,
): Promise<string> {
  const worktreePath = worker.worktreePath
  const status = (await execGit(worktreePath, ['status', '--porcelain'])).stdout.trim()
  if (status.length === 0) {
    return (await execGit(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()
  }
  const provided = commitMessage?.trim()
  const fallback = `fix(review-loop): ${record.issue.title}`
  const sanitized = sanitizeSubject(provided !== undefined && provided !== '' ? provided : fallback)
  const subject = sanitized.length > 0 ? sanitized : sanitizeSubject(fallback)
  await execGit(worktreePath, ['add', '-A'])
  await execGit(worktreePath, ['commit', '-m', subject])
  deps.log.log(`[fix] "${shortTitle(record)}" → auto-committed uncommitted changes`)
  return (await execGit(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()
}

/** The two per-fixer-result tallies that every branch of a commit attempt owes. */
function tallyFixerOutcome(collector: RoundCollector, record: LedgerIssueRecord, fixerResult: FixerResult): void {
  tallyFixerSeverity(collector, fixerResult.severity)
  tallyExposure(collector, exposureKind(record.issue.exposure), exposureKind(fixerResult.exposure))
}

function recordAcceptedFix(
  deps: IssueProcessorDeps,
  record: LedgerIssueRecord,
  fixerResult: FixerResult,
  checkBehind: CheckBehind,
  attempt: number,
  round: number,
  collector: RoundCollector,
  postSha: string,
): void {
  recordFixAttempt(deps.ledger, record.id)
  if (checkBehind === 'unmeasured') {
    deps.log.log(`[fix] "${shortTitle(record)}" → check-behind signal unavailable for this fix`)
  }
  tallyCheckBehind(collector, checkBehind)
  tallyDecision(collector, fixerResult.verdict, fixerResult.fixed)
  tallyFixerOutcome(collector, record, fixerResult)
  emitDecision(deps.log, record, 'fixed', attempt === 1 ? undefined : 'after retry')
  emitFixComplete(deps.trace, round, record.id, true, postSha, attempt)
}

export async function runCommitAttempt(
  deps: IssueProcessorDeps,
  worker: Worker,
  record: LedgerIssueRecord,
  baselineSha: string,
  fixerResult: FixerResult,
  attempt: number,
  round: number,
  collector: RoundCollector,
): Promise<{ fixed: boolean }> {
  const mergeStart = Date.now()
  try {
    const postSha = await ensureFixerChangesCommitted(deps, worker, record, fixerResult.commitMessage)
    if (postSha === baselineSha) {
      collector.decisions.no_commit += 1
      tallyFixerOutcome(collector, record, fixerResult)
      emitFixComplete(deps.trace, round, record.id, false, null, attempt)
      emitDecision(deps.log, record, 'no_commit', 'fixed:true was a false claim')
      return { fixed: false }
    }

    // Measured before the merge, deliberately: mergeWorkerIntoPrimary rebases the
    // worker branch onto primary, after which baselineSha is no longer its
    // ancestor and the diff would sweep in whatever other workers landed.
    const checkBehind = await measureCheckBehind(execGit, worker.worktreePath, baselineSha)

    const mergeResult = await deps.pool.mergeWorkerIntoPrimary(worker)
    if (!mergeResult.ok) {
      await worker.resetToBaseline(baselineSha)
      const reasoning = `Merge conflict on ${mergeResult.conflictFiles.join(', ')}`
      recordNeedsHuman(deps.ledger, deps.trace, round, record, reasoning, fixerResult)
      tallyDecision(collector, 'needs_human', false)
      tallyFixerOutcome(collector, record, fixerResult)
      emitDecision(deps.log, record, 'needs_human', 'merge conflict')
      emitFixComplete(deps.trace, round, record.id, false, null, attempt)
      return { fixed: false }
    }

    recordAcceptedFix(deps, record, fixerResult, checkBehind, attempt, round, collector, postSha)
    return { fixed: true }
  } finally {
    tallyPhaseMs(collector, 'fix', Date.now() - mergeStart)
  }
}
