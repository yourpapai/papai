// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LedgerIssueRecord } from './issue-ledger.js'
import type { ReviewerIssue, VerifierDecision } from './issue-schema.js'

function summarizeLedger(records: readonly LedgerIssueRecord[]): string {
  if (records.length === 0) {
    return 'No prior issues recorded.'
  }

  return records.map((record) => `- ${record.fingerprint} [${record.status}] ${record.issue.title}`).join('\n')
}

export function buildReviewPrompt(planPath: string, ledgerRecords: readonly LedgerIssueRecord[]): string {
  return [
    `Review the current implementation against the implementation plan at: ${planPath}.`,
    'Return JSON only.',
    'Include all severity levels: critical, high, medium, low.',
    'Use this exact schema:',
    '{"round": number, "issues": [{"title": string, "severity": "critical" | "high" | "medium" | "low", "summary": string, "whyItMatters": string, "evidence": string, "file": string, "lineStart": number, "lineEnd": number, "suggestedFix": string, "confidence": number}]}',
    'Prior issue ledger:',
    summarizeLedger(ledgerRecords),
  ].join('\n\n')
}

export function buildVerifyPrompt(planPath: string, issue: ReviewerIssue): string {
  return [
    `Verify this issue against the implementation plan at: ${planPath}.`,
    'Return JSON only.',
    'Use this exact schema:',
    '{"verdict": "valid" | "invalid" | "already_fixed" | "needs_human", "fixability": "auto" | "manual", "reasoning": string, "targetFiles": string[], "needsPlanning": boolean}',
    'Set needsPlanning to true if the fix touches multiple files, changes public APIs, or requires non-trivial refactoring.',
    JSON.stringify(issue, null, 2),
  ].join('\n\n')
}

export function buildPlanningPrompt(issue: ReviewerIssue, decision: VerifierDecision): string {
  return [
    'Produce a step-by-step plan to fix the verified issue below.',
    'The plan should be specific enough that a developer can follow it without re-reading the original issue.',
    'Return the plan as plain text.',
    'Issue:',
    JSON.stringify(issue, null, 2),
    'Verifier decision:',
    JSON.stringify(decision, null, 2),
  ].join('\n\n')
}

export function buildFixPrompt(issue: ReviewerIssue, decision: VerifierDecision, plan?: string): string {
  const sections = [
    'Fix exactly the verified issue below.',
    'Keep the fix minimal and do not broaden scope unless required for correctness.',
  ]

  if (plan !== undefined) {
    sections.push('Fix Plan:', plan)
  }

  sections.push(
    'After applying the fix:',
    '1. Run `bun check:full` to validate (lint, typecheck, format, tests).',
    '2. If any check fails, fix the failure.',
    '3. Commit with message: fix(review-loop): <issue title>',
    '4. Leave a clean worktree with no uncommitted changes.',
    'Issue:',
    JSON.stringify(issue, null, 2),
    'Verifier decision:',
    JSON.stringify(decision, null, 2),
  )

  return sections.join('\n\n')
}

export function buildRereviewPrompt(planPath: string, ledgerRecords: readonly LedgerIssueRecord[]): string {
  return [
    `Re-review the current implementation against the implementation plan at: ${planPath}.`,
    'Return JSON only with remaining critical/high/medium/low issues.',
    'Confirm whether previously fixed issues are resolved and report only unresolved or newly introduced issues.',
    'Use the same schema as the original review prompt.',
    'Current issue ledger:',
    summarizeLedger(ledgerRecords),
  ].join('\n\n')
}
