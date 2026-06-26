<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Cross-Thread Memory Bridge & Context-Scope Corrections — Design

**Date:** 2026-06-16
**Status:** Approved (design); ready for implementation planning
**Author:** Brainstormed with Claude Code

## 1. Problem

In group chats, threads are isolated for the _live conversation_ (history, short-term
memory), while durable assets and config are group-shared. That split is mostly correct, but
it produces a real symptom: **the bot rediscovers the same small recurring details in every
new thread**, unaware it already learned them elsewhere.

The naive framing ("nothing moves short-term → long-term") is **inaccurate** and was corrected
during design. The real architecture and the real gaps:

- What the code calls "short-term memory" (`memory_facts`) is **not** an LLM fact store. It is
  a structural entity-reference cache (task/project IDs, titles, URLs) extracted automatically
  from tool results, never LLM-written, **not searchable by the LLM**, injected as a system
  block, thread-isolated. (`src/memory.ts:49`, `src/memory.ts:132`)
- The actual durable fact store is **long-term `memory_records`** — preferences/facts/decisions
  with confidence/status/kinds — written by a background LLM extraction pass and the explicit
  `remember_memory` tool, and **already group-shared** across threads via
  `resolveMemoryScope` (`src/long-term-memory/scope.ts:15`). This is what `search_memory`
  searches (`src/long-term-memory/store.ts:215`).

So a bridge already exists, but rediscovery persists because of **three concrete gaps**:

1. **Capture gap** — background extraction only fires when a conversation is long enough to
   _trim_ (`shouldTriggerTrim`, `src/llm-history.ts:34`). Short threads never trim, so their
   durable facts never reach long-term memory.
2. **Recall gap** — long-term search is **FTS5 keyword-only**; the `embedding` column exists
   but is **never populated** (dead code). Only 3 records are auto-injected per turn
   (`src/long-term-memory/context.ts:8`). Paraphrased recall fails → rediscovery.
3. **No cross-thread fallback / cascade** — nothing searches sibling threads' state; only
   `lookup_group_history` exists, and it reads main-group _history_, not memory.

Alongside the memory work, two scope choices are wrong/questionable and one DX hazard makes the
whole scope model fragile (see §5–§6).

## 2. Goals / Non-Goals

**Goals**

- Capture durable knowledge even from short threads.
- Recall it semantically, group-wide, with an explicit priority cascade.
- Promote per-thread provisional knowledge to durable group memory once it proves itself across
  threads (frequency-gated, LLM-confirmed).
- Correct the attachments and web-rate-limit scope mistakes.
- Replace the fragile, smeared scope model with a single declarative source of truth.

**Non-Goals**

- Per-thread instruction overrides (registry leaves room; behavior unchanged — deferred).
- Plugin-declared scope (deferred).
- Cross-_group_ or cross-platform memory sharing (scope stays within a single group).
- Reworking `memory_facts` (the entity-reference cache) — it stays as-is.

## 3. Decisions (locked during brainstorming)

| Decision               | Choice                                             |
| ---------------------- | -------------------------------------------------- |
| Promotion trigger      | Hybrid: frequency gates, SMALL_MODEL confirms      |
| Spec scope             | Full memory overhaul + scope/DX corrections        |
| Cascade surface        | One unified `recall` tool; server-side cascade     |
| Capture trigger        | Decoupled debounce on idle (+ scheduler backstop)  |
| Provisional data model | Reuse `memory_records` with a `provisional` status |

## 4. Memory Bridge Design

### 4.1 Data model (extend `memory_records`, one migration)

Additive only; no new table.

- `thread_context_id TEXT NULL` — origin thread for **provisional** rows; `NULL` = durable
  group record.
- `status` enum gains `'provisional'`. Existing reads filter `status='active'`, so they ignore
  provisional rows automatically (minimal blast radius).
- `evidence.threads: string[]` — distinct thread IDs a provisional fact has been seen in; this
  is the promotion counter. (`evidence` is already a JSON column.)
- `embedding BLOB` — now **populated** on every write (currently dead).

A provisional row remains `scope_type='group'`, `scope_id=<group>`; it is thread-tagged and not
yet trusted. The FTS5 virtual table `memory_records_fts` and its triggers already cover
provisional rows (same table).

### 4.2 Capture pipeline (idle-debounce — closes the capture gap)

- Decouple extraction from trim. A per-context in-memory debounce
  (`MEMORY_CAPTURE_DEBOUNCE_MS ≈ 600000`, i.e. ~10 min) re-arms on each turn; a max-turns
  fallback forces a capture in busy threads. On fire, SMALL_MODEL extracts candidate facts from
  history since a `last_extracted_at` watermark and writes them as **provisional** records.
- A small `memory_extraction_state(context_id PK, last_extracted_at, last_message_seen)` table
  holds the watermark.
- **Semantic dedup/merge on write** (embedding cosine ≥ τ, FTS fallback) against existing
  group records:
  - matches an **active** record → bump `last_seen_at` only (reinforcement), no new row;
  - matches a **provisional** record → add current thread to `evidence.threads`, bump
    confidence/`last_seen_at`, optionally refine content;
  - no match → insert a new provisional row (`thread_context_id = current`,
    `evidence.threads = [current]`).
- **Backstop:** a lightweight scheduler sweep (alongside the existing hourly maintenance)
  extracts watermark-dirty threads, covering debounce loss on restart. Existing
  trim-triggered extraction stays in place.

### 4.3 Embeddings revival (closes the recall gap)

- Populate `memory_records.embedding` on every write via
  `getEmbeddingForContext(content, configContextId)` — BYOK-aware;
  `configContextId = getConfigContextIdFromStorageContextId(storageContextId)`.
- Search becomes **hybrid**: FTS5 candidate set ∪ vector top-k by cosine, merged/reranked
  (mirrors the existing `search-memos.ts` semantic + keyword-fallback pattern).
- **Degradation:** if `EMBEDDING_MODEL` is unset or an embedding is null → **FTS-only**, exactly
  today's behavior. Recall and promotion clustering both fall back to FTS/normalized-text
  matching. The cascade never breaks.

### 4.4 The `recall` tool + server-side cascade

- New `recall(query)` tool registered in `normal` mode. It **supersedes** `search_memory`,
  which becomes a thin layer-2-only alias for backward compatibility.
- Server walks the priority order:
  1. **Layer 1 — current thread:** provisional rows for this thread + the auto-injected
     current-thread block.
  2. **Layer 2 — group long-term:** `active` group records. _Layers 1+2 always run (cheap,
     indexed)._
  3. **Layer 3 — sibling threads:** provisional rows from other threads — **only when the
     top score of 1+2 is below τ** ("if the agent reaches this point").
- Returns ranked hits, each tagged with **provenance** (`current` / `group` / `other-thread`),
  so the agent knows when it is pulling cross-thread knowledge. Layer-3 hits feed the promotion
  engine as a side effect.

### 4.5 Promotion engine (hybrid: frequency gates, LLM confirms)

- **Trigger points:** a capture-merge or a recall layer-3 hit that pushes
  `evidence.threads.length ≥ MEMORY_PROMOTION_MIN_THREADS` (default **3**).
- **Confirm:** a cheap SMALL*MODEL check — "is this a durable, general \_group* fact, not
  thread-specific/transient noise?" → boolean (+ optional refined content/kind/confidence).
- **On yes:** in a transaction, set `status='active'`, `thread_context_id=NULL`, merge
  duplicate provisional rows, bump confidence; emit a `memory:promote` debug event (counts
  only — no content).
- **On no:** set a cooldown on the row (`evidence.promotionRejectedAt`) and raise its effective
  threshold so it is not re-evaluated every turn.
- **Concurrency:** in-flight guard per scope (reuse the `src/long-term-memory/runner.ts`
  `inFlight` pattern). Promotion is a status flip in a single transaction (idempotent).

### 4.6 Maintenance & bounds

- Extend `runMemoryMaintenance` (`src/long-term-memory/maintenance.ts:45`): provisional rows
  decay faster — evict unpromoted provisional rows after `MEMORY_PROVISIONAL_TTL_DAYS`
  (default **30**); cap provisional rows per group to bound storage. Active-record decay is
  unchanged.

### 4.7 System prompt

- Short addition (≤ a few lines, budget-aware): the agent has a `recall` tool that searches
  memory in priority order (this conversation → shared group memory → other conversations);
  prefer `recall` before re-asking the user or claiming no prior knowledge.

### 4.8 Rollout / safety (memory bridge)

- The entire bridge sits behind one per-context flag `cross_thread_memory` in the reserved
  `tool_context_flags` config key (super-admin **Feature flags** section, **default OFF**),
  consistent with `result_compaction` / `progressive_disclosure`.
- **OFF ⇒ reference-identical to today:** no provisional capture, `recall` = layer-2 only, no
  promotion. Embedding population may remain always-on (harmless).

## 5. Scope Corrections

### 5.1 Attachments → group-discoverable (read side only)

- **Ingest unchanged:** `attachments.context_id` stays the thread-scoped `storageContextId`.
- **Add `group_context_id TEXT NULL`**, populated at ingest =
  `getConfigContextIdFromStorageContextId(context_id)`; migration backfills existing rows.
- **Read tools** (`list_files`, `search_staged_files`, `resolve_staged_file`) resolve across
  the group: `context_id = current OR group_context_id = <group>`, **group contexts only**
  (DMs unaffected). Threads share one audience, so this removes cross-thread reuse friction
  with no privacy change.

### 5.2 `web_rate_limit` → per-user

- Change `makeWebFetchTool` wiring (`src/tools/web-fetch.ts`, `provider-independent-tools-builder.ts:112`)
  to pass `actorUserId = chatUserId` instead of the group-stripped `storageOwnerId`. The quota
  then keys on the person, not the pooled group — one heavy user can't starve the group and the
  limit actually bounds an actor. Plumbing already supports it
  (`actorId = input.actorUserId ?? input.storageContextId`, `src/web/fetch-extract.ts:224`).
  Window-based rows age out; no migration. Ships unflagged as a correction with its own test.

## 6. Declarative Scope Source of Truth (DX)

Effective scope is currently smeared across four hand-synced places — the registry
`threadScoped` flag (`src/db/migrations/scoped-context-owned-columns.ts`), runtime strip
helpers (`getStorageOwnerId`, `getConfigContextIdFromStorageContextId`), the migration-046
backfill allowlist, and the `PARENT_SHARED_USER_CONFIG_KEYS` Set. This is what mislabeled
`user_identity_mappings` (effectively **per-user**), `web_rate_limit` (effectively **per-group**),
and `memos`/`recurring_tasks`/`user_instructions` (effectively **group**) relative to their raw
`threadScoped:true` flags.

- **One registry** — `src/chat/context-scope.ts` exporting `ENTITY_SCOPES`: each entity
  (table+column, or config key) → effective scope ∈ `thread | group | user | group+threadOverride`.
- **Derive everything from it:**
  - `getScopeKey(entity, { storageContextId, chatUserId, contextType })` — the single
    write/read key resolver, replacing scattered ad-hoc strips at runtime.
  - The **already-shipped** migration 046 stays immutable (it has run in production). Its
    constants (`DURABLE_CONTEXT_COLUMNS`, `PARENT_SHARED_USER_CONFIG_KEYS`) and
    `CONTEXT_OWNED_COLUMNS.threadScoped` are **reconciled against** the registry by a
    **consistency unit test** that fails if they disagree — a declared `group` entity can no
    longer carry `threadScoped:true`, and any future entity is declared in the registry only.
    New backfills (if needed) read from the registry.
- **Behavior-preserving refactor** except where scope is intentionally changed (attachments read
  = `group`, `web_rate_limit` = `user`), now stated explicitly in the registry.
  `user_instructions` is registered as `group+threadOverride` to leave room for the deferred
  per-thread override; base behavior stays `group`, unchanged.

## 7. Data Flow (end to end)

```
turn in thread A ──► (debounce ~10m / idle) ──► SMALL_MODEL extract
   ──► provisional memory_records (scope=group, thread=A, embedding set)
        │ semantic dedup/merge vs existing group records
        ▼
turn in thread B (same fact) ──► merge ──► evidence.threads = {A,B}
turn in thread C (same fact) ──► merge ──► evidence.threads = {A,B,C}  (≥3)
        ▼
promotion engine ──► SMALL_MODEL confirm ──► status=active, thread_context_id=NULL
        ▼
fresh thread D: recall("…") ──► Layer1 (miss) ──► Layer2 active hit (provenance=group)
        └─ bot answers from shared memory; no rediscovery
```

## 8. Error Handling

- Embedding failure → FTS fallback; never breaks recall, capture, or promotion.
- Capture/extraction or promotion SMALL_MODEL failure → logged and swallowed; never breaks a
  turn (matches the existing background-extraction posture); the row waits for the next round.
- Debounce timer lost on restart → scheduler watermark sweep recovers it.
- `EMBEDDING_MODEL` unset → whole system runs keyword-only, degraded but functional.

## 9. Testing

- **Acceptance ("stop rediscovering"):** establish a durable fact in short thread A →
  idle-debounce capture writes provisional → repeat in B and C → `evidence.threads` reaches 3
  → SMALL_MODEL confirms → promoted to `active` → fresh thread D's `recall` returns it tagged
  `group`.
- **Unit:** scope-registry consistency (vs `threadScoped`); `getScopeKey` per scope; cascade
  ordering + layer-3 early-exit; promotion threshold + confirm/reject + cooldown; provisional
  dedup/merge; embedding → FTS fallback; attachments group read; `web_rate_limit` per-user
  keying.
- **Flag-off parity:** `cross_thread_memory=OFF` is byte-identical to current behavior.
- DI-first per `tests/CLAUDE.md`; isolation-clean (no cross-file shared state, no fixed-wall-clock
  timing assertions — poll for conditions).

## 10. Configuration Defaults

| Key                                      | Default          | Meaning                                                          |
| ---------------------------------------- | ---------------- | ---------------------------------------------------------------- |
| `cross_thread_memory` (per-context flag) | OFF              | Master switch for the whole bridge                               |
| `MEMORY_PROMOTION_MIN_THREADS`           | 3                | Distinct threads before a provisional fact is promotion-eligible |
| `MEMORY_CAPTURE_DEBOUNCE_MS`             | 600000 (~10 min) | Idle debounce before capture fires                               |
| `MEMORY_PROVISIONAL_TTL_DAYS`            | 30               | Eviction age for unpromoted provisional rows                     |
| τ (recall layer-3 threshold, cosine)     | tuned in impl    | Below this, the cascade reaches layer 3                          |

## 11. Deferred / Future Work

- Per-thread `user_instructions` overrides (`group+threadOverride` already reserved).
- Plugin-declared scope (thread vs group) for `plugin_kv` / `plugin_context_state`.
- Promoting embeddings into `lookup_group_history`.

## 12. Affected Code (orientation, not exhaustive)

- `src/long-term-memory/` — `schema`/store, `scope.ts`, `runner.ts`, `extractor.ts`,
  `maintenance.ts`, `context.ts` (new: cascade, promotion, provisional handling).
- `src/db/long-term-memory-schema.ts` + new migration (columns, status, FTS unaffected).
- `src/embeddings.ts` — now wired into memory-record writes/search.
- `src/tools/memory.ts`, `src/tools/provider-independent-tools-builder.ts` — `recall` tool.
- `src/system-prompt.ts` — recall preamble.
- `src/tools/feature-flags.ts` — `cross_thread_memory` flag.
- `src/scheduler-instance.ts` — capture backstop sweep.
- Attachments store + `src/tools/workspace-files.ts` / `staged-tools.ts` — group read + new column.
- `src/tools/web-fetch.ts` — per-user actor.
- `src/chat/context-scope.ts` (new), `scoped-context-owned-columns.ts`, migration-046 derivation,
  `provider-independent-tools-builder.ts` (`getStorageOwnerId` → `getScopeKey`).
  </content>
  </invoke>
