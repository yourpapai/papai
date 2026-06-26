<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0200: Recall Cascade and Promotion

## Status

Implemented

## Date

2026-06-16

## Context

Plan 1 (ADR-0199) delivered the provisional memory data model, the idle-debounce capture pipeline, and the embeddings revival that made `memory_records.embedding` populated and searchable. That closed the _capture_ and _recall-paraphrase_ gaps, but two symptoms remained: the bot still had no priority-ordered way to surface cross-thread knowledge, and a durable fact observed independently in several threads was never elevated from per-thread _provisional_ state to _active_ group memory — so it stayed thread-tagged and was rediscovered in every new thread.

This plan (Plan 2 of 3) makes provisional memory both **user-visible** and **self-improving**. It adds a server-side 3-layer recall cascade (current-thread → group long-term → sibling-thread) and a hybrid promotion engine that elevates a provisional fact to durable group memory once it appears in ≥3 distinct threads and a SMALL_MODEL confirms it is general. The whole bridge remains behind the per-context `cross_thread_memory` flag (default OFF), so flag-OFF stays reference-identical to current behavior.

The design is specified in `docs/superpowers/specs/2026-06-16-cross-thread-memory-and-context-scope-design.md` §4.4–§4.7. This ADR records the decisions made in the implementation plan and notes where the shipped form diverged.

## Decision Drivers

- **Stop rediscovering.** A durable fact seen across threads must surface in a fresh thread without re-asking the user or claiming no prior knowledge.
- **Provenance transparency.** The agent must know _when_ it is pulling cross-thread knowledge, so it can weigh self-known vs borrowed facts distinctly.
- **Conservative promotion.** Promotion must be frequency-gated _and_ LLM-confirmed, not automatic, to avoid stamping thread-specific or transient noise as durable group memory.
- **Degradation safety.** Embedding failure or an unset `EMBEDDING_MODEL` must never break recall, capture, or promotion — FTS/keyword fallback throughout.
- **Flag-OFF parity.** The entire bridge is feature-flagged; OFF is byte-identical to today (no provisional capture, no promotion, no cross-thread cascade).
- **Deterministic backstop.** A scheduler sweep must recover promotion work lost to debounce loss or process restart.

## Considered Options

### 1. A separate `recall` tool + server-side cascade (plan's choice)

- **Pros:** explicit priority surface with clean provenance tagging; supersedes keyword-only `search_memory`; the cascade is a single, testable entry point.
- **Cons:** adds a parallel tool name the agent must learn; tool-surface churn and prompt re-education.

### 2. Extend `search_memory` with the cascade in place

- **Pros:** no new tool name, no prompt re-education, one memory-search entry point; existing `tool_prefs` presets and permissions carry over unchanged.
- **Cons:** conflates "search active memory" with "cross-thread recall"; provenance is less prominent to the caller than a dedicated tool.
- **Outcome:** this is the form that ultimately shipped (see Implementation Notes and ADR-0206), not the separate tool the plan specified.

### 3. Automatic promotion on thread-count alone (no LLM confirm)

- **Pros:** no extra model call; simpler engine.
- **Cons:** promotes transient/thread-specific noise as durable; no quality gate. Rejected.

## Decision

Six coordinated changes implement the architecture:

### 1. Store mutations for promotion

`MemoryEvidence` gains `promotionRejectedAt?: string`. Two store functions flip provisional state: `promoteProvisionalToActive` sets `status='active'`, `thread_context_id=NULL`, merges the distinct thread set, and clears the cooldown; `markPromotionRejected` stamps `evidence.promotionRejectedAt` to enforce a 7-day cooldown. Both are idempotent, single-statement updates scoped by the memory scope + record id.

### 2. In-memory record ranking (`recall-ranking.ts`)

`rankCandidatesByQuery` ranks an already-loaded record list against a query — semantic (cosine ≥ `RECALL_SIMILARITY_THRESHOLD` = 0.65) when a query embedding is available, else keyword term-overlap. Used for the provisional layers (1 and 3) where candidates are loaded by `listProvisionalRecords`. Threshold and limit are overridable per call.

### 3. Promotion engine (`promotion.ts`)

`evaluatePromotion` clusters provisional records similar to a candidate (embedding cosine ≥ `CLUSTER_SIMILARITY_THRESHOLD` 0.8, or exact content match when embeddings are absent), counts distinct threads from `evidence.threads` ∪ `threadContextId`, and — when the count is ≥ `MEMORY_PROMOTION_MIN_THREADS` (3) and the row is not in a 7-day cooldown — asks a SMALL_MODEL a yes/no "is this a durable, general group fact" via a BYOK-aware `resolveEffectiveLlmConfig(configContextId)`. On confirm it promotes the candidate in-place and archives the cluster duplicates; on reject it stamps the cooldown. Never throws — confirmation failures are logged and swallowed.

### 4. Recall cascade (`recall-cascade.ts`)

`runRecallCascade` walks the priority order: **Layer 1** (current-thread provisional) and **Layer 2** (active group records, hybrid semantic ∩ FTS) always run; **Layer 3** (sibling-thread provisional, excluding the current thread) runs only when layers 1+2 return fewer than the requested limit. Each hit is tagged with `RecallProvenance` (`current` | `group` | `other-thread`). Layer-3 hits fire `schedulePromotion` as a background side-effect. DMs run layer-2 only. Results are deduped by id and capped at `RECALL_DEFAULT_LIMIT` (8).

### 5. Tool surface + system prompt

The plan specified a new `recall` tool registered in `normal` mode, flag-gated behind `cross_thread_memory`, returning `{ records }` with provenance and a public shape (no `embedding`/`scopeId` leaked). A `MEMORY_RECALL` system-prompt fragment (present iff `recall` enabled) instructs the agent to recall in priority order before re-asking. See Implementation Notes for the shipped divergence.

### 6. Promotion sweep (`promotion-sweep.ts`)

`sweepPromotions` is the deterministic backstop: it enumerates every group scope holding provisional rows and evaluates each candidate, scope by scope, swallowing per-record failures. Registered as the `memory-promotion-sweep` scheduler job (30-minute interval, no immediate run), it recovers promotion work lost when the layer-3 side-effect never fires or a debounce/restart drops state.

## Consequences

### Positive

- A fact established in ≥3 short threads is promoted to durable group memory and recalled from a fresh thread without rediscovery — the core acceptance criterion.
- Provenance tagging lets the agent distinguish self-known vs cross-thread knowledge.
- Promotion is quality-gated (thread threshold + LLM confirm + 7-day cooldown), limiting noise promotion.
- FTS/keyword fallback keeps recall, clustering, and ranking functional without embeddings.
- Flag-OFF is parity: no provisional capture, no promotion, no cross-thread cascade; `search_memory` behaves as before.

### Negative

- **Layer-3 promotion is a fire-and-forget side-effect of recall.** A recall storm can spin up many SMALL_MODEL confirm calls; bounded by the in-flight guard and per-row cooldown, but not by an explicit rate limit on confirms.
- **Count-based layer-3 gate.** The engine reaches layer 3 whenever layers 1+2 return fewer than `limit`, even when layer-2 returned high-quality active hits — spending promotion work unnecessarily. (The spec proposed a top-score threshold; the plan and shipped code use the count gate.)
- **Promotion is in-memory per-process.** Two processes racing on the same group can both confirm-and-archive; the in-place status flip is idempotent, but duplicate SMALL_MODEL calls are not prevented cluster-wide.

### Risks

- **Confirm-prompt sensitivity.** The SMALL_MODEL confirm is content-bearing; a low-quality or misaligned small model could over-promote noise or reject durable facts. Mitigated by the frequency gate and cooldown, but there is no human review loop.
- **Provisional accumulation.** Provisional rows accumulate until promoted or aged out; bounded by the 30-day TTL and per-group cap from Plan 1 maintenance, but a high-volume group can churn promotion candidates between sweeps.

## Related Decisions

- **ADR-0193: Long-Term Memory** — the `memory_records` store, `resolveMemoryScope`, and background extraction this builds on.
- **ADR-0199: Memory Foundation** — provisional store, capture pipeline, and semantic search (Plan 1) this plan depends on.
- **ADR-0201: Scope Corrections** — the declarative `ENTITY_SCOPES` registry and consistency test (Plan 3, independent of the memory work).
- **ADR-0206: Consolidate Recall** — later folded the separate `recall` tool back into `search_memory`; the cascade (`runRecallCascade`) is now invoked from `makeSearchMemoryTool`.

## Implementation Notes

Key files (confirmed present):

- `src/long-term-memory/provisional-store.ts:47` — `promoteProvisionalToActive`; `:73` — `markPromotionRejected` (re-exported via `src/long-term-memory/store.ts:38-39`).
- `src/long-term-memory/types.ts:48` — `MemoryEvidence.promotionRejectedAt`; `:62` — `threadContextId`.
- `src/long-term-memory/recall-ranking.ts:9,25` — `RECALL_SIMILARITY_THRESHOLD` (0.65, module-private), `rankCandidatesByQuery`.
- `src/long-term-memory/promotion.ts:23,84` — `MEMORY_PROMOTION_MIN_THREADS` (3), `evaluatePromotion`; `PROMOTION_REJECT_COOLDOWN_MS` (7d), `CLUSTER_SIMILARITY_THRESHOLD` (0.8).
- `src/long-term-memory/recall-cascade.ts:103` — `runRecallCascade`; `:17-18` — `RecallProvenance`/`RecallHit`; `:126` — count-based layer-3 gate (`dedupe(combined, limit).length < limit`).
- `src/long-term-memory/promotion-sweep.ts:62` — `sweepPromotions`.
- `src/scheduler-instance.ts:83` — `memory-promotion-sweep` registered (30 min interval).
- `src/system-prompt.ts:136,167` — `MEMORY_SEARCH` fragment tied to `search_memory`.

Divergence from the plan: the plan specified a new `src/tools/recall.ts` (`makeRecallMemoryTool`) registered as a separate flag-gated `recall` tool, with `search_memory` becoming a layer-2-only alias. What shipped instead — later formalized in ADR-0206 (consolidate-recall) — integrates `runRecallCascade` directly into the existing `search_memory` tool (`src/tools/memory.ts:121-149`); no `src/tools/recall.ts` exists. The tool gained `kind` and `include_stale` params and returns hits carrying `provenance`. The system-prompt fragment is `MEMORY_SEARCH` (tied to `search_memory`), not a `MEMORY_RECALL` tied to `recall`. `RECALL_SIMILARITY_THRESHOLD` is module-private (`const`, not `export const`). `runRecallCascade`'s input gained `kind?`/`includeStale?` beyond the plan's `query`/`limit`, and layer-2 uses a `searchActiveHybrid` helper that prefers semantic results and falls back to keyword rather than unioning both. The layer-3 gate is count-based, matching the plan rather than the spec's top-score-threshold proposal.
