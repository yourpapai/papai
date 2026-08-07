<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan — Mutation Coverage for `plugins/task-provider-kaneo/task-status.ts`

**Date:** 2026-08-07
**Spec:** `docs/superpowers/specs/2026-08-07-mutation-coverage-task-status-design.md`
**Scope:** test-only changes to
`tests/plugins/task-provider-kaneo/task-status.test.ts`.

## Global constraints

- Edit **only** `tests/plugins/task-provider-kaneo/task-status.test.ts` (plus
  these docs). No edits under `src/`, `client/`, `plugins/`, `scripts/`, or
  `scripts/mutation/baseline.json`.
- Use `bun:test`. Prefer DI (the `TaskStatusDeps` seam) for all behavior
  coverage. Do **not** add `mock.module()` — the module-init `logger.child(...)`
  cannot be intercepted from the companion file (see Class G), so logger
  mutants are accepted residuals rather than killed.
- Every new string assertion uses `toBe` (exact equality). No
  `startsWith`/`endsWith`/`toContain` where a full string is knowable.
- SPDX header preserved on the test file; no new lint-disable / type-ignore
  comments.

## Tasks (one checkbox per mutant class)

- [ ] **A. `denormalizeStatus` (ids 48, 49, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63)**
  - [ ] Add `describe('denormalizeStatus')` using `defaultDeps` + targeted column sets.
  - [ ] exact slug → canonical slug (covers 60; baseline for others).
  - [ ] compound slug `in-progress-2` → `in-progress` on a non-first column (kills 51, 52, 54, 55, 56, 57, 58, 60, 61, 63).
  - [ ] multi-space column `To  Do` + compound input `to-do-9` → `to-do` (kills 53).
  - [ ] ordered `[{To Do},{To}]`, input `to-do` → `to-do` (kills 59).
  - [ ] `[{In},{Inertia}]`, input `inertia` → `inertia` (kills 62).
  - [ ] no-match `zzz` → `zzz`.
- [ ] **B. Input whitespace collapse (id 9)**
  - [ ] input `'To  Do'` (two spaces), default columns → `toBe('to-do')`.
- [ ] **C. First-loop slugification (ids 12, 13, 14, 15, 16, 18, 20)**
  - [ ] column `'In  Review?'`, input `'in-review?'` → `toBe('in-review?')`
        (first loop is the only path because `slugPattern` rejects `?`).
- [ ] **D. `slugPattern` gate (ids 21, 22, 23, 24, 25, 26, 27)**
  - [ ] prefix status `'to'`, default columns → `toBe('to')` (kills 23, 24, 25).
  - [ ] `'to-do'` vs column `To Do Extra` → `toBe('to-do')` (kills 26, 27).
  - [ ] `'##to'` vs column `##To Do` → expects throw (kills 21).
  - [ ] `'to##'` vs column `To## Do` → expects throw (kills 22).
- [ ] **E. Partial-match branch (ids 28, 29, 30, 31, 32, 34, 35, 37, 38, 41, 42, 43)**
  - [ ] the `'to'` prefix test above also kills 29, 30, 31, 32, 34, 35, 37, 38, 41, 43.
  - [ ] `'to'` vs column `Today` → expects throw (kills 42).
  - [ ] `'to!'` vs column `To! Do` → expects throw (kills 28).
- [ ] **F. Exact error message (id 46)**
  - [ ] input `'Review'`, default columns → assert `thrownError.message` `toBe`
        the full `Invalid status "Review". Must match one of: To Do, In Progress, Done`.
- [ ] **G. Logger instrumentation (ids 0, 1, 5, 6, 48, 49) — accepted residual.**
  These mutate the module-init `logger.child(...)` scope and the two `log.debug`
  payloads/messages. `task-status.js` is transitively runtime-imported by
  `task-update-helpers.ts` and `task-resource.ts` (each driven by a sibling test
  file in the same paired run), so it is evaluated against the real logger
  before any companion-file `mock.module()` can intercept; a delayed-import
  harness inside the companion file cannot win the race (module already cached).
  Declared as residuals.
- [ ] **Residuals declared (ids 0, 1, 5, 6, 33, 39, 48, 49)** — 6
  harness-unkillable logger side-effects + 2 genuine equivalents; documented in
  spec.

## Verification gate

- [x] `bun test tests/plugins/task-provider-kaneo/task-status.test.ts` green
      (23 pass).
- [x] `bun test:mutate:file plugins/task-provider-kaneo/task-status.ts` →
      `score 0.875` (56 killed / 8 survived); survivors ==
      {0, 1, 5, 6, 33, 39, 48, 49}.
- [x] `result.json` residual `mutantIds` union == measured survivor set
      (capped-path success: score improved 0.234 → 0.875, residuals exact).
