// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { agentWritePath, emptyUsage, runAgent, AgentRunError, type AgentUsage, type SpawnFn } from './agent-runner.js'
import type { IssueWorker } from './issue-processor-attempts.js'
import type { IssueProcessorDeps } from './issue-processor.js'
import {
  AggregatedInspectorResultSchema,
  type AggregatedInspectorResult,
  type FixerResult,
  InspectorResultSchema,
  type InspectorResult,
  type ReviewerIssue,
} from './issue-schema.js'
import { emitInspectComplete } from './loop-trace.js'
import type { ProgressReporter } from './progress-log.js'
import { buildAggregatedInspectPrompt, buildInspectPrompt } from './prompt-templates.js'
import { tallyInspector, type RoundCollector } from './round-collector.js'
import { workerOutputPath } from './run-state.js'
import type { TraceLogger } from './trace-log.js'
import { execGit } from './worktree.js'

export interface RunInspectorDeps {
  spawn: SpawnFn
  cwd: string
  issue: ReviewerIssue
  baselineSha: string
  fixerReasoning: string
  outputPath: string
  logPath: string
  reporter: ProgressReporter
  model: string
  extraArgs: readonly string[]
  timeoutMs?: number
  label: string
}

export type InspectorOutcome =
  | (InspectorResult & { kind: 'inspected'; usage: AgentUsage })
  | { kind: 'unavailable'; reasoning: string; usage: AgentUsage }

export async function runInspector(
  deps: RunInspectorDeps,
  round: number,
  issueId: string,
  trace: TraceLogger,
  collector?: RoundCollector,
): Promise<InspectorResult & { kind: 'inspected'; usage: AgentUsage }> {
  // The fixer is instructed not to commit; the orchestrator commits only in
  // runCommitAttempt, which runs AFTER this step. At inspector time HEAD still
  // equals baselineSha, so `diff baselineSha..HEAD` would always be empty.
  // Diffing the working tree against baseline captures the fixer's uncommitted
  // edits (and also handles the retry case, where the worker was reset).
  // `git diff <commit>` only shows tracked files, so mark untracked files as
  // intent-to-add first; otherwise a fix that creates a new file would be
  // invisible to the inspector and always rejected. The marker is overwritten
  // by the subsequent `git add -A` in ensureFixerChangesCommitted.
  await execGit(deps.cwd, ['add', '-N', '.'])
  const { stdout: diff } = await execGit(deps.cwd, ['diff', deps.baselineSha])
  const result = await runAgent({
    spawn: deps.spawn,
    model: deps.model,
    cwd: deps.cwd,
    prompt: buildInspectPrompt(deps.issue, diff, deps.fixerReasoning, agentWritePath(deps.cwd, deps.outputPath)),
    outputPath: deps.outputPath,
    outputSchema: InspectorResultSchema,
    label: deps.label,
    reporter: deps.reporter,
    logPath: deps.logPath,
    extraArgs: deps.extraArgs,
    timeoutMs: deps.timeoutMs,
  })
  emitInspectComplete(trace, round, issueId, result.value.addresses, result.value.confidence, result.value.reasoning)
  if (collector !== undefined) {
    tallyInspector(collector, result.value.addresses)
  }
  return { ...result.value, kind: 'inspected', usage: result.usage }
}

export async function runInspectorOrTreatAsRejection(
  deps: IssueProcessorDeps,
  worker: IssueWorker,
  record: import('./issue-ledger.js').LedgerIssueRecord,
  fixerResult: FixerResult,
  baselineSha: string,
  round: number,
  collector: RoundCollector,
): Promise<InspectorOutcome> {
  const inspectorConfig = deps.config.inspector ?? deps.config.fixer
  const labelSuffix = worker.id === undefined ? '' : `-w${worker.id}`
  try {
    return await runInspector(
      {
        spawn: deps.spawn,
        cwd: worker.worktreePath,
        issue: record.issue,
        baselineSha,
        fixerReasoning: fixerResult.reasoning,
        outputPath: workerOutputPath(deps.runState.runDir, worker.id, 'inspect.json'),
        logPath: deps.runState.logPath,
        reporter: deps.log,
        model: inspectorConfig.model,
        extraArgs: inspectorConfig.extraArgs,
        timeoutMs: inspectorConfig.timeoutMs ?? deps.config.agentTimeoutMs,
        label: `inspector${labelSuffix}`,
      },
      round,
      record.id,
      deps.trace,
      collector,
    )
  } catch (error) {
    const originalReasoning = error instanceof Error ? error.message : String(error)
    deps.log.log(`[inspect] inspector unavailable: ${originalReasoning}`)
    emitInspectComplete(deps.trace, round, record.id, false, 0, `inspector unavailable: ${originalReasoning}`)
    if (collector !== undefined) {
      tallyInspector(collector, false)
    }
    return {
      kind: 'unavailable',
      reasoning: `inspector unavailable: ${originalReasoning}`,
      usage: error instanceof AgentRunError ? error.usage : emptyUsage(),
    }
  }
}

export interface AggregatedInspectorDeps {
  spawn: SpawnFn
  cwd: string
  issues: readonly { id: string; issue: ReviewerIssue }[]
  baselineSha: string
  outputPath: string
  logPath: string
  reporter: ProgressReporter
  model: string
  extraArgs: readonly string[]
  timeoutMs?: number
  label: string
}

export async function runAggregatedInspector(
  deps: AggregatedInspectorDeps,
  round: number,
  trace: TraceLogger,
  collector?: RoundCollector,
): Promise<AggregatedInspectorResult & { kind: 'inspected'; usage: AgentUsage }> {
  await execGit(deps.cwd, ['add', '-N', '.'])
  const { stdout: diff } = await execGit(deps.cwd, ['diff', deps.baselineSha])
  const result = await runAgent({
    spawn: deps.spawn,
    model: deps.model,
    cwd: deps.cwd,
    prompt: buildAggregatedInspectPrompt(deps.issues, diff, agentWritePath(deps.cwd, deps.outputPath)),
    outputPath: deps.outputPath,
    outputSchema: AggregatedInspectorResultSchema,
    label: deps.label,
    reporter: deps.reporter,
    logPath: deps.logPath,
    extraArgs: deps.extraArgs,
    timeoutMs: deps.timeoutMs,
  })
  for (const r of result.value.results) {
    emitInspectComplete(trace, round, r.id, r.addresses, r.confidence, r.reasoning)
    if (collector !== undefined) tallyInspector(collector, r.addresses)
  }
  return { ...result.value, kind: 'inspected', usage: result.usage }
}

function buildAggregatedInspectorUnavailable(
  deps: { log: ProgressReporter; trace: TraceLogger },
  issues: readonly { id: string }[],
  round: number,
  collector: RoundCollector,
  error: unknown,
): { kind: 'unavailable'; reasoning: string; usage: AgentUsage; results: AggregatedInspectorResult['results'] } {
  const reasoning = `inspector unavailable: ${error instanceof Error ? error.message : String(error)}`
  deps.log.log(`[inspect] aggregated inspector unavailable: ${reasoning}`)
  for (const { id } of issues) {
    emitInspectComplete(deps.trace, round, id, false, 0, reasoning)
    tallyInspector(collector, false)
  }
  return {
    kind: 'unavailable',
    reasoning,
    usage: error instanceof AgentRunError ? error.usage : emptyUsage(),
    results: issues.map(({ id }) => ({ id, addresses: false, reasoning, confidence: 0 })),
  }
}

export async function runAggregatedInspectorOrTreatAsRejection(
  deps: {
    config: {
      inspector?: { model: string; extraArgs: readonly string[]; timeoutMs?: number }
      fixer: { model: string; extraArgs: readonly string[]; timeoutMs?: number }
      agentTimeoutMs: number
    }
    spawn: SpawnFn
    log: ProgressReporter
    trace: TraceLogger
  },
  worktreePath: string,
  issues: readonly { id: string; issue: ReviewerIssue }[],
  baselineSha: string,
  round: number,
  runDir: string,
  logPath: string,
  collector: RoundCollector,
): Promise<
  | (AggregatedInspectorResult & { kind: 'inspected'; usage: AgentUsage })
  | { kind: 'unavailable'; reasoning: string; usage: AgentUsage; results: AggregatedInspectorResult['results'] }
> {
  const cfg = deps.config.inspector ?? deps.config.fixer
  try {
    return await runAggregatedInspector(
      {
        spawn: deps.spawn,
        cwd: worktreePath,
        issues,
        baselineSha,
        outputPath: workerOutputPath(runDir, undefined, 'inspect-aggregated.json'),
        logPath,
        reporter: deps.log,
        model: cfg.model,
        extraArgs: cfg.extraArgs,
        timeoutMs: cfg.timeoutMs ?? deps.config.agentTimeoutMs,
        label: 'inspector-aggregated',
      },
      round,
      deps.trace,
      collector,
    )
  } catch (error) {
    return buildAggregatedInspectorUnavailable(deps, issues, round, collector, error)
  }
}
