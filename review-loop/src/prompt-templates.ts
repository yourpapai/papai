// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReviewerIssue } from './issue-schema.js'

export function buildReviewPrompt(planPath: string, outputPath: string): string {
  return [
    `Review the current implementation against the implementation plan at: ${planPath}.`,
    `Write your findings as JSON to: ${outputPath}`,
    'Include all severity levels: critical, high, medium, low.',
    'Use this exact schema:',
    '{"issues": [{"title": string, "severity": "critical" | "high" | "medium" | "low", "summary": string, "whyItMatters": string, "evidence": string, "file": string, "lineStart": number, "lineEnd": number, "suggestedFix": string, "confidence": number}]}',
    'If there are no issues, write: {"issues": []}',
  ].join('\n\n')
}

export function buildFixPrompt(issue: ReviewerIssue, outputPath: string, checkCommand: string): string {
  return [
    'Verify and fix the issue below.',
    'First, verify whether this issue is valid, already fixed, or a false positive.',
    `If valid and auto-fixable, fix it, run \`${checkCommand}\`, and commit with message: fix(review-loop): <issue title>.`,
    'If not fixable automatically, do not modify any files.',
    `Write your result as JSON to: ${outputPath}`,
    'Use this exact schema:',
    '{"verdict": "valid" | "invalid" | "already_fixed" | "needs_human", "fixability": "auto" | "manual", "reasoning": string, "targetFiles": string[], "fixed": boolean, "commitSha": string | null}',
    '',
    'Issue:',
    JSON.stringify(issue, null, 2),
  ].join('\n\n')
}

export function buildRetryFixPrompt(issue: ReviewerIssue, outputPath: string, buildError: string): string {
  return [
    'Your previous fix broke the build. Fix the build error and try again.',
    `Write your updated result as JSON to: ${outputPath}`,
    'Use the same schema as before.',
    '',
    'Build error output:',
    buildError,
    '',
    'Original issue:',
    JSON.stringify(issue, null, 2),
  ].join('\n\n')
}
