<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `plugins/task-provider-youtrack/create-field-helpers.ts` Design

**Date:** 2026-08-07
**Status:** Approved for planning
**Target file:** `plugins/task-provider-youtrack/create-field-helpers.ts` (`collectFieldPairs`, which
tags dedicated params by field kind and flattens generic `customFields`, plus `resolveFieldPair`)
**Before score:** 0.813953488372093 (killed=35 survived=2 noCoverage=6, total=43)
**Target score:** ≥ 0.9

## Summary

`create-field-helpers.ts` has a companion test
(`tests/plugins/task-provider-youtrack/create-field-helpers.test.ts`) that covers the `status`/`priority`
branches of `collectFieldPairs`, the `customFields` generic branch, and the two `resolveFieldPair`
paths (dedicated resolution + unknown-generic throw). The remaining gap is narrow but precise: the
`assignee` (line 35) and `dueDate` (line 36) dedicated branches are **never exercised by any test in
the suite**. Consequently the `!== undefined` conditional that always returns `false`, the pushed
object literal (→ `{}`), and both string literals on each of those two lines all survive.

This spec adds **two** focused `test()`s — one per surviving mutant class — to the existing
companion file. Each asserts an exact `toBe(...)` on every field of the single produced pair (plus
`toHaveLength(1)` on the array), killing all 8 non-killed mutants and raising the score to **1.0**.
There are no accepted residuals: every survivor is observable as a changed exact value.

## Why this file

`collectFieldPairs` is the entry point that turns a `DedicatedParams` bag into the flat
`FieldPair[]` consumed by `resolveFieldPair`; it is imported by the YouTrack create/update flows. A
surviving mutant on the `assignee` or `dueDate` branch silently drops the dedicated pair, swaps its
`kind` tag, or empties the pushed object — which would misroute field resolution for assignee/due
date values. The function is pure and synchronous, so every behaviour is observable as an exact
return value, making it an ideal mutation target. The `status`/`priority` lines already score
perfectly; only `assignee` and `dueDate` are uncovered.

## Non-goals

- **No production-code changes.** `src/`, `client/`, `plugins/`, `scripts/` are untouched; the diff
  gate restricts edits to `tests/` and `docs/superpowers/`.
- **No edits to `scripts/mutation/baseline.json`** (the runner owns the ratchet).
- The existing companion test file is **extended in place** (not replaced); the only additions are
  the two new `test()` blocks plus the imports they need.
- No comments added to the test file (repo convention).

## Gap analysis

Measured via `bun test:mutate:file plugins/task-provider-youtrack/create-field-helpers.ts`; report at
`reports/paired/plugins__task-provider-youtrack__create-field-helpers.ts.stryker-report.json`.
2 `Survived` + 6 `NoCoverage` = 8 non-killed mutants (score 35/43 = 0.8140). They group into two
classes, one per uncovered dedicated branch. Mutant ids are Stryker ids from the report; locations
are `line:col` in `plugins/task-provider-youtrack/create-field-helpers.ts`.

The two relevant source lines are:

```
35:   if (params.assignee !== undefined) pairs.push({ source: 'dedicated', kind: 'user', value: params.assignee })
36:   if (params.dueDate !== undefined) pairs.push({ source: 'dedicated', kind: 'date', value: params.dueDate })
```

| # | Class (behaviour) | Mutant ids | Loc | Root cause / why it survives |
|---|---|---|---|---|
| 1 | `collectFieldPairs` assignee branch — the `!== undefined` conditional (→ always `false`), the pushed object literal (→ `{}`), and the `'dedicated'` / `'user'` string literals (→ `""`) | 15, 17, 18, 19 | 35:7, 35:49, 35:59, 35:78 | No test in the suite passes `assignee` to `collectFieldPairs`, so line 35 is never taken. The `=== undefined` equality-flip (mutant 16) and the conditional-→`true` (mutant 14) are killed indirectly because they inject an *extra* `value: undefined` pair that breaks an exact-output assertion elsewhere, but nothing verifies that a *provided* `assignee` value round-trips. Conditional-→`false` (15) drops the pair entirely; object-→`{}` (17) empties it; `'dedicated'`→`""` (18) and `'user'`→`""` (19) corrupt the tags. A single test passing `assignee` and asserting the exact pair kills all four. |
| 2 | `collectFieldPairs` dueDate branch — the `!== undefined` conditional (→ always `false`), the pushed object literal (→ `{}`), and the `'dedicated'` / `'date'` string literals (→ `""`) | 21, 23, 24, 25 | 36:7, 36:48, 36:58, 36:77 | No test passes `dueDate`, so line 36 is never taken. Identical root cause to class 1: the equality-flip (22) and conditional-→`true` (20) are killed by the extra-pair side effect, but nothing verifies a provided `dueDate` round-trips. Conditional-→`false` (21) drops the pair; object-→`{}` (23) empties it; `'dedicated'`→`""` (24) and `'date'`→`""` (25) corrupt the tags. A single test passing `dueDate` and asserting the exact pair kills all four. |

Note: the only reason the `=== undefined` flip and conditional-→`true` are already `Killed` while
conditional-→`false` survives is asymmetric observability — an *extra* element changes an exact array
used elsewhere, whereas a *missing* element is invisible until a test specifically provides that
param.

## Design — tests to add

Each class maps **one-to-one** to a single new `test()` appended to the existing
`tests/plugins/task-provider-youtrack/create-field-helpers.test.ts`. To make each assertion a
clean, single-element observation, each fixture passes **only** the dedicated param under test (no
`status`/`priority`/`customFields`), so the returned array is exactly one pair. Every assertion is
an exact `toBe(...)` (or `toHaveLength` for the array length) — never `toContain` / `startsWith` /
`endsWith`.

| Test (class #) | Fixture | Exact expected value | Kills |
|---|---|---|---|
| T1 (#1) `collectFieldPairs` assignee pair | `collectFieldPairs({ assignee: 'someone' })` | `toHaveLength(1)`; `pairs[0].source` is `toBe('dedicated')`, `.kind` is `toBe('user')`, `.value` is `toBe('someone')` | 15, 17, 18, 19 |
| T2 (#2) `collectFieldPairs` dueDate pair | `collectFieldPairs({ dueDate: '2026-01-01' })` | `toHaveLength(1)`; `pairs[0].source` is `toBe('dedicated')`, `.kind` is `toBe('date')`, `.value` is `toBe('2026-01-01')` | 21, 23, 24, 25 |

**Projected after-score:** killed = 35 + 8 = **43**, non-killed = 0, total = 43 →
**score = 43/43 = 1.0** (≥ 0.9 target).

Why each mutant dies under its test:

- **15 / 21** (conditional → `false`): the pair is never pushed, so `toHaveLength(1)` fails (array is empty).
- **17 / 23** (object literal → `{}`): `pairs[0]` is `{}`, so `.source`/`.kind`/`.value` are `undefined` and each `toBe(...)` fails.
- **18 / 24** (`'dedicated'` → `""`): `.source` becomes `""`, failing `toBe('dedicated')`.
- **19** (`'user'` → `""`): `.kind` becomes `""`, failing `toBe('user')`.
- **25** (`'date'` → `""`): `.kind` becomes `""`, failing `toBe('date')`.

## Verification

1. `bun test tests/plugins/task-provider-youtrack/create-field-helpers.test.ts` is green (all
   `test()`s, including the two new ones).
2. `bun test:mutate:file plugins/task-provider-youtrack/create-field-helpers.ts` reports
   `killed=43 survived=0 noCoverage=0 score=1.0`, and
   `reports/paired/plugins__task-provider-youtrack__create-field-helpers.ts.stryker-report.json`
   shows zero non-killed mutants.
3. No file under `src/`, `client/`, `plugins/`, `scripts/`, or `scripts/mutation/baseline.json` is
   modified (diff-gate); the only new/changed files are under `tests/` and `docs/superpowers/`, plus
   the single `.review-loop/result.json`.

## Accepted residuals

None. Every surviving mutant in this file is observable as a changed exact value: a dropped pair
(broken `toHaveLength`), an emptied object (broken field `toBe`), or a corrupted tag string (broken
`toBe`). No equivalent mutants remain; the projected score is 1.0.
