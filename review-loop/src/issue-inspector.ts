// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { agentWritePath, runAgent, type AgentUsage, type SpawnFn } from './agent-runner.js'
import type { IssueWorker } from './issue-processor-attempts.js'
import type { IssueProcessorDeps } from './issue-processor.js'
import { InspectorResultSchema, type InspectorResult, type ReviewerIssue } from './issue-schema.js'
import { emitInspectComplete, tallyInspector } from './loop-trace.js'
import type { RoundCollector } from './loop-trace.js'
import type { ProgressReporter } from './progress-log.js'
import { buildInspectPrompt } from './prompt-templates.js'
import type { TraceLogger } from './trace-log.js'
import { execGit } from './worktree.js'

export interface RunInspectorDeps {
  spawn: SpawnFn
  cwd: string
  issue: ReviewerIssue
  baselineSha: string
  outputPath: string
  logPath: string
  reporter: ProgressReporter
  model: string
  extraArgs: readonly string[]
  timeoutMs?: number
}

export async function runInspector(
  deps: RunInspectorDeps,
  round: number,
  issueId: string,
  trace: TraceLogger,
  collector?: RoundCollector,
): Promise<InspectorResult & { usage: AgentUsage }> {
  const { stdout: diff } = await execGit(deps.cwd, ['diff', `${deps.baselineSha}..HEAD`])
  const result = await runAgent({
    spawn: deps.spawn,
    model: deps.model,
    cwd: deps.cwd,
    prompt: buildInspectPrompt(deps.issue, diff, '', agentWritePath(deps.outputPath)),
    outputPath: deps.outputPath,
    outputSchema: InspectorResultSchema,
    label: 'inspector',
    reporter: deps.reporter,
    logPath: deps.logPath,
    extraArgs: deps.extraArgs,
    timeoutMs: deps.timeoutMs,
  })
  emitInspectComplete(trace, round, issueId, result.value.addresses, result.value.confidence, result.value.reasoning)
  if (collector !== undefined) {
    tallyInspector(collector, result.value.addresses)
  }
  return { ...result.value, usage: result.usage }
}

export async function runInspectorOrTreatAsRejection(
  deps: IssueProcessorDeps,
  worker: IssueWorker,
  record: import('./issue-ledger.js').LedgerIssueRecord,
  baselineSha: string,
  round: number,
  collector: RoundCollector,
): Promise<InspectorResult & { usage: AgentUsage }> {
  const inspectorConfig = deps.config.inspector ?? deps.config.fixer
  try {
    return await runInspector(
      {
        spawn: deps.spawn,
        cwd: worker.worktreePath,
        issue: record.issue,
        baselineSha,
        outputPath: deps.runState.inspectPath,
        logPath: deps.runState.logPath,
        reporter: deps.log,
        model: inspectorConfig.model,
        extraArgs: inspectorConfig.extraArgs,
        timeoutMs: inspectorConfig.timeoutMs ?? deps.config.agentTimeoutMs,
      },
      round,
      record.id,
      deps.trace,
      collector,
    )
  } catch (error) {
    const originalReasoning = error instanceof Error ? error.message : String(error)
    deps.log.log(`[inspect] inspector unavailable: ${originalReasoning}`)
    emitInspectComplete(deps.trace, round, record.id, false, 0, 'inspector unavailable')
    if (collector !== undefined) {
      tallyInspector(collector, false)
    }
    return {
      addresses: false,
      reasoning: 'inspector unavailable',
      confidence: 0,
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, wallMs: 0 },
    }
  }
}
