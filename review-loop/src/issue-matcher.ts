// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { runAgent, type SpawnFn } from './agent-runner.js'
import type { LedgerIssueRecord } from './issue-ledger.js'
import { IssueMatchesSchema } from './issue-schema.js'
import type { IssueMatch, ReviewerIssue } from './issue-schema.js'

export interface MatchIssuesDeps {
  spawn: SpawnFn
  newIssues: readonly ReviewerIssue[]
  existingRecords: readonly LedgerIssueRecord[]
  outputPath: string
  logPath: string
  cwd: string
  model: string
  extraArgs: readonly string[]
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
    'Match newly found issues to existing issues from the ledger by semantic similarity.',
    'Two issues match if they describe the same underlying problem, even if worded differently.',
    'Write the result as JSON to:',
    outputPath,
    'Use this exact schema:',
    '{"matches": [{"newIssueIndex": number, "existingId": string | null}]}',
    'Set existingId to null for genuinely new issues.',
    '',
    'New issues:',
    newSummary,
    '',
    'Existing issues:',
    existingSummary || '(none)',
  ].join('\n')
}

export async function matchIssues(deps: MatchIssuesDeps): Promise<IssueMatch[]> {
  if (deps.existingRecords.length === 0) {
    return deps.newIssues.map((_, index) => ({ newIssueIndex: index, existingId: null }))
  }

  const prompt = buildMatcherPrompt(deps.newIssues, deps.existingRecords, deps.outputPath)

  const result = await runAgent({
    spawn: deps.spawn,
    model: deps.model,
    cwd: deps.cwd,
    prompt,
    outputPath: deps.outputPath,
    outputSchema: IssueMatchesSchema,
    label: 'matcher',
    logPath: deps.logPath,
    extraArgs: deps.extraArgs,
  })

  return result.matches
}
