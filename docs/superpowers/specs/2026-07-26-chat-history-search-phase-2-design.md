<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Chat history search — Phase 2 (semantic/embedding)

**Date:** 2026-07-26
**Status:** Design approved, pending spec review

## Problem

Phase 1 (`docs/superpowers/specs/2026-07-26-chat-history-search-phase-1-design.md`)
shipped FTS5 keyword search over `message_metadata`, plus `get_message` and
`get_message_context`. Keyword search nails **exact-word** matches but fails
on **semantic recall** — when the query and the target message share no word
even though they mean the same thing ("did we talk about rotating
credentials?" should match "we should cycle the API keys"). Typos, synonyms,
and paraphrase all defeat FTS5.

The gap that matters most is exact-word failure (the primary use case);
topic clustering and ranking come along for free with dense embeddings, and
cross-lingual match is explicitly **not** a Phase-2 requirement (a
multilingual model is welcome incidentally but not demanded).

## Goal

Add a **semantic/embedding search layer** on top of the Phase 1 store that
closes the exact-word-failure gap, exposed to the agent via the existing
`search_chat_history` tool with a `mode` selector and an `auto` cascade —
mirroring the already-shipped `search_memos` tool exactly.

## What already exists (Phase 2 builds on this — no new infra)

The codebase already has a complete, battle-tested embedding stack:

- **`src/embeddings.ts`** — `getEmbeddingForContext(text, configContextId,
  ctx)` resolves the per-context **`embedding` role** (BYOK-aware: per-context
  override → admin binding → central `EMBEDDING_MODEL` env bootstrap at
  `src/llm-providers/env-bootstrap.ts:25`), returns `null` when no embedding
  model is configured, is billing-instrumented (`recordEmbeddingSuccess`/
  `recordEmbeddingFailure`), and is DI-seamed (`EmbeddingsDeps { embed }`).
- **`src/memos.ts`** stores embeddings as a nullable **BLOB** column
  (`updateMemoEmbedding` at `memos.ts:123`, Float32 ↔ Buffer round-trip at
  `memos.ts:126` and `memos.ts:180`); `loadEmbeddingsForUser`
  (`memos.ts:169`) loads them back for in-memory cosine.
- **`src/tools/save-memo.ts:33-46`** — the **fire-and-forget async embed**
  pattern (`void getEmbeddingForContext(...).then(updateMemoEmbedding)`).
- **`src/tools/search-memos.ts`** — the **hybrid `auto` cascade**
  (semantic-first → keyword fallback, `search-memos.ts:52-74`) with a `0.65`
  cosine threshold and `cosineSimilarity` from the `ai` SDK.

Phase 2 is largely "apply the proven memos pattern to `message_metadata`",
adapted for chat-history scale and the Phase 1 scope model.

## Decisions (locked during brainstorm)

| Decision | Choice |
| --- | --- |
| Primary gap | Semantic recall — exact-word failure (synonyms, typos, paraphrase) |
| Embedding source | The configured OpenAI-compatible provider via `getEmbeddingForContext` (inherits BYOK + the `embedding` role) |
| Vector storage | Side table `message_embeddings` (BLOB), behind a `MessageVectorStore` seam |
| Search at scale | In-memory cosine, **scope-bounded**; sqlite-vec indexed KNN deferred (the seam enables it) |
| Write path | Hybrid — inline fire-and-forget embed at cache-write + a scheduled sweep safety net |
| Read path | Extend `search_chat_history` with `mode: keyword\|semantic\|auto` (default `auto`) |
| Availability | "The `embedding` role resolves" — no new toggle; `auto` degrades to keyword silently |
| Retention / scope / permissions | Inherited unchanged from Phase 1 |

## Non-goals

- **No sqlite-vec / indexed ANN in Phase 2.** In-memory cosine is sufficient
  for papai's realistic per-scope volume; the `MessageVectorStore` seam makes
  the swap a later, localized change.
- **No cross-lingual as a requirement** (incidentally supported if the chosen
  embedding model is multilingual). **No cross-encoder reranking.**
- **No new quota / rate-limit gate** for embeddings. Cost is already billed
  via `embeddings.ts`; per-context quota is a later concern.
- **No user-facing `/history` command and no auto-enrichment.** Still
  agent-tool-only (unchanged from Phase 1).
- **No re-embedding on message edit/delete** — Phase 1 doesn't detect those
  events either.
- **No new env var or settings-UI surface.** The existing `embedding` role /
  `EMBEDDING_MODEL` is the only knob.

## Design

### 1. Data model — side table `message_embeddings`

A new side table, owned entirely by the new `MessageVectorStore`
(`src/message-cache/vector-store.ts`):

```sql
CREATE TABLE message_embeddings (
  context_id      TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  embedding       BLOB,                -- Float32Array, Buffer encoding per memos.ts:126
  embedding_model TEXT,                -- model that produced it; mismatch => re-embed
  embedding_dim   INTEGER,             -- dimensionality guard
  embedded_at     TEXT,                -- ISO timestamp
  PRIMARY KEY (context_id, message_id)
);
```

The composite PK mirrors `message_metadata`'s PK
(`src/db/schema.ts:183`), so each embedding row is a 1:1 satellite of a
content row. `message_metadata` itself is **not modified** — keeping the
content table lean (it is read on every cache hit / `get_message`).

**Why a side table, not an on-row BLOB (like memos):** Phase 2 chose the
**seam** approach precisely so the eventual sqlite-vec swap is surgical. A
side table means that swap replaces one module (`vector-store.ts`) + one
table and never touches the primary content table. The cost is one join at
search-load time — negligible, since the cosine impl loads a scope's
embeddings in one query regardless.

**Migration `071_message_embeddings`** (next after `070_message_metadata_
history_search`): `CREATE TABLE message_embeddings (...)` + register in the
migration-registration test. Nullable everywhere; **no data backfill** — the
sweep (§3) converges the existing Phase-1 cache for free.

### 2. The seam — `src/message-cache/vector-store.ts`

A focused module with one job (vector storage + scope-bounded cosine
search), isolating the storage strategy from the read API and the tools:

- `storeEmbedding(ctxId, msgId, vec: Float32Array, model: string, dim:
  number): void` — upsert (the PK makes it idempotent on retry). `ctxId` is
  the thread-scoped `context_id` (the `message_metadata` PK column), **not**
  the group config-context id — the side-table PK must mirror
  `message_metadata`'s so the join in `loadEmbeddingsForScope` keys
  correctly. (The config-context id is used only to *resolve the embedding
  model* via `getEmbeddingForContext`.)
- `loadEmbeddingsForScope(scope: MessageScope): { messageId: string; vec:
  Float32Array; authorId: string | null; timestamp: number; contextId:
  string }[]` — joins `message_metadata` to apply the shared `scopeWhere`
  (`src/message-cache/store.ts:44-47`) **and** carries the filterable columns
  so the existing `SearchFilters` can apply to the semantic candidate set.
  Emits a `warn` if the scope returns more than ~5 000 embeddings (the
  documented sqlite-vec swap trigger — see §6).
- `searchKnn(queryVec: number[], scope, filters: SearchFilters, limit:
  number, threshold = 0.65): { messageId: string; score: number }[]` — loads
  the scope, applies filters, computes `cosineSimilarity` (from the `ai`
  SDK, as in `search-memos.ts:27`), filters `≥ threshold`, sorts desc,
  slices `limit`. Pure function of the loaded set — no indexed KNN.
- `nextPendingBatch(limit: number, currentModel: string): row[]` /
  `countPending(currentModel: string): number` — rows where `embedding IS
  NULL` **or** `embedding_model != currentModel`. Feeds the sweep (§3):
  pre-Phase-2 backfill, inline-failure retries, and model-change re-embeds
  in one query.

Everything here is the BLOB + in-memory-cosine implementation. A future
`sqlite-vec` variant implements the same surface against a virtual table —
no tool or `store.ts` change.

### 3. Write path — hybrid inline + scheduled sweep

Composes the two patterns already in the codebase.

**Inline (mirrors `save-memo.ts:33-46`):** in the Phase-1 chokepoint
`cacheObservedIncomingMessage` (`src/bot-message-caching.ts`), immediately
after the content row is inserted, kick off fire-and-forget embedding:

```ts
void getEmbeddingForContext(text, configContextId, ctx)
  .then((vec) => {
    if (vec !== null) {
      store.storeEmbedding(ctxId, msgId, new Float32Array(vec), model, dim)
    }
  })
  .catch((e) => log.warn({ messageId }, 'inline embed failed; sweep will retry'))
```

- `getEmbeddingForContext` returns `null` when no embedding model resolves
  → the row is simply left without an embedding; the sweep still ignores it
  (nothing to embed until a model is configured), and `auto` search falls
  back to keyword. **Never blocks caching.**
- Only precondition: non-empty text. Phase 1 already skips command/empty
  messages at the chokepoint, and it caches only **incoming** messages, so
  the bot's own outgoing replies are out of scope — no bot-vs-human filter.

**Sweep safety net (mirrors `sweepDirtyContexts` / `memory-capture-sweep`):**
a new scheduler task `message-embedding-sweep`, registered in
`registerDefaultSchedulerTasks` (`src/scheduler-instance.ts:82`) alongside
the other default tasks, interval ~5 min. Handler:

1. Resolve the current embedding model name (central or per-context — the
   sweep processes contexts in batches, resolving each context's model via
   the role resolver).
2. `nextPendingBatch(limit, currentModel)` — NULL embeddings **and**
   model-mismatched rows (re-embeds on model change in the same pass).
3. Batch-embed via the AI SDK **`embedMany`** (the batch endpoint — cheaper
   and faster than per-row; memos only does single `embed`, but a sweep
   over many rows wants batching). *(De-risk: confirm `embedMany` is
   exported by the installed `ai` version during planning; fall back to
   bounded `p-limit` over `embed` if not.)*
4. Bounded concurrency with `p-limit` (repo convention). Store results.
5. `info`-log `countPending()` (count only); per-row at `debug`.

**Why both:** inline gives sub-second searchability; the sweep guarantees
convergence — failures retry, the pre-Phase-2 cache backfills with no
separate migration step, and a model change is handled by the
`embedding_model != current` predicate. No special backfill command.

### 4. Read path — extend `search_chat_history`

`search_chat_history` (`src/tools/search-chat-history.ts`) gains one
optional parameter and an enriched result shape, mirroring `search_memos`:

- **Input:** add `mode?: 'keyword' | 'semantic' | 'auto'` (default `'auto'`).
  All existing params (`query`, `limit`, `author`, `since`, `until`,
  `contextId`) unchanged.
- **Output:** results gain `score?: number` (semantic only) and the payload
  gains `mode: 'keyword' | 'semantic' | 'keyword_fallback' |
  'semantic_unavailable'` so the agent can tell which path ran. The
  embedding vector is **never** returned to the LLM.

**`auto` cascade (adapted from `search-memos.ts:52-74`):**

1. `mode === 'keyword'` → Phase-1 FTS5 path, unchanged (`mode: 'keyword'`).
2. `getEmbeddingForContext(query, …)`:
   - `null` (no model / API down) → `semantic` mode returns
     `{ results: [], mode: 'semantic_unavailable' }`; `auto` falls back to
     keyword (`mode: 'keyword_fallback'`).
   - a vector → `searchKnn(vec, scope, filters, limit)`; ≥1 hit →
     `{ results, mode: 'semantic' }`; 0 hits in `auto` → keyword fallback.
3. Threshold `0.65` (memos' value) as a tool constant for v1.

**Scope & filters:** identical to Phase 1. `searchKnn` takes the same
`MessageScope`; `loadEmbeddingsForScope` applies `scopeWhere` in the join,
so no out-of-scope row can ever score. `author`/`since`/`until`/`contextId`
filters apply to the candidate set before scoring (carried by the loader).

**`get_message` / `get_message_context` are untouched** — they read
`message_metadata`, never the side table.

### 5. Availability, permissions, privacy (all inherited)

- **Availability = "the `embedding` role resolves."** No new toggle. Adding
  `EMBEDDING_MODEL` (env) or a BYOK `embedding` binding turns semantic on;
  removing it makes `auto` silently behave as keyword.
- **Permissions / guest mode:** unchanged. Same `search_chat_history` tool,
  same `tool_prefs` entry, still excluded from the guest read-only toolset
  by default. The new `mode` param does not change the permission model.
- **Privacy:** identical to Phase 1 — embeddings never leave the local DB;
  the only egress is the embedding API call (text → vector), already a
  sanctioned, billed path via `embeddings.ts`. The `/stats` anonymity
  contract is untouched (it never read content; it still doesn't read
  vectors).

### 6. Scale ceiling (observable, documented)

In-memory cosine is O(N) per query in the scope's embedding count. For
papai's realistic per-group volume this is fine for a long time, but it is
not unbounded. The boundary is made explicit and observable:

- `loadEmbeddingsForScope` emits a `warn` when a scope returns more than
  ~5 000 embeddings ("scope exceeding cosine-comfort threshold; consider
  enabling sqlite-vec").
- That warning is the documented trigger for the sqlite-vec swap. Because
  all vector storage/search lives behind `MessageVectorStore`, the swap
  replaces only `vector-store.ts` + the `message_embeddings` table — no
  tool, no `store.ts`, no migration of `message_metadata`.

### 7. Error handling & logging

- Embed-API failure at write time → `getEmbeddingForContext` returns `null`
  (inline) or the batch item fails (sweep) → row stays embedding-less;
  search skips it; sweep retries. **Never blocks caching or search.**
- Semantic path with zero results / unavailable → `auto` falls back to
  keyword; `semantic` mode returns `semantic_unavailable`. Never throws to
  the LLM (`wrapToolExecution` normalizes regardless).
- **Logging discipline** (Phase-1 rule holds): `debug` entry/params,
  `info` success with counts/lengths only, `warn` on degraded/empty,
  `error` on DB failures. **Never log message text or query text at
  `info`** (query at `debug` only, as in Phase 1). The sweep logs
  `countPending()` at `info`.

## Testing

TDD per `tests/CLAUDE.md` and the write-hook pipeline.

- **`vector-store.test.ts`**: Float32 ↔ Buffer round-trip; scope-bounding
  via the join (group A cannot see group B's vectors); `SearchFilters`
  applied to the candidate set; threshold filter + sort; model-mismatch
  detection in `nextPendingBatch`; `countPending` accuracy; the 5 000-row
  warn boundary.
- **Tool tests** (extend `search-chat-history.test.ts`): `auto` → semantic
  hit; `auto` → keyword fallback when no embedding model resolves;
  `auto` → keyword fallback when semantic returns 0 hits; `semantic` →
  `semantic_unavailable`; `keyword` mode unchanged; results carry
  `score`/`mode`; out-of-scope returns nothing in both paths.
- **`message-embedding-sweep.test.ts`**: batch embeds NULL rows; retries
  inline-failure rows; re-embeds model-mismatched rows; bounded
  concurrency; a transient embed failure leaves rows pending (retried next
  tick) without crashing the sweep.
- **Migration test** (`071_…test.ts`): table created; registered in the
  migration-registration list.
- **Integration**: cache a message via the chokepoint → inline embed lands
  → `search_chat_history` `auto` returns it by meaning (no shared word);
  cross-context isolation end-to-end (semantic path); existing Phase-1
  keyword tests stay green.

## Constraints respected

- Reuses `getEmbeddingForContext` (BYOK + `embedding` role + billing) — no
  new embedding plumbing.
- Reuses the memos Float32-BLOB encoding and the `cosineSimilarity` helper
  from the `ai` SDK — no new vector math.
- Reuses the Phase-1 `MessageScope` / `scopeWhere` — scope symmetry between
  write and read is preserved; no skew.
- Reuses the scheduler default-task registration pattern and the
  long-term-memory sweep pattern — no new background-job mechanism.
- Strict TS, `.js` import paths, pino structured logging, `p-limit`
  concurrency, BUSL-1.1 headers — all repo conventions hold.

## Out of scope / follow-ups (later phases)

- **sqlite-vec indexed KNN** — the `MessageVectorStore` seam enables it as a
  localized swap once a scope crosses the ~5 000-embedding comfort line.
- **Cross-encoder reranking** and **cross-lingual as a hard requirement**.
- **Per-context embedding quota / rate-limiting.**
- **User-facing `/history` command + auto-enrichment** of incoming messages.
- **Re-embedding on message edit/delete** (blocked on Phase-1 event
  detection).
- **Platform on-demand history backfill** (Discord/Mattermost REST) — the
  deferred data-source option from Phase 1.
