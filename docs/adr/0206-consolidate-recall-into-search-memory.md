<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0206: Consolidate recall into search_memory

## Status

Implemented

## Date

2026-06-18

## Context

After the cross-thread memory bridge became always-on (ADR-0200), the bot exposed two overlapping "find what we know" tools in `normal` mode. `recall` (`src/tools/recall.ts`) ran the recall cascade — current-thread provisional → active group memory (hybrid semantic+term) → sibling-thread provisional, only when the first two layers underfilled — returning records tagged with `provenance` and scheduling promotion on sibling hits, but accepting only `query`/`limit`. `search_memory` (`src/tools/memory.ts`) called `searchMemoryRecords` directly — FTS/semantic over `active` (optionally `stale`) in the resolved scope, with `kind`/`include_stale`/`limit` filters, but no provenance and no cross-thread surfacing. In DMs the two collapsed to nearly the same active-only search.

Two tools for one intent created model ambiguity, a split prompt surface (`MEMORY_RECALL` advertised `recall`; nothing advertised `search_memory`), and redundant maintenance. The 2026-06-18 design (`docs/superpowers/specs/2026-06-18-consolidate-recall-search-memory-design.md`, approved) specified merging them into a single tool named `search_memory`, backed by the cascade engine, with `recall`'s richer multi-layer behavior plus `search_memory`'s filters threaded into the engine and `provenance` in the output — and deleting the `recall` tool.

## Decision Drivers

- **Single canonical retriever**: one "find what we know" tool reduces model confusion and the prompt surface that must stay in sync.
- **Preserve cascade behavior**: the current→group→sibling ordering and the `schedulePromotion` side-effect on sibling-thread hits must survive the merge.
- **Keep `search_memory`'s filters**: `kind`/`include_stale`/`limit` must remain available and apply across all cascade layers, not just the active tier.
- **Provenance visibility**: every hit must report which layer it came from (`current`/`group`/`other-thread`).
- **Name continuity**: keep the `search_memory` name — it fits the `remember_memory`/`list_memory`/`forget_memory`/`search_memory` family — rather than renaming the survivor to `recall`.
- **Minimal blast radius**: the capture, promotion, and sweep pipeline, plus `searchMemoryRecords` (still used by `forget_memory`), must stay untouched.

## Considered Options

### Option A: Merge into `search_memory` with the cascade as engine (chosen)

- **Pros:** One canonical tool; output is a superset of the old `search_memory` record fields plus `provenance`; reuses the tested cascade; `kind`/`include_stale` apply uniformly across layers; honest naming retained.
- **Cons:** Behavior change for existing `search_memory` callers (gains `provenance`, drops `mode`, gains cross-thread hits in groups); requires threading filter inputs into cascade internals.

### Option B: Keep both tools; make `search_memory` delegate to the cascade while `recall` stays

- **Pros:** No behavior change to existing `search_memory` callers.
- **Cons:** Two overlapping tools persist; model ambiguity and the split prompt surface remain; duplicate surface to maintain; the richer cascade behavior stays hidden behind the less-discoverable tool.

### Option C: Replace `search_memory` with `recall` (rename, not merge); drop `kind`/`include_stale`

- **Pros:** Simplest delete-and-rename mechanically.
- **Cons:** Loses useful `kind`/`include_stale` filters that `search_memory` already exposed; regresses tested filter logic; breaks the tool-name family.

## Decision

Adopt Option A. Five coordinated changes implement it:

### 1. `search_memory` runs the cascade (`src/tools/memory.ts`)

`makeSearchMemoryTool` keeps its name and `MemoryToolContext` (`{ storageContextId, contextType }`). Its `execute` stops calling `searchMemoryRecords` and instead resolves `configContextId` via `getConfigContextIdFromStorageContextId` (imported from `../chat/scoped-context.js`, as the old `recall.ts` did), then calls `runRecallCascade`. A new `toPublicHit(hit: RecallHit)` mapper — placed next to the existing `toPublicRecord` — spreads the public record fields and adds `provenance`. The output drops the `mode` discriminator and returns `{ records: records.map(toPublicHit) }`. The description is rewritten to advertise priority-ordered search across this conversation, shared group memory, and other conversations, with optional `kind`/`include_stale`. The `include_stale` input field is retained. `searchMemoryRecords` stays imported — `makeForgetMemoryTool` still uses it.

### 2. Filter threading into the cascade (`src/long-term-memory/recall-cascade.ts`)

`RunRecallCascadeInput` gains optional `kind?: MemoryKind` and `includeStale?: boolean`. A small `byKind(records, kind)` pre-filter is applied to every layer — current-thread provisional candidates, the active-layer results, and sibling-thread provisional candidates — before ranking. `includeStale` affects only the active layer: `searchActiveHybrid` now accepts a `statuses` list and uses `['active', 'stale']` when `includeStale === true`, else `['active']`, for both `rankRecordsBySimilarity` (which already accepts `statuses`) and the keyword-fallback `listMemoryRecords`. Provisional layers are unaffected — `stale` is an active-tier status, orthogonal to `provisional`. The DM branch (active-only, tagged `group`) and the `schedulePromotion` side-effect on sibling hits are unchanged; both now honor `kind`/`includeStale` in the active layer.

### 3. Remove the `recall` tool

`src/tools/recall.ts` is deleted (`git rm`). `src/tools/provider-independent-tools-builder.ts` drops the `makeRecallMemoryTool` import and the `recall` registration block — `search_memory` is already registered via `addMemoryTools`. `src/tools/tool-metadata.ts` removes the `recall: read('memory')` entry; `search_memory: read('memory')` stays. The risk class is unchanged.

### 4. Retarget the system-prompt fragment (`src/system-prompt.ts`)

The `MEMORY_RECALL` fragment is renamed `MEMORY_SEARCH`, reworded to reference `search_memory` and priority-ordered search, and rebound with `requiredTools: ['search_memory']`. The fragment still self-gates on the tool being enabled.

### 5. Tests and docs

`tests/tools/recall.test.ts` is deleted. `tests/system-prompt-recall.test.ts` is renamed to `tests/system-prompt-memory-search.test.ts` and repointed at `search_memory`. `tests/long-term-memory/stop-rediscovering.acceptance.test.ts` swaps `makeRecallMemoryTool` for `makeSearchMemoryTool` (same cascade engine) and drops any `mode` assertion. `tests/long-term-memory/recall-cascade.test.ts` gains `kind`-filter-across-layers and `include_stale`-extends-active-layer cases. `tests/tools/memory.test.ts` drops the `mode` assertion and adds provenance, `kind`, and `include_stale` cases. `CLAUDE.md` and `src/tools/CLAUDE.md` reflect `search_memory` as the single cascade-backed retriever.

## Consequences

### Positive

- One canonical "find what we know" tool eliminates model ambiguity and the split prompt surface.
- `search_memory` now surfaces cross-thread provisional and sibling-thread hits in groups, with `provenance` on every record.
- `kind`/`include_stale` apply uniformly across all cascade layers instead of only the active scope.
- The capture, promotion, and sweep pipeline is untouched; the `schedulePromotion` side-effect on sibling hits is preserved.
- `searchMemoryRecords` is retained for `forget_memory`; no store-level churn.

### Negative

- **Output shape change.** `search_memory` drops the `mode` field and gains `provenance` (and, in groups, provisional/cross-thread hits). Existing test assertions were updated; the output is a superset of the old record fields. There is no external API contract — tool output is agent-facing.
- **`include_stale` is layer-specific.** It widens only the active layer; provisional records are never "stale". The distinction is documented and tested but is a subtle semantic a future caller could misread.
- **Test rename tracked in history.** `system-prompt-recall.test.ts` → `system-prompt-memory-search.test.ts` and the repointed acceptance test require the rename to be recorded as a `git mv` so blame stays intact.

### Risks

- **A caller relying on `mode: 'keyword'`** would break. Mitigated: every in-repo assertion was updated and no out-of-repo consumer exists.
- **`kind` as a post-gather pre-rank filter on provisional layers.** `listProvisionalRecords` has no `kind` parameter, so `byKind` filters after gather. This keeps all three layers consistent but does not prune at the store level. Acceptable given low provisional volumes; revisitable if provisional cardinality grows.

## Related Decisions

- ADR-0193: Long-Term Memory — the durable group-scoped memory store this tool reads.
- ADR-0200: Recall Cascade and Promotion — the cascade engine `search_memory` now drives, and whose `schedulePromotion` side-effect is preserved.
- ADR-0201: Scope Corrections and Declarative Registry — the thread-vs-group scope model the cascade layers depend on.

## Implementation Notes

Key files confirmed present against the plan:

- `src/tools/memory.ts:14` — imports `runRecallCascade` and `type RecallHit` from `../long-term-memory/recall-cascade.js`; `toPublicHit` at `memory.ts:73`; `include_stale` input field at `memory.ts:127`; `execute` calls `runRecallCascade` at `memory.ts:133`; output `{ records: records.map(toPublicHit) }` at `memory.ts:146`. `searchMemoryRecords` still imported for `forget_memory`.
- `src/long-term-memory/recall-cascade.ts` — `byKind` helper at `:62`; `kind`/`includeStale` on `RunRecallCascadeInput` at `:26`–`:27`; `statuses` computed from `includeStale` at `:110`; threaded through `searchActiveHybrid` (`:70`–`:71`) and `scheduleLayerThree` (`:89`).
- `src/system-prompt.ts:135` — `MEMORY_SEARCH` fragment; `:167` — `requiredTools: ['search_memory']`. No `MEMORY_RECALL` or bare `'recall'` reference remains.
- `src/tools/tool-metadata.ts:149` — `search_memory: read('memory')` retained; `recall` entry removed.
- `src/tools/provider-independent-tools-builder.ts:57` — registers `search_memory` via `makeSearchMemoryTool`; no `recall` import or registration.
- `src/tools/recall.ts` — deleted (glob finds no file); no `makeRecallMemoryTool` / `tools/recall` / `'recall'` references remain in `src/tools/`.
- `tests/system-prompt-memory-search.test.ts` — exists (renamed from `system-prompt-recall.test.ts`); `tests/tools/recall.test.ts` — deleted.
