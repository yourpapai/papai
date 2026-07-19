// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ShellExecFn } from './build-checker.js'
import type { ReviewLoopConfig } from './config.js'
import { saveIssueLedger, type IssueLedger, type LedgerIssueRecord } from './issue-ledger.js'
import { processIssueAttempt, type IssueWorker, type RetryReason } from './issue-processor-attempts.js'
import { truncate, type RoundCollector } from './loop-trace.js'
import type { ProgressReporter } from './progress-log.js'
import type { RunState } from './run-state.js'
import type { TraceLogger } from './trace-log.js'
import type { Worker, WorkerPool } from './worker-pool.js'

export type { IssueWorker, RetryReason }

export interface IssueProcessorDeps {
  config: ReviewLoopConfig
  runState: RunState
  ledger: IssueLedger
  spawn: import('./agent-runner.js').SpawnFn
  exec: ShellExecFn
  log: ProgressReporter
  trace: TraceLogger
  pool: WorkerPool
  inspect?: boolean
}

export function sanitizeSubject(text: string): string {
  const oneLine = text.split(/\r?\n/u)[0] ?? ''
  return oneLine.replace(/[`"']/gu, '').trim().slice(0, 100)
}

export function shortTitle(record: LedgerIssueRecord): string {
  return truncate(record.issue.title, 60)
}

async function processIssue(
  record: LedgerIssueRecord,
  deps: IssueProcessorDeps,
  worker: Worker,
  round: number,
  collector: RoundCollector,
): Promise<{ fixed: boolean }> {
  try {
    return await processIssueAttempt(record, deps, worker, round, collector, 1, null)
  } finally {
    deps.pool.release(worker)
  }
}

export async function processPendingIssues(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  pending: readonly LedgerIssueRecord[],
): Promise<number> {
  let fixed = 0
  let index = 0
  const inFlight: Promise<void>[] = []

  const dispatchNext = async (): Promise<void> => {
    if (index >= pending.length) return
    const record = pending[index]!
    index += 1
    const worker = await deps.pool.acquire(record.issue.file)
    try {
      const result = await processIssue(record, deps, worker, round, collector)
      await saveIssueLedger(deps.ledger)
      if (result.fixed) fixed += 1
    } finally {
      // processIssue already releases the worker; nothing to do here
    }
    await dispatchNext()
  }

  const concurrency = Math.min(deps.config.poolSize, pending.length)
  for (let i = 0; i < concurrency; i++) {
    inFlight.push(dispatchNext())
  }
  await Promise.all(inFlight)
  return fixed
}
