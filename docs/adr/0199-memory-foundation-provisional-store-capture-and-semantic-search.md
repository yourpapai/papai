<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0199: Memory Foundation — Provisional Store, Capture, and Semantic Search

## Status

Implemented

## Date

2026-06-16

## Context

The cross-thread memory bridge spec (`docs/superpowers/specs/2026-06-16-cross-thread-memory-and-context-scope-design.md`) traced the "bot rediscovers the same recurring details in every new group thread" symptom to three concrete gaps: a **capture gap** (background extraction only fires on trim via `shouldTriggerTrim`, so short threads never reach long-term memory), a **recall gap** (the `memory_records.embedding` column existed but was never populated — dead code — and search was FTS5 keyword-only), and **no cross-thread fallback** (only `lookup_group_history` existed, reading main-group history, not memory).

Plan 1 ("Memory Foundation") is the infrastructure layer closing the capture and embedding halves of those gaps. It adds a `provisional` record tier to `memory_records`, decouples extraction from trim via an idle-debounce capture pipeline, populates embeddings on every write, and backs the in-memory debounce with a scheduler watermark sweep. It is deliberately **infrastructure-only**: it captures provisional records but does not yet surface them — the user-visible `recall` cascade and promotion engine are Plan 2.

The bridge originally shipped behind a per-context `cross_thread_memory` feature flag (default OFF, reference-identical to today). That flag was later removed by plan `2026-06-18-remove-cross-thread-memory-flag` to make the bridge **always-on**; capture now self-gates on group context + thread-scoped storage context + the memory-profile `enabled` toggle (per-context "Disable capture" in the settings Memory section), not a global feature flag.

## Decision Drivers

- **Capture from short threads**: decouple durable-fact extraction from the trim path so threads that never trim still reach long-term memory.
- **Minimal blast radius**: additive schema only; existing `status='active'` reads must ignore provisional rows by default.
- **Embeddings as first-class**: revive the dead `embedding` column with graceful FTS fallback so recall never breaks when `EMBEDDING_MODEL` is unset or an embedding is null.
- **Restart resilience**: in-memory debounce timers are lost on restart; a scheduler sweep over a persisted watermark table must recover dirty contexts.
- **DI-first testability**: every layer injects clock, scheduler, embedding, and extractor deps per `tests/CLAUDE.md` so suites need no wall-clock or network.
- **Flag-gated then promoted**: ship behind a flag for safe rollout, then remove the flag once the bridge is stable (executed by the later removal plan).

## Considered Options

### Option A: Reuse `memory_records` with a `provisional` status + `thread_context_id` (chosen)

- **Pros:** additive schema; existing reads filter `status='active'` so provisional rows are invisible by default; the FTS5 virtual table `memory_records_fts` and its triggers already cover the same table; one migration; promotion becomes a status flip, not a cross-table move.
- **Cons:** widens the `status` CHECK constraint — SQLite cannot ALTER a CHECK in place, forcing a table-recreation migration (RENAME → recreate → `INSERT…SELECT` → DROP old → rebuild FTS5), heavier than a purely additive migration.

### Option B: A separate `provisional_memory_records` table

- **Pros:** no CHECK-constraint rewrite; clean separation of provisional vs durable rows.
- **Cons:** duplicates the schema/store/search/maintenance code paths; promotion becomes a cross-table move instead of a status flip; FTS5 + embeddings need a second virtual table and a second store module.

### Option C: Capture only on trim (status quo)

- **Pros:** zero new infrastructure.
- **Cons:** short threads never trim → durable facts never captured → the spec's primary symptom is unaddressed.

## Decision

**Migration 056 — table-recreation, not a simple ALTER.** `memory_records.status` CHECK is widened to include `'provisional'`; a nullable `thread_context_id TEXT` column + `idx_memory_records_thread(scope_id, thread_context_id, status)` index are added; a new `memory_extraction_state(context_id PK, context_type, config_context_id, last_activity_at, last_extracted_at, last_history_len)` watermark table is created. Because recreation reassigns rowids and would desync the external-content FTS5 index, the migration rebuilds it (`INSERT INTO memory_records_fts(...) VALUES('rebuild')`). Registered last in `MIGRATIONS` in `src/db/index.ts`; regression-guarded by `tests/db/migration-056-fts-rebuild.test.ts`.

**Domain types.** `MemoryStatusSchema` gains `'provisional'`; `MemoryEvidence` gains `threads?: readonly string[]` (the promotion counter — distinct thread IDs a provisional fact has been seen in); `MemoryRecord`/`MemoryRecordInput` gain `threadContextId?: string | null`.

**Provisional store** (`src/long-term-memory/provisional-store.ts`, re-exported from `store.ts`): `listProvisionalRecords(filter)` selects `status='provisional'` rows for a scope, with optional `threadContextId` / `excludeThreadContextId` / `limit`, ordered by `lastSeenAt` desc. (Plan 2 later added `promoteProvisionalToActive` and `markPromotionRejected` here.)

**Semantic search** (`semantic-search.ts`): `cosineSimilarity(a, b)` and `rankRecordsBySimilarity(scope, queryEmbedding, { threshold=0.65, limit=10, statuses=['active'] })` — converts the stored `embedding` BLOB to `Float32Array`, scores, drops below threshold, sorts desc, slices to limit, and rehydrates full `MemoryRecord`s via `listMemoryRecords`.

**Embedding writer** (`embedding-writer.ts`): `saveMemoryRecordWithEmbedding(input, configContextId, deps)` saves the row synchronously, then **awaits** the BYOK-aware embedding (`getEmbeddingForContext`) and persists it as a `Buffer`-backed `Float32Array`. It never throws on embed failure (logs `warn`, FTS fallback). Awaiting completion lets promotion clustering rely on the embedding being present.

**Capture executor** (`capture.ts`): `runMemoryCapture(input, deps)` gates on `contextType === 'group'` + `hasThreadContextId` + the memory-profile `enabled` flag, runs the shared `extractMemoryPatch` extractor (LLM config resolved via `resolveEffectiveLlmConfig` + `buildChatModel`; returns an empty patch when config is unavailable), and writes each extracted fact as a `provisional` group-scoped record with `threadContextId = storageContextId` and `evidence.threads = [storageContextId]`, then updates the watermark via `markExtracted`.

**Idle debounce** (`capture-debounce.ts`): `armMemoryCapture(input, deps)` records activity (`markActivity`), clears any pending timer for the context, and schedules a debounced `runMemoryCapture` (`MEMORY_CAPTURE_DEBOUNCE_MS = 600_000` ≈ 10 min). Rapid arms coalesce into a single deferred capture. Wired unconditionally into `src/llm-history.ts` after the existing trim/extraction block on every group-thread turn (self-gates on group context).

**Extraction-state watermarks** (`extraction-state.ts`): `markActivity` (upsert), `markExtracted` (update), `listDirtyContexts(now, idleMs = DEFAULT_IDLE_MS)` — contexts where `last_activity_at ≤ now - idleMs` AND (`last_extracted_at IS NULL` OR `last_activity_at > last_extracted_at`).

**Scheduler backstop** (`capture-sweep.ts`): `sweepDirtyContexts(now, deps)` iterates `listDirtyContexts`, loads each context's history via `getCachedHistory`, and runs capture; registered as `memory-capture-sweep` (5-min interval, `immediate: false`) in `src/scheduler-instance.ts`.

## Consequences

### Positive

- Durable facts are captured from short threads that never trim, closing the capture gap.
- Embeddings are populated on every write; `rankRecordsBySimilarity` enables the semantic recall Plan 2 builds on.
- Additive schema; existing `status='active'` reads ignore provisional rows, so the blast radius of the new tier is near zero.
- In-memory debounce timers lost on restart are recovered by the 5-min scheduler sweep over the persisted watermark table.
- DI-first deps (clock, scheduler, embedding, extractor, UUID) make every layer unit-testable without wall-clock timing or network.

### Negative

- Migration 056 is a table-recreation, not a simple `ALTER … ADD COLUMN`, due to SQLite CHECK-constraint limits; it rebuilds the FTS5 external-content index, making it heavier than a purely additive migration and requiring a dedicated rowid-resync regression test.
- Capture runs the SMALL_MODEL extractor per idle context, adding background LLM cost proportional to group/thread activity.
- `rankRecordsBySimilarity` scans all scope rows into memory before scoring/limiting (the `limit` applies only post-filter), so a group with many records pays an unbounded pre-filter scan.

### Risks

- A busy group with many threads could accumulate provisional rows faster than Plan 2's promotion prunes them; `MEMORY_PROVISIONAL_TTL_DAYS` maintenance (Plan 2) bounds the growth.
- Embedding model drift: if `EMBEDDING_MODEL` changes, historical embeddings are stale relative to new queries; the system degrades to FTS rather than failing, but recall quality drops until records are re-embedded.
- The original `cross_thread_memory` flag was removed to make the bridge always-on; capture is now gated only by group context + the memory-profile `enabled` flag, so disabling capture is per-context, not global — an operator who wants it off everywhere must toggle each context (or set `TOOL_CONTEXT_REDUCTION_DISABLED`, which does not affect memory capture).

## Related Decisions

- **ADR-0193: Long-Term Memory** — the durable `memory_records` store this foundation extends; ADR-0193 already cites ADR-0199 as the capture-pipeline extension adding the idle-debounce capture and `memory_extraction_state` watermark (migration 056).
- **ADR-0161: Storage Context Sharing (Group Thread Entities)** — the thread-isolated vs group-shared scope model the provisional tier relies on (`scope_type='group'`, `thread_context_id`-tagged but group-scoped).
- **ADR-0200: Cross-thread memory bridge (recall cascade)** — planned; Plan 2 builds the `recall` tool and the current-thread → active group → sibling-thread cascade on `rankRecordsBySimilarity` + `listProvisionalRecords`.
- **ADR-0201: Cross-thread memory bridge (promotion)** — planned; Plan 2 adds the frequency-gated (`MEMORY_PROMOTION_MIN_THREADS = 3`), SMALL_MODEL-confirmed promotion of provisional facts clustered across ≥3 threads to active group memory.

## Implementation Notes

Key files (confirmed present in `src/`):

- `src/db/migrations/056_provisional_memory.ts` — table-recreation migration (RENAME at `:94`, FTS5 `rebuild` at `:100`).
- `src/db/long-term-memory-schema.ts` — `provisional` status enum (`:47`), `memoryExtractionState` table + `MemoryExtractionStateRow` (`:68`, `:77`).
- `src/long-term-memory/provisional-store.ts` — `listProvisionalRecords` (`:20`); later `promoteProvisionalToActive` (`:47`), `markPromotionRejected` (`:73`); re-exported from `store.ts` (`:37-41`).
- `src/long-term-memory/semantic-search.ts` — `cosineSimilarity` (`:24`), `rankRecordsBySimilarity` (`:41`).
- `src/long-term-memory/embedding-writer.ts` — `saveMemoryRecordWithEmbedding` (`:40`).
- `src/long-term-memory/capture.ts` — `runMemoryCapture` (`:99`); gates on `hasThreadContextId` (`:103`) + memory-profile `enabled` (`:106`).
- `src/long-term-memory/capture-debounce.ts` — `MEMORY_CAPTURE_DEBOUNCE_MS` (`:12`), `armMemoryCapture` (`:47`).
- `src/long-term-memory/extraction-state.ts` — `DEFAULT_IDLE_MS` (`:13`), `markActivity` (`:22`), `markExtracted` (`:44`), `listDirtyContexts` (`:56`).
- `src/long-term-memory/capture-sweep.ts` — `sweepDirtyContexts` (`:27`).
- `src/scheduler-instance.ts` — `memory-capture-sweep` registration (`:75`).
- `src/llm-history.ts` — `armMemoryCapture` import (`:12`) and call (`:46`).

Divergences from the plan as written:

- The plan's file-structure table placed `listProvisionalRecords` in `store.ts`; it shipped in a dedicated `provisional-store.ts` (re-exported from `store.ts`), which also hosts Plan 2's `promoteProvisionalToActive`/`markPromotionRejected`.
- The plan's Task 3 added a `cross_thread_memory` feature flag (default OFF) in `feature-flags.ts`; that flag was later removed by plan `2026-06-18-remove-cross-thread-memory-flag` to make the bridge always-on. `capture.ts`/`capture-debounce.ts` no longer reference `flagEnabled`/`resolveCrossThreadMemoryFlag`; `grep` for `cross_thread_memory|crossThreadMemory|resolveCrossThreadMemoryFlag` in `src/` returns zero matches. Capture now self-gates on `contextType === 'group'` + `hasThreadContextId` + the memory-profile `enabled` flag.
- The plan's inline correction (plan lines 147) is borne out: the shipped migration uses the table-recreation pattern because migration 053's `status` CHECK constraint could not accept `'provisional'`, and FTS5 rowids must be resynced.

The spec (`docs/superpowers/specs/2026-06-16-cross-thread-memory-and-context-scope-design.md`) is intentionally **not** archived — it remains shared by the recall-cascade-and-promotion and scope-corrections-and-registry plans still in `docs/superpowers/plans/`.
