<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `src/utils/scheduler.helpers.ts` Design

**Date:** 2026-08-07
**Status:** Approved for planning
**Target file:** `src/utils/scheduler.helpers.ts` (defaults, the `calculateBackoff`
exponential-backoff-with-jitter function, the `mergeOptions`/`mergeTaskOptions` mergers, and
the `getErrorMessage`/`getErrorObject` safe-extractors)
**Before score:** 0.3333333333333333 (killed=11 survived=12 noCoverage=10, total=33)
**Target score:** ≥ 0.9

## Summary

`src/utils/scheduler.helpers.ts` is the pure helper module for the scheduler: it owns the
`DEFAULT_OPTIONS` / `DEFAULT_TASK_OPTIONS` constants, the deterministic parts of retry backoff
(`calculateBackoff`), the option mergers, and the two safe-error extractors
(`getErrorMessage` / `getErrorObject`). It has **no companion test file**: the only coverage
comes indirectly from `tests/utils/scheduler.test.ts` (which exercises the running scheduler
but never asserts on these helpers' exact return values). The result is that 22 of 33 mutants
survive: every arithmetic operator in `calculateBackoff` is loose (jitter makes the result
non-deterministic), both safe-error extractors are never called directly with non-`Error`
inputs, and the default constants are never read for exact equality.

This spec adds a **new** companion `tests/utils/scheduler.helpers.test.ts` with one focused
`test()` per mutant class (8 tests) — each using exact `toBe(...)` equality — to raise the
score to **1.0**. The non-deterministic `Math.random()` jitter is pinned via a scoped stub so
the backoff result becomes an exact, assertable integer. There are no accepted residuals: every
surviving mutant is observable as a changed return value.

## Why this file

The scheduler helpers are imported by `src/utils/scheduler.js` (the retry loop uses
`calculateBackoff` and `getErrorMessage`/`getErrorObject`; task registration uses the mergers
and defaults). A surviving mutant here silently changes retry timing or error surfacing for
every scheduled task in the system. The file is pure and synchronous (the only external
dependency is `Math.random()`, which is trivially stubbable), so every behaviour is observable
as an exact return value — an ideal mutation target that nonetheless had zero direct test
coverage.

## Non-goals

- **No production-code changes.** `src/`, `client/`, `plugins/`, `scripts/` are untouched; the
  diff gate restricts edits to `tests/` and `docs/superpowers/`.
- **No edits to `scripts/mutation/baseline.json`** (the runner owns the ratchet).
- No edits to existing test files; a **new** companion `tests/utils/scheduler.helpers.test.ts`
  is created (the current companion resolver maps `src/utils/scheduler.helpers.ts` to exactly
  this path, which did not yet exist).
- `calculateBackoff`'s real-valued randomness is **not** under test; only the deterministic
  arithmetic is asserted, with `Math.random()` stubbed to a fixed value inside one `describe`.
- No comments added to the test file (repo convention).

## Gap analysis

Measured via `bun test:mutate:file src/utils/scheduler.helpers.ts`; report at
`reports/paired/src__utils__scheduler.helpers.ts.stryker-report.json`. 12 `Survived` + 10
`NoCoverage` = 22 non-killed mutants (score 11/33 = 0.3333). They group into the classes below.
Mutant ids are Stryker ids from the report; locations are `line:col` in
`src/utils/scheduler.helpers.ts`.

| # | Class (behaviour) | Mutant ids | Loc | Root cause / why it survives |
|---|---|---|---|---|
| 1 | `calculateBackoff` backoff arithmetic — `Math.min`→`Math.max`, `baseDelay * 0.1`→`/0.1`, trailing `* Math.random()`→`/`, `baseDelay + jitter`→`-` | 6, 8, 9, 10 | 89, 90, 91 | No test calls `calculateBackoff` at all, and even if it did the real `Math.random()` jitter makes the return a float range, so no exact assertion could pin it. Stubbing `Math.random()` to `0.5` makes `calculateBackoff(0, 60000)` return exactly `1050`; each arithmetic mutant yields a different integer (63000 / 6000 / 1200 / 950), so a single `toBe(1050)` kills all four. |
| 2 | `getErrorMessage` for an `Error` — function body removal and the `instanceof` guard | 15, 17, 18 | 118-123, 119 | No test calls `getErrorMessage(new Error(...))`. Body→`{}` (15) returns `undefined`; `if→false` (17) and the return-block→`{}` (18) both fall through to the ternary and return `'Unknown error'`. `toBe('boom')` kills all three. |
| 3 | `getErrorMessage` for a `string` — the `instanceof`→`true` flip and the `typeof === 'string'` ternary (conditional both ways, equality flip, `'string'` literal) | 16, 20, 21, 22 | 119, 122 | No test passes a string. `if→true` (16) returns `(<string>).message` = `undefined`; the three ternary mutants (20/21/22) all route a string to `'Unknown error'`. `toBe('some message')` kills all four. |
| 4 | `getErrorMessage` fallback (non-string, non-`Error`) — the ternary `→true` and the `'Unknown error'` literal | 19, 23 | 122 | No test passes a non-string/non-`Error`. Ternary `→true` (19) returns the raw value (`42`); `'Unknown error'`→`""` (23) returns `""`. `toBe('Unknown error')` kills both. |
| 5 | `getErrorObject` for a `string` — the `instanceof`→`true` flip and the ternary (both ways, equality flip, `'string'` literal) | 25, 29, 30, 31 | 129, 132 | No test calls `getErrorObject('...')`. `if→true` (25) returns the raw string (not an `Error`); the ternary mutants (29/30/31) wrap `'Unknown error'`. Asserting `instanceof Error` + `toBe('hello')` on `.message` kills all four. |
| 6 | `getErrorObject` fallback (non-string, non-`Error`) — the ternary `→true` and the `'Unknown error'` literal | 28, 32 | 132 | No test passes a non-string/non-`Error`. Ternary `→true` (28) wraps the raw value (`new Error(42)` → message `'42'`); `'Unknown error'`→`""` (32) yields message `""`. `toBe('Unknown error')` on `.message` kills both. |
| 7 | `DEFAULT_OPTIONS` constant — `unrefByDefault: true`→`false` | 1 | 49 | No test reads `DEFAULT_OPTIONS` for exact equality. `expect(DEFAULT_OPTIONS.unrefByDefault).toBe(true)` kills it. |
| 8 | `DEFAULT_TASK_OPTIONS` constant — whole object→`{}` and `unref: true`→`false` | 2, 4 | 57-61, 60 | No test reads `DEFAULT_TASK_OPTIONS` for exact equality. Object→`{}` (2) makes every field `undefined`; `unref→false` (4) flips one field. Per-field `toBe(...)` assertions kill both. |

## Design — tests to add

Each class maps **one-to-one** to a single new `test()` in the new
`tests/utils/scheduler.helpers.test.ts`. Every assertion is an exact `toBe(...)` (or
`toBeInstanceOf` / reference `toBe` for object identity) — never `toContain` / `startsWith` /
`endsWith`. Each expected value was computed from the unmutated function and (for backoff)
re-derived under a stubbed `Math.random`.

| Test (class #) | Fixture | Exact expected value | Kills |
|---|---|---|---|
| T1 (#1) `calculateBackoff` deterministic backoff (`Math.random` stubbed to `0.5`) | `calculateBackoff(0, 60000)`; plus capping `calculateBackoff(0, 500)` and `calculateBackoff(5, 60000)` | `1050`, `525`, `33600` | 6, 8, 9, 10 |
| T2 (#2) `getErrorMessage(Error)` | `getErrorMessage(new Error('boom'))` | `'boom'` | 15, 17, 18 |
| T3 (#3) `getErrorMessage(string)` | `getErrorMessage('some message')` | `'some message'` | 16, 20, 21, 22 |
| T4 (#4) `getErrorMessage` fallback | `getErrorMessage(42)` | `'Unknown error'` | 19, 23 |
| T5 (#5) `getErrorObject(string)` | `getErrorObject('hello')` → `instanceof Error` and `.message` | `instanceof Error` is `true`, `.message` is `'hello'` | 25, 29, 30, 31 |
| T6 (#6) `getErrorObject` fallback | `getErrorObject(42)` → `.message` | `'Unknown error'` | 28, 32 |
| T7 (#7) `DEFAULT_OPTIONS` exact | `DEFAULT_OPTIONS.unrefByDefault` / `.defaultRetries` / `.maxRetryDelay` | `true`, `3`, `60000` | 1 |
| T8 (#8) `DEFAULT_TASK_OPTIONS` exact | `DEFAULT_TASK_OPTIONS.immediate` / `.retries` / `.unref` | `false`, `3`, `true` | 2, 4 |

Two light documentation tests are also added that do **not** kill any survivor but keep the
companion self-contained and exercise the `Error`-instance branches and the mergers:
`getErrorObject(<same Error>)` returns the identical reference (`toBe`), and
`mergeOptions` / `mergeTaskOptions` override defaults per-field (`toBe`). The latter are already
killed indirectly by `tests/utils/scheduler.test.ts`; they are duplicated here only as a
standalone-companion safety net.

**Projected after-score:** killed = 11 + 22 = **33**, non-killed = 0, total = 33 →
**score = 33/33 = 1.0** (≥ 0.9 target).

## Verification

1. `bun test tests/utils/scheduler.helpers.test.ts` is green (all new `test()`s).
2. `bun test:mutate:file src/utils/scheduler.helpers.ts` reports `killed=33 survived=0
   noCoverage=0 score=1.0`, and `reports/paired/src__utils__scheduler.helpers.ts.stryker-report.json`
   shows zero non-killed mutants.
3. No file under `src/`, `client/`, `plugins/`, `scripts/`, or `scripts/mutation/baseline.json`
   is modified (diff-gate); the only new/changed files are under `tests/` and
   `docs/superpowers/`, plus the single `.review-loop/result.json`.

## Accepted residuals

None. Every surviving mutant in this file is observable as a changed exact return value (or, for
the constants, a changed exact field). The only source of non-determinism — `Math.random()` in
`calculateBackoff` — is pinned with a scoped stub, so all four backoff-arithmetic mutants become
distinguishable integers. No equivalent mutants remain.
