<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `src/utils/scheduler.helpers.ts` Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. This is a
> test-only effort; there is **no** production-code change.

**Goal:** Raise the `src/utils/scheduler.helpers.ts` mutation score from
**0.3333333333333333** to **≥ 0.9** (projected **1.0**) by creating a new companion
`tests/utils/scheduler.helpers.test.ts` with exact-equality assertions. Spec:
`docs/superpowers/specs/2026-08-07-mutation-coverage-scheduler.helpers-design.md`.

**Architecture:** `src/utils/scheduler.helpers.ts` is the pure helper module for the scheduler.
`calculateBackoff` computes `Math.floor(Math.min(2**attempt*1000, maxDelay) + jitter)` where
`jitter = baseDelay * 0.1 * Math.random()`; `getErrorMessage`/`getErrorObject` are defensive
extractors over `unknown`; `DEFAULT_OPTIONS`/`DEFAULT_TASK_OPTIONS` are plain object constants.
Every surviving mutant is observable as a changed exact return value once `Math.random()` is
pinned, so each new test asserts `toBe(...)` on a full value.

## Global Constraints

- **Test-only.** Create only `tests/utils/scheduler.helpers.test.ts` (plus the two docs files
  already written). Do **not** touch `src/`, `client/`, `plugins/`, `scripts/`, or
  `scripts/mutation/baseline.json`.
- Runtime Bun; tests use `bun:test` (`import { afterEach, beforeEach, describe, expect, test } from 'bun:test'`).
- **Every new assertion is an exact `toBe(...)`** — never `toContain` / `startsWith` /
  `endsWith` where a full value is knowable. Object-identity uses reference `toBe`, and
  `instanceof` checks use `toBeInstanceOf(Error)`. Constant objects are checked per-field with
  `toBe` (not `toEqual`) so an `ObjectLiteral→{}` mutant makes every field `undefined`.
- The `calculateBackoff` test stubs `Math.random` to `() => 0.5` inside a `beforeEach` and
  restores the original in an `afterEach` (direct assignment, not a bun `mock()` spy, so the
  global `mock.restore()` does not interfere). With this stub,
  `calculateBackoff(0, 60000) === Math.floor(1000 * 1.05) === 1050`.
- One `test()` per mutant class (one-to-one with the spec's gap table). Where a single
  behaviour cleanly kills several mutants of one class, they share one `test()`.
- No comments added to the test file (repo convention).
- The companion resolver maps `src/utils/scheduler.helpers.ts` →
  `tests/utils/scheduler.helpers.test.ts`; creating exactly that path makes the paired runner
  pick it up automatically (additive with the coverage-discovered `scheduler.test.ts`).

## Measure (already complete)

- [x] `bun test:mutate:file src/utils/scheduler.helpers.ts` → `killed=11 survived=12
      noCoverage=10 score=0.3333333333333333`; report at
      `reports/paired/src__utils__scheduler.helpers.ts.stryker-report.json`.
- [x] Enumerated all 22 surviving/no-coverage mutants with ids, mutators, and `line:col`.

## Tasks (one per mutant class → one test each)

- [ ] **Task 1 — `calculateBackoff` deterministic backoff.** Add a `describe` that stubs
      `Math.random = () => 0.5` in `beforeEach` (restore in `afterEach`) and one `test()`
      asserting `calculateBackoff(0, 60000)` is `toBe(1050)`, `calculateBackoff(0, 500)` is
      `toBe(525)`, and `calculateBackoff(5, 60000)` is `toBe(33600)`. Mutant 6 (`Math.min`→
      `Math.max`) yields 63000; 9 (`*0.1`→`/0.1`) yields 6000; 8 (trailing `*`→`/`) yields 1200;
      10 (`+jitter`→`-jitter`) yields 950 — all differ from 1050. Kills mutants 6, 8, 9, 10.
- [ ] **Task 2 — `getErrorMessage(Error)`.** Add `test()` asserting
      `getErrorMessage(new Error('boom'))` is `toBe('boom')`. Mutants 15 (body→`{}`) returns
      `undefined`, 17 (`if→false`) and 18 (return-block→`{}`) return `'Unknown error'`. Kills
      mutants 15, 17, 18.
- [ ] **Task 3 — `getErrorMessage(string)`.** Add `test()` asserting
      `getErrorMessage('some message')` is `toBe('some message')`. Mutant 16 (`if→true`)
      returns `undefined`; 20 (ternary→`false`), 21 (`===`→`!==`), 22 (`'string'`→`""`) all
      return `'Unknown error'`. Kills mutants 16, 20, 21, 22.
- [ ] **Task 4 — `getErrorMessage` fallback.** Add `test()` asserting `getErrorMessage(42)` is
      `toBe('Unknown error')`. Mutant 19 (ternary→`true`) returns `42`; 23 (`'Unknown error'`→
      `""`) returns `""`. Kills mutants 19, 23.
- [ ] **Task 5 — `getErrorObject(string)`.** Add `test()` asserting the result is
      `toBeInstanceOf(Error)` and `.message` is `toBe('hello')`. Mutant 25 (`if→true`) returns
      the raw string (fails `toBeInstanceOf`); 29 (ternary→`false`), 30 (`===`→`!==`), 31
      (`'string'`→`""`) wrap `'Unknown error'` (fails `.message` `toBe`). Kills mutants 25, 29,
      30, 31.
- [ ] **Task 6 — `getErrorObject` fallback.** Add `test()` asserting
      `getErrorObject(42).message` is `toBe('Unknown error')`. Mutant 28 (ternary→`true`) wraps
      the raw value (message `'42'`); 32 (`'Unknown error'`→`""`) yields message `""`. Kills
      mutants 28, 32.
- [ ] **Task 7 — `DEFAULT_OPTIONS` exact.** Add `test()` asserting
      `DEFAULT_OPTIONS.unrefByDefault` is `toBe(true)`, `.defaultRetries` is `toBe(3)`,
      `.maxRetryDelay` is `toBe(60000)`. Mutant 1 (`unrefByDefault`→`false`) flips the first
      field. Kills mutant 1.
- [ ] **Task 8 — `DEFAULT_TASK_OPTIONS` exact.** Add `test()` asserting
      `DEFAULT_TASK_OPTIONS.immediate` is `toBe(false)`, `.retries` is `toBe(3)`, `.unref` is
      `toBe(true)`. Mutant 2 (whole object→`{}`) makes every field `undefined`; 4 (`unref`→
      `false`) flips one field. Kills mutants 2, 4.
- [ ] **Task 9 (documentation only — no survivor) — `getErrorObject(Error)` identity.** Add
      `test()` asserting `getErrorObject(err)` returns the identical reference (`toBe(err)`).
      This documents the `instanceof` early-return branch; it does not kill any survivor
      (mutants 26/27 on line 129 are already killed indirectly).
- [ ] **Task 10 (documentation only — no survivor) — mergers.** Add one `test()` asserting
      `mergeOptions(undefined)` and `mergeOptions({...})` per-field `toBe`, and
      `mergeTaskOptions(...)` per-field `toBe`, including scheduler-default inheritance. These
      duplicate coverage already provided by `scheduler.test.ts`; they make the new companion
      self-contained. They kill no survivor (mutants 0/11/12/13/14 already killed).

## Residuals (accepted — no test can kill)

None. Every one of the 22 surviving/no-coverage mutants is killed by the tests above; no
equivalent mutants exist in this file. (Confirmed empirically by re-measuring in the
Verification step; the result JSON's `residuals` array is empty.)

## Verification

- [ ] `bun test tests/utils/scheduler.helpers.test.ts` → all green.
- [ ] `bun test:mutate:file src/utils/scheduler.helpers.ts` → `killed=33 score=1.0`; zero
      non-killed mutants in `reports/paired/src__utils__scheduler.helpers.ts.stryker-report.json`.
- [ ] `git status` shows changes only under `tests/` and `docs/superpowers/` (diff-gate), plus
      the single `.review-loop/result.json`.
