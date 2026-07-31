<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0305: F3 Memory Story Family — Behavioral Coverage for Memos, Long-Term Memory, Instructions, and Group-History Lookup

## Status

Implemented (with divergence)

## Date

2026-07-20

## Context

The coverage-expansion roadmap sequences family **F3** (`memory-*` / `memo-*` / `instructions-*` + `history-lookup` + `fetch-chat-link`) after F1/F2. None of the memo/memory/instruction/history tools carried a capability id — `CORE_TOOL_CAPABILITIES` covered only `tasks.*` and `meta.expand-result` — so the scripted story model's `callCapability(id, input)` decision could not address any of them, and the catalog audit classified all 13 F3 records `needs-seam`, every one sharing the `capability-ids` seam, with `embeddings-endpoint` on the two semantic-recall scenarios, `memory-extraction-llm` on `memory-capture-sweep`, and `public-url-assertion` on `fetch-chat-link`.

The design (`docs/superpowers/specs/2026-07-20-f3-memory-story-family-design.md`) and plan (`docs/superpowers/plans/2026-07-20-f3-memory-story-family.md`) chose to land **12 executable scenarios** plus a `fetch-chat-link` reclassification, moving the ledger from 69 to 81 executable stories and putting behavioral tripwires on four production surfaces: memo storage (`memos`/`memos_fts`), long-term memory (`memory_records`/`memory_profiles`, with the recall cascade, the idle-debounce capture sweep, and the ≥3-thread promotion gate), user instructions (`user_instructions`), and the main-group history-lookup path. The production truth the scenarios must mirror: `save_memo` schedules its embedding **fire-and-forget** (a floating `POST /embeddings`); `remember_memory` writes **no vector** (keyword-only recall); the capture sweep writes provisional records with an **awaited** embed; promotion elevates a provisional cluster spanning **≥3 distinct threads** after a `confirmDurable` gate.

Four harness seams were needed: a deterministic embeddings responder for the outbound embed calls, a `world.settle()` guarantee that drains fire-and-forget embeds before teardown, DB-seeding fixtures (dirty/idle contexts, provisional clusters, seeded memos/records/instructions), and single-pass `when.captureSweep()`/`when.promotionSweep()` primitives that drive the real, unmodified production sweeps through DI.

## Decision Drivers

- **Land the capability seam first and review it alone (roadmap rule 2).** 13 builtin capability-id entries must register so the scripted model can address each tool; registration is the existing `registerOfferedCoreToolCapabilities` iterate-and-register-when-present loop, so conditional gating (`promote_memo` needs a task provider, `lookup_group_history` needs a thread-scoped group context) is honored for free.
- **Every scenario qualifies through a real observation, never a scripted echo (rule 3).** Because `answer(text)` is emitted unconditionally, asserting reply text alone proves nothing; each read/list/recall scenario must observe the real tool result and each mutation must observe a token appearing or disappearing on a following real turn.
- **Drive the real production memory paths through DI, not mocks.** Both sweeps are single-pass, fully DI-able exports; the harness substitutes only the model/embedding I/O. Dirty-detection, idle-gating, scope resolution, DB writes, and the 3-thread promotion gate all run against unmodified production code.
- **Deterministic embeddings, never tuned against the threshold.** The 0.65 cosine threshold must be hit by an orthonormal contrast (`1.0` vs `0.0`), never a near-threshold float; one declared responder per embed call, FIFO-matched.
- **`memory-recall` asserts the keyword path (production truth).** `remember_memory` writes no vector, so semantic memory recall is unreachable from an explicit remember; the scenario asserts the keyword layer. The semantic memory pipeline is proven separately by `memory-capture-sweep`, the only producer of embedded memory records.
- **Reclassify `fetch-chat-link` honestly (rule 6).** Research disproved the audited `public-url-assertion` seam — `fetch_chat_link` resolves a Mattermost permalink through the authenticated REST API and never calls the DNS/SSRF `assertPublicUrl` guard (that is `web_fetch`, family F6); the corrected record names `platform-adapter-fakes`.
- **Ledger updates ride in the same PR (rule 5).** The 12 mappings move from `AUDIT_RECORDS` to `EXECUTABLE_STORY_MAPPINGS`, and the runner totals line follows.

## Considered Options

### Option 1 — Capability ids + four harness seams + 12 scenarios driving the real tools through DI + `fetch-chat-link` reclassification (chosen)

13 capability-id entries (reviewed alone); a strict-http in-flight drain wired into `world.settle()`; a one-shot deterministic embeddings fixture; DB-seed helpers plus `given.memo`/`memoryRecord`/`dirtyContext`/`instruction` and `when.captureSweep`/`promotionSweep` primitives that invoke the real sweeps with world-provided deps; three memory story files plus a context/history story file (12 scenarios total); the 12-entry ledger move and the `fetch-chat-link` reclassification.

- **Pros:** the smallest surface that still proves the builtin-tool registration path, the DB-storage path for memos/memory/instructions, the recall cascade, and both background sweeps against the real, unmodified production code; capability ids are RED→GREEN evidence; every read/list/recall scenario observes a real tool result, not a scripted echo; deterministic vectors are never near the threshold.
- **Cons:** four harness seams are frozen inputs (the compat baseline must be re-recorded); the sweeps' DI signatures and the strict-http drain become part of the compatibility contract; `save_memo`'s fire-and-forget embed forces a settle-drain guarantee or it is undeclared at teardown.

### Option 2 — Real model/embedding HTTP for the sweep generations (rejected)

Route capture extraction and promotion `confirmDurable` through declared chat-completion HTTP responders instead of injected DI results.

- **Pros:** the sweeps' model calls would be observable as real HTTP.
- **Cons:** the production `getEmbeddingForContext`/`generateText` paths have no fetch-injection seam under `--contracts` mode (the global-fetch patch is only installed by the sandboxed non-contracts preload), so the contract suite could not intercept them; the deterministic injected-result form is simpler, fully exercises the real sweep control flow and DB writes, and is what production already exposes via `RunMemoryCaptureDeps`/`SweepPromotionsDeps`.

### Option 3 — Two-turn save-then-recall for `memo-recall` to drain the fire-and-forget embed (rejected)

Write `memo-recall` as save → settle → recall so the floating embed lands before ranking.

- **Pros:** mirrors the spec's story-files table literally.
- **Cons:** couples the ranking-under-test to the settle guarantee and conflates two behaviors in one scenario. Seeding an embedded memo directly (fixture) plus one live query embed isolates the semantic-ranking path; the floating-embed drain is exercised separately by `memo-save` and proved by the strict-http `idle()` settle guarantee (risk 1's real fix).

## Decision

The chosen Option 1 shipped across the production capability map, four harness seams, four story files, and the catalog ledger. What shipped:

1. **13 F3 capability ids registered.** `CORE_TOOL_CAPABILITIES` gained `memos.save/search/list/archive/promote`, `memory.remember/search/forget/list`, `instructions.save/list/delete`, and `history.lookup`, each mapped to its snake_case wire name so `callCapability(...)` resolves and the per-turn capability gate can deny the unconfigured ones.
2. **Strict-http in-flight drain added.** `StrictHttpDispatcher` gained `idle(): Promise<void>`; `fetch()` tracks each responder promise in an `inFlight` set (added on start, removed on settle) and `idle()` awaits a snapshot until the set drains.
3. **`world.settle()` drains HTTP.** After `pending.settle()`, settle now awaits `http.idle()` so `save_memo`'s fire-and-forget embed is drained (and `verifyConsumed()`-able) before teardown.
4. **Deterministic embeddings fixture added.** `tests/stories/harness/embeddings.ts` exports `EMBEDDINGS_URL`/`MATCH_EMBEDDING=[1,0,0,0]`/`MISMATCH_EMBEDDING=[0,1,0,0]` and `expectEmbedding(http, embedding?)`, which declares one `POST https://llm.invalid/v1/embeddings` expectation returning the fixed vector (cosine `1.0` vs `0.0`).
5. **DB-seed helpers + fixtures.** `seedTestConversationHistory`/`seedTestMemoryExtractionState`/`seedTestUserInstruction` raw inserts; `ScenarioFixtures` gained `seedMemo`/`seedMemoryRecord`/`seedDirtyContext`/`seedInstruction`.
6. **Given/When DSL added.** `given.memo`/`memoryRecord`/`dirtyContext`/`instruction` and `when.captureSweep`/`promotionSweep`, plus the `FIXED_SWEEP_NOW = '2026-07-20T00:00:00.000Z'` clock and three thin world scope-id accessors (`scopedStorageContextId`/`groupScopeId`/`mainGroupStorageId`).
7. **12 scenarios across four files.** `memos.story.test.ts` (save/recall/archive/promote), `memory.story.test.ts` (remember/recall/forget/capture-sweep/promotion-sweep), `instructions.story.test.ts` (save/list-delete), `context/history-lookup.story.test.ts` (main-group history from a thread).
8. **Ledger updated.** The 12 F3 entries moved from `AUDIT_RECORDS` to `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-07-20'`; `fetch-chat-link` was reclassified; the runner totals line and contract-test totals were updated.
9. **Spec reconciled.** The design gained a dated `## Post-implementation deviations (2026-07-20)` section recording the mechanism refinements (rule-3 observation, one-shot embeddings, DI-driven capture embed, the scenarios that actually hit the endpoint, the new accessors).

## Consequences

### Positive

- Twelve new behavioral tripwires cover the builtin-tool registration path and the DB-storage path for memos, long-term memory, and instructions — exactly the surface the pending `plugin-core-separation` refactor is most likely to rewire — plus the recall cascade and both background memory sweeps against unmodified production code.
- The capability-ids seam is proven RED→GREEN: without the `memos.search` id the scripted semantic query cannot resolve, so `SCN-memo-recall` is a genuine registration proof, not a tautology.
- Every read/list/recall scenario observes the **real tool result** (via `promptToolResultTokenFingerprints`) and every mutation observes a token appearing/disappearing on a following real turn, so a tool that silently returned wrong data would fail the story rather than pass on a scripted echo.
- The keyword-only `memory-recall` truth is pinned: `remember_memory` writes no vector, and the scenario asserts the keyword layer wins after the unconditional query embed fires — the semantic memory pipeline is proven separately by `memory-capture-sweep`, the only embedded-record producer.
- The strict-http `idle()` settle guarantee is a general harness improvement: any future fire-and-forget HTTP is drained and `verifyConsumed()`-able, not just `save_memo`'s embed.
- The sweep primitives are honest DI seams: dirty-detection, idle-gating, scope resolution, the awaited capture embed, the 3-thread promotion gate, and the DB writes all run against real production code; only the model/embedding I/O is substituted.

### Negative

- **Four frozen harness inputs.** `strict-http.ts`, `world.ts`, `fixtures.ts`, `scenario.ts`, and the new `embeddings.ts`/`memory-seed.test.ts` are compat-baseline inputs; any later change re-records the baseline.
- **The DSL signatures diverged from the plan.** `given.memo`/`memoryRecord`/`dirtyContext` take a different shape than the plan specified (single-object, scope-nested, context-first), so the story call sites do not match the plan's literal code blocks — see Plan-vs-implementation notes.
- **The rule-3 observation mechanism adds an assertion line to every read/list/recall scenario** the plan did not call for (the `inspections().at(-1)?.promptToolResultTokenFingerprints` check), because reply text alone cannot observe real behavior under a scripted unconditionally-emitting model.
- **`fetch-chat-link` did not stay pending as the plan predicted** — it went executable at the Tier-3 platform lane once that lane existed (see Risks), so the plan's `needs:[capability-ids, platform-adapter-fakes]` pending record was superseded.

### Risks

- **The rule-3 fingerprint observation is a real-behavior dependency.** The scenarios assert a distinctive token is present in the real tool result; if a tool's output shape changed to omit that token, the story would fail (intended), but the token choice is per-scenario author discipline, not auto-derived.
- **The capture `getEmbedding` DI returns a fixed `MATCH_EMBEDDING`.** Under `--contracts` the production `getEmbeddingForContext` has no fetch-injection seam, so the scenario supplies the vector through the `RunMemoryCaptureDeps.getEmbedding` DI seam instead of an HTTP call; the tool-path embeds (`memo-save` floating, `memo-recall` query, `memory-recall` query, the capture follow-up `search_memory` query) are intercepted normally in sandboxed story mode.
- **`fetch-chat-link` went executable after the plan.** The spec deferred the Mattermost REST resolver fake as not-built-speculatively; the nightly Tier-3 platform-adapter lane later built it (`tests/platform/scenarios/mattermost-fetch-chat-link.platform.ts`), so the record moved to `provingTier: '3'` rather than staying pending — a post-F3 outcome, not an F3 deliverable.
- **Promotion is asserted exactly at the 3-thread threshold.** The scenario seeds three threads and injects `confirmDurable → true`, so the durable confirmation fires; the under-corroborated withhold is covered by a contract test (`memory-seed.test.ts`) seeding two threads.

## Related Decisions

- [ADR-0193](0193-long-term-memory.md) — Long-Term Memory: the durable group-scoped `memory_records` store, `resolveMemoryScope`, and background extraction the F3 memory scenarios observe (`remember_memory`/`search_memory`/`list_memory`).
- [ADR-0199](0199-memory-foundation-provisional-store-capture-and-semantic-search.md) — Memory Foundation: the provisional store, the idle-debounce capture pipeline (`capture.ts`/`capture-sweep.ts` + `memory_extraction_state`), and the embeddings revival that `when.captureSweep` drives.
- [ADR-0200](0200-recall-cascade-and-promotion.md) — Recall Cascade and Promotion: the cascade `search_memory` runs and the ≥3-thread `MEMORY_PROMOTION_MIN_THREADS` promotion gate `when.promotionSweep` exercises.
- [ADR-0201](0201-scope-corrections-and-declarative-registry.md) — Scope Corrections and Declarative Registry: the thread-vs-group scope model and the storage-owner-id keying the memo scenarios seed under (`world.scopedStorageContextId`).
- [ADR-0206](0206-consolidate-recall-into-search-memory.md) — Consolidate recall into search_memory: the single `search_memory` tool (with `runRecallCascade` integrated) that `SCN-memory-recall` exercises on the keyword path.
- [ADR-0207](0207-remove-cross-thread-memory-feature-flag.md) — Remove the Cross-Thread Memory Feature Flag: the always-on cross-thread bridge that makes the cascade and promotion scenarios unconditional.
- [ADR-0166](0166-storybook-harness-pr1.md) — Storybook Harness — PR 1 (Vertical Slice): the origin of the hermetic story harness (scripted model, scenario API, world/fixtures split, `MemoryTaskProvider`) this family extends.
- [ADR-0282](0282-hermetic-e2e-master-baseline.md) / [ADR-0283](0283-hermetic-story-process-sandbox-phase-1.md) / [ADR-0284](0284-scenario-catalog-hermetic-stories.md) / [ADR-0285](0285-hermetic-story-app-local-dependencies.md) / [ADR-0286](0286-hermetic-story-docker-all-hosts.md) — the hermetic Tier 0 story harness this family runs under (master baseline, OS sandbox, the coverage ledger this ADR's 12-entry move operates within, app-local dependencies, Docker-all-hosts).
- [ADR-0293](0293-settings-story-family.md) / [ADR-0297](0297-f1-command-meta-story-family.md) / [ADR-0298](0298-f2a-task-lifecycle-story-family.md) / [ADR-0299](0299-f2b1-task-provider-surface-story-family.md) / [ADR-0300](0300-f2b2-task-integration-surface-story-family.md) — sibling story-family ADRs in this batch; F3 inherits their family-by-family landing pattern, the `callCapability`/`given.llm`/`when.message` discipline, the rule-3 qualification-over-contract rule, and the `EXECUTABLE_STORY_MAPPINGS`/`AUDIT_RECORDS` ledger-move mechanics.
- [ADR-0304](0304-story-catalog-audit.md) — Story Catalog Audit: the structured machine-checked pending records this family consumed to resolve the F3 `needs-seam` pends into executable stories.

## Implementation Notes

Verified present against the shipped tree via grep/glob/read.

| File | Role | Evidence |
| --- | --- | --- |
| `src/tools/core-capabilities.ts:69-81` | The 13 F3 capability-id entries — `memos.save/search/list/archive/promote`, `memory.remember/search/forget/list`, `instructions.save/list/delete`, `history.lookup` mapped to their wire names (entries 82+ are later families). | `read` confirms. |
| `src/tools/core-capabilities.ts:100-103` | `registerOfferedCoreToolCapabilities` registers each wire name only when present in the offered set — conditional gating honored for free. | `read` confirms. |
| `tests/stories/harness/strict-http.ts:20,50` | `StrictHttpDispatcher.idle(): Promise<void>` on the type; `inFlight: Set<Promise<unknown>>` field. | `read` confirms. |
| `tests/stories/harness/strict-http.ts:84-93,112-116` | `fetch()` adds the responder promise to `inFlight` with `.finally` cleanup; `idle()` drains via `while (inFlight.size > 0) await Promise.allSettled(...)`. | `read` confirms. |
| `tests/stories/harness/strict-http.test.ts:154` | Contract test `idle() resolves after an in-flight responder settles`. | `grep` confirms. |
| `tests/stories/harness/world.ts:560-563` | `settle` awaits `pending.settle()` then `http.idle()` (the fire-and-forget embed drain). | `read` confirms. |
| `tests/stories/harness/world.ts:557-559,577-589` | Accessors `scopedStorageContextId`/`groupScopeId`/`mainGroupStorageId` + their `For` implementations. | `read` confirms. |
| `tests/stories/harness/embeddings.ts:8-13` | `EMBEDDINGS_URL`/`MATCH_EMBEDDING=[1,0,0,0]`/`MISMATCH_EMBEDDING=[0,1,0,0]`/`expectEmbedding(http, embedding?)`. | `read` confirms. |
| `tests/stories/harness/scenario.ts:323` | `FIXED_SWEEP_NOW = '2026-07-20T00:00:00.000Z'`. | `read` confirms. |
| `tests/stories/harness/scenario.ts:665-710` | `given.memo(input)` / `memoryRecord(input)` / `dirtyContext(context, input)` / `instruction(context, text, id?)` (signatures diverged from plan — see notes). | `read` confirms. |
| `tests/stories/harness/scenario.ts:819-866` | `when.captureSweep(input)` injects `extractMemoryPatch` + `getEmbedding` DI; `when.promotionSweep(input)` injects `evaluate` with `confirmDurable`. | `read` confirms. |
| `tests/stories/harness/fixtures.ts:492-520` | `seedMemo`/`seedMemoryRecord`/`seedDirtyContext`/`seedInstruction` over real `saveMemo`/`saveMemoryRecord` + raw inserts. | `read` confirms. |
| `tests/stories/harness/memory-seed.test.ts:15-131` | 6 contract tests: `given.memo`, `given.memoryRecord`, captureSweep dirty/not-idle, promotionSweep promotes-at-3/withholds-under-3. | `read` confirms. |
| `tests/stories/harness/scripted-llm.ts:77` | `promptTextFingerprint` export (the rule-3 observation primitive every read/list/recall scenario asserts on). | `grep` confirms. |
| `tests/stories/memory/memos.story.test.ts:12-101` | 4 scenarios (save/recall/archive/promote); read scenarios assert `promptToolResultTokenFingerprints`; memos seeded under `world.scopedStorageContextId(dm)`. | `read` confirms. |
| `tests/stories/memory/memory.story.test.ts:12-132` | 5 scenarios (remember/recall/forget/capture-sweep/promotion-sweep); group-thread asserts use `then.replyIn(thread)`. | `read` confirms. |
| `tests/stories/memory/instructions.story.test.ts:11-49` | 2 scenarios; `list-delete` seeds two instructions and deletes one (name diverged — see notes). | `read` confirms. |
| `tests/stories/context/history-lookup.story.test.ts:11-49` | 1 scenario; declares a real `POST .../chat/completions` for `lookup_group_history`'s small-model summarization. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:721-780` | The 12 F3 `EXECUTABLE_STORY_MAPPINGS` entries with `verifiedAt: '2026-07-20'` and literal story ids. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:1146-1152` | `SCN-fetch-chat-link` at `provingTier: '3'`, `verifiedAt: '2026-07-25'` (diverged from "stays pending" — see notes). | `read` confirms. |
| `tests/platform/scenarios/mattermost-fetch-chat-link.platform.ts` | Tier-3 platform-adapter scenario that resolved `fetch-chat-link` (created after F3). | `glob` confirms. |
| `tests/stories/harness/catalog-coverage.test.ts:114,216` | Totals: `CATALOG_SCENARIO_IDS` 165; executable `toHaveLength(140)` (ledger grew far beyond the plan's 81 — see notes). | `grep` confirms. |
| `tests/scripts/story-coverage-totals.test.ts:24` | Runner totals line `140/165 executable (T0 101, T1 29, T2 8, T3 2)`. | `read` confirms. |
| `src/tools/save-memo.ts:33-48` | `save_memo` fire-and-forget embed: `void getEmbeddingForContext(...).then(updateMemoEmbedding)`. | `read` confirms. |
| `src/tools/memory.ts:96,133` | `remember_memory` → `saveMemoryRecord` (no vector); `search_memory` → `runRecallCascade`. | `grep` confirms. |
| `docs/superpowers/specs/2026-07-20-f3-memory-story-family-design.md:243-290` | Spec's `## Post-implementation deviations (2026-07-20)` reconciliation section (Task 8). | `read` confirms. |

Plan-vs-implementation notes:

- **Rule-3 observation mechanism (systematic).** The plan's story code asserted reply text alone. Shipped, every read/list/recall scenario additionally asserts `world.model.inspections().at(-1)?.promptToolResultTokenFingerprints` `toContain`/`not.toContain` `promptTextFingerprint('<token>')` (`scripted-llm.ts:77`), because scripted `answer(text)` is emitted unconditionally so reply text cannot observe real behavior; mutations assert a token disappearing on a following real list turn, and `memo-promote` observes via `then.task(...).exists()`. Documented in the spec's Post-implementation deviations.
- **`given.memo` signature + scope key diverged.** Plan: `given.memo(user, input)` keyed by the chat user id. Shipped: `given.memo({ userId, content, tags?, summary?, embedding? })` (`scenario.ts:665`) where `userId` is `world.scopedStorageContextId(dm)` — memo tools key personal notes by the group-scoped storage owner id (ADR-0201), not the raw chat id (`memos.story.test.ts:37-44`).
- **`given.memoryRecord` shape diverged.** Plan: flat `scopeId`/`scopeType?`/`threadContextId`/`threads?`. Shipped: `scope: { scopeId, scopeType }` plus flat `kind`/`content`/`status`/`threadContextId`/`evidence`/`embedding` (`scenario.ts:669-691`); `threads` folded into `evidence`.
- **`given.dirtyContext` shape diverged.** Plan: `given.dirtyContext({ storageContextId, configContextId, history: string[], lastActivityAt })`. Shipped: `given.dirtyContext(context, { messages: {role, content}[], lastActivityAt, lastExtractedAt? })` (`scenario.ts:692-702`) — context handle first, structured message objects instead of a raw string array, storage/config ids derived internally.
- **`when.captureSweep`/`when.promotionSweep` signatures diverged.** Plan: `captureSweep({ records })` with a live scripted-model extraction and an awaited HTTP embed; `promotionSweep()` with `confirmDurable` hardcoded true. Shipped: `captureSweep(input = {})` injects a canned `MemoryPatch` and a `getEmbedding` DI returning `MATCH_EMBEDDING` directly (no HTTP — `getEmbeddingForContext` has no fetch-injection seam under `--contracts`); `promotionSweep(input = {})` takes an optional `confirmDurable` (`scenario.ts:819-866`). The real sweep control flow, idle-gating, scope resolution, and DB writes are unmodified.
- **`SCN-instructions-list-delete` reshaped and renamed.** Plan name: "lists then deletes an instruction"; plan shape: list → delete → list. Shipped name: "deletes an instruction and confirms it is gone from a later list" (`coverage.ts:774`); shipped shape: seed two instructions → delete one → list shows the survivor, so the deleted text never leaks into the rule-3 fingerprint set via an earlier list turn (`instructions.story.test.ts:28-49`).
- **`SCN-fetch-chat-link` went executable at Tier 3, not pending.** Plan/spec: stays pending, reclassified to `needs:[capability-ids, platform-adapter-fakes]`. Shipped: executable at `provingTier: '3'`, `verifiedAt: '2026-07-25'` via `tests/platform/scenarios/mattermost-fetch-chat-link.platform.ts` (`coverage.ts:1146-1152`) — the nightly platform-adapter lane (Tier 3, per `tests/AGENTS.md`) was created after F3, so the deferred Mattermost REST resolver fake got built. A post-F3 outcome, not an F3 deliverable.
- **Ledger totals far exceed the plan's 81/128.** Plan: 81/128 executable, 47 pending (23 needs-seam). Shipped: 140/165 (`T0 101, T1 29, T2 8, T3 2`), pending 25 (`story-coverage-totals.test.ts:24`). The 12 F3 mappings landed as specified, but later families (F6/F7), tier expansion, parity, and platform lanes all landed after and filled the table far beyond this plan; the plan's "69→81" delta is one layer of that larger redesign.
- **Group-thread scenarios assert `then.replyIn(thread)`, not `then.replyTo(user)`.** Thread-scoped replies are matched by thread, not by user (`memory.story.test.ts:100,128`; `history-lookup.story.test.ts:46`), per the spec deviation.
- **`SCN-history-lookup` declares a real chat-completions expectation.** `lookup_group_history` runs its own `getSmallModel`/`generateText` summarization (not the scripted main model); the story declares `POST https://llm.invalid/v1/chat/completions` with a canned completion (`history-lookup.story.test.ts:29-39`), rather than only a scripted `answer`.
- **`memory-seed.test.ts` has 6 contract tests, not the plan's 3.** It adds captureSweep not-idle skip and promotionSweep withholds-under-3 negative cases (`memory-seed.test.ts:58-131`), strengthening the idle-gate and 3-thread-gate proofs.

The source plan `docs/superpowers/plans/2026-07-20-f3-memory-story-family.md` and design `docs/superpowers/specs/2026-07-20-f3-memory-story-family-design.md` are archived alongside this ADR to `docs/archive/`.
