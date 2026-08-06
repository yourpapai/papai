<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan: mutation coverage for `plugins/task-provider-youtrack/query-builder.ts`

Date: 2026-08-06
Target: 0.80 → **≥ 0.9** (predicted **1.0**)
Companion spec: `docs/superpowers/specs/2026-08-06-mutation-coverage-query-builder-design.md`

## Global constraints

- **Test-only.** No edits under `src/`, `client/`, `plugins/`, `scripts/`, and
  no edit to `scripts/mutation/baseline.json`. Touch only the new companion test
  file and the two `docs/superpowers/` artifacts.
- **New file, not a refactor.** Create
  `tests/plugins/task-provider-youtrack/query-builder.test.ts`; leave the
  existing query case in `task-helpers.test.ts` untouched (it stays a regression
  anchor and the coverage map keeps it in scope).
- **Pure unit.** `buildYouTrackQuery` is synchronous and side-effect-free. No
  `mock.module`, no `setMockFetch`, no `setupTestDb` — import the function
  directly from `../../../plugins/task-provider-youtrack/query-builder.js`.
- **Exact oracles only.** Every assertion is a full-string `toBe(...)` on the
  returned query. No `toContain` / `startsWith` / `endsWith` / `toMatch`.
- **One test per mutant class.** Names mirror spec classes A–D.
- **SPDX header** on the new file (BUSL-1.1), matching the source.

## Task checklist (one per mutant class)

- [ ] **Class A — `dueAfter`-only branch.** Add test passing
      `{ dueAfter: '2026-01-01' }` → assert
      `'project: {DEMO} Due date: >2026-01-01'`. Kills mutants 33, 34, 30, 24.
- [ ] **Class B — `dueBefore`-only branch.** Add test passing
      `{ dueBefore: '2026-01-31' }` → assert
      `'project: {DEMO} Due date: <2026-01-31'`. Kills mutants 39, 40, 36.
- [ ] **Class C — `sortBy: 'createdAt'` → `'created'`.** Add test passing
      `{ sortBy: 'createdAt', sortOrder: 'desc' }` → assert
      `'project: {DEMO} sort by: created desc'` (explicit `desc` so it does not
      also cover class D). Kills mutants 47, 49, 50.
- [ ] **Class D — default `'asc'` sort order.** Add test passing
      `{ sortBy: 'priority' }` (no `sortOrder`) → assert
      `'project: {DEMO} sort by: priority asc'`. Kills mutant 53.

## Verification steps

- [ ] `bun test tests/plugins/task-provider-youtrack/query-builder.test.ts` —
      all four cases green.
- [ ] `bun test:mutate:file plugins/task-provider-youtrack/query-builder.ts` —
      `killed=55 survived=0 noCoverage=0 score=1.0`.
- [ ] `bun check:full` — lint + typecheck clean (new file only).
- [ ] Write `.review-loop/result.json` (schema: `specPath`, `planPath`,
      `testPaths`, `residuals`, `notes`). Residuals empty — no equivalent
      survivors identified.

## Residuals

None expected. All 11 survivors are killed by the four classes above; per-loc
equivalence reasoning is recorded in the spec's "Accepted residuals" section.
