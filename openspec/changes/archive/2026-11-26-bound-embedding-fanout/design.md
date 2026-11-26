# Design: bound-embedding-fanout

## Context

See `proposal.md` — Why. Current mechanics that shape this design:

- `EmbeddingToolRetriever.rank()` (`src/tools/disclosure/embedding-tool-retriever.ts`) embeds the query via `tryGetEmbedding`, then `Promise.all(briefs.map(embedBrief))` — one `embed()` HTTP call per uncached brief, unbounded concurrency, success-only per-brief cache (`briefEmbeddingCaches`, module-level, keyed `baseUrl:model` → brief name).
- `src/embeddings.ts` `getEmbedding`/`tryGetEmbedding` call AI SDK `embed()` with default retries and no timeout; usage is recorded per call via `recordUsage`.
- The `message-embedding-sweep` (`src/message-embedding-sweep.ts`) already establishes the repo's batch pattern: per-context resolved config + `embedMany` + `p-limit(3)` — and shares the same endpoint with disclosure.
- Live incident numbers: solo embed ≈ 490 ms; a ~75-wide cold burst on a queueing endpoint produced 195 s+ `search_tools` wall time, provider batch rejections, and 2–4× duplicate embeds from concurrent searches.

## Goals / Non-Goals

**Goals:**

- Cold-cache `search_tools` cost ≈ one (chunked) batch request round-trip, not N.
- Hard upper bound on discovery embedding latency with guaranteed lexical degradation.
- No duplicate in-flight work across concurrent searches; no per-search re-probing of failed briefs.

**Non-Goals** (beyond proposal Non-goals):

- No change to ranking math (cosine + lexical fallback semantics stay as-is).
- No cross-restart persistence of any cache (unchanged volatility contract).

## Decisions

### D1: Batch briefs with `embedMany`, chunked and p-limited (primary fix)

The retriever gains a batch seam in its deps: `embedMany(texts, apiKey, baseUrl, model) => Promise<number[][]>`, implemented in `src/embeddings.ts` next to `getEmbedding` (default impl via `createOpenAICompatible` + `embedMany`, mirroring the sweep's defaultDeps; records one usage event per batch). `rank()` collects uncached briefs and embeds them in chunks of `BATCH_CHUNK = 32` under `p-limit(BATCH_CONCURRENCY = 2)`. The query stays a single `tryGetEmbedding` call (one fast request; solo latency measured at ~0.5 s).

- *Alternative: keep per-brief calls, only add `p-limit`.* Rejected: at the incident endpoint's serialized service rate (~2–4 s/request), 75/3 × 2 s ≈ 50 s — still turn-killing. Batching is the fix; the limit is the safety net.
- *Alternative: include the query in the batch.* Marginal saving, couples query and brief failure domains. Rejected.

### D2: Timeout + reduced retries in `getEmbedding`/`embedMany`

Both seams pass `abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS = 10_000)` and `maxRetries: 1` to the AI SDK call. 10 s tolerates slow-but-working providers (solo ≈ 0.5 s, batches with queueing headroom) while cutting queue-hangs; `maxRetries: 1` stops a throttling endpoint from multiplying requests through SDK backoff. On timeout/failure the existing `safeEmbed`/lexical degradation path applies — this also hardens memo and long-term-memory embeds, which share `getEmbedding` and can hang identically today.

### D3: Single-flight at the batch level, keyed per endpoint+model

A `Map<cacheKey, Promise<void>>` of in-flight warm-ups joins concurrent `rank()` calls: a caller first reads cached vectors, computes its missing set, then — if a warm-up for the same cacheKey is pending — awaits it and recomputes the missing set once (bounded two-pass; converged callers find an empty missing set, matching the incident's same-brief-set stacking). Only then does it start (and register) its own batch. No union-merging complexity; extra briefs from a different context's toolset cost at most one additional small batch.

### D4: Negative cache with failure TTL

Per cacheKey: `Map<briefName, failedAtMs>`. A brief with a failure younger than `FAILURE_TTL_MS = 60_000` is skipped (no request); ranking proceeds over available vectors and the existing empty-result → lexical fallback. Success clears the tombstone. 60 s matches the observed ~30 s provider recovery while capping re-probe rate at one per minute per brief.

### D5: Constants are code, not config

`BATCH_CHUNK`, `BATCH_CONCURRENCY`, `EMBED_TIMEOUT_MS`, `EMBED_MAX_RETRIES`, `FAILURE_TTL_MS` are module constants. No env vars or settings surface (see Non-goals); revisit only if an operator needs per-endpoint tuning.

### D6: Batch-level usage recording

`embedMany` records exactly one usage event per batch request (success or failure), reusing the recorder fields `getEmbedding` writes today. With D3 removing duplicate work, the observed duplicate-`eventId` warns disappear without touching the recorder.

### Scope model / gating impact

No new persisted state; all caches remain in-memory and process-volatile, keyed by endpoint+model (group-shared BYOK/central embedding credentials — unchanged). No new tool surface, so capability gating and `tool_prefs` are untouched; `search_tools` keeps its existing meta-tool registration and `disclosure:search` event shape (counts/lengths only).

## Risks / Trade-offs

- [Providers cap batch input sizes differently] → conservative chunk (32) + `p-limit(2)`; a rejected chunk degrades to lexical for those briefs and tombstones them for the TTL.
- [10 s timeout cuts off genuinely slow endpoints] → intentional: bounded latency beats completeness for a discovery ranking; degradation is lexical ranking, not an error; warn logs carry the error class for operators.
- [Some providers return no `usage` for batches] → tokens stay null, as the single-call path already tolerates.
- [Brief cache still keyed by name, not text] → unchanged semantics; two contexts exposing same-named tools with different summaries share a vector — pre-existing behavior, not widened by this change.
- [`embeddings.ts` grows a second seam] → file stays under max-lines; if the edit crosses the limit, extract the batch impl into `src/embeddings-batch.ts` re-exported from `embeddings.ts` (the limit is a design signal, honored by split, not compression).

## Migration Plan

No DB/schema/config migration. Deploy is code-only; rollback is `git revert`. Existing warm caches behave identically; cold start after deploy pays one batched request.

## TDD / hooks

The Write/Edit TDD hook gates every new/edited `src/` file: `src/embeddings.ts`, `src/tools/disclosure/embedding-tool-retriever.ts` (and any extracted module). Test-first order (all DI-based, no `mock.module`):

1. `tests/embeddings.test.ts` (extend): timeout/maxRetries args threaded; batch usage recording.
2. `tests/tools/disclosure/embedding-tool-retriever.test.ts` (extend): batch chunking + p-limit observable via dep call shapes; single-flight join; TTL skip; lexical fallback on batch failure; model-change re-embed (existing case stays green).
3. Full `bun run test:affected` in the loop; one full suite + `bun run typecheck` + `bun run lint` before finish; mutation gate via `test:mutate:changed`.

## Open Questions

None blocking — the numeric constants (chunk size, TTL, timeout) are tunable later without spec or interface changes.
