<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan — mutation coverage for `plugins/task-provider-kaneo/search-tasks.ts`

Implements the design in
`docs/superpowers/specs/2026-08-07-mutation-coverage-search-tasks-design.md`.

## Goal

Raise the per-file Stryker score from `0.6327` to the tests-only ceiling
(`0.8163`) by extending `tests/plugins/task-provider-kaneo/search-tasks.test.ts`
only. The remaining nine survivors are declared residuals → **capped** outcome.

## Global constraints

- Test-only: touch only `tests/` and `docs/superpowers/` (plus the one
  `result.json`). No edits under `src/`, `client/`, `plugins/`, `scripts/`.
- Every new assertion uses exact equality (`toBe` / `toEqual`); no partial
  matchers for knowable values.
- No `lint-disable` / `type-ignore` comments; respect `no-unsafe-type-assertion`
  (no `as unknown as T`, no narrowing casts).
- SPDX header on any new file; emoji copied verbatim from source.
- One new test per mutant class.

## Tasks

- [x] **Measure.** Run `bun test:mutate:file plugins/task-provider-kaneo/search-tasks.ts`;
  enumerate survivors from `reports/paired/plugins__task-provider-kaneo__search-tasks.ts.stryker-report.json`.
  Result: 18 survivors (14 Survived + 4 NoCoverage).
- [x] **Class 1 — pick-mask (ids 3, 4, 5, 6, 8).** Add
  `TaskResultSchema retains every picked source field`: `safeParse` a full object,
  assert `id`/`title`/`number`/`status`/`priority`/`projectId` via `toBe`.
- [x] **Class 2 — number default (id 13).** Add
  `flattenGroupedTaskSearchResults preserves number and defaults null number to 0`:
  import the helper, assert `42` and `0`.
- [x] **Class 3 — userId default (id 16).** Add
  `flattenGroupedTaskSearchResults defaults null userId to empty string`:
  assert `''`.
- [x] **Class 4 — offset slice (id 32).** Add
  `applies offset without limit when filtering by assigneeId`: two matching
  tasks + `offset: 1`, assert length `1` and the second id.
- [x] **Class 5 — catch propagation (id 46).** Add
  `rethrows a classified error when the search request fails`: mock 500,
  `rejects.toThrow('Kaneo API GET request failed with status 500')`.
- [x] **Residuals — logging (ids 0, 1, 36, 37, 44, 45, 47, 48).** No test.
  Investigated a tracked-logger delayed-import suite; it fails Stryker's combined
  dry run (shared process binds `log` to real pino before any mock). Declared
  residual.
- [x] **Residual — priority fallback (id 14).** No test. Dead code in the
  integrated path; direct helper test needs a forbidden type assertion. Declared
  residual.
- [x] **Verify.** `bun test tests/plugins/task-provider-kaneo/search-tasks.test.ts`
  (12 pass); `bun test tests/plugins/task-provider-kaneo/` (373 pass); oxlint
  clean; re-measure → `score=0.8163`, survivors exactly
  `["0","1","14","36","37","44","45","47","48"]`.
- [x] **Result.** Write `result.json` with spec/plan/test paths and the nine
  residual entries.
