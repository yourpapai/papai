<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Consolidate `recall` and `search_memory` into one retrieval tool

Date: 2026-06-18
Status: Approved (design)

## Goal

Provide a single canonical "find what we know" memory-retrieval tool. After the cross-thread memory
bridge became always-on, both `recall` and `search_memory` are exposed in `normal` mode and overlap
(especially in DMs, where `recall` collapses to active-only search). Merge them into one tool named
`search_memory`, backed by the recall cascade engine, with `recall`'s richer behavior plus
`search_memory`'s filters — and remove the `recall` tool.

Decisions (from brainstorming):

- One canonical tool (merge, don't keep both).
- Keep the `search_memory` name (fits the `remember_memory`/`list_memory`/`forget_memory`/`search_memory`
  family); run the cascade inside it; remove `recall`.
- Approach A: cascade-as-engine, filters threaded into the cascade.

## Background: current state

- `search_memory` (`src/tools/memory.ts` `makeSearchMemoryTool`) → `searchMemoryRecords` (FTS/semantic over
  `active`, optionally `stale`) in the resolved scope (personal in DM, group in group). Filters: `kind`,
  `include_stale`, `limit`. Output `{ mode: 'keyword', records }` with `kind`/`source`/timestamps, no provenance.
- `recall` (`src/tools/recall.ts` `makeRecallMemoryTool`) → `runRecallCascade` (`src/long-term-memory/recall-cascade.ts`):
  layer 1 current-thread provisional → layer 2 active group (hybrid semantic+term) → layer 3 sibling-thread
  provisional (only if 1+2 underfill), with `provenance` tags and a `schedulePromotion` side-effect on layer-3
  hits. Input: `query`, `limit`. Output `{ mode: 'recall', records }` with provenance, no `kind`/`source`.
- Both are `read('memory')` in `tool-metadata.ts`. `recall` is advertised by the `MEMORY_RECALL`
  system-prompt fragment (`requiredTools: ['recall']`).
- Management tools `remember_memory` / `list_memory` / `forget_memory` are separate write/management
  concerns and are out of scope. `searchMemoryRecords` (store fn) is also used by `forget_memory`.

## Detailed design

### 1. Unified `search_memory` tool (`src/tools/memory.ts`)

`makeSearchMemoryTool` keeps its name and `MemoryToolContext` ({ storageContextId, contextType }). Its
`execute` stops calling `searchMemoryRecords` and runs the cascade instead.

- Input schema (unchanged surface): `query` (string 1–500), `kind?` (optional `MemoryKindSchema`),
  `include_stale?` (boolean), `limit?` (int 1–50).
- execute: `const configContextId = getConfigContextIdFromStorageContextId(input.storageContextId)` (import
  from `../chat/scoped-context.js`, as `recall.ts` did), then
  `runRecallCascade({ storageContextId, configContextId, contextType, query, limit, kind, includeStale })`.
- Output: `{ records }` (drop the `mode` discriminator). Each record is the existing `PublicMemoryRecord`
  shape (`id, kind, content, summary, tags, confidence, status, source, createdAt, updatedAt, lastSeenAt,
expiresAt`) plus `provenance: 'current' | 'group' | 'other-thread'`. Add a `toPublicHit(hit: RecallHit)`
  mapper next to the existing `toPublicRecord`.
- Description: "Search everything known in this conversation, the shared group memory, and other
  conversations (priority-ordered), by keyword or meaning. Optionally filter by kind or include stale
  memories."
- `searchMemoryRecords` (store) is retained — `forget_memory` still uses it.

### 2. Cascade filter threading (`src/long-term-memory/recall-cascade.ts`)

Extend `RunRecallCascadeInput` with `kind?: MemoryKind` and `includeStale?: boolean`.

- `includeStale` affects only the active layer (`searchActiveHybrid`): use
  `statuses: includeStale ? ['active', 'stale'] : ['active']` for `rankRecordsBySimilarity` (already accepts
  `statuses`) and for the keyword-fallback `listMemoryRecords` (use the `statuses` list param added during the
  flag-removal work). Provisional layers are unaffected — `stale` is an active-tier status, orthogonal to
  `provisional`.
- `kind` filters every layer via a small `byKind(records, kind)` pre-filter applied to: current-thread
  provisional candidates, the active-layer results, and sibling-thread provisional candidates — before
  ranking. (Uniform post-gather filter keeps all three layers consistent and covers `listProvisionalRecords`,
  which has no `kind` param.)
- `limit` default stays `RECALL_DEFAULT_LIMIT` (8) when unset.
- The DM branch (active-only, tagged `group`) and the `schedulePromotion` side-effect on sibling hits are
  unchanged; both now also honor `kind`/`includeStale` in the active layer.

### 3. Remove `recall`, retarget the system prompt

- Delete `src/tools/recall.ts`.
- `src/tools/provider-independent-tools-builder.ts`: remove the `import { makeRecallMemoryTool }` and the
  `recall` registration block. (`search_memory` is already registered via `addMemoryTools`.)
- `src/tools/tool-metadata.ts`: remove the `recall: read('memory'),` entry; keep `search_memory`.
- `src/system-prompt.ts`: change the `MEMORY_RECALL` fragment's `requiredTools` from `['recall']` to
  `['search_memory']` and reword the text to reference `search_memory` (priority-ordered search across this
  conversation, shared group memory, and other conversations; use before re-asking). The fragment still
  self-gates on the tool being enabled.

`recall-cascade.ts`, `promotion*.ts`, the sweeps, and the capture pipeline are otherwise untouched —
`search_memory` becomes the cascade's caller in place of the deleted `recall` tool.

### 4. Tests

- Delete `tests/tools/recall.test.ts`.
- `tests/long-term-memory/stop-rediscovering.acceptance.test.ts`: repoint the fresh-thread recall from
  `makeRecallMemoryTool` to `makeSearchMemoryTool` (same cascade engine); keep the end-to-end
  capture→promotion→recall assertions.
- `tests/tools/provider-independent-tools-builder.test.ts`: remove the `recall registration` describe block;
  add a minimal assertion that `search_memory` is registered when `contextId`/`contextType` are set.
- `tests/system-prompt-recall.test.ts`: update to assert the fragment is gated on / references
  `search_memory`; rename the file to `tests/system-prompt-memory-search.test.ts`.
- `tests/tools/memory.test.ts`: update `search_memory` tests — output records carry `provenance`, no `mode`
  field; add `kind` and `include_stale` filter cases and (group context) a case where provisional/cross-thread
  hits surface. Follow the existing memory-test seeding/DI pattern.
- `tests/long-term-memory/recall-cascade.test.ts`: add a `kind`-filter-across-layers case and an
  `include_stale`-extends-active-layer case.
- `tests/tools/tool-metadata.test.ts`: drop any `recall` assertion; keep `search_memory`.
- `tests/tools/tools-builder.test.ts`: verify `search_memory` expectations still hold; update only if it
  asserts the old `mode`/output shape.

### 5. Documentation

- `CLAUDE.md`: in the cross-thread memory bridge paragraph, change the "(2) Recall — the `recall` tool …"
  clause to "(2) Retrieval — the `search_memory` tool runs the server-side cascade (`recall-cascade.ts`) …";
  remove any standalone `recall` tool mention in the Tools section and note `search_memory` now spans
  current-thread provisional → active group → sibling-thread provisional with optional `kind`/`include_stale`.
- `src/tools/CLAUDE.md`: grep `recall`/`search_memory`; reflect that `search_memory` is the single
  cascade-backed retriever and `recall` is gone.
- `README.md`: grep; touch only if it names the `recall` tool (likely not).

## Out of scope

- The management tools `remember_memory` / `list_memory` / `forget_memory` (unchanged).
- The capture/promotion/sweep pipeline and `recall-cascade.ts` layer ordering (only filter inputs added).
- Per-context tool permissions and risk class (`search_memory` stays `read('memory')`).

## Risks & mitigations

- **Behavior change for existing `search_memory` callers:** it now returns `provenance` and (in groups)
  provisional + cross-thread hits, and drops `mode`. Intended (richer, single tool). Tests updated; the
  output is a superset of the old record fields.
- **`kind`/`include_stale` semantics in the cascade:** `kind` applies to all layers; `include_stale` only
  to the active layer (provisional is not "stale"). Documented and tested.
- **Prompt/coverage drift:** the `recall`-named system-prompt fragment and test file are renamed/retargeted
  so naming stays honest.

## Verification

`bun typecheck`, `bunx oxlint`, `bun knip`, `bun run format:check` clean; `grep -rn "makeRecallMemoryTool\|tools/recall\|'recall'" src tests` returns nothing (recall tool fully gone); `tests/tools/`,
`tests/long-term-memory/`, system-prompt, and tools-builder suites green. Manual: in a group thread,
`search_memory` returns provisional + active + sibling hits with provenance and honors `kind`/`include_stale`;
in a DM it returns active records honoring the same filters.
