// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReviewerIssue } from './issue-schema.js'

export function buildReviewPrompt(planPath: string, outputPath: string): string {
  return [
    `Review the current implementation against the implementation plan at: ${planPath}.`,
    `Read the plan first, then evaluate the implementation against it; cite which plan requirement each issue relates to.`,
    `Write your findings as JSON to: ${outputPath}`,
    '',
    'In scope: bugs, security, error-handling gaps, plan-conformance, and violations of the repo conventions in AGENTS.md (already in your context) — e.g. the logging rules, the no-lint-disable rule, .js import paths, and the max-lines design signal.',
    'NOT in scope (do not report): style/formatting a linter owns, naming preferences, or "correct but I would write it differently."',
    '',
    'Evidence rule: only report an issue for files/lines you have actually opened and read. `evidence` must quote the offending source line(s); `file`/`lineStart`/`lineEnd` must point at code you opened. Before raising an issue, verify the impact you claim (e.g. check .gitignore before asserting something "will be committed by git add -A"; trace the control flow before claiming a missing keyword matters). If you cannot cite exact evidence or verify the impact, lower `confidence` or omit the issue.',
    '',
    'Verification budget: do NOT run test suites, builds, typechecks, linters, or the repo check command (e.g. `bun run test`, `bun run typecheck`, `bun run knip`, `bun check:full`) — the fixer and the final build check own build/test verification. Gather evidence only by reading files, inspecting `git diff`/`git log`/`git show`, and cheap targeted searches (rg/grep).',
    '',
    'Severity calibration — critical: data loss / security / crash / blocks the plan goal; high: likely bug or breaks a requirement; medium: conditional correctness risk or maintainability; low: minor. Include all severity levels.',
    '',
    'Use this exact schema:',
    '{"issues": [{"title": string, "severity": "critical" | "high" | "medium" | "low", "summary": string, "whyItMatters": string, "evidence": string, "file": string, "lineStart": number, "lineEnd": number, "suggestedFix": string, "confidence": number}]}',
    '`confidence` is a probability between 0 and 1 (e.g. 0.85), NOT a 1-5 rating.',
    'If there are no issues, write: {"issues": []}',
  ].join('\n\n')
}

export function buildFixPrompt(issue: ReviewerIssue, outputPath: string, checkCommand: string): string {
  return [
    'Verify and fix the issue below.',
    'First, verify whether this issue is valid, already fixed, or a false positive.',
    `If valid and auto-fixable, fix it and run \`${checkCommand}\` to confirm. Edit only what is necessary — no drive-by refactors; scope edits to targetFiles.`,
    'If non-trivial, run a check that reproduces the issue before and confirms resolution after. When you edit a shared helper, enumerate all of its call sites in your reasoning and confirm each still works.',
    'Do NOT commit and do NOT edit the plan/spec. If the issue is really that the code diverged from the plan/spec but is not a code defect (extra files, different structure), do not change anything — return verdict "plan_drift" with reasoning describing the divergence.',
    `Write your result as JSON to: ${outputPath}`,
    'Use this exact schema:',
    '{"verdict": "valid" | "invalid" | "already_fixed" | "needs_human" | "plan_drift", "fixability": "auto" | "manual", "reasoning": string, "targetFiles": string[], "fixed": boolean, "commitSha": string | null, "commitMessage": string, "severity": "critical" | "high" | "medium" | "low"}',
    '- verdict "valid" means a real defect that you fixed; a real but not-auto-fixable issue is "needs_human".',
    '- commitMessage: a single-line conventional-commit subject describing the ACTUAL changes you made (the orchestrator commits; you do not).',
    '- severity: your independently-assessed severity (may differ from the reviewer). Omit only for "invalid".',
    'If not fixable automatically, do not modify any files.',
    '',
    'Issue:',
    JSON.stringify(issue, null, 2),
  ].join('\n\n')
}

export function buildRetryFixPrompt(
  issue: ReviewerIssue,
  outputPath: string,
  buildError: string,
  checkCommand: string,
): string {
  return [
    'Your previous fix broke the build. Fix the build error and try again.',
    `After fixing, run \`${checkCommand}\` to verify the build passes.`,
    'This is your final attempt. If you cannot make the build pass, report "needs_human" and leave the tree buildable — do not leave a broken tree.',
    `Write your updated result as JSON to: ${outputPath}`,
    'Use this exact schema:',
    '{"verdict": "valid" | "invalid" | "already_fixed" | "needs_human" | "plan_drift", "fixability": "auto" | "manual", "reasoning": string, "targetFiles": string[], "fixed": boolean, "commitSha": string | null, "commitMessage": string, "severity": "critical" | "high" | "medium" | "low"}',
    '',
    'Build error output:',
    buildError,
    '',
    'Original issue:',
    JSON.stringify(issue, null, 2),
  ].join('\n\n')
}

export function buildInspectPrompt(
  issue: ReviewerIssue,
  diff: string,
  fixerReasoning: string,
  outputPath: string,
): string {
  return [
    'You are an inspector. Your ONLY job: decide whether the diff below actually addresses the issue described.',
    'Do not flag unrelated problems. Do not assess code quality. Do not run checks.',
    'A build check has already passed — assume the code compiles and tests pass.',
    '',
    'Return addresses=true ONLY if you can point to specific lines in the diff that resolve the specific complaint in the issue.',
    'Return addresses=false if the diff is cosmetic, addresses a different problem, or leaves the core complaint untouched.',
    'When addresses=false, your reasoning MUST be actionable: explain what the fixer should have done differently.',
    '',
    `Write your result as JSON to: ${outputPath}`,
    'Use this exact schema:',
    '{"addresses": boolean, "reasoning": string, "confidence": number}',
    '`confidence` is a probability between 0 and 1 (e.g. 0.85), NOT a 1-5 rating.',
    '',
    'Issue:',
    JSON.stringify(issue, null, 2),
    '',
    'Fixer reasoning (what the fixer claims it did):',
    fixerReasoning,
    '',
    'Diff (baseline..HEAD):',
    diff,
  ].join('\n\n')
}

export function buildRetryFixWithInspectorFeedbackPrompt(
  issue: ReviewerIssue,
  inspectorReasoning: string,
  outputPath: string,
  checkCommand: string,
): string {
  return [
    'Your previous fix was rejected by an inspector.',
    'The inspector said:',
    inspectorReasoning,
    '',
    'You have two options:',
    '1. If the inspector is RIGHT and the issue cannot be auto-fixed cleanly, return verdict "invalid", "needs_human", or "plan_drift" with reasoning. Do not edit anything.',
    '2. If the inspector is WRONG or you can fix differently, produce a corrected fix. Edit only what is necessary; run the check command to confirm.',
    `After fixing, run \`${checkCommand}\` to verify the build passes.`,
    'This is your final attempt. If you cannot make it work, return verdict "needs_human" — do not leave a broken tree.',
    `Write your result as JSON to: ${outputPath}`,
    'Use this exact schema:',
    '{"verdict": "valid" | "invalid" | "already_fixed" | "needs_human" | "plan_drift", "fixability": "auto" | "manual", "reasoning": string, "targetFiles": string[], "fixed": boolean, "commitSha": string | null, "commitMessage": string, "severity": "critical" | "high" | "medium" | "low"}',
    '',
    'Issue:',
    JSON.stringify(issue, null, 2),
  ].join('\n\n')
}
