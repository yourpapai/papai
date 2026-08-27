// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReviewerIssue } from './issue-schema.js'

/**
 * Exposure is reported as a citation, never as a rating: name the caller you
 * found, or state there is none. Shared verbatim by the reviewer and the fixer
 * so the two answers are comparable — their disagreement is the whole point.
 */
const EXPOSURE_SCHEMA = '{"kind": "caller", "file": string, "line": number, "quote": string} | {"kind": "none"}'

const FIXER_RESULT_SCHEMA =
  '{"verdict": "valid" | "invalid" | "already_fixed" | "needs_human" | "plan_drift", "fixability": "auto" | "manual", "reasoning": string, "targetFiles": string[], "fixed": boolean, "commitSha": string | null, "commitMessage": string, "severity": "critical" | "high" | "medium" | "low", "exposure": ' +
  EXPOSURE_SCHEMA +
  '}'

const FIXER_EXPOSURE_RULE = [
  '- exposure: your own, independent judgement of whether the code you touched is reached at all.',
  'Cite a caller you actually found — file, line, and the line quoted — or report {"kind": "none"}.',
  "Do not copy the reviewer's answer and do not defer to it; disagreeing with it is a useful result,",
  'and it never changes whether your fix is accepted.',
].join(' ')

/**
 * The ladder runs *after* comprehension, never instead of it: the cheapest fix
 * is the one that turns out not to be needed, but only reading tells you that.
 * Carried by the retry prompts too — a second attempt is where scope creeps,
 * because the first one already failed and more feels like the answer.
 */
export const MINIMALITY_LADDER = [
  'Smallest thing that works. After you understand the problem, and before you write code, in order:',
  'does this need to exist at all; is it already in this codebase; does the stdlib or an installed',
  'dependency already do it; can it be one line. Only then write something new, and write the least',
  'of it that resolves the issue. A smaller diff is not the goal — never cut validation, error',
  'handling, security, or a test to reach one.',
].join(' ')

/**
 * A check that ran once and left nothing behind proves the fix worked on the
 * author's machine and nowhere else. This repo gates implementation code on
 * test-first for exactly that reason, and a fixer is not exempt from it.
 */
const CHECK_BEHIND_RULE = [
  'Non-trivial logic leaves one runnable check behind, in the test path this repo maps the file to.',
  'Reproducing the defect in a scratch run and deleting it does not satisfy this: the check has to',
  'still be there, and still fail, if someone reverts your fix.',
].join(' ')

/**
 * The loop cannot keep prose true. No actor sees two fixes, and the last
 * round's fixes are never reviewed — so a paragraph written by one fix and
 * invalidated by a later one ships wrong, which is worse than a doc that is
 * merely out of date. Report the gap; let a human write it.
 */
const NO_PROSE_RULE = [
  'Do not write architecture documentation. If a doc is wrong or missing, say so in `reasoning`',
  'and name the file — a later fix in this same run can invalidate anything you write, and nothing',
  'here would catch it.',
].join(' ')

/**
 * Duplicated from `opencode-agent`'s `PROTECTED_PATHS_RULE` rather than
 * imported — that workspace drives this one as a subprocess and shares no
 * module boundary — and pinned against divergence by
 * `tests/opencode-agent/protected-paths-rule.test.ts`, the `MINIMALITY_LADDER`
 * precedent. Run 32992114904 (issue #360) is the cost of the gap. The second
 * paragraph is the loop's own: the agent-side rule says "say in your reply",
 * and a fixer has no reply — it has a JSON result, and without the mapping
 * the rule's manual-application half has no landing place.
 */
export const PROTECTED_PATHS_RULE = [
  "Never create or edit a file under .github/workflows/ — this pipeline's token cannot push one, and the",
  'refusal discards the whole commit. If the work needs a workflow change, do the rest and say in your reply',
  'exactly what a maintainer should apply by hand.',
  'Your reply is the result file: a fix that requires editing a protected path is not auto-fixable — return',
  'verdict "needs_human" with the exact change described in `reasoning`, editing nothing.',
].join(' ')

/**
 * Over-engineering is reportable, as a closed set of five forms rather than an
 * open category — an open one collects everything a reviewer mildly dislikes,
 * which is what the "correct but I would write it differently" exclusion above
 * already guards against and which a deletion vocabulary is uniquely able to
 * reopen.
 *
 * The mandatory replacement is the same discipline `exposure` uses: a citation,
 * not a rating. "Nothing replaces it" is a complete answer for code nothing
 * reaches; being unable to name one at all is a reason to stay quiet.
 */
const CLEANUP_FINDINGS = [
  'Also in scope — code that is more than it needs to be. Report these as `"kind": "cleanup"`; everything else above is `"kind": "defect"`, and every issue must carry one of the two.',
  'A cleanup is one of exactly five forms, and a finding that fits none of them is not a cleanup:',
  '- delete: code nothing reaches, or flexibility nothing uses. Nothing replaces it — say so; that is a complete answer, not a missing one.',
  '- stdlib: a hand-rolled thing the standard library already ships. Name the function.',
  '- native: a dependency, or code, doing what the platform already does. Name the feature.',
  '- yagni: an abstraction with one implementation, a config nobody sets, a layer with one caller.',
  '- shrink: the same logic in materially fewer lines. Show the shorter form.',
  'Every cleanup MUST name what stands in place of the code it cuts — a named function, a named platform feature, an existing helper in this codebase, the shorter form, or nothing at all for code that is simply unused. If you cannot name one, omit the finding rather than reporting it without.',
  'A cleanup is never above medium severity: severity grades what happens if the code is reached, and code that is merely over-built does not lose data, breach security, or crash. Grade a genuine defect as a defect, at whatever severity it deserves — the ceiling applies to the cleanup finding only.',
  'Cleanups are fixed after every defect, so reporting one never delays a bug. Report the ones you are confident in and omit the rest.',
].join('\n')

const SPANS_SCHEMA = '"spans": [{"file": string, "lineStart": number, "lineEnd": number, "evidence": string}]'

const COALESCE_RULE = [
  'Coalescence: if the same class repeats across files (e.g. un-migrated English literals), emit ONE theme issue with `spans`, not N separate issues.',
  'Put each location in `spans` with its own file/lineStart/lineEnd/evidence, and keep `file`/`lineStart`/`lineEnd`/`evidence` mirrored from the first span for backward compatibility.',
  'A single-file defect emits a single span and is identical to a legacy issue.',
].join(' ')

export function buildReviewPrompt(planPath: string, outputPath: string): string {
  return [
    `Review the current implementation against the implementation plan at: ${planPath}.`,
    `Read the plan first, then evaluate the implementation against it; cite which plan requirement each issue relates to.`,
    `Write your findings as JSON to: ${outputPath}`,
    '',
    'In scope: bugs, security, error-handling gaps, plan-conformance, and violations of the repo conventions in AGENTS.md (already in your context) — e.g. the logging rules, the no-lint-disable rule, .js import paths, and the max-lines design signal.',
    'NOT in scope (do not report): style/formatting a linter owns, naming preferences, or "correct but I would write it differently."',
    '',
    // A workflow-fix finding is real — the reviewer still reports it, it just
    // does not route it to an edit. Without this line every such finding buys
    // a full fixer cycle that can only end in `needs_human`, the same wasted
    // cycle the fixer-side rule exists to prevent, one layer earlier.
    "Protected paths: a finding whose fix requires editing a file under `.github/workflows/` is still reportable — describe the exact change in `suggestedFix` for a maintainer to apply by hand. The loop cannot fix it: this pipeline's token cannot push a workflow edit, so report it for manual application rather than as something a fixer will change.",
    '',
    CLEANUP_FINDINGS,
    '',
    'Evidence rule: only report an issue for files/lines you have actually opened and read. `evidence` must quote the offending source line(s); `file`/`lineStart`/`lineEnd` must point at code you opened. Before raising an issue, verify the impact you claim (e.g. check .gitignore before asserting something "will be committed by git add -A"; trace the control flow before claiming a missing keyword matters). If you cannot cite exact evidence or verify the impact, lower `confidence` or omit the issue.',
    '',
    COALESCE_RULE,
    '',
    'Verification budget: do NOT run test suites, builds, typechecks, linters, or the repo check command (e.g. `bun run test`, `bun run typecheck`, `bun run knip`, `bun check:full`) — the fixer and the final build check own build/test verification. Gather evidence only by reading files, inspecting `git diff`/`git log`/`git show`, and cheap targeted searches (rg/grep).',
    '',
    'Exposure — every issue MUST carry `exposure`, and omitting it is not an answer. Severity grades what happens if the code is reached; exposure records whether it is reached at all. Find a caller that reaches the code you are reporting on and cite it: the file, the line, and that line quoted. If you searched and nothing reaches it, report {"kind": "none"} — that is a finding, not a failure. Cite only what you actually found, exactly as the evidence rule requires. Exposure never suppresses your issue; it orders which issues are fixed first.',
    '',
    'Severity calibration — critical: data loss / security / crash / blocks the plan goal; high: likely bug or breaks a requirement; medium: conditional correctness risk or maintainability; low: minor. Include all severity levels.',
    '',
    'Use this exact schema:',
    '{"issues": [{"title": string, "kind": "defect" | "cleanup", "severity": "critical" | "high" | "medium" | "low", "summary": string, "whyItMatters": string, "evidence": string, "file": string, "lineStart": number, "lineEnd": number, "suggestedFix": string, "confidence": number, "exposure": ' +
      EXPOSURE_SCHEMA +
      ', ' +
      SPANS_SCHEMA +
      ' (optional, theme issue coalescence)}]}',
    '`confidence` is a probability between 0 and 1 (e.g. 0.85), NOT a 1-5 rating.',
    'If there are no issues, write: {"issues": []}',
  ].join('\n\n')
}

export function buildFixPrompt(issue: ReviewerIssue, outputPath: string, checkCommand: string): string {
  return [
    'Verify and fix the issue below.',
    'First, verify whether this issue is valid, already fixed, or a false positive.',
    `If valid and auto-fixable, fix it and run \`${checkCommand}\` to confirm. Edit only what is necessary — no drive-by refactors; scope edits to targetFiles.`,
    MINIMALITY_LADDER,
    'If non-trivial, run a check that reproduces the issue before and confirms resolution after. When you edit a shared helper, enumerate all of its call sites in your reasoning and confirm each still works.',
    CHECK_BEHIND_RULE,
    'Do NOT commit and do NOT edit the plan/spec. If the issue is really that the code diverged from the plan/spec but is not a code defect (extra files, different structure), do not change anything — return verdict "plan_drift" with reasoning describing the divergence.',
    NO_PROSE_RULE,
    PROTECTED_PATHS_RULE,
    `Write your result as JSON to: ${outputPath}`,
    'Use this exact schema:',
    FIXER_RESULT_SCHEMA,
    FIXER_EXPOSURE_RULE,
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
    MINIMALITY_LADDER,
    PROTECTED_PATHS_RULE,
    'This is your final attempt. If you cannot make the build pass, report "needs_human" and leave the tree buildable — do not leave a broken tree.',
    `Write your updated result as JSON to: ${outputPath}`,
    'Use this exact schema:',
    FIXER_RESULT_SCHEMA,
    FIXER_EXPOSURE_RULE,
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
    MINIMALITY_LADDER,
    PROTECTED_PATHS_RULE,
    'This is your final attempt. If you cannot make it work, return verdict "needs_human" — do not leave a broken tree.',
    `Write your result as JSON to: ${outputPath}`,
    'Use this exact schema:',
    FIXER_RESULT_SCHEMA,
    FIXER_EXPOSURE_RULE,
    '',
    'Issue:',
    JSON.stringify(issue, null, 2),
  ].join('\n\n')
}

export function buildAggregatedInspectPrompt(
  issues: readonly { id: string; issue: ReviewerIssue }[],
  diff: string,
  outputPath: string,
): string {
  return [
    'You are an inspector for an aggregated batch. Your ONLY job: decide for EACH issue below whether the diff addresses it.',
    'Do not flag unrelated problems. Do not assess code quality. Do not run checks.',
    'A build check has already passed — assume the code compiles and tests pass.',
    '',
    'Return addresses=true ONLY if you can point to specific lines in the diff that resolve the specific complaint in that issue.',
    'For each issue, return {id, addresses, reasoning, confidence}. When addresses=false, reasoning MUST be actionable.',
    '',
    `Write your result as JSON to: ${outputPath}`,
    'Use this exact schema:',
    '{"results": [{"id": string, "addresses": boolean, "reasoning": string, "confidence": number}]}',
    '`confidence` is a probability between 0 and 1, NOT a 1-5 rating.',
    '',
    'Issues:',
    JSON.stringify(issues, null, 2),
    '',
    'Diff (baseline..HEAD):',
    diff,
  ].join('\n\n')
}
