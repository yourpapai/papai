<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage: `plugins/task-provider-youtrack/query-builder.ts`

Date: 2026-08-06
Status: approved

## Summary

Raise the mutation score of `plugins/task-provider-youtrack/query-builder.ts`
from **0.80** (44 killed / 5 survived / 6 no-coverage, 55 mutants — measured by
`bun test:mutate:file` 2026-08-06) to **≥ 0.9** (predicted **1.0**) by adding a
dedicated companion test file. No source changes. The entire gap is uncovered
`else if` due-date branches and the sort-field/sort-order mapping in a pure
string-building function, so every survivor is killable with one exact-output
`toBe(...)` assertion per missing input class.

## Why this file

- **Genuine, fully killable gap.** `buildYouTrackQuery` is a 19-line pure
  function (no fetch, no store, no DI, no clock). All 11 surviving mutants are
  observable through the returned query string; none is structural/IO.
- **Thin existing coverage.** The only covering test today is a single case in
  `tests/plugins/task-provider-youtrack/task-helpers.test.ts` that exercises
  exactly one combination (every filter set + `sortBy: 'priority'`). It leaves
  three input classes entirely unreached: a `dueAfter`-only filter, a
  `dueBefore`-only filter, and `sortBy: 'createdAt'` (the only value that is
  *rewritten* rather than passed through) plus the default-`'asc'` fallback.
- **No companion exists.** The mirror path
  `tests/plugins/task-provider-youtrack/query-builder.test.ts` does not exist;
  the paired runner's companion resolver discovers it automatically once added
  (no `overrides.json` edit), and the coverage map union heuristic keeps the
  existing `task-helpers.test.ts` in scope too.
- **Real consumer.** `buildYouTrackQuery` is the sole builder for YouTrack
  issue-search queries (used by the list-tasks operation). A surviving mutant
  here silently emits a malformed query — e.g. a spurious `Due date:
  <undefined>`, or `sort by: createdAt` instead of `sort by: created` — that
  YouTrack interprets as a different (or empty) result set.

## Non-goals

- **No edits to `query-builder.ts` or any `src/`/`client/`/`plugins/`/`scripts/`
  code.** This is test-only; the implementation is already correct.
- **No change to `scripts/mutation/baseline.json`.** The runner owns the floor;
  the CI re-seed job raises it on master.
- **No refactor of the existing `task-helpers.test.ts` query case.** It stays as
  a regression anchor; the new companion adds the missing classes alongside it.
- **No table-driven `test.each` matrix.** One named test per mutant class keeps
  the spec↔test mapping explicit and the gap analysis diffable, per the
  one-test-per-class brief.
- **No integration through the list-tasks operation.** The operation needs the
  client/field harness to kill the same pure-function mutants; the direct
  unit path is the documented entry contract.

## Gap analysis

Measured survivors (`reports/paired/plugins__task-provider-youtrack__query-builder.ts.stryker-report.json`,
paired run 2026-08-06): 5 `Survived` + 6 `NoCoverage` = **11**. They collapse
into **4 missing-input classes**, one row each:

| # | Class (missing input) | Mutants in the class (id · mutator · loc · status) | Why it survives |
| --- | --- | --- | --- |
| A | `dueAfter` set, `dueBefore` unset | **33** BlockStatement `else if` body L17–L19 (NoCoverage); **34** StringLiteral `` `Due date: >${params.dueAfter}` `` L18 (NoCoverage); **30** ConditionalExpression `params?.dueAfter !== undefined` → `false` L17:14–L17:44 (Survived); **24** ConditionalExpression `params.dueBefore !== undefined` → `true` L14:41–L14:71 (Survived) | No test passes `dueAfter` without `dueBefore`. With no such input the `else if` body is never entered (33/34 uncovered), the else-if guard is never the deciding branch (30 survives), and the both-branch `dueBefore` operand only diverges from `true` on exactly this input (24 survives — every other path either takes the both-branch by default or short-circuits before evaluating it). |
| B | `dueBefore` set, `dueAfter` unset | **39** BlockStatement `else if` body L19–L21 (NoCoverage); **40** StringLiteral `` `Due date: <${params.dueBefore}` `` L20 (NoCoverage); **36** ConditionalExpression `params?.dueBefore !== undefined` → `false` L19:14–L19:45 (Survived) | No test passes `dueBefore` without `dueAfter`. The second `else if` body is never entered (39/40 uncovered) and its guard is never the deciding branch (36 survives). |
| C | `sortBy: 'createdAt'` (rewritten to `'created'`) | **47** ConditionalExpression `params.sortBy === 'createdAt'` → `false` L23:23–L23:52 (Survived); **49** StringLiteral `'createdAt'` (right operand of `===`) → `""` L23:41–L23:52 (Survived); **50** StringLiteral `'created'` (ternary true branch) → `""` L23:55–L23:64 (NoCoverage) | The only covering test uses `sortBy: 'priority'`, which takes the ternary's *false* branch (`sortField = params.sortBy`). The `'createdAt' → 'created'` rewrite is never exercised: the true-branch literal is uncovered (50) and the `=== 'createdAt'` comparison is never the deciding branch (47/49 survive — with a non-`createdAt` value the mutant and original agree). |
| D | `sortBy` set, `sortOrder` unset (default `'asc'`) | **53** StringLiteral `'asc'` (`?? 'asc'` fallback) → `""` L24:66–L24:71 (NoCoverage) | The only covering test passes `sortOrder: 'desc'`, so the `?? 'asc'` fallback never evaluates. The literal is uncovered (53). |

Net: 11 survivors across 4 classes. Killing all four classes lands every
survivor. No mutant class falls outside these four.

## Design — tests to add

New companion file
`tests/plugins/task-provider-youtrack/query-builder.test.ts`. Plain `bun:test`,
no harness (the function is pure and synchronous). Each test imports
`buildYouTrackQuery` directly from
`../../../plugins/task-provider-youtrack/query-builder.js` and asserts the
**entire** returned string with `toBe(...)` — exact equality is mandatory and
sufficient here because the full query string is fully knowable from the input,
and any string-literal / operand mutant that survives changes exactly that
string. One test per class, mapped one-to-one onto the gap table:

1. **Class A — `dueAfter` only.**
   `buildYouTrackQuery({ dueAfter: '2026-01-01' }, 'DEMO')`
   → `toBe('project: {DEMO} Due date: >2026-01-01')`.
   *Kills 33* (the `else if` body now executes), *34* (the literal appears and
   any change breaks `toBe`), *30* (mutant `→ false` skips the body, dropping
   the clause → string differs), *24* (mutant `→ true` routes to the both-branch
   and appends `Due date: <undefined>` → string differs).
2. **Class B — `dueBefore` only.**
   `buildYouTrackQuery({ dueBefore: '2026-01-31' }, 'DEMO')`
   → `toBe('project: {DEMO} Due date: <2026-01-31')`.
   *Kills 39, 40, 36* by the same mechanisms as class A mirrored to the second
   `else if`.
3. **Class C — `sortBy: 'createdAt'` with an explicit `sortOrder`.**
   `buildYouTrackQuery({ sortBy: 'createdAt', sortOrder: 'desc' }, 'DEMO')`
   → `toBe('project: {DEMO} sort by: created desc')`.
   *Kills 50* (the `'created'` literal is now reached and asserted), *47*
   (mutant `→ false` makes `sortField = 'createdAt'` → `sort by: createdAt desc`
   → differs), *49* (mutant `'createdAt'→""` makes the `===` false → same
   `createdAt` output → differs). An explicit `sortOrder: 'desc'` is used so
   this test does *not* also cover class D, keeping the one-to-one mapping clean.
4. **Class D — `sortBy` set, `sortOrder` unset.**
   `buildYouTrackQuery({ sortBy: 'priority' }, 'DEMO')`
   → `toBe('project: {DEMO} sort by: priority asc')`.
   *Kills 53* (the `?? 'asc'` fallback now evaluates; mutant `'asc'→""` yields
   `sort by: priority ` with a trailing space → differs from `... priority asc`).

### Expected outcome

Predicted killed: **55/55 → score 1.0**. Every mutant in the inventory (44
already killed + the 11 above) is reached by at least one case with a
discriminating exact-string oracle. Pre-analysis found **no equivalent-mutant
class** among the 11: each survivor's mutated value flows unchanged into a query
clause or comparison whose effect is visible in the returned string for the
class's defining input (see Accepted residuals).

## Verification

1. `bun test tests/plugins/task-provider-youtrack/query-builder.test.ts` — the
   four new cases pass.
2. `bun test:mutate:file plugins/task-provider-youtrack/query-builder.ts` —
   confirm `killed=55 survived=0 noCoverage=0 score=1.0`; investigate any
   unexpected survivor before declaring done.
3. No `baseline.json` edit in the PR: the CI `mutation-baseline` job re-seeds
   the floor on master (per-key max) from the changed-files run; the gate is
   regression-only, so the improved score can only raise the floor.
4. Lint/typecheck via the repo's `bun check:full` — no existing suite is
   modified (new file, no shared mocks, no `mock.module`).

## Accepted residuals

None. All 11 surviving mutants are behaviorally observable through the returned
query string and are killed by the four cases above; no equivalent mutant was
identified. Per-loc reasoning that none is equivalent:

- **L17 `params?.dueAfter !== undefined` (30), L17–L19 body (33), L18 literal
  (34), L14 `params.dueBefore !== undefined` (24):** on a `dueAfter`-only input
  the original emits exactly one `Due date: >…` clause; every one of these
  mutants changes that emission (drops it, or adds a spurious `Due date:
  <undefined>`). Observable → not equivalent.
- **L19 `params?.dueBefore !== undefined` (36), L19–L21 body (39), L20 literal
  (40):** mirrored to a `dueBefore`-only input; the original emits exactly one
  `Due date: <…` clause and each mutant changes it. Observable → not equivalent.
- **L23 `params.sortBy === 'createdAt'` (47), L23 `'createdAt'` literal (49),
  L23 `'created'` literal (50):** on `sortBy: 'createdAt'` the original rewrites
  to `created`; each mutant yields `createdAt` (or empty). Observable → not
  equivalent.
- **L24 `'asc'` fallback literal (53):** on a `sortOrder`-unset input the
  original appends ` asc`; the mutant appends an empty string. Observable → not
  equivalent.

If a future run surfaces a survivor outside these four classes, it would be a
new mutator on already-killed lines and must be triaged then.
