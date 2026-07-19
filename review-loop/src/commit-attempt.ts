// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { recordFixAttempt, recordNeedsHuman, type LedgerIssueRecord } from './issue-ledger.js'
import { sanitizeSubject } from './issue-processor.js'
import type { IssueProcessorDeps } from './issue-processor.js'
import type { FixerResult } from './issue-schema.js'
import { emitFixComplete, tallyDecision, tallyFixerSeverity, tallyPhaseMs, type RoundCollector } from './loop-trace.js'
import type { Worker } from './worker-pool.js'
import { execGit } from './worktree.js'

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

function shortTitle(record: LedgerIssueRecord): string {
  return record.issue.title.length > 60 ? `${record.issue.title.slice(0, 59)}\u2026` : record.issue.title
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
  const postSha = await ensureFixerChangesCommitted(deps, worker, record, fixerResult.commitMessage)
  tallyPhaseMs(collector, 'fix', Date.now() - mergeStart)
  if (postSha === baselineSha) {
    collector.decisions.no_commit += 1
    tallyFixerSeverity(collector, fixerResult.severity)
    emitFixComplete(deps.trace, round, record.id, false, null, attempt)
    deps.log.log(`[fix] "${shortTitle(record)}" → no change (fixed:true was a false claim)`)
    return { fixed: false }
  }

  const mergeResult = await deps.pool.mergeWorkerIntoPrimary(worker)
  if (!mergeResult.ok) {
    await worker.resetToBaseline(baselineSha)
    const reasoning = `Merge conflict on ${mergeResult.conflictFiles.join(', ')}`
    recordNeedsHuman(deps.ledger, deps.trace, round, record, reasoning, fixerResult)
    tallyDecision(collector, 'needs_human', false)
    tallyFixerSeverity(collector, fixerResult.severity)
    deps.log.log(`[fix] "${shortTitle(record)}" → needs_human (merge conflict)`)
    emitFixComplete(deps.trace, round, record.id, false, null, attempt)
    return { fixed: false }
  }

  recordFixAttempt(deps.ledger, record.id)
  tallyDecision(collector, fixerResult.verdict, fixerResult.fixed)
  tallyFixerSeverity(collector, fixerResult.severity)
  deps.log.log(
    attempt === 1 ? `[fix] "${shortTitle(record)}" → fixed` : `[fix] "${shortTitle(record)}" → fixed (after retry)`,
  )
  emitFixComplete(deps.trace, round, record.id, true, postSha, attempt)
  return { fixed: true }
}
