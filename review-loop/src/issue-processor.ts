// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ShellExecFn } from './build-checker.js'
import type { ReviewLoopConfig } from './config.js'
import { saveIssueLedger, type IssueLedger, type LedgerIssueRecord } from './issue-ledger.js'
import { processIssueAttempt, type IssueWorker, type RetryReason } from './issue-processor-attempts.js'
import type { RoundCollector } from './loop-trace.js'
import type { ProgressReporter } from './progress-log.js'
import type { RunState } from './run-state.js'
import type { TraceLogger } from './trace-log.js'
import { execGit, resetWorktreeTo } from './worktree.js'

export type { IssueWorker, RetryReason }

export interface IssueProcessorDeps {
  config: ReviewLoopConfig
  runState: RunState
  ledger: IssueLedger
  spawn: import('./agent-runner.js').SpawnFn
  exec: ShellExecFn
  log: ProgressReporter
  trace: TraceLogger
}

export function sanitizeSubject(text: string): string {
  const oneLine = text.split(/\r?\n/u)[0] ?? ''
  return oneLine.replace(/[`"']/gu, '').trim().slice(0, 100)
}

function singleWorkerFromState(runState: RunState): IssueWorker {
  return {
    worktreePath: runState.worktreePath,
    headSha: () => execGit(runState.worktreePath, ['rev-parse', 'HEAD']).then((r) => r.stdout.trim()),
    resetToBaseline: (sha) => resetWorktreeTo(runState.worktreePath, sha),
  }
}

function processIssue(
  record: LedgerIssueRecord,
  deps: IssueProcessorDeps,
  worker: IssueWorker,
  round: number,
  collector: RoundCollector,
): Promise<{ fixed: boolean }> {
  return processIssueAttempt(record, deps, worker, round, collector, 1, null)
}

async function processPendingIssue(
  deps: IssueProcessorDeps,
  worker: IssueWorker,
  round: number,
  collector: RoundCollector,
  pending: readonly LedgerIssueRecord[],
  index: number,
  fixed: number,
): Promise<number> {
  if (index >= pending.length) return fixed
  const record = pending[index]!
  const result = await processIssue(record, deps, worker, round, collector)
  await saveIssueLedger(deps.ledger)
  return processPendingIssue(deps, worker, round, collector, pending, index + 1, result.fixed ? fixed + 1 : fixed)
}

export function processPendingIssues(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  pending: readonly LedgerIssueRecord[],
): Promise<number> {
  const worker = singleWorkerFromState(deps.runState)
  return processPendingIssue(deps, worker, round, collector, pending, 0, 0)
}
