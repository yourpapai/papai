<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0193: Long-Term Memory

## Status

Implemented

## Date

2026-06-11

## Context

papai had four memory primitives — conversation history with `memory_summary`, `memory_facts` (entity pointers), `memos` (explicit user notes with FTS5), and `user_instructions` — but no layer that _learned durable context in the background_. The summary was short-term narrative; `memory_facts` tracked recently accessed task entities, not learned knowledge; memos and instructions were user-initiated. The missing capability was a default-on, controllable long-term memory layer that captures stable personal and group context after conversations, keeps it organized, makes it retrievable, and retires stale memories so they stop polluting every turn.

The 2026-06-11 design (`docs/superpowers/specs/2026-06-11-long-term-memory-design.md`) specified a hybrid **pinned profile + memory records** model: a small always-injected profile projection plus individual typed, timestamped, searchable records recalled by tools or a bounded relevance pass. The implementation plan (`docs/superpowers/plans/2026-06-11-long-term-memory.md`) broke this into nine TDD tasks: schema/migration, scope normalization, store, bounded context injection, background extraction, agent tools, settings API, settings UI, and decay maintenance.

A key scope decision: long-term _group_ memory normalizes thread-scoped Telegram/Mattermost contexts up to the parent group, so a fact learned in one thread is available in another thread of the same group — while short-term conversation history stays thread-isolated. This matches the storage-context sharing model from ADR-0161 but applies it specifically to durable memory.

## Decision Drivers

- **Default-on, non-blocking capture:** memory extraction runs after the assistant replies and never delays the user-facing response.
- **Bounded default context:** the prompt must stay small; deeper memory is retrieved just-in-time through tools.
- **Personal/group isolation with cross-thread group sharing:** a group turn never reads private personal memory, and a DM never reads group memory — but group memory is shared across the group's threads.
- **Decay and retirement:** records lose authority before disappearing; staleness is kind-specific and maintenance is scheduled.
- **Trust labelling and safety:** injected memory is rendered as lower-trust data, never as instructions; profile and record content are never logged; evidence stores pointers, not raw message text.
- **Fit existing primitives:** SQLite + FTS5 + in-app cosine similarity, the existing scheduler, settings auth/CSRF model, and tool-permission gating.

## Considered Options

### Option A: Pinned profile only (rejected)

Keep only a synthesized profile, no individual records.

- **Pros:** smallest prompt; simplest storage; no retrieval plumbing.
- **Cons:** too likely to either grow noisy or lose important detail; no way to recall specific memories on demand; contradictions and per-record decay are impossible to model.

### Option B: Temporal knowledge graph (rejected)

Store memories as typed nodes and edges with a graph traversal engine.

- **Pros:** powerful temporal reasoning; relationships first-class; future-proof.
- **Cons:** overbuilt for the first version; expensive to design correctly; SQLite + FTS5 is sufficient at current scale. The schema preserves `valid_from`/`valid_until`/`expires_at` and evidence to keep the graph door open without building traversal.

### Option C: Hybrid profile + memory records (chosen)

A pinned profile plus individual searchable records.

- **Pros:** agents get immediate high-signal context while detail stays out of the prompt until relevant; per-record status/confidence/decay; conservative background capture with explicit hot-path tools; fits SQLite + FTS5.
- **Cons:** more moving parts (extraction runner, maintenance, settings controls); profile/record drift requires periodic regeneration.

## Decision

Implement the hybrid profile + memory records design across nine coordinated changes:

### 1. Schema and migration (`053_long_term_memory`)

Two tables: `memory_profiles` (one pinned profile per normalized scope: `scope_id`, `scope_type`, `profile`, `enabled`, `version`, `updated_at`) and `memory_records` (typed records: `kind` ∈ 8 values, `content`/`summary`, `tags` JSON, `confidence` 0–1, `status` ∈ active/stale/archived/contradicted, `source` ∈ background/explicit/tool_result/admin_edit, `evidence` JSON, timestamps, validity/expiry windows, optional `embedding` blob). Indexes on `(scope_id, status, last_seen_at)` and `(scope_id, kind, status)`. An FTS5 virtual table over `content`/`summary`/`tags` kept in sync by `memory_records_ai`/`_au`/`_ad` triggers. Drizzle schema lives in `src/db/long-term-memory-schema.ts` to keep `src/db/schema.ts` under the max-lines rule; `schema.ts` re-exports `memoryProfiles`/`memoryRecords`.

### 2. Scope normalization (`src/long-term-memory/scope.ts`)

`resolveMemoryScope({ storageContextId, contextType })` returns `{ scopeId, scopeType }`. DMs use the personal scope directly; group contexts normalize to the config-context id (`getConfigContextIdFromStorageContextId`), so Telegram/Mattermost thread-scoped storage contexts roll up to the parent group. Discord group channels (not thread-scoped) pass through unchanged.

### 3. Store (`src/long-term-memory/store.ts`)

Profile CRUD (`getMemoryProfile`/`saveMemoryProfile`/`setMemoryCaptureEnabled`) and record CRUD (`saveMemoryRecord`/`listMemoryRecords`/`searchMemoryRecords`/`archiveMemoryRecord`/`clearMemoryScope`). FTS query sanitization mirrors `src/memos.ts`. `searchMemoryRecords` filters by `scope_id`, includes `active` by default, and includes `stale` only when `includeStale` is true.

### 4. Bounded context injection (`src/long-term-memory/context.ts`)

`buildLongTermMemoryContextMessage({ profile, records })` renders a single `<long_term_memory trust="profile_and_retrieved_low">` system block: profile (truncated to 4 000 chars) and at most three records (each truncated to 800 chars), with staleness and trust guidance. Returns `null` when both are empty. `src/conversation.ts` merges this with the existing compacted-memory system message via `mergeMemoryMessages`.

### 5. Background extraction (`src/long-term-memory/extractor.ts`, `runner.ts`)

`parseMemoryPatch` extracts a Zod-validated patch (`MemoryPatchSchema`: `profile`, `records[]`, `updates[]`) from model output, rejecting malformed JSON and out-of-range confidence. `runMemoryExtractionInBackground` resolves the normalized scope, guards against concurrent runs with a per-`scopeId` `inFlight` set, respects the profile `enabled` flag, applies the patch (saving profile, inserting records with generated UUIDs, applying status/content/confidence updates), and logs only counts and scope IDs. `src/llm-history.ts` triggers extraction after the assistant history append fires a trim.

### 6. Agent tools (`src/tools/memory.ts`)

Four factories registered in `src/tools/provider-independent-tools-builder.ts`: `makeSearchMemoryTool` (FTS, `include_stale` default false), `makeRememberMemoryTool` (writes an `explicit` active record immediately), `makeForgetMemoryTool` (archives by `memory_id` or best match by query), `makeListMemoryTool` (list by optional `kind`/`status`). All operate on `resolveMemoryScope` of the current context. Metadata added to `src/tools/tool-metadata.ts` under a new `memory` domain (`search`/`list` = read, `remember` = write, `forget` = destructive).

### 7. Settings API (`src/debug/settings/memory-routes.ts`)

`GET /settings/api/memory` returns profile + active records; `PATCH /settings/api/memory/profile`, `PATCH /settings/api/memory/capture` (enable/disable), `POST /settings/api/memory/clear`, `DELETE /settings/api/memory/records/:id`. Each write handler authenticates, verifies CSRF, resolves context scope via `resolveContextScope(principal, 'write', ...)`, converts to a memory scope, and logs only scope ID, action, and counts.

### 8. Settings UI (`client/settings/sections/MemorySection.svelte`)

Svelte section rendering the pinned profile (editable textarea), capture toggle, clear button, and the record list with kind/status/source/timestamp pills. Wired into `SettingsApp.svelte` after Profile.

### 9. Decay maintenance (`src/long-term-memory/maintenance.ts`)

`runMemoryMaintenance` marks records stale by kind-specific windows (preference/procedure 180d, decision/project_context/person_context/fact 90d, episode/reference 45d; explicit memories exempt) and archives records whose `expires_at` has passed. Registered as `long-term-memory-maintenance` in `src/scheduler-instance.ts` at a 1-hour interval.

## Consequences

### Positive

- Durable personal and group memory is captured automatically without delaying replies.
- Group memory is shared across threads via scope normalization, so learned context is not rediscovered per thread.
- Default prompt stays bounded (≤3 records + a 4 000-char profile) while deeper memory is tool-retrievable.
- Stale memories decay to lower authority and are archived on expiry, preventing unbounded prompt pollution.
- Full admin/user controls (view, edit, archive, clear, disable capture) respect the existing authorization and tool-permission model.
- Memory content is trust-labelled and rendered as data, never as instructions; content is never logged.

### Negative

- **Background extractor adds LLM cost and latency.** Each trim-triggered extraction is a SMALL_MODEL call; the per-scope `inFlight` guard bounds concurrency but not total volume. Capture can be disabled per context via the profile `enabled` flag.
- **FTS5 keyword search only at this layer.** Embedding-backed semantic search and the recall cascade were added by later extensions (migration 056, `recall-cascade.ts`), not this plan.
- **Profile/record drift.** The pinned profile is a projection; without periodic regeneration it can lag behind active records. Maintenance regenerates opportunistically, not on a strict schedule.

### Risks

- **Prompt-injection-shaped memory content.** Mitigated by trust labelling and data-mode rendering, but a record that contradicts the live user message could still mislead a model that ignores the trust label. Stale records carry explicit `status="stale"` guidance to verify before relying on them.
- **Scope normalization bugs.** A misnormalized group scope would either leak one group's memory into another or fail to share across threads. Covered by scope normalization tests for Telegram/Mattermost thread rollup and personal isolation.

## Related Decisions

- ADR-0161: Storage Context Sharing (Group Thread Entities) — the scope normalization model this layer builds on.
- ADR-0199: Cross-thread memory bridge (capture) — later extension adding the idle-debounce capture pipeline (`capture.ts`/`capture-debounce.ts`) and `memory_extraction_state` watermark (migration 056), beyond this plan's synchronous trim-triggered extraction.
- ADR-0200: Cross-thread memory bridge (recall cascade) — later extension adding `recall-cascade.ts` (current-thread provisional → active group → sibling-thread provisional) and embedding-backed semantic search, replacing this plan's plain FTS-only `search_memory`.
- ADR-0201: Cross-thread memory bridge (promotion) — later extension promoting provisional facts clustered across ≥3 threads to active group memory (`promotion.ts`), introducing the `provisional` status and `thread_context_id` columns.
- ADR-0206: Consolidate recall — later reconciliation of the retrieval cascade paths.

## Implementation Notes

Key files confirmed present:

- `src/db/migrations/053_long_term_memory.ts` — `migration053LongTermMemory` (registered in `src/db/index.ts:163`).
- `src/db/long-term-memory-schema.ts` — Drizzle `memoryProfiles`/`memoryRecords` (re-exported from `src/db/schema.ts:78`).
- `src/long-term-memory/scope.ts:15` — `resolveMemoryScope`.
- `src/long-term-memory/store.ts:121` — `saveMemoryRecord` (plus `getMemoryProfile`/`listMemoryRecords`/`searchMemoryRecords`/`archiveMemoryRecord`/`clearMemoryScope`).
- `src/long-term-memory/context.ts:52` — `buildLongTermMemoryContextMessage`.
- `src/long-term-memory/extractor.ts:112` — `parseMemoryPatch`.
- `src/long-term-memory/runner.ts:210` — `runMemoryExtractionInBackground` (per-scope `inFlight` guard).
- `src/long-term-memory/maintenance.ts` — `runMemoryMaintenance` (registered as `long-term-memory-maintenance` in `src/scheduler-instance.ts:67`).
- `src/tools/memory.ts:83,121,151,179` — `makeRememberMemoryTool`/`makeSearchMemoryTool`/`makeListMemoryTool`/`makeForgetMemoryTool`, wired in `src/tools/provider-independent-tools-builder.ts:57-60`.

**Divergence from the plan:** the codebase later extended this foundation beyond the plan's scope — `src/long-term-memory/` now also contains `capture.ts`, `recall-cascade.ts`, `embedding-writer.ts`, and provisional/promotion stores, backed by migration 056 (`memory_extraction_state`, `provisional` status, `thread_context_id`). `src/db/schema.ts` re-exports the additional `memoryExtractionState`/`MemoryExtractionStateRow`. These extensions are documented by ADRs 0199/0200/0201/0206, not this record.
