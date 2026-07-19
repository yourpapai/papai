// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { agentWritePath, runAgent, type AgentRunResult } from './agent-runner.js'
import { runBuildWithLogging } from './build-checker.js'
import { runInspectorOrTreatAsRejection } from './issue-inspector.js'
import { recordFixAttempt, recordNeedsHuman, recordVerify, type LedgerIssueRecord } from './issue-ledger.js'
import type { IssueProcessorDeps } from './issue-processor.js'
import { FixerResultSchema, type FixerResult } from './issue-schema.js'
import {
  emitBuildComplete,
  emitFixComplete,
  tallyDecision,
  tallyFixerSeverity,
  tallyPhaseMs,
  tallyUsage,
  truncate,
  type RoundCollector,
} from './loop-trace.js'
import { buildFixPrompt, buildRetryFixPrompt, buildRetryFixWithInspectorFeedbackPrompt } from './prompt-templates.js'
import { execGit } from './worktree.js'

export interface AttemptPromptDeps {
  config: { checkCommand: string }
  runState: { resultPath: string }
}

export interface IssueWorker {
  readonly worktreePath: string
  headSha(): Promise<string>
  resetToBaseline(sha: string): Promise<void>
}

export type RetryReason =
  | { kind: 'build_failure'; buildError: string }
  | { kind: 'inspector_rejection'; inspectorReasoning: string }

const MAX_ATTEMPTS = 2

export function shortTitle(record: LedgerIssueRecord): string {
  return truncate(record.issue.title, 60)
}

export function runFixerRaw(
  deps: IssueProcessorDeps,
  prompt: string,
  label: string,
): Promise<AgentRunResult<FixerResult>> {
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
    timeoutMs: deps.config.fixer.timeoutMs ?? deps.config.agentTimeoutMs,
  })
}

export function sanitizeSubject(text: string): string {
  const oneLine = text.split(/\r?\n/u)[0] ?? ''
  return oneLine.replace(/[`"']/gu, '').trim().slice(0, 100)
}

export async function ensureFixerChangesCommitted(
  deps: IssueProcessorDeps,
  record: LedgerIssueRecord,
  commitMessage: string | undefined,
): Promise<string> {
  const worktreePath = deps.runState.worktreePath
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

export function buildAttemptPrompt(
  deps: AttemptPromptDeps,
  record: LedgerIssueRecord,
  retryReason: RetryReason | null,
): string {
  if (retryReason === null) {
    return buildFixPrompt(record.issue, agentWritePath(deps.runState.resultPath), deps.config.checkCommand)
  }
  if (retryReason.kind === 'build_failure') {
    return buildRetryFixPrompt(
      record.issue,
      agentWritePath(deps.runState.resultPath),
      retryReason.buildError,
      deps.config.checkCommand,
    )
  }
  return buildRetryFixWithInspectorFeedbackPrompt(
    record.issue,
    retryReason.inspectorReasoning,
    agentWritePath(deps.runState.resultPath),
    deps.config.checkCommand,
  )
}

type FixerStepResult = { kind: 'proceed'; result: FixerResult } | { kind: 'terminal'; outcome: { fixed: false } }

export async function runFixerAttempt(
  deps: IssueProcessorDeps,
  worker: IssueWorker,
  record: LedgerIssueRecord,
  prompt: string,
  baselineSha: string,
  attempt: number,
  round: number,
  collector: RoundCollector,
): Promise<FixerStepResult> {
  const fixerStart = Date.now()
  const fixerAgentResult = await runFixerRaw(deps, prompt, `fixer${attempt > 1 ? `-retry` : ''}`)
  tallyPhaseMs(collector, 'verify', Date.now() - fixerStart)
  tallyUsage(collector, fixerAgentResult.usage)
  const fixerResult = fixerAgentResult.value
  recordVerify(deps.ledger, deps.trace, round, record, fixerResult)

  if (!fixerResult.fixed || fixerResult.verdict !== 'valid') {
    await worker.resetToBaseline(baselineSha)
    tallyDecision(collector, fixerResult.verdict, fixerResult.fixed)
    tallyFixerSeverity(collector, fixerResult.severity)
    deps.log.log(`[fix] "${shortTitle(record)}" → ${fixerResult.verdict}`)
    emitFixComplete(deps.trace, round, record.id, false, null, attempt)
    return { kind: 'terminal', outcome: { fixed: false } }
  }
  return { kind: 'proceed', result: fixerResult }
}

type BuildStepResult =
  | { kind: 'proceed' }
  | { kind: 'retry'; reason: RetryReason }
  | { kind: 'terminal'; outcome: { fixed: false } }

export async function runBuildAttempt(
  deps: IssueProcessorDeps,
  record: LedgerIssueRecord,
  fixerResult: FixerResult,
  attempt: number,
  round: number,
  collector: RoundCollector,
): Promise<BuildStepResult> {
  const buildStart = Date.now()
  const buildResult = await runBuildWithLogging(deps.exec, deps.log)
  tallyPhaseMs(collector, 'build', Date.now() - buildStart)
  emitBuildComplete(deps.trace, round, record.id, buildResult.passed, attempt, Date.now() - buildStart)

  if (!buildResult.passed) {
    if (attempt >= MAX_ATTEMPTS) {
      recordNeedsHuman(
        deps.ledger,
        deps.trace,
        round,
        record,
        `Build failed after retry: ${buildResult.stderr}`,
        fixerResult,
      )
      tallyDecision(collector, 'needs_human', false)
      tallyFixerSeverity(collector, fixerResult.severity)
      deps.log.log(`[fix] "${shortTitle(record)}" → needs_human (build failed)`)
      emitFixComplete(deps.trace, round, record.id, false, null, attempt)
      return { kind: 'terminal', outcome: { fixed: false } }
    }
    return { kind: 'retry', reason: { kind: 'build_failure', buildError: buildResult.stderr } }
  }
  return { kind: 'proceed' }
}

type InspectorStepResult =
  | { kind: 'proceed' }
  | { kind: 'retry'; reason: RetryReason }
  | { kind: 'terminal'; outcome: { fixed: false } }

export async function runInspectorAttempt(
  deps: IssueProcessorDeps,
  worker: IssueWorker,
  record: LedgerIssueRecord,
  fixerResult: FixerResult,
  baselineSha: string,
  attempt: number,
  round: number,
  collector: RoundCollector,
): Promise<InspectorStepResult> {
  const inspectStart = Date.now()
  const inspectorResult = await runInspectorOrTreatAsRejection(deps, worker, record, baselineSha, round, collector)
  tallyPhaseMs(collector, 'inspect', Date.now() - inspectStart)
  tallyUsage(collector, inspectorResult.usage)

  if (!inspectorResult.addresses) {
    if (attempt >= MAX_ATTEMPTS) {
      recordNeedsHuman(
        deps.ledger,
        deps.trace,
        round,
        record,
        `Inspector rejected twice: ${inspectorResult.reasoning}`,
        fixerResult,
      )
      tallyDecision(collector, 'inspector_rejected', false)
      tallyFixerSeverity(collector, fixerResult.severity)
      deps.log.log(`[fix] "${shortTitle(record)}" → needs_human (inspector rejected)`)
      emitFixComplete(deps.trace, round, record.id, false, null, attempt)
      return { kind: 'terminal', outcome: { fixed: false } }
    }
    return { kind: 'retry', reason: { kind: 'inspector_rejection', inspectorReasoning: inspectorResult.reasoning } }
  }
  return { kind: 'proceed' }
}

export async function runCommitAttempt(
  deps: IssueProcessorDeps,
  record: LedgerIssueRecord,
  baselineSha: string,
  fixerResult: FixerResult,
  attempt: number,
  round: number,
  collector: RoundCollector,
): Promise<{ fixed: boolean }> {
  const mergeStart = Date.now()
  const postSha = await ensureFixerChangesCommitted(deps, record, fixerResult.commitMessage)
  tallyPhaseMs(collector, 'fix', Date.now() - mergeStart)
  if (postSha === baselineSha) {
    collector.decisions.no_commit += 1
    tallyFixerSeverity(collector, fixerResult.severity)
    emitFixComplete(deps.trace, round, record.id, false, null, attempt)
    deps.log.log(`[fix] "${shortTitle(record)}" → no change (fixed:true was a false claim)`)
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

export async function processIssueAttempt(
  record: LedgerIssueRecord,
  deps: IssueProcessorDeps,
  worker: IssueWorker,
  round: number,
  collector: RoundCollector,
  attempt: number,
  retryReason: RetryReason | null,
): Promise<{ fixed: boolean }> {
  const baselineSha = await worker.headSha()
  const prompt = buildAttemptPrompt(deps, record, retryReason)

  const fixerStep = await runFixerAttempt(deps, worker, record, prompt, baselineSha, attempt, round, collector)
  if (fixerStep.kind === 'terminal') return fixerStep.outcome

  const buildStep = await runBuildAttempt(deps, record, fixerStep.result, attempt, round, collector)
  if (buildStep.kind === 'terminal') {
    await worker.resetToBaseline(baselineSha)
    return buildStep.outcome
  }
  if (buildStep.kind === 'retry') {
    await worker.resetToBaseline(baselineSha)
    return processIssueAttempt(record, deps, worker, round, collector, attempt + 1, buildStep.reason)
  }

  const inspectStep = await runInspectorAttempt(
    deps,
    worker,
    record,
    fixerStep.result,
    baselineSha,
    attempt,
    round,
    collector,
  )
  if (inspectStep.kind === 'terminal') {
    await worker.resetToBaseline(baselineSha)
    return inspectStep.outcome
  }
  if (inspectStep.kind === 'retry') {
    await worker.resetToBaseline(baselineSha)
    return processIssueAttempt(record, deps, worker, round, collector, attempt + 1, inspectStep.reason)
  }

  return runCommitAttempt(deps, record, baselineSha, fixerStep.result, attempt, round, collector)
}
