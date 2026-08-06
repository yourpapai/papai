// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

const stemFrom = (file: string): string => {
  const base = path.basename(file).replace(/\.ts$/u, '')
  return base
}

export function buildSelectPrompt(input: {
  doneSet: readonly string[]
  baselineSummary: string
  outputPath: string
}): string {
  const excluded = input.doneSet.length === 0 ? '(none)' : input.doneSet.join(', ')
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
    '- Create or modify files ONLY under tests/ and docs/superpowers/, plus the one result JSON',
    '  below - do not create copies of it anywhere else.',
    '',
    `When done, REWRITE your result JSON to this ABSOLUTE path: ${input.outputPath}`,
    'Schema: { specPath: string, planPath: string, testPaths: string[] (>=1),',
    'residuals: [{loc, why}], notes: string }.',
  ].join('\n')
}

export function buildImprovePrompt(input: {
  file: string
  beforeScore: number
  threshold: number
  date: string
  outputPath: string
}): string {
  const stem = stemFrom(input.file)
  const specPath = `docs/superpowers/specs/${input.date}-mutation-coverage-${stem}-design.md`
  const planPath = `docs/superpowers/plans/${input.date}-mutation-coverage-${stem}.md`
  return [
    `You are the IMPROVE phase of an autonomous mutation-coverage improvement runner.`,
    `Target file: ${input.file} (current mutation score: ${input.beforeScore}; target: >= ${input.threshold})`,
    '',
    'Execute, in order, the FULL procedure:',
    '',
    '1. MEASURE. Run `bun test:mutate:file ' + input.file + '` and inspect reports/paired/ to enumerate',
    '   the ACTUAL surviving mutants. Ground every later step in the real report, not speculation.',
    '2. SPEC. Write ' + specPath + ' with sections: Summary / Why this file / Non-goals / Gap analysis',
    '   (a table of surviving mutant classes, one row per class) / Design - tests to add (mapped one-to-one',
    '   onto the gap classes) / Verification / Accepted residuals.',
    '3. PLAN. Write ' + planPath + ' with task-per-mutant-class checkboxes and global constraints.',
    '4. TESTS. Extend the existing companion test file (tests/.../<stem>.test.ts). Every new assertion',
    '   MUST use exact equality toBe(...) - never startsWith/endsWith/toContain where a full string is',
    '   knowable. One test per mutant class.',
    '5. RESIDUALS. Enumerate equivalent mutants that survive and genuinely cannot be killed, with per-loc',
    '   reasoning.',
    '',
    `Write your result as JSON to this ABSOLUTE path (note the hidden .review-loop/ parent dir): ${input.outputPath}`,
    'Schema: { specPath: string, planPath: string, testPaths: string[] (>=1),',
    'residuals: [{loc, why}], notes: string }.',
    '',
    'HARD CONSTRAINTS (the runner verifies these and REJECTS the iteration if violated):',
    '- MUST NOT edit anything under src/, client/, plugins/, or scripts/. Test-only.',
    '- MUST NOT edit scripts/mutation/baseline.json (the runner owns it).',
    '- Create or modify files ONLY under tests/ and docs/superpowers/, plus the one result JSON',
    '  above - do not create copies of it anywhere else. Any other new or changed file,',
    '  including under review-loop/ or mutation-improve/, fails the diff gate.',
    '- Run `bun test tests/<companion>` green before finishing.',
    '- SPDX license headers on any new file; emoji copied verbatim from source.',
  ].join('\n')
}
