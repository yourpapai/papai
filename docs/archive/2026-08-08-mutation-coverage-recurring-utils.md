<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan — Mutation Coverage for `src/recurring-utils.ts`

**Spec:** `docs/superpowers/specs/2026-08-08-mutation-coverage-recurring-utils-design.md`
**Goal:** Raise `src/recurring-utils.ts` mutation score from 0.6 toward ≥ 0.9 via
test-only changes, declaring the residual equivalent mutants.

## Global constraints

- **Test-only.** No edits under `src/`, `client/`, `plugins/`, `scripts/`, and
  never touch `scripts/mutation/baseline.json`.
- **New files only under** `tests/` and `docs/superpowers/`, plus the single
  `result.json` under `.review-loop/`.
- **Companion file:** create `tests/recurring-utils.test.ts` (no companion
  exists today; the resolver maps `src/recurring-utils.ts` → this path).
- **Exact equality only:** every assertion uses `toBe` (scalars) or `toEqual`
  (arrays/objects) on fully-knowable values. No `startsWith` / `endsWith` /
  `toContain` where the full value is knowable.
- **Determinism:** avoid wall-clock dependence. Use `COUNT`-bounded rules whose
  occurrences are all in the past, so the internal `new Date()` bound never
  changes which occurrences fall in range.
- **License header** on the new test file: `// SPDX-License-Identifier: BUSL-1.1`
  + copyright lines, matching the repo style.

## Tasks (one per mutant class)

- [ ] **A. `parseLabels` empty-string/null guard** — add a test that calls
      `parseLabels('')` and `parseLabels(null)` and asserts `toEqual([])`.
      Kills mutant ids 2, 3, 6, 8, 9.
- [ ] **B. `parseLabels` non-array guard** — add a test that calls
      `parseLabels('{}')` and `parseLabels('5')` and asserts `toEqual([])`.
      Kills mutant ids 12, 13.
- [ ] **C. `parseLabels` string-element filter** — add a test that calls
      `parseLabels('["a",1,true,"b"]')` and asserts `toEqual(['a','b'])`.
      Kills mutant ids 14, 16.
- [ ] **D. `toRecord` `catchUp` coercion** — add a test that builds two full
      rows identical except `catchUp: '1'` vs `'0'`, calls `toRecord`, and
      asserts `.catchUp` is `toBe(true)` / `toBe(false)`. Kills ids 33, 34, 35, 36.
- [ ] **E. `computeNextRun` null branch** — add a test with an exhausted
      `COUNT=2` daily rule and a future `after` date, asserting the result is
      `toBe(null)`. Kills id 39.
- [ ] **F. `computeMissedDates` `fromDate` branch** — add a test with a
      `COUNT=3` daily rule and `fromDate '2026-01-02T12:00:00.000Z'`, asserting
      `toEqual(['2026-01-03T00:00:00.000Z'])`. Kills ids 42, 44.
- [ ] **G. `computeMissedDates` ISO mapping** — add a test asserting the first
      missed date is `toBe('2026-01-03T00:00:00.000Z')`. Kills id 45.
- [ ] **H. `buildCompiled` null guard** — add a test calling
      `buildCompiled(null, dtstart, tz)` and `buildCompiled(rrule, null, tz)`,
      each asserting `toBe(null)`. Kills ids 49, 50, 52.

## Residual declaration

- [ ] Declare equivalent mutant **id 4** (`parseLabels` `raw === null` → `false`)
      with per-loc reasoning in `result.json`.
- [ ] Declare equivalent mutant **id 43** (`computeMissedDates`
      `fromDate === null` → `false`) with per-loc reasoning in `result.json`.

## Verification gates

- [ ] `bun test tests/recurring-utils.test.ts` is green.
- [ ] `bun test:mutate:file src/recurring-utils.ts` re-measured; survivors are
      exactly `{4, 43}` and the declared residual `mutantIds` UNION is exactly
      that set.
- [ ] `result.json` written to the absolute `.review-loop/` path with all
      required fields.
