<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0368: Search-Memos Mutation Coverage — Companion Harness via Embeddings Module Mock and Cache-Busted Reload, Two Accepted Residual Mutants

## Status

Accepted

## Date

2026-08-04

## Context

`src/tools/search-memos.ts` had a ratcheted mutation floor of 0.18 in `scripts/mutation/baseline.json` — 17 killed / 28 survived / 51 no-coverage of 96 mutants. The entire `trySemanticSearch` body and the auto/semantic routing branches were never executed by any test, and the surviving log-metadata mutants sit behind `logger.child({ scope: 'tool:memo' })`, bound at module evaluation. The only existing coverage was three keyword-mode tests inside `tests/tools/memo-tools.test.ts`.

Two structural problems blocked raising the floor without touching production code. First, `getEmbeddingForContext` (src/embeddings.js) has no per-call DI, so the query embedding cannot be injected through the tool's public surface. Second, the module-level `logger.child()` binding means a static import captures the real logger before any `mock.module()` registered in a test body takes effect.

The design spec (`docs/superpowers/specs/2026-08-04-search-memos-mutation-design.md`) and implementation plan (`docs/superpowers/plans/2026-08-04-search-memos-mutation.md`) define the fix; this ADR records the decisions.

## Decision Drivers

- **Test-only change.** The production code is correct; the deficit is missing tests. `src/tools/search-memos.ts` stays unmodified — no refactoring-for-testability, no DI retrofit.
- **Reuse proven harnesses, don't invent new ones.** The hoisted `mock.module('../../src/embeddings.js')` pattern from `tests/tools/search-chat-history.test.ts` already controls `getEmbeddingForContext`; the cache-busted module reload + tracked-logger pattern from `tests/history.test.ts` already solves module-eval-time logger binding. The new file mirrors both exactly.
- **Own the conventional companion path.** The paired mutation runner and the TDD hook expect tests for `src/tools/search-memos.ts` at `tests/tools/search-memos.test.ts` — the moved keyword tests plus all new tests live there, and `tests/tools/memo-tools.test.ts` sheds the `search_memos` suite it no longer owns.
- **Test against the real in-memory DB.** Memos and embeddings are seeded via `saveMemo()` + `updateMemoEmbedding()` with 2D vector fixtures of known cosine similarity against `QUERY_VEC = [1, 0]` — ranking, threshold, and limit semantics are asserted on real data, not mocks of `src/memos.js`.
- **Document accepted residuals, never suppress.** Two survivors are explicitly accepted (threshold `>=` vs `>` at exactly 0.65, which is not float-representable; a defensive `r === null` filter-predicate flip unreachable via the public API). Anything else is a missing assertion, not an equivalent mutant.
- **Baseline ratchets via CI, not by hand.** `scripts/mutation/baseline.json` is not edited; the master `mutation-baseline` job's `seedMerge` raises the floor post-merge.

## Considered Options

### Option 1 — Companion test file combining the embeddings module-mock and cache-busted reload patterns (chosen)

Create `tests/tools/search-memos.test.ts` with a `mockEmbeddings()` helper (hoisted `mock.module` on src/embeddings.js, re-applied in `beforeEach` after the preload reset) and a `loadSearchMemosModule(tracked)` helper that registers a tracked logger mock then imports `` `../../src/tools/search-memos.js?t=${crypto.randomUUID()}` `` so the module-eval `logger.child()` binds the tracked child. Grow the file task-by-task: harness + 3 moved keyword tests → 2 schema-contract tests → 5 semantic-routing tests → 3 ranking/wiring tests → 2 log-contract tests (15 total). Remove the `search_memos` describe block and its import from `tests/tools/memo-tools.test.ts`.

- **Pros:** production code untouched; both harness mechanisms are already proven in-repo (search-chat-history, history); conventional path satisfies the paired runner and TDD hook; real-DB seeding kills ranking/threshold/limit mutants with exact cosine fixtures; quality gate is the measured mutation score (≥ 0.90), not test redness.
- **Cons:** the cache-busting dynamic import is subtle — a future contributor copying the file without the explanatory comments could statically import and silently bind the real logger; `mock.module` semantics are Bun-specific; the two accepted residual mutants permanently cap the file below 1.0.

### Option 2 — Refactor `src/tools/search-memos.ts` for injectable embeddings and logging (rejected)

Add DI parameters (factory args or options object) so tests pass mock embeddings and a mock logger statically.

- **Pros:** tests become plain static imports; no module-mock or cache-bust trickery.
- **Cons:** modifies production code purely to satisfy tests; changes the tool factory's call signature for every consumer; the same module-eval-binding problem recurs across the codebase and is already solved by the cache-bust convention — a one-off DI retrofit fragments the pattern.

### Option 3 — Keep the tests inside `tests/tools/memo-tools.test.ts` (rejected)

Extend the existing file with the semantic and log-contract suites instead of creating a companion file.

- **Pros:** no file moves; no second suite to keep in sync.
- **Cons:** violates the paired-path convention the mutation runner and TDD hook enforce (`tests/tools/search-memos.test.ts` for `src/tools/search-memos.ts`); mixes two tools' suites in one file; memo-tools.test.ts grows past comfortable size limits.

## Decision

Adopt Option 1. Ship the companion `tests/tools/search-memos.test.ts` (15 tests) using the embeddings module-mock plus cache-busted tracked-logger reload, remove the `search_memos` suite from `tests/tools/memo-tools.test.ts`, verify the paired mutation measurement reaches ≥ 0.90 with only the two documented residual survivors, and leave `scripts/mutation/baseline.json` untouched for CI to ratchet.

## Consequences

### Positive

- `src/tools/search-memos.ts` gains characterization over its entire semantic path: auto→semantic routing, keyword fallback on null query vector and on zero hits, threshold exclusion, descending-score ordering, `limit` truncation, and the user-scope wiring of `getEmbeddingForContext` (configContextId + `{ storageContextId, contextType: 'dm', chatUserId }`).
- The log contracts are executable documentation: child scope `{ scope: 'tool:memo' }`, entry params `{ mode, limit }` on `search_memos called`, completion payloads `{ mode, resultCount }` on `Keyword search completed` / `Semantic search completed`, and the `Semantic search unavailable` warn are all pinned.
- The input schema contract (mode enum + default `auto`, limit bounds 1–20, integer-only) is asserted directly, killing schema-tampering mutants without executing the tool.
- `tests/tools/memo-tools.test.ts` shrinks to its own save/list/archive/promote suites; both files run green (29 tests combined).

### Negative

- The harness couples to Bun-specific `mock.module` + query-string cache-bust semantics; it is not portable to another runner without rework.
- Two residual mutants are accepted by design, so the file's ceiling is below 1.0 — future score regressions must be triaged against the documented residual list, not assumed equivalent.
- `scripts/mutation/overrides.json` still pairs `src/tools/search-memos.ts` with `tests/tools/memo-tools.test.ts` and not the new companion file; if the paired runner does not also resolve the conventional path, that entry needs a follow-up to point at `tests/tools/search-memos.test.ts`.

### Risks

- If `src/embeddings.js` grows per-call DI or changes its export shape, the hoisted module mock silently stops controlling the tool. Mitigation: the re-apply-in-`beforeEach` comment documents the preload-reset interaction; the embedding-call wiring test would fail loudly on a signature change.
- A refactor of `src/tools/search-memos.ts` imports could change what stays a shared singleton and invalidate the cache-bust assumptions. Mitigation: the module-eval explanation comment mirrors the precedent files and travels with the harness.
- A future contributor may chase the two accepted residual mutants. Mitigation: the plan and spec both enumerate them with line-level rationale; this ADR records the acceptance.

## Implementation Notes

- Fixtures: `QUERY_VEC = [1, 0]` with `VEC_HIGH ≈ 0.994`, `VEC_MID ≈ 0.862`, `VEC_PASS ≈ 0.707` (above the 0.65 threshold) and `VEC_BELOW ≈ 0.498`, `VEC_ORTHO = 0` (below); `seedMemoWithEmbedding()` persists via `saveMemo()` + `updateMemoEmbedding(..., new Float32Array(vec))`.
- `mockEmbeddings()` captures `{ text, configContextId, context }` per call so the wiring test asserts the user scope exactly.
- Verified: `bun test tests/tools/search-memos.test.ts tests/tools/memo-tools.test.ts` → 29 pass, 0 fail; `baseline.json` intentionally left at 0.177 pending the CI `seedMerge` ratchet (plan Task 6 Step 4 forbids manual edits).
- Accepted residuals: L28 `>=` vs `>` at exactly 0.65 (threshold not float-representable); L37 `r === null` filter-predicate flip (defensive `getMemo`-null branch unreachable via the public API).

## Implementation Status

Implemented. `tests/tools/search-memos.test.ts` exists with all 15 planned tests (harness, 3 keyword, 2 schema, 5 semantic routing, 3 ranking/wiring, 2 log contract); `tests/tools/memo-tools.test.ts` no longer references `search_memos`; `src/tools/search-memos.ts` is unmodified; both test files run green. The mutation floor ratchet is deferred to CI per the plan.

## Related Decisions

- ADR-0342: Mutation Gate Becomes a Pure Regression Ratchet — defines the baseline mechanics (`seedMerge`, monotonic floor) this change defers the ratchet to.
- ADR-0354: History Mutation Coverage — origin of the cache-busted module-reload + tracked-logger pattern reused here.
- ADR-0361: Create-Recurring-Task Mutation Coverage — sibling test-only mutation-coverage effort.
- ADR-0363: Deferred-Tool-Handlers Mutation Coverage — same tracked-logger/cache-bust philosophy on the deferred-prompts surface.
- ADR-0339: Chat-History Search Phase 2 Semantic Embeddings — sibling semantic-search surface whose test harness (`search-chat-history.test.ts`) supplied the embeddings module-mock pattern.

## References

- Spec: `docs/superpowers/specs/2026-08-04-search-memos-mutation-design.md`
- Plan: `docs/superpowers/plans/2026-08-04-search-memos-mutation.md`
- Source: `src/tools/search-memos.ts`; tests: `tests/tools/search-memos.test.ts`, `tests/tools/memo-tools.test.ts`
- Pattern sources: `tests/tools/search-chat-history.test.ts` (embeddings mock), `tests/history.test.ts` (cache-busted reload); tracked logger: `tests/utils/logger-mock.ts`
