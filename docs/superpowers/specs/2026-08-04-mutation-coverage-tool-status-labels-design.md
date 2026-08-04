<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage Strengthening — `live-status/tool-status-labels.ts`

**Date:** 2026-08-04
**Status:** Verified — score 0.4619 → 0.9714 (target ≥ 0.95 met); 6 accepted equivalent residuals; test-only, no `src/` changes.
**Type:** Test-only — no production source changes

## Summary

`src/live-status/tool-status-labels.ts` renders the live, user-facing status
line for each in-flight tool call (e.g. `🌐 Fetching example.com…`). Its current
mutation score in `scripts/mutation/baseline.json` is **0.46** — 54% of mutants
survive. The file is the highest-ROI target in the baseline: pure functions, zero
external dependencies, no I/O, no DI, an existing companion test file to extend,
and surviving mutants that each map to a visible defect. This spec adds targeted,
exact-equality test cases that kill the surviving mutant classes and lifts the
score to **≥ 0.95**.

## Why this file

Selection criterion (confirmed): **best score ROI** — largest reliable
mutation-score gain per unit of test effort.

Trade-off versus the runners-up:

| File | Score | Verdict |
|---|---|---|
| **`live-status/tool-status-labels.ts`** | 0.46 | **Selected.** Pure, dependency-free, user-facing, existing test file, ~0.5 headroom to ~0.95+. |
| `utils/scheduler.helpers.ts` | 0.33 | `calculateBackoff` uses `Math.random()`; jitter mutants can only be bounds-checked, capping the reachable score. |
| `tools/tool-metadata.ts` | 0.29 | ~180 of 196 lines are a declarative table; killing table-cell mutants is low-value busywork. Only `getToolMetadata` (~15 lines) is interesting. |
| `chat/command-auth.ts` | 0.0 | 19-line passthrough; real logic lives in `bot.ts`. |

Every surviving mutant in the selected file corresponds to a real, observable
bug (wrong truncation boundary, dropped port, wrong key precedence, wrong
emoji/label mapping), and each is killable with a single exact assertion.

## Non-goals

- No changes to `src/live-status/tool-status-labels.ts` or any other production
  file. The implementation is correct; this is test strengthening only.
- No refactoring of `asRecord` to eliminate its one equivalent mutant (see
  Residual mutants). The identity round-trip is accepted as-is.
- No manual edit to `scripts/mutation/baseline.json` on the PR — the ratchet is
  regression-only on PRs and the raised floor is seeded by CI's master
  `mutation-baseline` job after merge.

## Gap analysis — surviving mutant classes

The current suite (`tests/live-status/tool-status-labels.test.ts`) proves happy
paths but leaks precision. The dominant weakness is the truncation assertion at
lines 31-36, which uses `startsWith`/`endsWith` instead of exact equality and
lets an entire class of mutants live.

| # | Mutant class | Location | Why it survives |
|---|---|---|---|
| A | Truncation boundary / slice endpoint / ellipsis char / `MAX_ARG_LENGTH` constant / `>` vs `>=` | `sanitizeArg` (L48-51) | Loose `startsWith`+`endsWith`; no exact string, no 40/41 boundary |
| B | `getStringField` key precedence (first-key-wins) | L26-34 | No test has two populated keys |
| C | Empty-string / non-string field skip inside the loop | L29-31 | No `{title:'', name:'X'}` or `{title:5, name:'X'}` cases |
| D | `host` vs `hostname` (port dropped) | `hostOf` (L41) | All tested URLs have no port |
| E | `Array.isArray` / `null` rejection | `asRecord` (L21) | Only `string` rejection tested |
| F | `entry.arg === undefined` path (tools with no arg extractor) | `formatToolStatus` (L102) | Only `arg`-returning-undefined tested, never a missing `arg` |
| G | Whitespace-only arg omission (`rawArg.trim() === ''`) | L103 | No `{query:'   '}` case |
| H | `humanizeToolName`: hyphen→space, `toLowerCase`, `lastIndexOf` vs `indexOf` (multi-`__`), prefix-strip on non-`__` mcp/plugin names | L89-94 | Single-`__`, already-lowercase, underscore-only inputs |
| I | Registry table-cell mutants (emoji/label/quote for under-pinned entries) | `REGISTRY` (L53-86) | Several entries never asserted exactly |

## Design — tests to add

All new cases extend the existing `describe('formatToolStatus')` block in
`tests/live-status/tool-status-labels.test.ts`. **Every assertion uses exact
`toBe(...)` equality** — no `startsWith`, no `endsWith`, no `toContain` where a
full string is knowable. The existing loose truncation test (L31-36) is
rewritten as exact-equality.

Mapping one-to-one onto the gap classes:

- **A — truncation precision.**
  - Exactly 40-char arg → full value, no ellipsis (boundary: `length > 40` is false at 40).
  - Exactly 41-char arg → first 40 chars + `…`.
  - Rewrite the existing long-arg case to a single exact expected string; include a tab/newline/run-of-spaces substring to pin `replace(/\s+/gu, ' ')`, `.trim()`, the slice endpoint, and the ellipsis character simultaneously.
- **B — precedence.** `create_task` with `{title:'A', name:'B'}` → title wins.
- **C — skip rules.** `create_task` with `{title:'', name:'B'}` → `B`; `{title:5, name:'B'}` → `B` (pins `typeof value === 'string'`).
- **D — port.** `web_fetch` `{url:'https://host.example:8080/x'}` → host includes `:8080` (pins `.host` over `.hostname`).
- **E — record rejection.** `search_memory` called with `['query']` (array), `null`, and `42` → each yields the no-arg label `🔍 Searching memory…`. Pins all three guards in `asRecord`.
- **F — no-arg tool.** `list_memory` `{}` → `🧠 Recalling memory…` exactly (pins an entry whose `arg` is absent).
- **G — whitespace-only arg.** `search_memory` `{query:'   '}` → no-arg label (pins `rawArg.trim() === ''`).
- **H — humanize edge cases.**
  - `mcp_s__audio-transcribe` → `⚙️ Running audio transcribe…` (hyphen→space).
  - `mcp_s__CamelCase` → `⚙️ Running camelcase…` (`toLowerCase`).
  - `plugin_a__b__c` → `⚙️ Running c…` (`lastIndexOf` over `indexOf`).
  - `mcp_standalone` (no `__`) → `⚙️ Running standalone…` (pins `^(?:mcp|plugin)_` strip).
- **I — registry pinning.** Exact `toBe` for `fetch_chat_link` (second `quote:false` + `hostOf` entry), `update_task`, `delete_task` to lock their emoji/label.

## Verification

1. **Baseline before** — `bun test:mutate:file src/live-status/tool-status-labels.ts` → record the score (expected ~0.46).
2. **Unit green** — `bun test tests/live-status/tool-status-labels.test.ts` stays green.
3. **Mutation target** — re-run `bun test:mutate:file src/live-status/tool-status-labels.ts`; target **≥ 0.95**. Inspect the Stryker report; any remaining survivors should be the accepted equivalent mutant(s) below, not behavioural.
4. **No production diff** — `git diff` must be empty under `src/`.
5. **Baseline ratchet** — no manual baseline edit on the PR. The master `mutation-baseline` CI job re-seeds `scripts/mutation/baseline.json` after merge via `seedMerge` (per-file max), which is what raises the committed floor.

## Residual mutants (accepted)

Verified at execution time — 6 survivors, all observably-identical for every reachable registry input (the authoritative list lives in the plan's Task 6 Step 2):

- **L21** `Array.isArray(input)` guard in `asRecord` — arrays passed through become `{0:...}` records, but every registry extractor reads a string key no array possesses, so the result is still `undefined`.
- **L39** `if (url === undefined) return undefined` early-return in `hostOf` — without it, `new URL(undefined)` throws and the `catch` returns `undefined`; identical outcome.
- **L93** `.trim()` in `humanizeToolName`'s chain — `base` is always a slice/replace of a tool name with no surrounding whitespace, so trimming is a no-op.
- **L103** (×3) `rawArg.trim() === ''` and the `''` literal in `formatToolStatus`'s omission check — registry extractors (`getStringField`, `hostOf`) pre-filter whitespace, so `rawArg` is never a non-empty whitespace string; these guard an unreachable state.

(The pre-execution design predicted the `asRecord` `Object.fromEntries(Object.entries(input))` identity round-trip as the sole residual; the actual run showed that mutant is killed, and the six above are the real equivalent set.) This residual floor is the reason the target is 0.95 rather than 1.0.

## Risk & notes

- **TDD write hook:** only `tests/` is touched; `src/` is unchanged, so no
  red-green source gate applies. Adding characterization tests to already-correct
  code is the intended pattern (see `tests/CLAUDE.md`).
- **Exact-equality discipline** is the whole lever — any new test that uses a
  partial matcher re-opens the leak it was meant to close. The plan should call
  this out at the top of the test additions.
