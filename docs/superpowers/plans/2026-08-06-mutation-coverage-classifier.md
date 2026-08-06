<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# `classifier.ts` Mutation Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the paired mutation score of
`src/analytics/intent/classifier.ts` from **0.4582** to **≥ 0.90** by
extending `tests/analytics/intent/classifier.test.ts`. No production
changes.

**Architecture:** Test-only. All eight new tests append to the existing
`describe('deterministic A+B classifiers', …)` block. Two new imports are
needed: `STRUCTURED_SIGNAL_BY_INTENT` and `TOOL_BY_INTENT` (both already
exported from `src/analytics/intent/classifier.js`). The classifier is a
set of pure functions over in-memory data — no DB, no mocks, no DI.

**Tech Stack:** Bun test runner (`bun:test`), Stryker via
`bun test:mutate:file`.

**Spec:** `docs/superpowers/specs/2026-08-06-mutation-coverage-classifier-design.md`

## Global Constraints

- Runtime is **Bun**; tests use `bun:test` (no Jest/Vitest).
- Strict TypeScript; use `.js` extension in all import paths.
- **No lint-disable or type-ignore comments** — the write hook blocks them.
- **No comments in test code.**
- **Every new assertion uses exact equality** — `toBe(...)` for scalars /
  full strings, `toEqual(...)` for arrays/objects. Never
  `startsWith`/`endsWith`/`toContain` where a full string is knowable.
- **One `test(...)` per mutant class** (eight tests total, one per gap row
  in the spec).
- No production source changes anywhere. No edit to
  `scripts/mutation/baseline.json`.
- The standard red-step of TDD does not apply: the production code is
  correct and the new tests pass immediately. The quality gate is the
  **mutation score** in Task 7, not test redness.
- Commit message style: conventional, e.g.
  `test: lock classifier vocabulary and return-path shapes`.

## File Structure

- **Modify** `tests/analytics/intent/classifier.test.ts` — extend the
  import to add `STRUCTURED_SIGNAL_BY_INTENT` and `TOOL_BY_INTENT`, then
  append eight tests inside the existing `describe` block.

---

### Task 1: Extend imports

**Files:**
- Modify: `tests/analytics/intent/classifier.test.ts`

- [ ] **Step 1: Add the two table exports to the import**

Extend the existing import from `../../../src/analytics/intent/classifier.js`
to also import `STRUCTURED_SIGNAL_BY_INTENT` and `TOOL_BY_INTENT` (both are
already `export const`). No other import changes.

- [ ] **Step 2: Run the file**

Run: `bun test tests/analytics/intent/classifier.test.ts`
Expected: PASS — 13 tests, 0 failures (no new tests yet).

---

### Task 2: Tests T1–T8 (one per mutant class)

**Files:**
- Modify: `tests/analytics/intent/classifier.test.ts` (append eight tests
  inside the existing `describe('deterministic A+B classifiers', …)` block,
  before its closing `})`).

**Interfaces:**
- Consumes: `classifyToolTrace`, `classifyMetadata`, `classifyHybrid`,
  `toClassifierToolSlug`, `STRUCTURED_SIGNAL_BY_INTENT`, `TOOL_BY_INTENT`,
  `inputOf`.

- [ ] **Step 1: T1 — structured feature signals map each intent to its primary**

Loop over every entry of `STRUCTURED_SIGNAL_BY_INTENT`; for each
`[intent, signal]` assert
`classifyMetadata(inputOf({ feature_events: [signal] })).primary` is `toBe`
the intent. (Kills class C1.)

- [ ] **Step 2: T2 — a meta-tool alongside a mapped goal tool does not mask the goal**

For each meta-tool in `['search_tools', 'load_tool', 'expand_result']`,
classify `[{tool_slug: meta}, {tool_slug: 'create_task'}]` and assert
`primary` is `toBe('task.create')`, `abstained` is `toBe(false)`, and
`tool_evidence_conflict` is `toBe(false)`. (Kills class C2.)

- [ ] **Step 3: T3 — runtime tool slugs translate exhaustively to classifier vocabulary**

Define a `Record<string, string>` mapping every runtime slug from
`RUNTIME_SLUGS_BY_INTENT` to its classifier slug
(`TOOL_BY_INTENT[intent]`); iterate and assert
`toClassifierToolSlug(slug)` is `toBe` the expected classifier slug. Also
assert `toClassifierToolSlug('external_other')` is `toBe('external_other')`
(unmapped passthrough). (Kills class C3 — all 110 non-residual runtime
mutants.)

- [ ] **Step 4: T4 — abstention predictions carry an empty goal list**

Assert `classifyToolTrace(inputOf({})).goals` `toEqual([])`. (Kills C4.)

- [ ] **Step 5: T5 — prediction-from-goals marks tool_evidence_conflict false**

Assert `classifyToolTrace(inputOf({ tool_trace: [{ tool_slug: 'create_task' }] })).tool_evidence_conflict` `toBe(false)`. (Kills C5.)

- [ ] **Step 6: T6 — every classifier path reports its deterministic strategy**

Assert `.strategy`:
- tool-trace empty → `toBe('tool_trace_v1')`
- tool-trace mapped (`create_task`) → `toBe('tool_trace_v1')`
- tool-trace unmapped-only (`external_other`) → `toBe('tool_trace_v1')`
- metadata signal (`provider:task:create`) → `toBe('metadata_v1')`
- `command_family: 'help'` → `toBe('metadata_v1')`
- `command_family: 'config'` → `toBe('metadata_v1')`
- `command_family: 'stop'` → `toBe('metadata_v1')`
- unsupported-goal signal → `toBe('metadata_v1')`
- metadata empty → `toBe('metadata_v1')`

(Kills class C6 — nine strategy StringLiteral mutants.)

- [ ] **Step 7: T7 — stop and unsupported-goal paths report no conflict and empty goals**

Assert stop `tool_evidence_conflict` `toBe(false)`; assert unsupported-goal
`tool_evidence_conflict` `toBe(false)` and `goals` `toEqual([])`.
(Kills class C7.)

- [ ] **Step 8: T8 — hybrid with no evidence reports no tool evidence conflict**

Assert `classifyHybrid(inputOf({})).tool_evidence_conflict` `toBe(false)`.
(Kills class C8.)

- [ ] **Step 9: Run the file**

Run: `bun test tests/analytics/intent/classifier.test.ts`
Expected: PASS — 21 tests, 0 failures.

---

### Task 3: Mutation verification

**Files:** None modified (measurement only), unless a survivor above the
accepted residuals appears.

- [ ] **Step 1: Run the paired mutation measurement**

Run: `bun test:mutate:file src/analytics/intent/classifier.ts`
Expected: score **≥ 0.90** (target ≈ 0.98; previous baseline 0.4582).

- [ ] **Step 2: Triage any survivors above the accepted residuals**

Accepted residuals (documented in the spec — do not chase):
- L96 `task.change_state: []` (no runtime slug maps to it).
- L188 `help_context: []` (reached via `command_family`, not a slug).
- L92 `task.create: ['create_task']` array + `'create_task'` string, L94
  `'get_task'` string, L117 `task.delete: ['delete_task']` array +
  `'delete_task'` string — fixed-point entries where the runtime slug
  equals its classifier slug, so the mapping is a no-op whether present or
  absent.
- L218 `ordered.length === 0` left-operand (private helper, callers guard).
- L242 `goals.length === 0` (empty path delegates to an identical
  abstention).

Any other survivor means a missing assertion — extend the relevant test,
re-run `bun test tests/analytics/intent/classifier.test.ts`, then re-run
Step 1.

- [ ] **Step 3: Full local verification**

Run: `bun test tests/analytics/intent/classifier.test.ts`
Expected: PASS — all green.
Run lint and typecheck per the repo's `package.json` scripts.
Expected: clean.

- [ ] **Step 4: Do NOT edit `scripts/mutation/baseline.json`**

The floor ratchets via the runner; no commit touches it.
