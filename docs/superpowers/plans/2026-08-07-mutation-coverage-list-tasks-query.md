<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan — mutation coverage for `plugins/task-provider-kaneo/list-tasks-query.ts`

Implements the design in
`docs/superpowers/specs/2026-08-07-mutation-coverage-list-tasks-query-design.md`.

## Goal

Take `plugins/task-provider-kaneo/list-tasks-query.ts` from Stryker score 0
(all 10 mutants `NoCoverage`) to **1.0** (target >= 0.9) using a single new
test-only companion file. No `src/`/`client/`/`plugins/`/`scripts/` edits.

## Global constraints

- Test-only: the only new file lives under `tests/`.
- Every assertion uses exact `toBe(...)` equality on a fully-knowable value
  (JSON-serialized result string); never `startsWith`/`endsWith`/`toContain`.
- One test per mutant class (C1, C2, C3), matching the spec one-to-one.
- SPDX license header on the new test file (BUSL-1.1 `.ts` form).
- `.js` extensions on relative imports; type-only import for `ListTasksParams`
  from `papai/plugin-types` (matches source).
- No `any`, no `@ts-` ignore/disable comments.

## Tasks

- [x] **T1 — Measure.** Ran
      `bun test:mutate:file plugins/task-provider-kaneo/list-tasks-query.ts`;
      report `reports/paired/plugins__task-provider-kaneo__list-tasks-query.ts.stryker-report.json`
      shows 10 mutants, all `NoCoverage`, ids 0-9.

- [x] **T2 — Class C1: defined values are stringified and retained.** Add a test
      asserting `buildListTasksQuery({ status: 'open', page: 3 })` serializes to
      `'{"status":"open","page":"3"}'`. Kills mutant ids 0, 1, 2, 6, 8.

- [x] **T3 — Class C2: explicit `undefined` values are omitted.** Add a test
      asserting `buildListTasksQuery({ status: 'open', assigneeId: undefined })`
      serializes to `'{"status":"open"}'`. Kills mutant ids 3, 4, 5, 6, 9.

- [x] **T4 — Class C3: `null` values are omitted.** Add a test asserting
      `buildListTasksQuery(Object.assign({ status: 'open', priority: 'high' }, { priority: null }))`
      serializes to `'{"status":"open"}'` (null merged in lint-safely because
      `ListTasksParams` forbids null and oxlint blocks `as unknown as`).
      Kills mutant ids 3, 4, 7, 8, 9.

- [x] **T5 — Verify green.** Run
      `bun test tests/plugins/task-provider-kaneo/list-tasks-query.test.ts`.

- [x] **T6 — Re-measure.** Confirm
      `bun test:mutate:file plugins/task-provider-kaneo/list-tasks-query.ts`
      reports `killed=10 survived=0 noCoverage=0 score=1.0` with no survivors.

## Residuals

None expected — all 10 mutants are killed by the three tests above, so the
tests-only ceiling is 1.0 and there are no equivalent mutants to declare.

## Out of scope

- `list-tasks.ts` (caller) and `schemas/list-tasks.ts` coverage.
- Editing the implementation or `scripts/mutation/baseline.json`.
