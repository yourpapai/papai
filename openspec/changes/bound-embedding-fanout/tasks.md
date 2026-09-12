# Tasks: bound-embedding-fanout

Ordered test-first (TDD hook gates every `src/` write). Design references: D1–D6 in `design.md`.

## 1. Embedding call bounds (`src/embeddings.ts`)

- [x] 1.1 Red: extend `tests/embeddings.test.ts` — `getEmbedding` threads `abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS)` and `maxRetries: 1` into the AI SDK `embed` dep (assert on dep args via DI). Run: `bun test tests/embeddings.test.ts`
- [x] 1.2 Green: implement constants (`EMBED_TIMEOUT_MS = 10_000`, `EMBED_MAX_RETRIES = 1`) and thread them in `getEmbedding`. Run: `bun test tests/embeddings.test.ts`
- [x] 1.3 Red+Green: add `embedManyTexts(texts, apiKey, baseUrl, model, context?, deps?)` batch seam to `src/embeddings.ts` — same timeout/maxRetries bounds, one `recordUsage` event per batch (success/failure), usage tokens extracted when the provider returns them. DI deps mirror `EmbeddingsDeps`. Run: `bun test tests/embeddings.test.ts`

## 2. Retriever batching + single-flight + TTL (`src/tools/disclosure/embedding-tool-retriever.ts`)

- [x] 2.1 Red: extend `tests/tools/disclosure/embedding-tool-retriever.test.ts` — cold-cache `rank()` with 75 briefs calls the batch dep with chunk-sized text arrays (≤ 32 per call, all briefs covered), never one call per brief; warm cache issues no brief-embedding calls (query only). Run: `bun test tests/tools/disclosure/embedding-tool-retriever.test.ts`
- [x] 2.2 Green: add `embedMany` to `EmbeddingRetrieverDeps` (default from `src/embeddings.ts`); replace the per-brief `Promise.all` fan-out with chunked batches under `p-limit(BATCH_CONCURRENCY = 2)`; store per-brief vectors in the existing cache keyed by endpoint+model. Run: `bun test tests/tools/disclosure/embedding-tool-retriever.test.ts`
- [x] 2.3 Red: concurrent `rank()` calls on a cold cache — second call awaits the first's in-flight batch and issues no duplicate embeds for the same texts. Run: `bun test tests/tools/disclosure/embedding-tool-retriever.test.ts`
- [x] 2.4 Green: implement the per-cacheKey single-flight warm-up map (`Map<cacheKey, Promise<void>>`) with the bounded await-then-recompute-missing pass (design D3). Run: `bun test tests/tools/disclosure/embedding-tool-retriever.test.ts`
- [x] 2.5 Red: failed brief embeddings are not re-requested within `FAILURE_TTL_MS` (60 s) — a second `rank()` right after a failed batch issues no new brief embeds and still returns lexical-ranked results; after TTL (injected clock) the brief is retried. Run: `bun test tests/tools/disclosure/embedding-tool-retriever.test.ts`
- [x] 2.6 Green: implement the per-cacheKey failure tombstone map with injected clock; success clears tombstones. Run: `bun test tests/tools/disclosure/embedding-tool-retriever.test.ts`
- [x] 2.7 Regression check: existing model-change and lexical-fallback cases stay green (batch failure → `scored.length === 0` → lexical path). Run: `bun test tests/tools/disclosure/`

## 3. Factory wiring

- [x] 3.1 Red+Green: `getToolRetriever` passes the `embedManyTexts`-backed dep (resolved credentials, same `callContext`) into the retriever; no-config path still returns the pure lexical retriever. (Note: the factory wiring landed with 2.2 because the constructor change required it to compile; the `embedTexts` forwarding assertions were therefore written against already-wired code.) Run: `bun test tests/tools/disclosure/`

## 4. Verification + docs

- [x] 4.1 `bun run test:affected` in the edit loop; then one full suite: `bun run test` (17590 pass / 0 fail)
- [x] 4.2 `bun run typecheck && bun run lint`
- [x] 4.3 Update `docs/architecture/tools.md` progressive-disclosure paragraph: bounded batched brief embedding, timeout/lexical degradation, failure TTL (one sentence each).
- [x] 4.4 Mutation gate on touched files: retriever measured via `test:mutate:file` at 0.8551 ≥ baseline 0.8310 (ratchet holds); `src/embeddings.ts` has no baseline entry (first PR measurement records it; score 0.6562 with survivors confined to pre-existing legacy surface — log lines, provider cache, wall-clock durations).
