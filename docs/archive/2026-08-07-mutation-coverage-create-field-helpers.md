<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `plugins/task-provider-youtrack/create-field-helpers.ts` Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. This is a test-only
> effort; there is **no** production-code change.

**Goal:** Raise the `plugins/task-provider-youtrack/create-field-helpers.ts` mutation score from
**0.813953488372093** to **≥ 0.9** (projected **1.0**) by appending two `test()`s to the existing
companion `tests/plugins/task-provider-youtrack/create-field-helpers.test.ts`. Spec:
`docs/superpowers/specs/2026-08-07-mutation-coverage-create-field-helpers-design.md`.

**Architecture:** `collectFieldPairs(params)` walks four optional dedicated fields
(`status`/`priority`/`assignee`/`dueDate`) plus the generic `customFields` array, pushing a tagged
`FieldPair` per present field. The `status`, `priority`, and generic branches are already perfectly
covered; the `assignee` (line 35) and `dueDate` (line 36) branches are exercised by **no** test in
the suite, so their conditional/object-literal/string-literal mutants survive. Each new test passes
**only** the dedicated param under test so the returned array is exactly one pair, then asserts
`toHaveLength(1)` and exact `toBe(...)` on every field.

## Global Constraints

- **Test-only.** Extend only `tests/plugins/task-provider-youtrack/create-field-helpers.test.ts`
  (plus the two docs files already written). Do **not** touch `src/`, `client/`, `plugins/`,
  `scripts/`, or `scripts/mutation/baseline.json`.
- Runtime Bun; tests use `bun:test` (`import { describe, expect, test } from 'bun:test'`).
- **Every new assertion is an exact `toBe(...)`** (and `toHaveLength` for the array length) — never
  `toContain` / `startsWith` / `endsWith`. Field access (`pairs[0].source` etc.) is checked
  per-field with `toBe`, so an `ObjectLiteral→{}` mutant makes every field `undefined`.
- One `test()` per mutant class (one-to-one with the spec's gap table).
- No comments added to the test file (repo convention).
- Reuse the existing `collectFieldPairs` import already in the file (no new imports needed).

## Measure (already complete)

- [x] `bun test:mutate:file plugins/task-provider-youtrack/create-field-helpers.ts` → `killed=35
      survived=2 noCoverage=6 score=0.813953488372093`; report at
      `reports/paired/plugins__task-provider-youtrack__create-field-helpers.ts.stryker-report.json`.
- [x] Enumerated all 8 surviving/no-coverage mutants with ids, mutators, and `line:col`.

## Tasks (one per mutant class → one test each)

- [ ] **Task 1 — `collectFieldPairs` assignee pair (class 1).** Append a `test()` to the existing
      `describe('collectFieldPairs', ...)` block: call
      `collectFieldPairs({ assignee: 'someone' })`, then assert `pairs.toHaveLength(1)`,
      `pairs[0].source` is `toBe('dedicated')`, `pairs[0].kind` is `toBe('user')`, and
      `pairs[0].value` is `toBe('someone')`. Kills mutants 15 (conditional→`false`, array becomes
      empty → `toHaveLength` fails), 17 (object→`{}`, fields become `undefined` → `toBe` fails), 18
      (`'dedicated'`→`""` → `.source` `toBe('dedicated')` fails), 19 (`'user'`→`""` → `.kind`
      `toBe('user')` fails).
- [ ] **Task 2 — `collectFieldPairs` dueDate pair (class 2).** Append a `test()` to the existing
      `describe('collectFieldPairs', ...)` block: call
      `collectFieldPairs({ dueDate: '2026-01-01' })`, then assert `pairs.toHaveLength(1)`,
      `pairs[0].source` is `toBe('dedicated')`, `pairs[0].kind` is `toBe('date')`, and
      `pairs[0].value` is `toBe('2026-01-01')`. Kills mutants 21 (conditional→`false`), 23
      (object→`{}`), 24 (`'dedicated'`→`""`), 25 (`'date'`→`""`) — each via the same failure modes
      as Task 1.

## Residuals (accepted — no test can kill)

None. Every one of the 8 surviving/no-coverage mutants is killed by the two tests above; no
equivalent mutants exist in this file. (Confirmed empirically by re-measuring in the Verification
step; the result JSON's `residuals` array is empty.)

## Verification

- [ ] `bun test tests/plugins/task-provider-youtrack/create-field-helpers.test.ts` → all green.
- [ ] `bun test:mutate:file plugins/task-provider-youtrack/create-field-helpers.ts` →
      `killed=43 score=1.0`; zero non-killed mutants in
      `reports/paired/plugins__task-provider-youtrack__create-field-helpers.ts.stryker-report.json`.
- [ ] `git status` shows changes only under `tests/` and `docs/superpowers/` (diff-gate), plus the
      single `.review-loop/result.json`.
