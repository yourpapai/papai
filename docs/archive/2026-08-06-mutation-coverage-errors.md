<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `src/errors.ts` Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. This is a
> test-only effort; there is **no** production-code change.

**Goal:** Raise the `src/errors.ts` mutation score from **0.8726114649681529** to **≥ 0.9**
by adding exact-equality assertions to `tests/errors.test.ts`. Spec:
`docs/superpowers/specs/2026-08-06-mutation-coverage-errors-design.md`.

**Architecture:** `src/errors.ts` is the central `AppError` discriminated-union module.
`extractAppError` is a defensive extractor over arbitrary thrown values, and `getUserMessage`
dispatches to four per-type `switch`-based message helpers. Every surviving mutant is
observable either as a changed return value (extractor / constructor) or as a changed message
string, so each new test asserts `toBe(...)` on a full value.

## Global Constraints

- **Test-only.** Edit only `tests/errors.test.ts` (and the two docs files already written).
  Do **not** touch `src/`, `client/`, `plugins/`, `scripts/`, or
  `scripts/mutation/baseline.json`.
- Runtime Bun; tests use `bun:test` (`import { describe, expect, test } from 'bun:test'`).
- **Every new assertion is an exact `toBe(...)`** — never `toContain` / `startsWith` /
  `endsWith` where a full value is knowable. Object-shape assertions use `Object.hasOwn(...)`
  so the mutant's added `status: undefined` key is detectable (Bun's `toEqual` ignores
  `undefined` keys).
- New tests are **appended**; existing tests are left unchanged (additive diff).
- One `test()` per mutant class (one-to-one with the spec's gap table). Where a single
  behaviour cleanly kills several mutants of one class, they share one `test()`.
- No comments added to the test file (repo convention).
- `ProviderClassifiedError` is imported from `../src/providers/errors.js` (it is the public
  class that `extractAppError` checks via `instanceof`). `AppError` type is imported as a
  type-only symbol for casts.
- The defensive-bypass casts use `as unknown as AppError` (TS strict) to reach `default:`
  branches without weakening the source discriminated unions.

## Measure (already complete)

- [x] `bun test:mutate:file src/errors.ts` → `killed=137 survived=10 noCoverage=10
      score=0.8726114649681529`; report at
      `reports/paired/src__errors.ts.stryker-report.json`.
- [x] Enumerated all 20 surviving/no-coverage mutants with ids, mutators, and `line:col`.

## Tasks (one per mutant class → one test each)

- [ ] **Task 1 — `extractAppError(null)` early-return guard.** Add `test()` calling
      `extractAppError(null)` and asserting `toBe(null)`. Mutant 71 (`error === null`→`false`)
      bypasses the guard and throws on the next `'appError' in null` access, failing the
      `toBe`. Kills mutant 71.
- [ ] **Task 2 — `extractAppError({appError: non-AppError})` short-circuit.** Add `test()`
      calling `extractAppError({ appError: 'not-an-error' })` and asserting `toBe(null)`.
      Mutant 75 (`&&`→`||`) returns the non-AppError value. Kills mutant 75.
- [ ] **Task 3 — `extractAppError({error: AppError})` happy path.** Add `test()` calling
      `extractAppError({ error: providerError.authFailed() })` and asserting `toBe(...)` with
      reference equality against the same constructed error. Mutants 78 (conditional→`false`)
      and 80 (`'error'`→`""`) both make the guard false, returning `null` instead of the
      inner error. Kills mutants 78, 80.
- [ ] **Task 4 — `extractAppError({error: non-AppError})` short-circuit.** Add `test()`
      calling `extractAppError({ error: 'not-an-error' })` and asserting `toBe(null)`. Mutant
      79 (`&&`→`||`) returns the non-AppError value. Kills mutant 79.
- [ ] **Task 5 — `extractAppError(new ProviderClassifiedError(...))` documentation test.**
      Add `test()` asserting the wrapper's inner error is returned. This does **not** kill
      mutant 64 (the `'error' in error` fallback returns the identical value for type-correct
      inputs); it is added to document the `instanceof` branch's behaviour so future refactors
      that break the fallback equivalence are caught.
- [ ] **Task 6 — `webFetchError.upstreamError()` shape (no status).** Add `test()` asserting
      `Object.hasOwn(webFetchError.upstreamError(), 'status')` is `toBe(false)`. Mutant 44
      (`status === undefined`→`false`) sets `status: undefined`, flipping `Object.hasOwn` to
      `true`. Kills mutant 44.
- [ ] **Task 7 — `getValidationMessage('invalid-input')` exact string.** Add `test()`
      asserting `getUserMessage(validationError.invalidInput('email', 'bad format'))` is
      `toBe('Invalid email: bad format')`. Mutant 97 removes the case body, falling through to
      `missing-required` (`'Missing required field: email'`). Kills mutant 97.
- [ ] **Task 8 — `getLlmMessage` default branch.** Add `test()` calling
      `getUserMessage({ type: 'llm', code: '__unknown' } as unknown as AppError)` and asserting
      `toBe('An AI service error occurred. Please try again later.')`. Mutants 94 (default
      label removed → returns `undefined`) and 95 (return string → `''`) both fail the
      assertion. Kills mutants 94, 95.
- [ ] **Task 9 — `getValidationMessage` default branch.** Add `test()` calling
      `getUserMessage({ type: 'validation', code: '__unknown' } as unknown as AppError)` and
      asserting `toBe('Invalid input provided.')`. Kills mutants 103, 104.
- [ ] **Task 10 — `getSystemMessage` default branch.** Add `test()` calling
      `getUserMessage({ type: 'system', code: '__unknown' } as unknown as AppError)` and
      asserting `toBe('An unexpected error occurred. Please try again later.')`. Note: this
      targets the `default:` body (mutants 115, 116), **not** the equivalent `'unexpected'`
      case (mutants 112, 113 — see residuals). Kills mutants 115, 116.
- [ ] **Task 11 — `getWebFetchMessage` default branch.** Add `test()` calling
      `getUserMessage({ type: 'web-fetch', code: '__unknown' } as unknown as AppError)` and
      asserting `toBe("I couldn't fetch that page.")`. Kills mutants 142, 143.
- [ ] **Task 12 — `getUserMessage` top-level default branch.** Add `test()` calling
      `getUserMessage({ type: '__unknown' } as unknown as AppError)` and asserting
      `toBe('An unexpected error occurred. Please try again later.')`. Kills mutants 155, 156.

## Residuals (accepted — no test can kill)

- [x] **id 64 (L78)** `if (error instanceof ProviderClassifiedError) return error.error`.
      Mutant (`instanceof`→`false`) falls through to `'error' in error && isAppError(error.error)`.
      `ProviderClassifiedError` always carries an own `error: ProviderError` field (constructor
      parameter property), and `ProviderError` is a member of the `AppError` union, so
      `isAppError(error.error)` is always `true` and the fallback returns the identical
      `error.error` reference. Only distinguishable by constructing `new
      ProviderClassifiedError('x', valueThatIsNotAProviderError)`, which violates the class's
      own type signature — outside the contract this module guarantees.
- [x] **id 112 (L117-118)** `case 'unexpected':` body in `getSystemMessage` returns
      `'An unexpected error occurred. Please try again later.'`. The `default:` body returns
      the byte-identical string. Mutant removes the case's `return`, so `'unexpected'` falls
      through to `default:` and yields the same message.
- [x] **id 113 (L117)** `case 'unexpected':` → `case '':` relabels the discriminator. With
      `error.code === 'unexpected'` (the only value that reaches this case in well-typed
      inputs), the case label no longer matches and execution falls through to `default:`,
      returning the identical string as the original `'unexpected'` body.

## Verification

- [ ] `bun test tests/errors.test.ts` → all green.
- [ ] `bun test:mutate:file src/errors.ts` → `killed=154 score≈0.9809`; only residual ids
      (64, 112, 113) remain non-killed in the report.
- [ ] `git status` shows changes only under `tests/` and `docs/superpowers/` (diff-gate).
