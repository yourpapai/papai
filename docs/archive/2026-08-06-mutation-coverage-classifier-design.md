<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage: `src/analytics/intent/classifier.ts`

Date: 2026-08-06
Status: approved

## Summary

Raise the paired mutation score of `src/analytics/intent/classifier.ts` —
measured **0.4582** (126 killed / 149 survived / 5 runtime-error of 280
mutants) — to **≥ 0.90** by extending the existing companion test file
`tests/analytics/intent/classifier.test.ts` with vocabulary- and
shape-locking assertions. No production changes.

## Why this file

- **Frozen vocabulary module.** `classifier.ts` is the deterministic A+B
  intent classifier promoted from the PoC. Its three lookup tables
  (`TOOL_BY_INTENT`, `STRUCTURED_SIGNAL_BY_INTENT`,
  `RUNTIME_SLUGS_BY_INTENT`) and the `META_TOOLS` set are pure data: a
  single wrong string silently reroutes an intent. Almost every surviving
  mutant is a `StringLiteral → ""` or `ArrayDeclaration → []` inside these
  tables, meaning the vocabulary is effectively unverified today.
- **Highest bad-mutant density in this run.** 149 survivors concentrate in
  one small (293-line) file; the existing 13 tests sample only a handful of
  the ~100 mapped slugs/signals.
- **Real behavior at stake.** The runtime-slug adapter
  (`toClassifierToolSlug`) gates which tool traces the classifier can ever
  recognize; an unmapped slug fails closed to abstention. A regression here
  silently degrades classification for entire intent families (collaborate,
  project-schema, recurring, attachment, coding, …).

## Non-goals

- No change to `src/`, `client/`, `plugins/`, or `scripts/` — test-only.
- No edit to `scripts/mutation/baseline.json` (the runner owns it).
- No refactor of the classifier. The frozen `intent.v1` strings are
  asserted verbatim; this work locks them, not redesigns them.
- Not chasing the four accepted equivalent residuals (see Accepted
  residuals).

## Gap analysis

Run: `bun test:mutate:file src/analytics/intent/classifier.ts`
Report: `reports/paired/src__analytics__intent__classifier.ts.stryker-report.json`
(126 killed / 149 survived / 5 runtime-error; score 0.4582).

The 149 survivors cluster into eight classes. One row per class:

| # | Class | Loc range | Mutator(s) | Count | Why it survives today |
| --- | --- | --- | --- | --- | --- |
| C1 | `STRUCTURED_SIGNAL_BY_INTENT` signal values | L62–76 | StringLiteral→`""` | 15 | Only `provider:task:create` is fed to `classifyMetadata`; the other 15 feature signals are never exercised, so blanking a value just makes that signal unmapped with no observable assertion. |
| C2 | `META_TOOLS` set + the skip conditional | L89, L233 | ArrayDeclaration→`[]`, StringLiteral→`""`, ConditionalExpression→`false` | 5 | The meta-tool test uses meta-tools *alone*; with no mapped goal alongside, skipping vs. not-skipping both abstain with `conflict=false`, so the skip is observationally equivalent on that input. |
| C3 | `RUNTIME_SLUGS_BY_INTENT` vocabulary | L92–186 | StringLiteral→`""`, ArrayDeclaration→`[]` | 110 | `toClassifierToolSlug` is asserted for only 4 of ~70 runtime slugs; the other ~66 slugs and their parent arrays are unverified, so blanking any one passes through unchanged. (Excludes the 2 empty-array residuals in C-residual.) |
| C4 | `abstention()` goals array | L205 | ArrayDeclaration→`["Stryker was here"]` | 1 | No test asserts `goals` on an abstention path, so a garbage element is invisible. |
| C5 | `predictionFromGoals` conflict flag | L225 | BooleanLiteral false→true | 1 | No test asserts `tool_evidence_conflict === false` on a successful (non-abstained) goal prediction. |
| C6 | Strategy labels on every return path | L241,242,254,256,259,263,273,281 | StringLiteral→`""` | 9 | `strategy` is asserted only on the hybrid path; the `tool_trace_v1` / `metadata_v1` labels on the seven other return paths are unchecked. |
| C7 | `no_action` / unsupported-goal conflict + goals | L268, L275, L278 | BooleanLiteral false→true, ArrayDeclaration→`["Stryker was here"]` | 3 | The stop and unsupported-goal tests assert `primary`/`abstained`/`confidence` but not `tool_evidence_conflict` (→true survives) nor the `goals: []` shape (→garbage survives). |
| C8 | Hybrid conflict OR-shortcut | L291 | ConditionalExpression→`true` | 1 | The hybrid no-evidence path is not asserted for `tool_evidence_conflict`, so forcing it to `true` is invisible. |

**Kill budget.** 149 survived. Nine are accepted equivalent residuals
(below). Killing the other 140 yields `(126+140)/(126+140+9) = 266/275 =
0.967`, comfortably above 0.90. The minimum needed to clear 0.90 is 122
kills. (Note: the runtime-slug class C3 excludes five fixed-point entries
— `create_task`, `get_task`, `delete_task` slug/array at L92/94/117 —
where the runtime slug equals its classifier slug so the mapping is a
no-op; those join the empty-array lookups as accepted residuals.)

## Design — tests to add

All eight new tests are appended to the existing `describe('deterministic
A+B classifiers', …)` block in `tests/analytics/intent/classifier.test.ts`.
Each test maps 1:1 onto one gap class and uses exact equality
(`toBe` / `toEqual`) throughout — no `startsWith`/`endsWith`/`toContain`
where a full string is knowable.

| Test (new) | Kills class | Mechanism |
| --- | --- | --- |
| T1 structured feature signals map each intent's signal to its primary | C1 | Loop over the exported `STRUCTURED_SIGNAL_BY_INTENT`; for each `[intent, signal]` assert `classifyMetadata({feature_events:[signal]}).primary === intent`. Blank any value → that signal unmapped → abstention → assertion fails. |
| T2 a meta-tool alongside a mapped goal tool does not mask the goal | C2 | For each of `search_tools`/`load_tool`/`expand_result`, assert `classifyToolTrace([{tool_slug: meta}, {tool_slug: 'create_task'}])` yields `primary === 'task.create'`, `abstained === false`, `tool_evidence_conflict === false`. If the meta is not skipped it becomes an unmapped goal tool → abstention-with-conflict → fail. |
| T3 runtime tool slugs translate exhaustively to classifier vocabulary | C3 | A `Record<string, string>` of every runtime slug → its classifier slug (`TOOL_BY_INTENT[intent]`), iterated with `expect(toClassifierToolSlug(slug)).toBe(expected)`. Blank any value or array → the slug passes through unchanged → fail. Also asserts a known unmapped slug passes through. |
| T4 abstention predictions carry an empty goal list | C4 | `expect(classifyToolTrace(inputOf({})).goals).toEqual([])`. |
| T5 prediction-from-goals marks tool_evidence_conflict false | C5 | `expect(classifyToolTrace(inputOf({tool_trace:[{tool_slug:'create_task'}]})).tool_evidence_conflict).toBe(false)`. |
| T6 every classifier path reports its deterministic strategy | C6 | Assert `.strategy` is `'tool_trace_v1'` on tool-trace empty / mapped / unmapped paths and `'metadata_v1'` on the signal / help / config / stop / unsupported-goal / metadata-abstention paths. |
| T7 stop and unsupported-goal paths report no conflict and empty goals | C7 | stop: `tool_evidence_conflict === false`; unsupported-goal: `tool_evidence_conflict === false` and `goals` toEqual `[]`. |
| T8 hybrid with no evidence reports no tool evidence conflict | C8 | `expect(classifyHybrid(inputOf({})).tool_evidence_conflict).toBe(false)` (tool abstains clean, metadata abstains clean → OR must be false). |

## Verification

1. `bun test tests/analytics/intent/classifier.test.ts` — green (existing
   13 + 8 new).
2. `bun test:mutate:file src/analytics/intent/classifier.ts` — score
   **≥ 0.90** (target ≈ 0.98).
3. Repo lint / typecheck via the standard scripts.
4. No manual `scripts/mutation/baseline.json` edit — the runner ratchets it.

## Accepted residuals

The final paired run leaves **9 survivors** (score **0.9673**, 266 killed /
9 survived of 275 scoring mutants). All nine are genuinely unobservable
through the public API — killing them would require either exporting a
private helper or asserting on Stryker's `"Stryker was here"` sentinel
(which tests the mutator, not real behavior):

**Empty-array lookups (the `[] → ["Stryker was here"]` mutator):**

- **L96 `task.change_state: []`** — `task.change_state` has no runtime
  slugs by design; no real slug ever maps to `change_task_state`. The
  intent is reached via the classifier-vocabulary slug directly, never the
  runtime adapter.
- **L188 `help_context: []`** — symmetric: `help_context` has no runtime
  slugs; the intent is reached via `command_family: 'help'`, never a tool
  slug. Only the sentinel string would be affected.

**Fixed-point runtime-slug entries (runtime slug === classifier slug, so the
mapping is a no-op whether present or absent):**

- **L92 `task.create: ['create_task']`** (array→`[]`) and
  **L92 `'create_task'`** (string→`""`) — the runtime slug `create_task`
  equals its classifier slug `create_task`; `toClassifierToolSlug` returns
  the same string mapped or unmapped, and `classifyToolTrace` resolves
  `create_task` via `TOOL_TO_INTENT`, not the runtime table.
- **L94 `'get_task'`** (string→`""`) — runtime slug `get_task` equals
  classifier slug `get_task`. (The sibling `get_task_history → get_task`
  mapping is non-trivial and IS killed by T3.)
- **L117 `task.delete: ['delete_task']`** (array→`[]`) and
  **L117 `'delete_task'`** (string→`""`) — runtime slug `delete_task`
  equals classifier slug `delete_task`.

**Equivalent control-flow in private helpers:**

- **L218 `ordered.length === 0` (left operand) → `false`** —
  `predictionFromGoals` is module-private and every caller guards empty
  goals (`classifyToolTrace` checks `goals.length === 0`; `classifyMetadata`
  checks `goals.length > 0` or passes a literal single-goal array). After
  `sortGoals` dedup, a non-empty input cannot become empty, so the
  sub-condition is never true; replacing it with `false` is equivalent.
- **L242 `goals.length === 0` → `false`** — with empty goals the original
  returns `abstention('tool_trace_v1')`; the mutant delegates to
  `predictionFromGoals('tool_trace_v1', [], 0.99)`, whose first line
  (`ordered.length === 0`) routes back to `abstention('tool_trace_v1')`.
  The two paths produce byte-identical predictions.
