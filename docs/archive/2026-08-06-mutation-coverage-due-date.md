<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `due-date.ts` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Raise the Stryker mutation score of
`plugins/task-provider-youtrack/due-date.ts` from **0.6915** (65/94) to
**≥ 0.9** (target 87/94 ≈ 0.9255) by extending
`tests/plugins/task-provider-youtrack/due-date.test.ts` only.

**Design doc:** `docs/superpowers/specs/2026-08-06-mutation-coverage-due-date-design.md`
— read it first; the gap table and per-class reasoning are authoritative.

**Tech stack:** Bun, `bun:test`, Zod v4. Test-only — no edits under `src/`,
`client/`, `plugins/`, or `scripts/`.

---

## Global constraints

- **Test-only.** The only modified source file is
  `tests/plugins/task-provider-youtrack/due-date.test.ts`. New docs live under
  `docs/superpowers/`. The single result artifact is
  `.review-loop/result.json`. Nothing else may be created or changed.
- **Never touch `scripts/mutation/baseline.json`** — the runner owns it.
- **Exact equality only.** Every new assertion uses `toBe(...)` on a
  fully-knowable value. No `startsWith` / `endsWith` / `toContain`. Error
  assertions pin `message` and each scalar field of `appError`
  (`type`, `code`, `field`, `reason`) individually.
- **One test per mutant class** (classes A–J from the design doc). Do not
  combine two classes into one test body.
- **Preserve the existing 4 happy-path tests verbatim** (apart from adding the
  two new imports: `DueDateCustomFieldSchema`, `YouTrackClassifiedError`).
- **SPDX license header** is already present in the test file; do not duplicate.
- All asserted timestamp/`slice`/`appError` literals are taken from the design
  doc and were verified against live runtime probing (see design *Design*).

## Reference

| File (unchanged)                                  | What's there                          | Used for                                  |
| ------------------------------------------------- | ------------------------------------- | ----------------------------------------- |
| `plugins/task-provider-youtrack/due-date.ts`      | Functions under test                  | Read-only reference                       |
| `plugins/task-provider-youtrack/classify-error.ts`| `YouTrackClassifiedError` class       | Import for typed `appError` access        |
| `src/providers/errors.ts` (L88)                   | `validationFailed` → `{type,code,field,reason}` | Exact `appError` field values |

---

## Tasks

Each task = one class = one `test(...)` block. Check a box only after the test
is written and passes on the unmutated source.

- [ ] **Setup — imports.** Add `DueDateCustomFieldSchema` to the existing
  `due-date.js` import block; add a new import line for `YouTrackClassifiedError`
  from `../../../plugins/task-provider-youtrack/classify-error.js`. Add a small
  `captureClassification(fn)` helper that runs `fn`, returns the thrown
  `Error`, and throws if `fn` did not throw — used by the error-asserting tests.
- [ ] **Class A — schema object literal (id 0).**
  `DueDateCustomFieldSchema.safeParse({}).success` `toBe(false)`.
- [ ] **Class B — final fallback (ids 2, 58, 63, 64, 65).**
  `parseDueDateValue('abc2024-03-15')` throws; assert `message` and all four
  `appError` scalars (`reason` =
  `Expected YYYY-MM-DD or an ISO datetime with timezone information`).
- [ ] **Class C — ISO `^` anchor (id 11).**
  `parseDueDateValue('abc2024-03-15T23:45:00+02:00')` throws; assert `message`
  and the same `appError` shape as B.
- [ ] **Class D — ISO `$` anchor (id 12).**
  `parseDueDateValue('2024-03-15T23:45:00+02:00abc')` throws; assert `message`
  and the same `appError` shape as B.
- [ ] **Class E — ISO optional seconds (id 23).**
  `parseDueDateValue('2024-03-15T23:45+02:00')`
  `toBe(Date.parse('2024-03-15T12:00:00.000Z'))`.
- [ ] **Class F — ISO fractional seconds (ids 27, 28).**
  `parseDueDateValue('2024-03-15T23:45:00.123+02:00')`
  `toBe(Date.parse('2024-03-15T12:00:00.000Z'))`.
- [ ] **Class G — calendar-reality check (ids 40, 42, 44, 53, 54, 55, 56, 57).**
  `parseDueDateValue('2024-02-30')` throws; assert `message` and all four
  `appError` scalars (`reason` =
  `Expected a real calendar date in YYYY-MM-DD format`).
- [ ] **Class H — nullish guard (id 72).**
  `mapYouTrackDueDateValue(null)` `toBe(undefined)` **and**
  `mapYouTrackDueDateValue(undefined)` `toBe(undefined)`.
- [ ] **Class I — filter undefined guard (id 81).**
  `normalizeYouTrackListTaskParams({}).dueAfter` `toBe(undefined)`.
- [ ] **Class J — filter date-regex `^` (id 83).**
  `normalizeYouTrackListTaskParams({ dueAfter: 'abc2024-03-15' }).dueAfter`
  `toBe('abc2024-03')`.

## Verification gate

- [ ] `bun test tests/plugins/task-provider-youtrack/due-date.test.ts` → 16 pass, 0 fail.
- [ ] `bun test:mutate:file plugins/task-provider-youtrack/due-date.ts` →
      score ≥ 0.9; residual survivors are exactly ids
      `{37, 85, 86, 87, 88, 89, 90}` (7 equivalent).
- [ ] `git diff --stat` shows changes only under `tests/` and
      `docs/superpowers/` (plus the single `.review-loop/result.json`).

## Residuals (accepted, do NOT write tests for)

- id 37 — L23 guard (equivalent; see design doc).
- ids 85–90 — L61 date-regex char-class/quantifier (equivalent; see design doc).

These are recorded in `.review-loop/result.json` `residuals[]` with per-loc
reasoning so the runner's residual tolerance can admit the final score.
