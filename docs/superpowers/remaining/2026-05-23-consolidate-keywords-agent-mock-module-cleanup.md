<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Remaining Work: consolidate-keywords-agent mock.module cleanup

**Status:** not_started
**Generated:** 2026-05-23
**Predecessor:** `docs/archive/2026-04-22-behavior-audit-mock-module-cleanup.md` (closed out the classify-agent + phase2a + incremental-integration leftovers; explicitly carried this one as out-of-scope)
**ADR (pattern):** `docs/adr/0057-dependency-injection-test-refactor.md`, `docs/adr/0111-behavior-audit-mock-module-cleanup.md`

## Goal

Remove the remaining two `mock.module()` boundaries in `tests/scripts/behavior-audit/consolidate-keywords-agent.test.ts` — `mock.module('ai', ...)` (line 22) and `mock.module('@ai-sdk/openai-compatible', ...)` (line 25) — by routing the test through dependency injection. The source module (`scripts/behavior-audit/consolidate-keywords-agent.ts`) already exposes `EmbedSlugBatchDeps` with an injectable `embedMany`, but the test ignores the seam and mocks both modules instead. Provider/model construction (`createOpenAICompatible(...).embeddingModel(...)`) is not yet injectable, which is why the test also stubs `@ai-sdk/openai-compatible`.

## Scope

- 1 test file: `tests/scripts/behavior-audit/consolidate-keywords-agent.test.ts` (4 tests, ~82 lines)
- 1 source file: `scripts/behavior-audit/consolidate-keywords-agent.ts` (~74 lines)
- No production callers need to change — defaults stay wired to real imports.

## Suggested Approach

1. **Extend `EmbedSlugBatchDeps`** in `scripts/behavior-audit/consolidate-keywords-agent.ts` so the embedding model (or its factory) is injectable. Two viable shapes:
   - Add `buildEmbeddingModel: (apiKey: string) => EmbeddingModel` — symmetric to `ClassifyAgentDeps.buildModel` in classify-agent.ts.
   - Or, simpler given how the test uses the value: add `embeddingModel: EmbeddingModel` directly and only construct the provider when `deps` is omitted.

   Default deps must continue to call the real `createOpenAICompatible(...).embeddingModel(EMBEDDING_MODEL)` so production callers (`scripts/behavior-audit/consolidate-keywords.ts` and friends) are unaffected.

2. **Rewrite each of the 4 tests** to pass a `deps` object with a fake `embedMany` (already supported) and a stub embedding model:

   ```typescript
   await embedSlugBatch(['a: desc a', 'b: desc b'], {
     embedMany: ({ values }) => {
       calls.push(values)
       return Promise.resolve({ embeddings: values.map(() => [0.1, 0.2]) })
     },
     embeddingModel: { doEmbed: null } as never,
   })
   ```

   Delete the `beforeEach` `mock.module(...)` block entirely. `embedManyImpl` becomes per-test local state.

3. **Verify**:
   - `bun test tests/scripts/behavior-audit/consolidate-keywords-agent.test.ts` — 4/4 pass.
   - `rg "mock\.module" tests/scripts/behavior-audit/consolidate-keywords-agent.test.ts` — 0 matches.
   - `rg "mock\.module" tests/scripts/behavior-audit/` — only the documented `incremental-integration.test.ts` startup mocks remain.
   - `bun check:verbose` — 12/12 green.

## Notes / Watch-outs

- The `embedSlugBatch` retry path reads `MAX_RETRIES` and `RETRY_BACKOFF_MS` from `./config.js` directly (ESM live bindings). The "throws after exhausting retries" test relies on setting `BEHAVIOR_AUDIT_MAX_RETRIES=1` and calling `reloadBehaviorAuditConfig()`. That continues to work with DI; no extra seam needed for that path.
- Production caller `scripts/behavior-audit/consolidate-keywords.ts` and any test in the broader behavior-audit suite that imports `embedSlugBatch` must keep working without passing `deps`. Default-deps construction stays inside the function body.
- Consider whether the `sleep` indirection in `retryEmbedBatch` should also become injectable for deterministic retry tests — out of strict scope but a natural extension if the retry test ever starts to feel slow.

## Definition of Done

- Both `mock.module()` calls removed from `tests/scripts/behavior-audit/consolidate-keywords-agent.test.ts`.
- All 4 tests pass via DI.
- `bun check:verbose` exits 0.
- This brief moved to `docs/archive/`.
