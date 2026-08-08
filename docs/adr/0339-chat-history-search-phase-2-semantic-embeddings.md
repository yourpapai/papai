<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0339: Chat History Search Phase 2 — Semantic Embedding Search via Side Table, In-Memory Cosine, and Sweep-Only Write Path

## Status

Accepted

## Date

2026-08-06

## Context

Phase 1 (ADR-0338) gave the agent FTS5 keyword search over observed chat history. Keyword search cannot answer meaning-based queries ("what did we decide about rotating credentials?" when the actual message said "cycle the api keys"). Phase 2 adds a semantic/embedding layer so the `search_chat_history` tool can find past messages by meaning, exposed as a `keyword|semantic|auto` mode selector on the existing tool. The design is in `docs/superpowers/specs/2026-07-26-chat-history-search-phase-2-design.md`; the implementation plan is `docs/superpowers/plans/2026-07-26-chat-history-search-phase-2.md`.

The repo already had the ingredients: a BYOK `embedding` LLM role (`resolveLlmConfig` → `embedding.apiKey/baseUrl/model`), a proven embedding store pattern in `memos` (Float32 ↔ BLOB encode at `src/memos.ts`), a sweep pattern (`memory-capture-sweep`), and Phase 1's `MessageScope`/`scopeWhere`/`SearchFilters` seam for scope enforcement.

## Decision Drivers

- **No new infrastructure.** The whole data tier is one SQLite file; a vector DB or search service is unjustified for per-group corpora.
- **Scope privacy inherited from Phase 1.** Embeddings must be bounded by the same group-wide/DM-scoped `MessageScope` model; semantic search must not widen visibility.
- **sqlite-vec deferred, not rejected.** A side table behind a `MessageVectorStore` seam keeps the door open to indexed ANN later without committing to a native extension now.
- **Per-group scale is small.** In-memory cosine over a scope's embeddings is fine at expected corpus sizes; a comfort-threshold warning (`COSINE_COMFORT_WARN = 5000`) flags when to revisit.
- **Hermetic test suite integrity.** The Tier-0 story suite uses a strict one-shot embedding HTTP dispatcher; any per-message inline embed call collides with scripted expectations.
- **Cost discipline.** An embedding HTTP call on every incoming message is avoidable spend when a periodic batch sweep achieves the same coverage.
- **Never log message/query text at `info`** — query text at `debug` only, per repo logging policy.

## Considered Options

### Option 1 — Side table + in-memory cosine seam + scheduled sweep (chosen)

Migration 071 creates `message_embeddings` (composite PK `(context_id, message_id)`, nullable BLOB embedding + model/dim/timestamp provenance). A `MessageVectorStore` (`src/message-cache/vector-store.ts`) owns storage, scope-bounded loading (join to `message_metadata` to apply `scopeWhere`), in-memory cosine KNN (`cosineSimilarity` from `ai`, threshold 0.65), and pending-batch queries (NULL or model-mismatched rows). A scheduled `message-embedding-sweep` task backfills, retries failures, and re-embeds on model change, with `p-limit`-bounded concurrency across config-contexts. The tool gains `mode` (default `auto` = semantic-first with keyword fallback; `semantic` alone returns `semantic_unavailable` when no embedding model resolves).

- **Pros:** no new dependencies or native extensions; scope enforcement reuses Phase 1 SQL; sweep mirrors the proven `memory-capture-sweep` pattern; `auto` cascade mirrors `search-memos.ts`; the seam makes a future sqlite-vec swap a one-file change.
- **Cons:** O(n) scan per query within a scope (acceptable at expected scale, flagged at 5000+); embeddings lag new messages by up to one sweep interval; model changes trigger a full re-embed of the context.

### Option 2 — sqlite-vec (or another ANN index) from day one

Load the sqlite-vec extension and store vectors in an indexed virtual table for sub-linear KNN.

- **Pros:** indexed ANN; scales beyond the in-memory comfort ceiling without a redesign.
- **Cons:** a native extension to ship, load, and keep compatible across platforms for corpora that do not need it yet; adds migration and ops complexity now for a hypothetical scale problem. Explicitly deferred behind the `MessageVectorStore` seam.

### Option 3 — Inline fire-and-forget embed at the caching chokepoint

Embed each message in `cacheObservedIncomingMessage` right after caching (planned as Task 3 of the plan).

- **Pros:** zero search lag; no sweep needed for the ongoing path.
- **Cons:** an embedding HTTP call per incoming message collided with the hermetic story suite's strict one-shot `expectEmbedding` dispatcher and broke 9 Tier-0 stories; adds avoidable per-message API cost in production. **Dropped during implementation** — the sweep's `message_metadata LEFT JOIN message_embeddings` discovery covers both backfill and ongoing embedding.

## Decision

Option 1 shipped, with Option 3 explicitly rejected after an attempted implementation:

1. **Migration 071** (`src/db/migrations/071_message_embeddings.ts`) + Drizzle schema (`src/db/message-embeddings-schema.ts`, re-exported from `src/db/schema.ts`): `message_embeddings` side table with nullable BLOB embedding and `(context_id, message_id)` composite PK. Nullability encodes "pending" so the sweep discovers work by `LEFT JOIN ... WHERE embedding IS NULL`.
2. **`MessageVectorStore`** (`src/message-cache/vector-store.ts`): `storeEmbedding` (upsert), `loadEmbeddingsForScope` (joins `message_metadata`, applies Phase 1 `scopeWhere`, warns past `COSINE_COMFORT_WARN`), `searchKnn` (filter-then-score in-memory cosine, threshold 0.65), plus `pendingConfigContexts` / `nextPendingBatchForContext` / `countPending` for the sweep. Float32 ↔ BLOB encoding mirrors `src/memos.ts` exactly.
3. **Sweep** (`src/message-embedding-sweep.ts`): `runMessageEmbeddingSweep` resolves the BYOK `embedding` role per config-context, batch-embeds via `embedMany`, stores with model provenance, `p-limit(3)` across contexts; registered in `registerImmediateDefaultTasks` with `immediate: false` and a 5-minute interval. Re-embeds rows whose `embedding_model` differs from the current model.
4. **Tool extension** (`src/tools/search-chat-history.ts`): `mode: keyword|semantic|auto` (default `auto`); result `mode` is one of `keyword|semantic|keyword_fallback|semantic_unavailable`; semantic hits resolve to full rows via scope-checked `getMessage` and carry a `score`. Embeddings availability degrades to keyword silently under `auto`.
5. **Inline embed path not shipped**: `src/message-cache/embed-message.ts` and its test do not exist; `src/bot-message-caching.ts` retains its Phase-1 shape with no embed call.

## Consequences

### Positive

- The agent can find past messages by meaning, not just exact phrasing, with the same scope guarantees as keyword search.
- No new dependencies, native extensions, or infrastructure — embeddings live in the same SQLite file as everything else.
- `auto` mode gives semantic-first behavior with graceful degradation: no embedding config → keyword; no semantic hits → keyword. Users without BYOK embedding creds see no breakage.
- The sweep centralizes retries, backfill, and model-change re-embedding in one observable scheduler task; per-message write path stays cheap and synchronous.
- The `MessageVectorStore` seam confines the in-memory-cosine decision to one file; adopting sqlite-vec later is a localized change.

### Negative

- Semantic results lag new messages by up to one sweep interval (5 minutes); there is no real-time embedding path.
- Search loads all in-scope embeddings into memory per query — fine at current scale, explicitly bounded by the `COSINE_COMFORT_WARN` warning rather than a hard limit.
- Changing the embedding model silently invalidates all prior embeddings for a context; recovery is a full re-embed on the next sweep, which costs API calls proportional to history size.
- `semantic_unavailable`/`keyword_fallback` result modes leak embedding-config availability to the LLM caller — accepted as useful signal for honest answers.

### Risks

- Corpus growth past the in-memory comfort ceiling degrades search latency; mitigated by the warn log and the sqlite-vec-ready seam.
- Sweep failure modes (rate limits, endpoint down) leave rows pending indefinitely with only warn logs; mitigated by retry-on-next-run semantics and `countPending` visibility.
- Similarity threshold 0.65 is a heuristic; too high misses paraphrases, too low floods results. Tunable per call site (`searchKnn` accepts a threshold) without schema change.

## Implementation Notes

- TDD per task: migration → vector store → sweep → tool; tests at `tests/db/migrations/071_message_embeddings.test.ts`, `tests/message-cache/vector-store.test.ts`, `tests/message-embedding-sweep.test.ts`, and extended `tests/tools/search-chat-history.test.ts`.
- The tool's semantic tests use `mock.module` on `src/embeddings.js` (legacy module-mock pattern, accepted in `tests/AGENTS.md` where DI is unavailable); existing keyword tests pass `mode: 'keyword'` explicitly to stay deterministic.
- Plan Task 3 is retained in the plan file marked SUPERSEDED as a historical record — do not execute it.

## Related Decisions

- ADR-0338: Chat History Search Phase 1 — provides the `MessageScope`/`scopeWhere`/`SearchFilters` seam this phase extends, and the `search_chat_history` tool this phase modifies.
- ADR-0219: BYOK Self-Serve — the `embedding` role resolved per config-context is a BYOK credential; semantic search is unavailable without it and degrades to keyword.

## References

- Spec: `docs/superpowers/specs/2026-07-26-chat-history-search-phase-2-design.md`
- Plan: `docs/superpowers/plans/2026-07-26-chat-history-search-phase-2.md`
- Memos embedding precedent: `src/memos.ts`
- Sweep precedent: `memory-capture-sweep` (see `src/scheduler-instance.ts`)
