<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `src/errors.ts` Design

**Date:** 2026-08-06
**Status:** Approved for planning
**Target file:** `src/errors.ts` (the constructors, `extractAppError`, `isAppError`,
and the four `get*Message` helpers — `getAgentGuidance`/`getAppErrorDetails`/
`isRetryableAppError` are re-exports from `src/error-analysis.js` and have their own
baseline entry)
**Before score:** 0.8726114649681529 (killed=137 survived=10 noCoverage=10, total=157)
**Target score:** ≥ 0.9

## Summary

`src/errors.ts` is the project's central `AppError` discriminated-union module: it exports
constructors (`systemError`, `webFetchError`, plus re-exports of `providerError`), the
`extractAppError` defensive extractor, the `isAppError` type guard, and `getUserMessage`
which dispatches to per-type message helpers. The companion `tests/errors.test.ts` exercises
most constructor and helper branches but leaves two surface areas loose: (a) `extractAppError`
has **no tests at all**, so six mutants in its body survive; (b) several assertions use
`toContain` instead of exact strings, allowing template-text mutants to pass; (c) every
`switch` `default:` branch is uncovered. This spec adds one focused `test()` per mutant
class (10 tests) — each using exact `toBe(...)` equality — to raise the score to **~0.98**
and enumerates the small set of genuinely-equivalent residuals.

## Why this file

`src/errors.ts` is imported by virtually every runtime path (provider classification,
orchestrator error mapping, command handlers, web-fetch tooling). A surviving mutant here
silently degrades the user-facing error message or — worse — the `extractAppError` extractor,
which is the only seam many call sites use to recover an `AppError` from an arbitrary thrown
value. The file is also pure and synchronous (no I/O, no clocks), so every behaviour is
observable as an exact return value, making it an ideal mutation target.

## Non-goals

- **No production-code changes.** `src/`, `client/`, `plugins/`, `scripts/` are untouched; the
  diff gate restricts edits to `tests/` and `docs/superpowers/`.
- **No edits to `scripts/mutation/baseline.json`** (the runner owns the ratchet).
- No new test files; the existing companion `tests/errors.test.ts` is extended in place.
- No coverage of `src/providers/errors.ts` (separate baseline entry) — only the
  `ProviderClassifiedError` class is used as a *fixture* via its public constructor.
- Existing tests are left as-is; only new `test()` blocks are appended so the diff stays
  additive and reviewable.

## Gap analysis

Measured via `bun test:mutate:file src/errors.ts`; report at
`reports/paired/src__errors.ts.stryker-report.json`. 10 `Survived` + 10 `NoCoverage` = 20
non-killed mutants. They group into the classes below. Mutant ids are Stryker ids from the
report; locations are `line:col` in `src/errors.ts`.

| # | Class (behaviour) | Mutant ids | Loc | Root cause / why it survives |
|---|---|---|---|---|
| 1 | `extractAppError(null)` early-return guard (`error === null` half of the `typeof !== 'object' \|\| error === null` condition) | 71 | 79 | No test calls `extractAppError(null)`. The mutant flips `error === null`→`false`; the outer `typeof null !== 'object'` is also `false` (typeof null is `'object'`), so the guard is bypassed and the next line `'appError' in null` throws. Test that expects `null` return kills it (mutant throws → test fails). |
| 2 | `extractAppError({appError: non-AppError})` short-circuit (`&&`→`\|\|` on the `'appError' in error` line) | 75 | 80 | No test passes an object with an `appError` key whose value is *not* an `AppError`. Original returns `null` (right side of `&&` is false); mutant `||` returns the non-AppError value. `toBe(null)` kills it. |
| 3 | `extractAppError({error: AppError})` happy path — both the `'error' in error` condition and the `'error'` string literal | 78, 80 | 81 | No test passes an object with a valid `error: AppError` field. Original returns the inner `AppError`; mutants make the condition always false (one via the conditional-expression mutator, one via `'error'`→`""` so `'' in obj` is false). `toBe(innerError)` kills both. |
| 4 | `extractAppError({error: non-AppError})` short-circuit (`&&`→`\|\|` on the `'error' in error` line) | 79 | 81 | Symmetric to class #2: mutant `||` would return the non-AppError value when `'error' in error` is true but `isAppError(error.error)` is false. `toBe(null)` kills it. |
| 5 | `webFetchError.upstreamError()` (no status argument) — the `status === undefined` ternary discriminator | 44 | 64 | Only `upstreamError(502)` is tested. With no argument the original omits the `status` key entirely; the mutant (`status === undefined`→`false`) sets `status: undefined`, adding the key. `toEqual` ignores `undefined` keys so an `Object.hasOwn(...)` / key-list `toBe` is needed. |
| 6 | `getValidationMessage('invalid-input')` exact string — the `case 'invalid-input':` body falls through to `case 'missing-required':` mutant | 97 | 102-103 | The existing test asserts only `toContain('email')` (the field name). The mutant removes the `case 'invalid-input':` return statement, so it falls through and returns `Missing required field: email` — which still contains `'email'`. Exact `toBe('Invalid email: bad format')` kills it. |
| 7 | `getLlmMessage` default branch (no-coverage) — `default:` label and its return string | 94, 95 | 95-96 | `LlmError.code` is a closed enum (api-error / rate-limited / timeout / token-limit); no test casts a fake code to reach `default`. A cast input kills both mutants (label removal returns `undefined`; string→empty returns `''`). |
| 8 | `getValidationMessage` default branch (no-coverage) | 103, 104 | 106-107 | Same shape as #7; `ValidationError.code` is closed. |
| 9 | `getSystemMessage` default branch (no-coverage) | 115, 116 | 119-120 | Same shape as #7; `SystemError.code` is closed. |
| 10 | `getWebFetchMessage` default branch (no-coverage) | 142, 143 | 142-143 | Same shape as #7; `WebFetchError.code` is closed. |
| 11 | `getUserMessage` top-level default branch (no-coverage) | 155, 156 | 161-162 | `AppError.type` is a closed discriminator; no test casts a fake type to reach the outer `default:`. |
| — | *(residual classes — see "Accepted residuals")* | 64, 112, 113 | 78, 117 | Genuinely equivalent; no test can kill them. |

## Design — tests to add

Each class maps **one-to-one** to a single new `test()` in `tests/errors.test.ts`. Every
assertion is an exact `toBe(...)` on either a full return value or an `Object.hasOwn`
boolean — never `toContain` / `startsWith` / `endsWith`. Each expected value was verified
empirically against the unmutated function before writing.

| Test (class #) | Fixture | Exact expected value | Kills |
|---|---|---|---|
| T1 (#1) `extractAppError(null)` | `extractAppError(null)` | `null` (mutant throws → test fails) | 71 |
| T2 (#2) `extractAppError({appError: non-AppError})` | `extractAppError({ appError: 'not-an-error' })` | `null` | 75 |
| T3 (#3) `extractAppError({error: AppError})` | `extractAppError({ error: providerError.authFailed() })` | the inner `providerError.authFailed()` (reference equality via `toBe`) | 78, 80 |
| T4 (#4) `extractAppError({error: non-AppError})` | `extractAppError({ error: 'not-an-error' })` | `null` | 79 |
| T5 (#5) `webFetchError.upstreamError()` no-status shape | `Object.hasOwn(webFetchError.upstreamError(), 'status')` | `false` (mutant sets `status: undefined`, `Object.hasOwn` becomes `true`) | 44 |
| T6 (#6) `getValidationMessage('invalid-input')` exact | `getUserMessage(validationError.invalidInput('email', 'bad format'))` | `'Invalid email: bad format'` | 97 |
| T7 (#7) `getLlmMessage` default | `getUserMessage({ type: 'llm', code: '__unknown' } as unknown as AppError)` | `'An AI service error occurred. Please try again later.'` | 94, 95 |
| T8 (#8) `getValidationMessage` default | `getUserMessage({ type: 'validation', code: '__unknown' } as unknown as AppError)` | `'Invalid input provided.'` | 103, 104 |
| T9 (#9) `getSystemMessage` default | `getUserMessage({ type: 'system', code: '__unknown' } as unknown as AppError)` | `'An unexpected error occurred. Please try again later.'` | 115, 116 |
| T10 (#10) `getWebFetchMessage` default | `getUserMessage({ type: 'web-fetch', code: '__unknown' } as unknown as AppError)` | `"I couldn't fetch that page."` | 142, 143 |
| T11 (#11) `getUserMessage` top-level default | `getUserMessage({ type: '__unknown' } as unknown as AppError)` | `'An unexpected error occurred. Please try again later.'` | 155, 156 |

A defensive documentation test (`extractAppError(new ProviderClassifiedError(...))` returns
its inner error) is **also** added for behaviour coverage, but it does not kill any mutant
because — as analysed in "Accepted residuals" — the `'error' in error` fallback path
produces the same return value as the `instanceof` branch for type-correct inputs.

**Projected after-score:** killed = 137 + 17 = **154**, non-killed = 3 residuals (64, 112,
113), total = 157 → **score = 154/157 = 0.9809** (≥ 0.9 target).

## Verification

1. `bun test tests/errors.test.ts` is green (all 32 existing + 11 new `test()`s + 1
   documentation test).
2. `bun test:mutate:file src/errors.ts` reports `killed=154 survived=3 score≈0.9809`, and
   `reports/paired/src__errors.ts.stryker-report.json` shows only the 3 residual ids (64,
   112, 113) as non-killed.
3. No file under `src/`, `client/`, `plugins/`, `scripts/`, or `scripts/mutation/baseline.json`
   is modified (diff-gate).

## Accepted residuals

Three mutants survive and genuinely cannot be killed (each is observationally equivalent for
every type-correct input). See the plan's "Residuals" task for full per-loc reasoning.
Summary:

| id | Loc | Why equivalent |
|---|---|---|
| 64 | 78 | `if (error instanceof ProviderClassifiedError) return error.error`. Mutant (`instanceof`→`false`) falls through to the next guard `'error' in error && isAppError(error.error)`, which is also true for every well-typed `ProviderClassifiedError` (the class always carries an own `error: ProviderError` field that `isAppError` accepts) and returns the identical `error.error` reference. Only distinguishable by handing the constructor a value that violates its own type signature. |
| 112 | 117-118 | `case 'unexpected':` body in `getSystemMessage` is byte-identical to the `default:` body — both return `'An unexpected error occurred. Please try again later.'`. The mutant removes the case's `return`, falling through to `default:`, which yields the same string. |
| 113 | 117 | `case 'unexpected':` → `case '':` rewrites the discriminator label. `error.code` is `'unexpected'` for the only call that reaches this case; it no longer matches `''`, falls through to `default:`, returns the identical string as the original `unexpected` body. |
