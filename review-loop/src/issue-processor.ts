// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ShellExecFn } from './build-checker.js'
import type { ReviewLoopConfig } from './config.js'
import { recordNeedsHuman, saveIssueLedger, type IssueLedger, type LedgerIssueRecord } from './issue-ledger.js'
import { processIssueAttempt, type IssueWorker, type RetryReason } from './issue-processor-attempts.js'
import type { FixerResult } from './issue-schema.js'
import { emitFixComplete, tallyDecision, truncate, type RoundCollector } from './loop-trace.js'
import { emitDecision } from './progress-log.js'
import type { ProgressReporter } from './progress-log.js'
import type { RunState } from './run-state.js'
import type { StopController } from './stop-controller.js'
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
  /** The run's bound, asked between issues rather than during one. */
  stop?: StopController
  /** Override the ledger-save function (default: real `saveIssueLedger`). Tests use this to observe concurrency. */
  saveLedger?: (ledger: IssueLedger) => Promise<void>
}

export function sanitizeSubject(text: string): string {
  const oneLine = text.split(/\r?\n/u)[0] ?? ''
  return oneLine.replace(/[`"']/gu, '').trim().slice(0, 100)
}

export function shortTitle(record: LedgerIssueRecord): string {
  return truncate(record.issue.title, 60)
}

function fallbackFixerResult(reasoning: string): FixerResult {
  return {
    verdict: 'needs_human',
    fixability: 'manual',
    reasoning,
    targetFiles: [],
    fixed: false,
  }
}

function recordProcessingFailure(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  record: LedgerIssueRecord,
  msg: string,
): void {
  recordNeedsHuman(deps.ledger, deps.trace, round, record, `issue processing failed: ${msg}`, fallbackFixerResult(msg))
  tallyDecision(collector, 'needs_human', false)
  emitDecision(deps.log, record, 'needs_human', `issue processing failed: ${msg}`)
  emitFixComplete(deps.trace, round, record.id, false, null, 1)
}

async function processIssue(
  record: LedgerIssueRecord,
  deps: IssueProcessorDeps,
  worker: Worker,
  round: number,
  collector: RoundCollector,
): Promise<{ fixed: boolean }> {
  let baselineSha: string | null = null
  try {
    baselineSha = await worker.headSha()
    return await processIssueAttempt(record, deps, worker, round, collector, 1, null)
  } catch (error) {
    if (baselineSha !== null) {
      try {
        await worker.resetToBaseline(baselineSha)
      } catch {
        // Best-effort cleanup; do not mask the original error.
      }
    }
    throw error
  } finally {
    deps.pool.release(worker)
  }
}

function makeSerializedSave(saveLedger: (ledger: IssueLedger) => Promise<void>): {
  save: (ledger: IssueLedger) => Promise<void>
} {
  // Coroutine-local save serialization. Without this, K parallel workers each
  // call `saveLedger` after `processIssue` returns, and their non-atomic
  // `writeFile` calls race: whichever finishes last wins, persisting a stale
  // stringify that may predate another worker's already-completed mutation.
  // On crash-resume that lost state resurrects already-fixed issues. The chain
  // guarantees ordered, non-overlapping saves while still surfacing each save's
  // own error to its calling coroutine.
  let saveChain: Promise<void> = Promise.resolve()
  const save = (ledger: IssueLedger): Promise<void> => {
    const next = saveChain.then(
      () => saveLedger(ledger),
      () => saveLedger(ledger),
    )
    // Keep the chain alive even if this save rejects; otherwise a single
    // failure would poison every subsequent queued save.
    saveChain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
  return { save }
}

function makeDispatcher(args: {
  deps: IssueProcessorDeps
  round: number
  collector: RoundCollector
  pending: readonly LedgerIssueRecord[]
  save: (ledger: IssueLedger) => Promise<void>
  onFixed: () => void
  nextIndex: () => number
}): () => Promise<void> {
  const { deps, round, collector, pending, save, onFixed, nextIndex } = args
  const dispatchNext = async (): Promise<void> => {
    // Between two issues is where a stop is free: the previous fix is committed,
    // build-checked, merged and — under `mergeEachFix` — already published, and
    // the next one has not begun. Taking one more issue here is what a run that
    // is out of time cannot afford: the fixer alone can spend twenty minutes,
    // and the caller's kill would land in the middle of it.
    if ((deps.stop?.requested() ?? null) !== null) return
    const index = nextIndex()
    if (index >= pending.length) return
    const record = pending[index]!
    const worker = await deps.pool.acquire(record.issue.file)
    let result: { fixed: boolean } | null = null
    try {
      result = await processIssue(record, deps, worker, round, collector)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      recordProcessingFailure(deps, round, collector, record, msg)
    }
    try {
      await save(deps.ledger)
    } catch (error) {
      // Best-effort per-issue persistence: the in-memory ledger holds the
      // correct state regardless, and the round-end saveIssueLedger in
      // runRound is the safety net. Letting this escape would abort the
      // entire round via Promise.all, discarding work done by every
      // in-flight coroutine — even though processIssue already succeeded.
      const msg = error instanceof Error ? error.message : String(error)
      deps.log.log(`[fix] "${shortTitle(record)}" → ledger save failed (will retry at round end): ${msg}`)
    }
    if (result !== null && result.fixed) onFixed()
    await dispatchNext()
  }
  return dispatchNext
}

export async function processPendingIssues(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  pending: readonly LedgerIssueRecord[],
): Promise<number> {
  let fixed = 0
  let index = 0
  const { save } = makeSerializedSave(deps.saveLedger ?? saveIssueLedger)
  const dispatchNext = makeDispatcher({
    deps,
    round,
    collector,
    pending,
    save,
    onFixed: () => {
      fixed += 1
    },
    nextIndex: () => index++,
  })

  const concurrency = Math.min(deps.config.poolSize, pending.length)
  const inFlight: Promise<void>[] = []
  for (let i = 0; i < concurrency; i++) {
    inFlight.push(dispatchNext())
  }
  await Promise.all(inFlight)
  return fixed
}
