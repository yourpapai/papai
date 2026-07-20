// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { agentWritePath, runAgent, type AgentUsage, type SpawnFn } from './agent-runner.js'
import type { LedgerIssueRecord } from './issue-ledger.js'
import { IssueMatchesSchema } from './issue-schema.js'
import type { IssueMatch, ReviewerIssue } from './issue-schema.js'
import type { ProgressReporter } from './progress-log.js'

export interface MatchIssuesDeps {
  spawn: SpawnFn
  newIssues: readonly ReviewerIssue[]
  existingRecords: readonly LedgerIssueRecord[]
  outputPath: string
  logPath: string
  cwd: string
  model: string
  extraArgs: readonly string[]
  reporter: ProgressReporter
  timeoutMs?: number
}

function buildMatcherPrompt(
  newIssues: readonly ReviewerIssue[],
  existingRecords: readonly LedgerIssueRecord[],
  outputPath: string,
): string {
  const newSummary = newIssues
    .map((issue, index) => `[${index}] ${issue.file}: ${issue.title} — ${issue.summary}`)
    .join('\n')

  const existingSummary = existingRecords
    .map((record) => `${record.id}: ${record.issue.file}: ${record.issue.title} — ${record.issue.summary}`)
    .join('\n')

  return [
    'Match newly found issues to existing issues from the ledger by the underlying problem (same root cause / same location), not surface wording. When in doubt, link to an existing issue; set existingId to null only for genuinely new, unrelated problems.',
    'Some existing issues may already be rejected / needs_human / already_fixed — still match re-reports to them by underlying problem; the loop decides whether to re-process.',
    'Write the result as JSON to:',
    outputPath,
    'Use this exact schema:',
    '{"matches": [{"newIssueIndex": number, "existingId": string | null}]}',
    '',
    'New issues:',
    newSummary,
    '',
    'Existing issues:',
    existingSummary || '(none)',
  ].join('\n')
}

export async function matchIssues(deps: MatchIssuesDeps): Promise<{ matches: IssueMatch[]; usage: AgentUsage }> {
  if (deps.newIssues.length === 0) {
    return { matches: [], usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, wallMs: 0 } }
  }

  if (deps.existingRecords.length === 0) {
    return {
      matches: deps.newIssues.map((_, index) => ({ newIssueIndex: index, existingId: null })),
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, wallMs: 0 },
    }
  }

  const prompt = buildMatcherPrompt(deps.newIssues, deps.existingRecords, agentWritePath(deps.cwd, deps.outputPath))

  const agentResult = await runAgent({
    spawn: deps.spawn,
    model: deps.model,
    cwd: deps.cwd,
    prompt,
    outputPath: deps.outputPath,
    outputSchema: IssueMatchesSchema,
    label: 'matcher',
    reporter: deps.reporter,
    logPath: deps.logPath,
    extraArgs: deps.extraArgs,
    timeoutMs: deps.timeoutMs,
  })

  return { matches: agentResult.value.matches, usage: agentResult.usage }
}
