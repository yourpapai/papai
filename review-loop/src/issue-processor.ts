// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { agentWritePath, runAgent, type SpawnFn } from './agent-runner.js'
import { runBuildCheck, type BuildCheckResult, type ShellExecFn } from './build-checker.js'
import type { ReviewLoopConfig } from './config.js'
import {
  recordFixAttempt,
  recordVerification,
  saveIssueLedger,
  type IssueLedger,
  type LedgerIssueRecord,
} from './issue-ledger.js'
import { FixerResultSchema } from './issue-schema.js'
import type { FixerResult } from './issue-schema.js'
import { formatDuration, withLivePhase } from './live-renderer.js'
import {
  emitBuildComplete,
  emitFixComplete,
  emitVerifyComplete,
  tallyDecision,
  tallyFixerSeverity,
  truncate,
  type RoundCollector,
} from './loop-trace.js'
import type { ProgressReporter } from './progress-log.js'
import { buildFixPrompt, buildRetryFixPrompt } from './prompt-templates.js'
import type { RunState } from './run-state.js'
import type { TraceLogger } from './trace-log.js'
import { execGit } from './worktree.js'

export interface IssueProcessorDeps {
  config: ReviewLoopConfig
  runState: RunState
  ledger: IssueLedger
  spawn: SpawnFn
  exec: ShellExecFn
  log: ProgressReporter
  trace: TraceLogger
}

function shortTitle(record: LedgerIssueRecord): string {
  return truncate(record.issue.title, 60)
}

function runFixer(deps: IssueProcessorDeps, prompt: string, label: string): Promise<FixerResult> {
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

async function runBuildWithLogging(deps: IssueProcessorDeps): Promise<BuildCheckResult> {
  const phase = await withLivePhase(deps.log, 'build', () => runBuildCheck({ exec: deps.exec }))
  deps.log.event(`[build] ${phase.result.passed ? 'passed' : 'FAILED'} \u00B7 ${formatDuration(phase.durationMs)}`)
  return phase.result
}

function recordVerify(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  record: LedgerIssueRecord,
  result: FixerResult,
): void {
  recordVerification(deps.ledger, record.id, {
    verdict: result.verdict,
    fixability: result.fixability,
    reasoning: result.reasoning,
    targetFiles: result.targetFiles,
  })
  emitVerifyComplete(
    deps.trace,
    round,
    record.id,
    result.verdict,
    result.fixability,
    record.issue.severity,
    result.severity ?? null,
    truncate(result.reasoning, 200),
    result.targetFiles,
  )
  tallyDecision(collector, result.verdict, result.fixed)
  tallyFixerSeverity(collector, result.severity)
}

function recordNeedsHuman(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  record: LedgerIssueRecord,
  reasoning: string,
  result: FixerResult,
): void {
  recordVerification(deps.ledger, record.id, {
    verdict: 'needs_human',
    fixability: 'manual',
    reasoning,
    targetFiles: result.targetFiles,
  })
  emitVerifyComplete(
    deps.trace,
    round,
    record.id,
    'needs_human',
    'manual',
    record.issue.severity,
    result.severity ?? null,
    truncate(reasoning, 200),
    result.targetFiles,
  )
  tallyDecision(collector, 'needs_human', false)
}

async function ensureFixerChangesCommitted(deps: IssueProcessorDeps, record: LedgerIssueRecord): Promise<void> {
  const status = (await execGit(deps.runState.worktreePath, ['status', '--porcelain'])).stdout.trim()
  if (status.length === 0) {
    return
  }
  await execGit(deps.runState.worktreePath, ['add', '-A'])
  await execGit(deps.runState.worktreePath, ['commit', '-m', `fix(review-loop): ${record.issue.title}`])
  deps.log.log(`[fix] "${shortTitle(record)}" \u2192 auto-committed uncommitted changes`)
}

async function retryFixAfterBuildFailure(
  record: LedgerIssueRecord,
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
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
    recordVerify(deps, round, collector, record, result)
    deps.log.log(`[fix] "${shortTitle(record)}" \u2192 ${result.verdict} (after retry)`)
    emitFixComplete(deps.trace, round, record.id, false, 2)
    return false
  }

  const retryStart = Date.now()
  const retryBuild = await runBuildWithLogging(deps)
  emitBuildComplete(deps.trace, round, record.id, retryBuild.passed, 2, Date.now() - retryStart)

  if (retryBuild.passed) {
    await ensureFixerChangesCommitted(deps, record)
    recordFixAttempt(deps.ledger, record.id)
    deps.log.log(`[fix] "${shortTitle(record)}" \u2192 fixed (after retry)`)
    emitFixComplete(deps.trace, round, record.id, true, 2)
    return true
  }

  await execGit(deps.runState.worktreePath, ['reset', '--hard', baselineSha])
  recordNeedsHuman(deps, round, collector, record, `Build failed after retry: ${retryBuild.stderr}`, result)
  deps.log.log(`[fix] "${shortTitle(record)}" → needs_human (build failed)`)
  emitFixComplete(deps.trace, round, record.id, false, 2)
  return false
}

async function processIssue(
  record: LedgerIssueRecord,
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
): Promise<{ fixed: boolean }> {
  deps.log.log(`[fix] "${shortTitle(record)}" — verifying...`)
  const baselineSha = (await execGit(deps.runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()
  const result = await runFixer(
    deps,
    buildFixPrompt(record.issue, agentWritePath(deps.runState.resultPath), deps.config.checkCommand),
    'fixer',
  )
  recordVerify(deps, round, collector, record, result)

  if (!result.fixed || result.verdict !== 'valid') {
    await execGit(deps.runState.worktreePath, ['reset', '--hard', baselineSha])
    deps.log.log(`[fix] "${shortTitle(record)}" → ${result.verdict}`)
    emitFixComplete(deps.trace, round, record.id, false, 1)
    return { fixed: false }
  }

  const buildStart = Date.now()
  const buildResult = await runBuildWithLogging(deps)
  emitBuildComplete(deps.trace, round, record.id, buildResult.passed, 1, Date.now() - buildStart)

  if (buildResult.passed) {
    await ensureFixerChangesCommitted(deps, record)
    recordFixAttempt(deps.ledger, record.id)
    deps.log.log(`[fix] "${shortTitle(record)}" \u2192 fixed`)
    emitFixComplete(deps.trace, round, record.id, true, 1)
    return { fixed: true }
  }

  const fixed = await retryFixAfterBuildFailure(record, deps, round, collector, buildResult.stderr, baselineSha)
  return { fixed }
}

async function processNextIssue(
  pending: readonly LedgerIssueRecord[],
  index: number,
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  fixed: number,
): Promise<number> {
  if (index >= pending.length) {
    return fixed
  }
  const result = await processIssue(pending[index]!, deps, round, collector)
  await saveIssueLedger(deps.ledger)
  return processNextIssue(pending, index + 1, deps, round, collector, result.fixed ? fixed + 1 : fixed)
}

export function processPendingIssues(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  pending: readonly LedgerIssueRecord[],
): Promise<number> {
  return processNextIssue(pending, 0, deps, round, collector, 0)
}
