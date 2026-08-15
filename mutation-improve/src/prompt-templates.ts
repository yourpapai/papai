// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CappedEntry } from './capped-registry.js'

// Kept in step with `result-schema.ts` by hand, and asserted against it: the
// prompt states the shape as a literal, so a field the parser rejects — or one
// the agent is still told to produce after it stopped being asked for — costs a
// whole iteration to a validation error.
const RESULT_SCHEMA_LINE =
  'Schema: { testPaths: string[] (>=1),\n' + 'residuals: [{loc, why, mutantIds: string[]}], notes: string }.'

// Both header forms spelled out verbatim: agents default to the // style they
// see in source, but check.sh requires the HTML-comment form for docs/*.md and
// rejects anything else at the pre-commit hook.
const LICENSE_HEADER_LINES = [
  '- SPDX license headers on any new file; emoji copied verbatim from source.',
  '  Header styles: .ts files use `// SPDX-License-Identifier: BUSL-1.1` (plus copyright lines);',
  '  .md files MUST use the HTML-comment form as the first lines of the file:',
  '  <!--',
  '  SPDX-License-Identifier: BUSL-1.1',
  '  Copyright (c) 2026 Dmitriy Lazarev',
  '  Use of this software is governed by the Business Source License 1.1.',
  '  See LICENSE in the project root for details.',
  '  -->',
]

export function buildSelectPrompt(input: {
  doneSet: readonly string[]
  failedFiles: readonly string[]
  cappedFiles: readonly CappedEntry[]
  baselineSummary: string
  outputPath: string
}): string {
  const excluded = input.doneSet.length === 0 ? '(none)' : input.doneSet.join(', ')
  const failed = input.failedFiles.length === 0 ? '(none)' : input.failedFiles.join(', ')
  const capped =
    input.cappedFiles.length === 0
      ? '(none)'
      : input.cappedFiles.map((e) => `${e.file} (ceiling ${e.score})`).join(', ')
  return [
    'You are the SELECT phase of an autonomous mutation-coverage improvement runner.',
    '',
    'Read scripts/mutation/baseline.json (a {filePath: score} map; current contents below) and pick',
    'the SINGLE highest-ROI source file to improve, where ROI = reliable mutation-score gain per',
    'unit of test effort. Prefer pure functions with zero external dependencies, an existing',
    'companion test file, and surviving mutants that each map to an observable bug.',
    '',
    'REJECT files matching any of these patterns (they waste effort):',
    '- Declarative lookup tables / schema files where >80% of lines are data (e.g. big REGISTRY/Zod maps) and the score is already >= 0.9.',
    '- Files whose non-determinism caps the reachable score (e.g. Math.random jitter, real wall-clock) — jitter mutants can only be bounds-checked.',
    '- Single-statement passthrough wrappers whose real logic lives elsewhere.',
    '- Files whose companion test cannot exercise the behaviour without a full chat/LLM runtime.',
    '',
    `Files already improved in this run (DO NOT pick): ${excluded}`,
    `Files already attempted and FAILED this run (DO NOT pick; same gates, same model — a retry re-fails): ${failed}`,
    `Files capped at their tests-only ceiling by earlier runs (DO NOT pick; the ceiling is already merged): ${capped}`,
    '',
    `baseline.json contents: ${input.baselineSummary}`,
    '',
    `Write your pick as JSON to this ABSOLUTE path: ${input.outputPath}`,
    'Schema: { file: string (repo-relative), beforeScore: number (your read of baseline[file], 0..1),',
    'rationale: string (1-3 sentences), runnerUps: [{file, score, why}] (2-3 rejected candidates) }.',
    'Write ONLY that file; do not edit any source.',
  ].join('\n')
}

export function buildFixPrompt(input: {
  file: string
  attempt: number
  maxAttempts: number
  buildOutput: string
  outputPath: string
}): string {
  return [
    `You are the FIX phase of an autonomous mutation-coverage improvement runner.`,
    `The runner's build gate (the repo's full check suite) FAILED in your worktree after your`,
    `changes for ${input.file}. This is fix attempt ${input.attempt} of ${input.maxAttempts}.`,
    '',
    'Failed check output (tail):',
    '---',
    input.buildOutput,
    '---',
    '',
    'Diagnose the failure and fix the cause. The output names the failing check and the files it',
    'rejected; those are files YOU created or modified. Typical causes: formatting (run the',
    "repo's formatter on your files), lint, typecheck errors, or a failing test you added.",
    'Re-run the failing check until it passes before finishing.',
    '',
    'HARD CONSTRAINTS (unchanged; the runner verifies these and REJECTS the iteration if violated):',
    '- MUST NOT edit anything under src/, client/, plugins/, or scripts/.',
    '- Create or modify files ONLY under tests/ and openspec/changes/, plus the one result JSON',
    '  below - do not create copies of it anywhere else.',
    '',
    `When done, REWRITE your result JSON to this ABSOLUTE path: ${input.outputPath}`,
    RESULT_SCHEMA_LINE,
  ].join('\n')
}

export function buildImprovePrompt(input: {
  file: string
  beforeScore: number
  threshold: number
  outputPath: string
}): string {
  return [
    `You are the IMPROVE phase of an autonomous mutation-coverage improvement runner.`,
    `Target file: ${input.file} (current mutation score: ${input.beforeScore}; target: >= ${input.threshold})`,
    '',
    'Execute, in order, the FULL procedure:',
    '',
    '1. MEASURE. Run `bun test:mutate:file ' + input.file + '` and inspect reports/paired/ to enumerate',
    '   the ACTUAL surviving mutants. Ground every later step in the real report, not speculation.',
    '2. TESTS. Extend the existing companion test file (tests/.../<stem>.test.ts). Every new assertion',
    '   MUST use exact equality toBe(...) - never startsWith/endsWith/toContain where a full string is',
    '   knowable. One test per mutant class.',
    '3. RESIDUALS. Enumerate equivalent mutants that survive and genuinely cannot be killed, with per-loc',
    '   reasoning. Each entry MUST list the Stryker mutant ids it covers (mutantIds: string[]) exactly as',
    '   they appear in your measured report (reports/paired/<stem>.stryker-report.json, "id" fields with',
    '   status Survived or NoCoverage). The runner re-measures and set-matches the UNION of your mutantIds',
    '   against its own surviving ids: they must be EQUAL — every survivor declared, nothing extra.',
    '',
    'CAPPED PATH. If the file\u2019s tests-only ceiling lands below the target (equivalent mutants / dead code',
    'that only a src/ edit could remove), a full residual declaration still counts as success: the runner',
    'merges your tests, ratchets the baseline to the measured score, and marks the file capped (outcome',
    "'capped'), provided the score improved AND your declared mutantIds exactly cover every survivor.",
    'A file below target with incomplete or padded mutantIds FAILS and all work is discarded.',
    '',
    `Write your result as JSON to this ABSOLUTE path (note the hidden .review-loop/ parent dir): ${input.outputPath}`,
    RESULT_SCHEMA_LINE,
    '',
    'HARD CONSTRAINTS (the runner verifies these and REJECTS the iteration if violated):',
    '- MUST NOT edit anything under src/, client/, plugins/, or scripts/. Test-only.',
    '- MUST NOT edit scripts/mutation/baseline.json (the runner owns it).',
    '- Create or modify files ONLY under tests/ and openspec/changes/, plus the one result JSON',
    '  above - do not create copies of it anywhere else. Any other new or changed file,',
    '  including under review-loop/ or mutation-improve/, fails the diff gate.',
    '- Run `bun test tests/<companion>` green before finishing.',
    ...LICENSE_HEADER_LINES,
  ].join('\n')
}
