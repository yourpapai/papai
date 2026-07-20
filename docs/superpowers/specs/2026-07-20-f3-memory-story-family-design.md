<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: F3 memory, memos, instructions, and history-lookup story family

**Status:** approved

**Date:** 2026-07-20

## Context

The coverage-expansion roadmap (`2026-07-19-story-coverage-expansion-roadmap-design.md`)
sequences family F3 (`memory-*`/`memo-*` + `instructions-*` + `history-lookup` +
`fetch-chat-link`) after F1 and F2. `plugin-core-separation` rewires builtin tool
registration and DB-backed storage — exactly what these scenarios observe. The catalog
audit (`docs/superpowers/plans/2026-07-19-story-catalog-audit.md`) classified the 13 F3
records: every one `needs-seam`, all sharing `capability-ids`, with `embeddings-endpoint`
on the two semantic-recall scenarios, `memory-extraction-llm` on `memory-capture-sweep`,
and `public-url-assertion` on `fetch-chat-link`.

This spec lands **12 executable scenarios** and **reclassifies the 13th**
(`fetch-chat-link`) after research showed its audited seam was wrong (see Reclassification
below). Landing F3 moves the ledger from **69 to 81 executable** stories and puts
behavioral tripwires on the builtin tool-registration and DB-storage paths: memo storage
(`memos`/`memos_fts`), long-term memory (`memory_records`/`memory_profiles`), user
instructions (`user_instructions`), and the group-history lookup path.

Research basis: memo tools (`src/tools/save-memo.ts`, `search-memos.ts`, `list-memos.ts`,
`archive-memos.ts`, `promote-memo.ts`, storage `src/memos.ts`); long-term memory
(`src/tools/memory.ts`, store `src/long-term-memory/store.ts`, recall
`src/long-term-memory/recall-cascade.ts` + `semantic-search.ts`, capture
`src/long-term-memory/capture.ts` + `capture-sweep.ts` + `embedding-writer.ts`, promotion
`src/long-term-memory/promotion.ts` + `promotion-sweep.ts`); instructions
(`src/tools/instructions.ts`, `src/instructions.ts`, `src/cache-instructions.ts`); history
lookup (`src/tools/lookup-group-history.ts`, `src/cache.ts`); embeddings
(`src/embeddings.ts`, config `src/llm-config-resolver.ts`, `src/system-config.ts`);
capability registration (`src/tools/core-capabilities.ts`,
`src/llm-orchestrator-tools.ts:222`); and harness mechanics
(`tests/stories/harness/scenario.ts`, `world.ts`, `strict-http.ts`, `fixtures.ts`,
`scripted-llm.ts`).

## Production seam: capability registration for builtin tools

None of the memo/memory/instruction/history tools carry a capability id today —
`CORE_TOOL_CAPABILITIES` (`src/tools/core-capabilities.ts:10-69`) covers only `tasks.*`
and `meta.expand-result`. F3 adds 13 entries that the scripted model addresses with the
existing `callCapability(id, input)` decision, exactly as F1/F2 do:

| Capability id         | Wire name              | Notes                                                             |
| --------------------- | ---------------------- | ----------------------------------------------------------------- |
| `memos.save`          | `save_memo`            | provider-independent (`provider-independent-tools-builder.ts:48`) |
| `memos.search`        | `search_memos`         | semantic + FTS fallback                                           |
| `memos.list`          | `list_memos`           |                                                                   |
| `memos.archive`       | `archive_memos`        |                                                                   |
| `memos.promote`       | `promote_memo`         | provider-dependent (`tools-builder.ts:239`)                       |
| `memory.remember`     | `remember_memory`      | writes no vector (keyword-only recall)                            |
| `memory.search`       | `search_memory`        | recall cascade                                                    |
| `memory.forget`       | `forget_memory`        |                                                                   |
| `memory.list`         | `list_memory`          |                                                                   |
| `instructions.save`   | `save_instruction`     |                                                                   |
| `instructions.list`   | `list_instructions`    |                                                                   |
| `instructions.delete` | `delete_instruction`   |                                                                   |
| `history.lookup`      | `lookup_group_history` | thread-scoped group context only                                  |

Registration is unchanged: `registerOfferedCoreToolCapabilities`
(`src/tools/core-capabilities.ts:71-75`) iterates the map and registers each wire name
**only when present in the offered set**, so conditional gating is honored for free —
`promote_memo` registers only with a task provider, `lookup_group_history` only in a
thread-scoped group context. This is the roadmap's `capability-ids` seam; it lands first
and is reviewed independently (rule 2).

## Harness seams

Each is harness-only, added under `tests/stories/harness/` with its own contract test.

### 1. Deterministic embeddings endpoint (`embeddings-endpoint`)

Config already resolves in the sandbox: `seedSystemLlmConfig`
(`tests/stories/harness/fixtures.ts:278-282`) seeds `llm_apikey`, `llm_baseurl`
(`https://llm.invalid/v1`), and `main_model`, and `resolveEffectiveLlmConfig`
(`src/llm-config-resolver.ts:52`) derives `embeddingModel = embedding_model ?? main_model`
— so `getEmbeddingForContext` returns a live config today rather than `null`. The seam is
therefore not config but a **declared responder** for the outbound embed call:

- Request (from `@ai-sdk/openai-compatible`): `POST https://llm.invalid/v1/embeddings`,
  body `{ model, input: [text], encoding_format: 'float' }`.
- Response the fake returns: `{ data: [{ embedding: number[] }] }`.
- Determinism: an **orthonormal basis per topic** — the responder inspects `input[0]`,
  maps a fixture keyword to a fixed unit basis vector, and returns it. A memo/query on the
  same topic gets the same vector (cosine `1.0 ≥ 0.65`, the shared threshold at
  `search-memos.ts:17` and `semantic-search.ts:20`); unrelated topics get an orthogonal
  vector (cosine `0.0`). No floating-point tuning against the threshold.

The endpoint is declared per story via the strict dispatcher (`world.http.expect`, one
expectation per embed call, FIFO-matched) behind a small fixture helper. It is exercised
by `memo-recall` (one embed at save, one at query) and `memory-capture-sweep` (the awaited
save embed inside the sweep). `memory-recall` deliberately does **not** use it (below).

### 2. Sweep-trigger primitives (`memory-extraction-llm`)

Both sweeps are single-pass, fully DI-able exports with no wall-clock or hardcoded model:
`sweepDirtyContexts(now, deps)` (`capture-sweep.ts:27`, `SweepDeps =
{ idleMs, loadHistory, runCapture }`) and `sweepPromotions(deps)`
(`promotion-sweep.ts:62`, `SweepPromotionsDeps = { evaluate, listScopes }`). The harness
adds `when.captureSweep()` / `when.promotionSweep()` primitives that invoke them with a
**fixed `now`** and world-provided deps, and route the model calls through the scripted
world model:

- **Capture** extraction (`runMemoryCapture` → `extractMemoryPatch`,
  `capture.ts:99-136`): the primitive injects a `runCapture`/extraction dep bound to
  `world.model`, so the extraction generation is scripted like any `given.llm` step
  instead of hitting a hand-authored chat endpoint. The new record's embedding is written
  through `saveMemoryRecordWithEmbedding` (`embedding-writer.ts:40`, **awaited**), which
  hits the declared embeddings endpoint.
- **Promotion** (`evaluatePromotion`, `promotion.ts:84-117`) is pure `memory_records` DB
  logic until a provisional cluster reaches `MEMORY_PROMOTION_MIN_THREADS = 3`
  (`promotion.ts:23,95`); only then does it call `confirmDurable` (a **chat** completion,
  not an embedding). The `memory-promotion-sweep` story seeds a cluster at that threshold
  and injects an `evaluate` dep whose `confirmDurable` routes through `world.model`, so the
  durable confirmation is scripted. No embeddings endpoint is touched by promotion.

### 3. State-seeding fixtures

- **Dirty/idle context** for capture: seed `conversation_history` plus the
  `memory_extraction_state` row so the seeded context is "dirty" and older than
  `SweepDeps.idleMs` relative to the fixed `now`.
- **Provisional cluster** for promotion: seed ≥3-thread provisional `memory_records` — the
  exact shape that makes `evaluatePromotion` reach `confirmDurable`.
- **Group history** for history-lookup: seed the main-group `conversation_history` behind a
  thread-scoped group context (the only context that offers `lookup_group_history`).

### 4. Fire-and-forget embed settle guarantee

`save_memo` schedules its embedding as fire-and-forget
(`src/tools/save-memo.ts:33-48` — `void getEmbeddingForContext(...).then(updateMemoEmbedding)`,
not awaited), so the tool returns before the vector is written. `memo-recall` is written as
a **two-turn** story (save, then recall) and relies on `world.settle()` draining the
pending embed before the recall turn. If `settle()` does not already drain such promises,
the plan adds that guarantee; the declared embeddings expectation plus `verifyConsumed()`
proves the embed actually fired.

## Story files

Behavioral shapes; every scenario qualifies through a reply or a durable change observed on
a following turn (rule 3 — no assertion-only stories).

### `tests/stories/memory/memos.story.test.ts` (4)

| Scenario           | Shape                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCN-memo-save`    | `callCapability('memos.save', …)`; a follow-up `list_memos` turn surfaces the saved memo in the reply                                             |
| `SCN-memo-recall`  | Turn 1 save (embed settles); turn 2 `search_memos` semantic hit via the fake endpoint → reply quotes the memo; an unrelated query returns nothing |
| `SCN-memo-archive` | Seed memos → `archive_memos` → follow-up `list_memos` excludes the archived memo                                                                  |
| `SCN-memo-promote` | `promote_memo` against the memory task provider → `then.task(title).exists()`                                                                     |

### `tests/stories/memory/memory.story.test.ts` (5)

| Scenario                     | Shape                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCN-memory-remember`        | `remember_memory` → follow-up `list_memory` (or keyword `search_memory`) surfaces the record                                                                               |
| `SCN-memory-recall`          | `remember_memory` then `search_memory` on the **keyword** path (production truth: remember writes no vector) → reply quotes the record                                     |
| `SCN-memory-forget`          | Seed records → `forget_memory` → follow-up `list_memory` shows it gone                                                                                                     |
| `SCN-memory-capture-sweep`   | Seed dirty/idle context → `when.captureSweep()` (scripted extraction + awaited embed) → follow-up `search_memory`/`list_memory` shows the captured fact                    |
| `SCN-memory-promotion-sweep` | Seed a ≥3-thread provisional cluster → `when.promotionSweep()` (scripted `confirmDurable`) → the record is promoted to durable, observed on a following `list_memory` turn |

### `tests/stories/memory/instructions.story.test.ts` (2)

| Scenario                       | Shape                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `SCN-instructions-save`        | `save_instruction` → follow-up `list_instructions` surfaces it                                        |
| `SCN-instructions-list-delete` | Seed instructions → `list_instructions` then `delete_instruction` → follow-up list shows the deletion |

### `tests/stories/context/history-lookup.story.test.ts` (1)

| Scenario             | Shape                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCN-history-lookup` | Thread-scoped group context with seeded main-group history → `lookup_group_history` (extraction via the scripted small model) → reply reflects the looked-up content |

## Reclassification (roadmap rule 6)

`SCN-fetch-chat-link` had the audit record `needs:[capability-ids, public-url-assertion]`
with the rationale "the fetch path performs a real DNS lookup unless assertPublicUrl is
injected." Research disproved this: `fetch_chat_link` (`src/tools/fetch-chat-link.ts:29`)
resolves a Mattermost permalink purely through the authenticated Mattermost REST API
(`resolveChatLink` → `src/chat/mattermost/link-resolver.ts:265`) and only regex-parses the
URL for a post id — it **never calls `assertPublicUrl`**. `assertPublicUrl`
(`src/web/safe-fetch.ts:84`, the real DNS/SSRF guard) is reached only by `web_fetch`, which
belongs to family F6.

Corrected record: `needs:[capability-ids, platform-adapter-fakes]` — the scenario needs a
Mattermost REST resolver fake (or a `resolveChatLink` DI seam), which does not exist and is
not built speculatively (consistent with F8's platform-fake discipline). It **stays
pending** with the corrected rationale; `public-url-assertion` remains an F6-only seam.

## Deliberate exclusions

- **No embeddings endpoint for `memory-recall`.** `remember_memory`
  (`src/tools/memory.ts:96`) calls `saveMemoryRecord` and writes no vector, so semantic
  `search_memory` is unreachable from an explicit remember. The scenario asserts the
  keyword path — the true production behavior — and the semantic memory pipeline is proven
  by `memory-capture-sweep`, the only producer of embedded memory records.
- **No new seam ids.** All four seams used (`capability-ids`, `embeddings-endpoint`,
  `memory-extraction-llm`, `platform-adapter-fakes`) already exist in `STORY_SEAM_IDS`.
- **No clock seam.** The sweep primitives pass a fixed `now`; no virtual-time injection
  (deferred to tiering phase 5).
- **No hand-authored chat/embedding HTTP for scripted generations.** Capture extraction and
  promotion confirmation route through the scripted world model, not declared chat routes.
- `SCN-fetch-chat-link` stays pending (reclassified above).

## Ledger updates (same PR, roadmap rule 5)

Twelve `AUDIT_RECORDS` entries move from pending to executable story mappings with
`verifiedAt: '2026-07-20'`; the `SCN-fetch-chat-link` record is rewritten with the
corrected seam and rationale. Contract-test totals update to **128 ids / 81 executable /
47 pending**, and the runner manifest totals line follows.

## Success criteria

- 12 new scenarios pass sandboxed (`bun test:stories`).
- Ledger: 81 executable / 47 pending; runner prints the updated totals line.
- The one production change (13 capability-id entries) lands first, is reviewed alone, and
  is covered by the memo/memory/instruction/history stories that resolve those capabilities.
- `bun test:stories:contracts`, typecheck, and lint stay green; the compat baseline is
  re-recorded only if a frozen harness file changed intentionally.

## Risks

1. **Fire-and-forget embed settle** — mitigated by the two-turn `memo-recall` shape plus a
   `world.settle()` drain guarantee and `verifyConsumed()`.
2. **Deterministic vectors across the 0.65 threshold** — mitigated by the orthonormal-basis
   responder (cosine `1.0` vs `0.0`), never a tuned near-threshold value.
3. **Strict-http one-shot expectations vs. multiple embed calls per story** — the fixture
   registers one expectation per embed call (or a persistent responder); the plan decides.
4. **Promotion `confirmDurable` gate** — the story seeds exactly at
   `MEMORY_PROMOTION_MIN_THREADS`, so the durable confirmation actually fires and is scripted.
5. **Sweep deps-injection stability** — the sweep export signatures already exist on master;
   the harness consumes them without changing production, so the compat proof is unaffected.

## Post-implementation deviations (2026-07-20)

The implementation held to the spec's decisions (fake-embedding semantic path, keyword
`memory-recall`, `fetch-chat-link` reclassified, 12 scenarios, ledger 69→81) but refined
several mechanisms. Recorded here rather than rewriting each section above.

- **Rule-3 observation mechanism.** Scripted `answer(text)` is emitted unconditionally, so
  asserting reply text alone does not observe real behavior. Every read/list/recall scenario
  instead asserts on the real tool result via
  `world.model.inspections().at(-1)?.promptToolResultTokenFingerprints` containing
  `promptTextFingerprint('<distinctive token>')` (the established
  `lifecycle-and-policy.story.test.ts` pattern), and mutations assert a token appearing or
  disappearing (`.not.toContain`) on a following real list turn. `memo-promote` observes via
  `then.task().exists()`.
- **Embeddings fixture is one-shot, not orthonormal-basis.** The harness seam is
  `expectEmbedding(world.http, embedding = MATCH_EMBEDDING)` returning a fixed vector per
  declared call (`MATCH_EMBEDDING=[1,0,0,0]` / `MISMATCH_EMBEDDING=[0,1,0,0]`, cosine 1.0 vs
  0.0). Risk 2/3 above are subsumed by this: one expectation per embed call, no
  near-threshold tuning.
- **`memo-recall` seeds an embedded memo + one live query embed** (not the two-turn
  save-then-recall of the Story-files table), sidestepping `save_memo`'s fire-and-forget
  embed for the ranking under test. `memo-save` still exercises that floating embed, drained
  by the `world.settle()` strict-http `idle()` guarantee added in the harness (Risk 1's real
  fix — a settle drain, not a two-turn shape).
- **Which scenarios exercise the embeddings endpoint.** `memo-save` (floating), `memo-recall`
  (query), `memory-recall` (query, then keyword layer wins), and `memory-capture-sweep`'s
  follow-up `search_memory` query. **`memory-capture-sweep` itself does NOT hit the endpoint**
  — its record embed is supplied deterministically through the production
  `RunMemoryCaptureDeps.getEmbedding` DI seam (`MATCH_EMBEDDING`), because `--contracts`-mode
  harness tests skip the fetch-patching preload; story-mode (`bun test:stories`) does patch
  fetch, so the tool-path embeds above are intercepted normally. `memory-forget` makes **no**
  embed call — `forget_memory` resolves via direct FTS.
- **Sweep model calls are deterministic injected results, not a live scripted model.**
  `when.captureSweep({ records })` injects a canned `MemoryPatch` (and `getEmbedding`);
  `when.promotionSweep()` injects `evaluate` binding `confirmDurable → true`. Dirty-detection,
  idle-gating, scope resolution, DB writes, and the 3-thread promotion gate all run against
  the real, unmodified production code.
- **`history-lookup`'s internal small-model call.** `lookup_group_history` runs its own
  `getSmallModel`/`generateText` summarization (not the scripted main model), which in story
  mode is a real `POST https://llm.invalid/v1/chat/completions`. The story declares that route
  via `world.http.expect` with a canned chat completion; non-circular because an unreached
  (empty) history never fires the call and the strict dispatcher then fails on the unconsumed
  expectation.
- **New harness accessors** used by the memory/history stories: `world.scopedStorageContextId`,
  `world.groupScopeId`, `world.mainGroupStorageId`. Group-thread scenarios assert with
  `then.replyIn(thread)` (not `then.replyTo(user)`), which does not match thread replies.
- **Seeding is keyed by the config/scope id**, not the chat user id: `given.memo`'s `userId` is
  `world.scopedStorageContextId(dm)`.
