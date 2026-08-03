// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { agentWritePath, runAgent, type AgentRunResult } from './agent-runner.js'
import { runBuildWithLogging } from './build-checker.js'
import { runCommitAttempt } from './commit-attempt.js'
import { runInspectorOrTreatAsRejection } from './issue-inspector.js'
import { recordNeedsHuman, recordVerify, type LedgerIssueRecord } from './issue-ledger.js'
import type { IssueProcessorDeps } from './issue-processor.js'
import { FixerResultSchema, type FixerResult } from './issue-schema.js'
import {
  emitBuildComplete,
  emitFixComplete,
  tallyDecision,
  tallyFixerSeverity,
  tallyPhaseMs,
  tallyUsage,
  type RoundCollector,
} from './loop-trace.js'
import { emitDecision } from './progress-log.js'
import { buildFixPrompt, buildRetryFixPrompt, buildRetryFixWithInspectorFeedbackPrompt } from './prompt-templates.js'
import { workerOutputPath } from './run-state.js'
import type { Worker } from './worker-pool.js'

export interface AttemptPromptDeps {
  config: { checkCommand: string }
  /** Worker cwd the fixer runs in. Used to compute the absolute agent-output path. */
  cwd: string
  /** Final destination of the fixer result; the agent writes to `<cwd>/.review-loop/<basename>`. */
  resultPath: string
}

export interface IssueWorker {
  readonly id?: number
  readonly worktreePath: string
  headSha(): Promise<string>
  resetToBaseline(sha: string): Promise<void>
}

export type RetryReason =
  | { kind: 'build_failure'; buildError: string }
  | { kind: 'inspector_rejection'; inspectorReasoning: string }

const MAX_ATTEMPTS = 2

export function runFixerRaw(
  deps: IssueProcessorDeps,
  worker: Worker,
  prompt: string,
  label: string,
): Promise<AgentRunResult<FixerResult>> {
  return runAgent({
    spawn: deps.spawn,
    model: deps.config.fixer.model,
    cwd: worker.worktreePath,
    prompt,
    outputPath: workerOutputPath(deps.runState.runDir, worker.id, 'result.json'),
    outputSchema: FixerResultSchema,
    label,
    reporter: deps.log,
    logPath: deps.runState.logPath,
    extraArgs: deps.config.fixer.extraArgs,
    timeoutMs: deps.config.fixer.timeoutMs ?? deps.config.agentTimeoutMs,
  })
}

export function buildAttemptPrompt(
  deps: AttemptPromptDeps,
  record: LedgerIssueRecord,
  retryReason: RetryReason | null,
): string {
  const agentPath = agentWritePath(deps.cwd, deps.resultPath)
  if (retryReason === null) {
    return buildFixPrompt(record.issue, agentPath, deps.config.checkCommand)
  }
  if (retryReason.kind === 'build_failure') {
    return buildRetryFixPrompt(record.issue, agentPath, retryReason.buildError, deps.config.checkCommand)
  }
  return buildRetryFixWithInspectorFeedbackPrompt(
    record.issue,
    retryReason.inspectorReasoning,
    agentPath,
    deps.config.checkCommand,
  )
}

type FixerStepResult = { kind: 'proceed'; result: FixerResult } | { kind: 'terminal'; outcome: { fixed: false } }

export async function runFixerAttempt(
  deps: IssueProcessorDeps,
  worker: Worker,
  record: LedgerIssueRecord,
  prompt: string,
  baselineSha: string,
  attempt: number,
  round: number,
  collector: RoundCollector,
): Promise<FixerStepResult> {
  const fixerStart = Date.now()
  const workerSuffix = worker.id === undefined ? '' : `-w${worker.id}`
  const fixerAgentResult = await runFixerRaw(deps, worker, prompt, `fixer${workerSuffix}${attempt > 1 ? `-retry` : ''}`)
  tallyPhaseMs(collector, 'verify', Date.now() - fixerStart)
  tallyUsage(collector, fixerAgentResult.usage)
  const fixerResult = fixerAgentResult.value
  recordVerify(deps.ledger, deps.trace, round, record, fixerResult)

  if (!fixerResult.fixed || fixerResult.verdict !== 'valid') {
    await worker.resetToBaseline(baselineSha)
    tallyDecision(collector, fixerResult.verdict, fixerResult.fixed)
    tallyFixerSeverity(collector, fixerResult.severity)
    emitDecision(deps.log, record, fixerResult.verdict)
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
  worker: Worker,
  record: LedgerIssueRecord,
  fixerResult: FixerResult,
  attempt: number,
  round: number,
  collector: RoundCollector,
): Promise<BuildStepResult> {
  const buildStart = Date.now()
  const buildResult = await runBuildWithLogging(deps.exec, deps.log, worker.worktreePath)
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
      emitDecision(deps.log, record, 'needs_human', 'build failed')
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
  worker: Worker,
  record: LedgerIssueRecord,
  fixerResult: FixerResult,
  baselineSha: string,
  attempt: number,
  round: number,
  collector: RoundCollector,
): Promise<InspectorStepResult> {
  const inspectStart = Date.now()
  const inspectorResult = await runInspectorOrTreatAsRejection(
    deps,
    worker,
    record,
    fixerResult,
    baselineSha,
    round,
    collector,
  )
  tallyPhaseMs(collector, 'inspect', Date.now() - inspectStart)
  tallyUsage(collector, inspectorResult.usage)

  const unavailable = inspectorResult.kind === 'unavailable'
  if (unavailable || !inspectorResult.addresses) {
    if (attempt >= MAX_ATTEMPTS) {
      recordNeedsHuman(
        deps.ledger,
        deps.trace,
        round,
        record,
        unavailable
          ? `Inspector unavailable twice: ${inspectorResult.reasoning}`
          : `Inspector rejected twice: ${inspectorResult.reasoning}`,
        fixerResult,
      )
      tallyDecision(collector, unavailable ? 'needs_human' : 'inspector_rejected', false)
      tallyFixerSeverity(collector, fixerResult.severity)
      const note = unavailable ? 'inspector unavailable' : 'inspector rejected'
      emitDecision(deps.log, record, 'needs_human', note)
      emitFixComplete(deps.trace, round, record.id, false, null, attempt)
      return { kind: 'terminal', outcome: { fixed: false } }
    }
    return { kind: 'retry', reason: { kind: 'inspector_rejection', inspectorReasoning: inspectorResult.reasoning } }
  }
  return { kind: 'proceed' }
}

export function attemptDepsFromWorker(deps: IssueProcessorDeps, worker: IssueWorker): AttemptPromptDeps {
  return { config: deps.config, cwd: worker.worktreePath, resultPath: deps.runState.resultPath }
}

export async function processIssueAttempt(
  record: LedgerIssueRecord,
  deps: IssueProcessorDeps,
  worker: Worker,
  round: number,
  collector: RoundCollector,
  attempt: number,
  retryReason: RetryReason | null,
): Promise<{ fixed: boolean }> {
  const baselineSha = await worker.headSha()
  const prompt = buildAttemptPrompt(attemptDepsFromWorker(deps, worker), record, retryReason)

  const fixerStep = await runFixerAttempt(deps, worker, record, prompt, baselineSha, attempt, round, collector)
  if (fixerStep.kind === 'terminal') return fixerStep.outcome

  const buildStep = await runBuildAttempt(deps, worker, record, fixerStep.result, attempt, round, collector)
  if (buildStep.kind === 'terminal') {
    await worker.resetToBaseline(baselineSha)
    return buildStep.outcome
  }
  if (buildStep.kind === 'retry') {
    await worker.resetToBaseline(baselineSha)
    return processIssueAttempt(record, deps, worker, round, collector, attempt + 1, buildStep.reason)
  }

  if (deps.inspect !== false) {
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
  }

  return runCommitAttempt(deps, worker, record, baselineSha, fixerStep.result, attempt, round, collector)
}
