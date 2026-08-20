<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage — `plugins/task-provider-kaneo/mappers.ts`

## Summary

Drive the mutation score of `plugins/task-provider-kaneo/mappers.ts` from the
measured **0.317** (20 / 63 killed) up to its tests-only ceiling by adding a
dedicated companion test file (`tests/plugins/task-provider-kaneo/mappers.test.ts`)
that directly exercises every exported mapper with type-valid inputs. The file
had no companion test before; its coverage came only incidentally from five
other suites that assert outputs too coarsely to kill most mutants.

Re-measured ceiling: **0.762** (48 / 63 killed, 15 survivors). The 15 survivors
are genuinely unkillable in a test-only, type-honest, lint-clean iteration and
are declared as accepted residuals (see Gap analysis + Accepted residuals). The
0.9 target is unreachable without editing `plugins/` (export / loosen the
internal date helpers, or delete the dead fallback), so this is a **capped**
outcome.

## Why this file

`mappers.ts` is the single translation layer between Kaneo's wire shapes and
papai's common `Task` / `Project` / `Comment` / `Label` / `Column` /
`TaskSearchResult` types. Every Kaneo read path funnels through it, so silent
mapping regressions are high-blast-radius. Its 0.317 score meant the
project-description omission logic and the string paths of the two date helpers
were effectively unchecked.

## Non-goals

- Editing anything under `src/`, `client/`, `plugins/`, or `scripts/`
  (hard constraint: test-only iteration). The residual mutants below are
  *accepted*, not fixed.
- Changing `scripts/mutation/baseline.json` (the runner owns it).
- Rewriting the five existing suites that cover this module indirectly — they
  stay additive to the new companion.
- Testing the Kaneo network/client layer; the mappers are pure functions and
  are tested as such (no DB, no fetch, no mocks).

## Gap analysis

Measured via `bun test:mutate:file plugins/task-provider-kaneo/mappers.ts`
(report `reports/paired/plugins__task-provider-kaneo__mappers.ts.stryker-report.json`):
before the new tests, 63 mutants — 20 Killed, 21 Survived, 22 NoCoverage. After
the new companion tests: 48 Killed, 10 Survived, 5 NoCoverage (score 0.762).
The 15 remaining survivors group into the classes below.

| Class | Location | Stryker ids | Status | Why unkillable (test-only) |
|-------|----------|-------------|--------|----------------------------|
| G1 | `toDateString` null/undefined guard, `mappers.ts:24` `if (value === undefined \|\| value === null) return null` | 2, 3, 4, 6 | Survived | **Equivalent.** The fall-through at line 27 also returns `null`, so for every input the return value is identical with the guard mutated to `false` / `&&` / either side removed. |
| G2 | `toDateString` string check true-branch, `mappers.ts:25` `if (typeof value === 'string') return value` | 8 | Survived | **Equivalent for the typed contract.** `toDateString` is only reachable through `mapCreateTaskResponse(result.startDate: string\|null\|undefined)` / `mapTaskDetails(result.startDate: string\|null)`. `null`/`undefined` are caught by the line-24 guard before line 25, so line 25 is only ever reached by strings, for which `typeof === 'string'` is already `true`. Mutating it to `true` changes nothing. Distinguishing it requires a non-string value, which the typed API cannot deliver without an assertion that the repo linter (`no-unsafe-type-assertion`) rejects. |
| G3 | `toDateString` `instanceof Date` branch, `mappers.ts:26` | 12, 13 | NoCoverage | **Unreachable via the typed API.** Valid inputs are `string\|null\|undefined`; strings return at line 25 and `null`/`undefined` at line 24, so line 26 is never executed. Covering it needs a `Date`/object value, which the typed mapper parameter forbids (same lint blocker as G2). |
| G4→killed | `toOptionalDateString` guard + string check | 14, 15, 19, 21, 23, 24, 25 | (now Killed) | Killed by asserting `createdAt` equals the exact input string. |
| G5a | `toOptionalDateString` string check true-branch, `mappers.ts:32` | 22 | Survived | **Equivalent for the typed contract.** `toOptionalDateString` is only reachable via `mapCreateTaskResponse(result.createdAt)`, whose schema type is a required `string`. Line 32 is therefore only ever reached by strings; mutating `typeof === 'string'` to `true` is a no-op. |
| G5b | `toOptionalDateString` `instanceof Date` branch, `mappers.ts:33` | 26, 27 | NoCoverage | **Unreachable via the typed API.** `createdAt` is a required string; line 33 is never executed. Same lint blocker as G3. |
| G6 | `toOptionalDateString` null/undefined guard, `mappers.ts:31` | 16, 17, 18, 20 | Survived | **Equivalent.** Same reasoning as G1 — the fall-through at line 34 also returns `undefined`. |
| G7→killed | `mapTaskDetails`, `mapTaskListItem`, `mapComment` bodies | 30–33, 57, 58 | (now Killed) | Killed by asserting mapped fields. |
| G8→killed | `mapProject` description-omission conditional, `mappers.ts:124` | 42–56 | (now Killed) | Killed by asserting `description` present (exact string) and `'description' in result === false` for null / undefined / `''`. |
| G9 | `mapGlobalSearchTaskResults` `'no-priority'` fallback, `mappers.ts:92` | 37 | NoCoverage | **Dead code.** Line 83 runs `GlobalSearchResponseSchema.parse`, whose `tasks` use `SearchTaskSchema` with `priority: TaskPriorityEnum`; by line 85's re-parse, `priority` is guaranteed valid, so `priorityParsed.success` is always `true` and the fallback is unreachable for any input. |

Surviving (residual) classes: G1, G2, G3, G5a, G5b, G6, G9 → 15 mutants.
Killed by the new tests: G4, G7, G8 → 28 mutants (plus reinforcement of the
20 already-killed).

## Design — tests added

All tests live in one new companion file:
`tests/plugins/task-provider-kaneo/mappers.test.ts`. The two internal date
helpers are not exported, so they are exercised through the exported mappers
that call them, using only type-valid inputs (`string`, `null`, `undefined`).
Every assertion uses exact equality (`toBe`); `relations` is asserted `toBe`
on a captured reference, and key-presence uses `expect('description' in result).toBe(false)`.

| Test | Kills | How |
|------|-------|-----|
| `mapCreateTaskResponse` maps every field, string dates pass through | G4 (14, 15, 19, 21, 23, 24, 25) | Assert `startDate` / `dueDate` / `createdAt` equal the exact input strings. |
| `mapTaskDetails` maps every field incl. relations (captured ref) | G7 (30, 31) | Assert each field; `relations` asserted `toBe(inputArray)`. |
| `mapTaskListItem` maps fields; null dueDate passes through | G7 (32, 33) | Assert each field. |
| `mapProject` includes a non-empty description | G8 (42, 43, 44, 50, 52, 54, 56) | Assert `description` equals the exact string. |
| `mapProject` omits description when null / undefined / `''` | G8 (45, 46, 47, 48, 49, 51, 53, 55) | Assert `'description' in result` is `false`. |
| `mapComment` maps fields | G7 (57, 58) | Assert each field. |
| `mapLabel`, `mapColumn`, `mapTaskSearchResult`, `mapGlobalSearchTaskResults` | reinforces already-killed mutants | Self-contained companion coverage. |

## Verification

1. `bun test tests/plugins/task-provider-kaneo/mappers.test.ts` — green (15 pass).
2. `bunx oxlint` + `bunx tsgo --noEmit` on the file — clean (no
   `no-unsafe-type-assertion` / type errors; only type-valid inputs are used).
3. `bun test:mutate:file plugins/task-provider-kaneo/mappers.ts` — re-measured
   killed 48 / survived 10 / noCoverage 5 / score 0.7619.
4. The measured surviving ids equal the declared residual ids
   `{2, 3, 4, 6, 8, 12, 13, 16, 17, 18, 20, 22, 26, 27, 37}` — every survivor
   declared, nothing extra.

## Accepted residuals

Fifteen mutants survive every type-honest test and require a `plugins/` edit
to remove or to make testable. They are declared in `result.json`:

- **G1 — `toDateString:24` guard (ids 2, 3, 4, 6).** Output-redundant
  early-return: the line-27 fall-through also returns `null`.
- **G6 — `toOptionalDateString:31` guard (ids 16, 17, 18, 20).** Same shape;
  the line-34 fall-through also returns `undefined`.
- **G2 — `toDateString:25` typeof-true (id 8).** Line 25 is only reached by
  strings (null/undefined exit at line 24), so `typeof === 'string'` → `true`
  is a no-op. Distinguishing it needs a non-string, blocked by the typed API
  + `no-unsafe-type-assertion`.
- **G5a — `toOptionalDateString:32` typeof-true (id 22).** `createdAt` is a
  required string, so line 32 only sees strings; same no-op.
- **G3 — `toDateString:26` Date branch (ids 12, 13).** Unreachable: valid
  inputs are `string | null | undefined`, all of which return before line 26.
  Covering needs a `Date`, blocked by the typed API + lint.
- **G5b — `toOptionalDateString:33` Date branch (ids 26, 27).** Unreachable:
  `createdAt` is a required string.
- **G9 — `mapGlobalSearchTaskResults:92` `'no-priority'` fallback (id 37).**
  Dead code after the `GlobalSearchResponseSchema` double-parse.

Enabling tests for G2/G3/G5a/G5b means exporting the helpers (or loosening the
mapper parameter types) in `plugins/`; G1/G6 mean deleting the redundant
guards; G9 means dropping the redundant double-parse/fallback. All are
`plugins/` edits, out of scope for this test-only iteration.
