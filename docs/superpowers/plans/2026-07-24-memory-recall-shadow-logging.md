<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory Recall Shadow-Logging Implementation Plan (thread B, P1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a sampled, off-hot-path, **content-free** production instrument that, at memory-bearing turns, runs the counterfactual query-aware recall Tier 3 *would* run, **discards the records**, and logs only anonymized counts/scores about what it would have surfaced versus what the model actually pulled via `search_memory`. Output: the under-trigger funnel that decides (pre-registered gate) whether P2 (abstention harness) and Tier 3 (auto-injection) are built at all.

**Architecture:** A new append-only telemetry table `memory_recall_shadow_log`. A fire-and-forget hook (`queueMicrotask`, mirroring `src/cache-db.ts`) fires **after** the turn resolves, right after `emitLlmEnd` in `src/llm-orchestrator-invoke.ts:127` — so it adds **zero** latency to the user-facing turn and injects **nothing** into the prompt. The shadow reuses `runRecallCascade` with a **no-op `schedulePromotion` dep** so it is side-effect-free (no `lastSeenAt`/promotion mutation). Every high-cardinality string is keyed-hashed with the existing `keyedHash` (`src/stats/hashing.ts`, `stats_anonymity_salt`); the row holds only hashes/counts/enums/scores/bools — it inherits the `/stats/*` anonymity contract, and a schema-guard test makes a free-text column a build failure. A deterministic sampler and a default-OFF kill switch gate the whole path.

**Tech Stack:** Bun 1.3, strict TypeScript, Drizzle ORM over `bun:sqlite`, Zod v4, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md`

## Global Constraints

- Runtime **Bun**; strict TypeScript; **use `.js` extension in import paths**.
- Add the SPDX/BUSL header to every new TypeScript file (copy from `src/db/migrations/070_memory_record_injection.ts`).
- **Never** add lint-disable or type-ignore comments — fix the underlying issue.
- Error extraction: `error instanceof Error ? error.message : String(error)`.
- Structured, metadata-first pino logging; **never** log tokens, keys, or raw query/record content.
- **Anonymity is release-blocking.** No column, log line, or return value in this feature may carry message text, record bodies/snippets, `search_memory` query text, usernames, or workspace/project/task names. Only keyed-hashes, counts, enums, scores, bools.
- **Zero hot-path impact.** The instrument must not block, delay, or alter the user-facing turn, and must inject nothing into the prompt. Verified by test.
- **Default OFF.** The kill switch defaults off; a deployment opts in to run the study.
- Write each behavior test first, run it, confirm it fails, then implement (TDD).
- Do not touch capture, extraction, promotion, retrieval ranking, or the `search_memory` tool. `deriveInjectionQuery` is **out of scope** — the shadow query is the raw user turn (the floor).
- Run `bun run typecheck` and the relevant `bun test <file>` before each commit; the Write/Edit hook also runs lint/typecheck/format/license gates on staged files.

---

### Task 1: Storage foundation — `memory_recall_shadow_log` table + migration

**Files:**
- Create: `src/db/migrations/071_memory_recall_shadow_log.ts` (copy header/shape from `070_memory_record_injection.ts`)
- Modify: `src/db/index.ts` (import + append to `MIGRATIONS` after `migration070MemoryRecordInjection`, lines 83 / 188)
- Modify: `src/db/long-term-memory-schema.ts` (add `memoryRecallShadowLog` table)
- Test: `tests/db/migrations/071_memory_recall_shadow_log.test.ts`

**Interfaces:**
- Produces: `memoryRecallShadowLog` Drizzle table; `migration071MemoryRecallShadowLog: Migration`. Columns (SQL name → mode):
  `id` (text pk), `created_at` (integer), `scope_hash` (text), `context_hash` (text), `turn_ref` (text), `reader_model_id` (text), `active_record_count` (integer), `shadow_query_hash` (text), `shadow_query_len_bucket` (text enum), `shadow_hit_count` (integer), `shadow_top_score` (real, nullable), `shadow_top_provenance` (text enum, nullable), `shadow_top_record_hash` (text, nullable), `model_pulled` (integer boolean), `pull_count` (integer), `pull_query_hash` (text, nullable), `pull_result_count` (integer), `shadow_pull_overlap` (integer), `skipped_reason` (text enum, nullable — e.g. `no-active-records`). Index on `(reader_model_id, created_at)`.

- [ ] **Step 1: Write the failing migration test** — apply migrations to a fresh in-memory DB; assert `memory_recall_shadow_log` exists with the expected columns and that inserting a hash-only row round-trips. Expected: FAIL (table absent).
- [ ] **Step 2: Add the table** to `long-term-memory-schema.ts` and the migration file; register in `db/index.ts`.
- [ ] **Step 3: Run** `bun test tests/db/migrations/071_memory_recall_shadow_log.test.ts` → PASS. Also assert 071 applies cleanly on a DB already at 070.

---

### Task 2: The anonymized row builder (pure, content-free) — the anonymity guard

This is the anonymity-critical seam: a pure function from a rich in-memory outcome to the safe row. Test it hardest.

**Files:**
- Create: `src/long-term-memory/shadow-log-row.ts`
- Test: `tests/long-term-memory/shadow-log-row.test.ts`

**Interfaces:**
- `type ShadowOutcome` (in-memory, may reference ids/queries): `{ scope, contextId, turnRef, readerModelId, activeRecordCount, shadowQuery, shadowHits: ReadonlyArray<{ id; score; provenance }>, pull: { pulled; queries: string[]; resultIds: string[] } }`.
- `buildShadowLogRow(outcome: ShadowOutcome): ShadowLogRow` — applies `keyedHash` to scope, context, query, top-record id, and each pull query; buckets query length; computes `shadow_pull_overlap` = |{shadow top-k ids} ∩ {pull result ids}|. The **output type** contains only hash/count/enum/score/bool fields — no string field may carry raw content.

- [ ] **Step 1: Write failing tests:**
  - the returned row's `scope_hash`/`shadow_query_hash`/`shadow_top_record_hash`/`pull_query_hash` equal `keyedHash(...)` of the inputs (not the raw values);
  - **anonymity guard:** every string field of `ShadowLogRow` either is a 64-char hex hash or belongs to a fixed enum/id allow-list — a test that enumerates the row's keys and fails if any value equals a raw input query/record snippet;
  - `shadow_pull_overlap` counts id-intersection correctly on a fixture;
  - `shadow_query_len_bucket` maps lengths to the fixed buckets.
- [ ] **Step 2: Implement** `buildShadowLogRow`. Reuse `keyedHash` from `src/stats/hashing.ts`.
- [ ] **Step 3: Run** the test file → PASS.

> **Note:** keep `buildShadowLogRow` the *only* place a raw string enters and a hash leaves. The insert path (Task 6) must accept `ShadowLogRow`, never `ShadowOutcome`, so raw content is structurally unable to reach the DB.

---

### Task 3: Side-effect-free shadow recall + zero-record precondition

**Files:**
- Create: `src/long-term-memory/shadow-recall.ts`
- Test: `tests/long-term-memory/shadow-recall.test.ts`

**Interfaces:**
- `runShadowRecall(input: { storageContextId; configContextId; contextType; query; limit? }, deps?): Promise<{ hits: ReadonlyArray<{ id; score; provenance }>; activeRecordCount: number; skippedReason?: 'no-active-records' }>`.
- Internally: (1) count active records in scope; if `0`, return `{ hits: [], activeRecordCount: 0, skippedReason: 'no-active-records' }` **without** embedding or scanning. (2) Otherwise call `runRecallCascade` with `deps.schedulePromotion = () => {}` (no-op — shadow must not mutate promotion/`lastSeenAt`) and map hits to `{ id, score, provenance }` only.

- [ ] **Step 1: Write failing tests:**
  - a scope with **0 active records** performs **no** embedding call (assert via spied `getEmbedding`) and returns `skippedReason: 'no-active-records'`;
  - a scope with records calls `runRecallCascade` and returns id/score/provenance only;
  - **side-effect-free:** the injected `schedulePromotion` is never invoked (spy asserts 0 calls) — shadow does not schedule promotion.
- [ ] **Step 2: Implement** `runShadowRecall` wrapping `runRecallCascade` (`src/long-term-memory/recall-cascade.ts`) with the no-op promotion dep and the count precondition (reuse the existing active-record count query used by `listMemoryRecords`).
- [ ] **Step 3: Run** → PASS.

---

### Task 4: Extract the model's `search_memory` pulls from `result.steps` (pure)

**Files:**
- Create: `src/long-term-memory/shadow-pull-extract.ts`
- Test: `tests/long-term-memory/shadow-pull-extract.test.ts`

**Interfaces:**
- `extractSearchMemoryPulls(steps: ResolvedStreamTextResult['steps']): { pulled: boolean; pullCount: number; queries: string[]; resultIds: string[] }`.
- Walks `steps[].toolCalls` for `toolName === 'search_memory'` (registered in `src/tools/provider-independent-tools-builder.ts:56`); reads each call's `input.query`; correlates the matching `toolResults[].output` by `toolCallId` to collect returned record ids. Tolerant of missing/oddly-shaped outputs (Zod-parse defensively; unknown shape ⇒ empty ids, not a throw).

- [ ] **Step 1: Write failing tests:** no `search_memory` call ⇒ `{ pulled:false, pullCount:0, queries:[], resultIds:[] }`; one call ⇒ query + result ids extracted; two calls ⇒ `pullCount:2`, ids merged; malformed output ⇒ no throw, empty ids.
- [ ] **Step 2: Implement** with a defensive Zod schema for the tool input/output shapes.
- [ ] **Step 3: Run** → PASS.

---

### Task 5: Deterministic sampler + kill switch

**Files:**
- Create: `src/long-term-memory/shadow-log-config.ts`
- Test: `tests/long-term-memory/shadow-log-config.test.ts`

**Interfaces:**
- `isShadowLoggingEnabled(): boolean` — reads `process.env['MEMORY_SHADOW_LOG_ENABLED']`, default **false** (only `'true'` enables). Convention per `src/startup-helpers.ts`.
- `shadowSampleRate(): number` — reads `process.env['MEMORY_SHADOW_LOG_SAMPLE_RATE']`, default `0.1`, clamped `[0,1]`.
- `shouldSampleTurn(contextId: string, turnRef: string, rate: number): boolean` — deterministic: `keyedHash(`shadow:${contextId}:${turnRef}`)` → take the first bytes as a uniform fraction → `< rate`. Reproducible, evenly spread, no `Math.random`.

- [ ] **Step 1: Write failing tests:** flag unset ⇒ disabled; `'true'` ⇒ enabled; same `(contextId, turnRef)` always yields the same sample decision across calls; the sampled fraction over many synthetic `turnRef`s is within tolerance of `rate`; `rate:0` ⇒ never, `rate:1` ⇒ always.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** → PASS. Document both env vars in `docs/architecture/environment.md`.

---

### Task 6: The orchestration hook — off hot path, fire-and-forget

**Files:**
- Create: `src/long-term-memory/shadow-log.ts` (the orchestrator-facing entrypoint + the async insert)
- Modify: `src/llm-orchestrator-invoke.ts` (call the hook right after `emitLlmEnd`, line 127)
- Modify: `src/long-term-memory/store.ts` (add `insertShadowLogRow(row: ShadowLogRow): void`)
- Test: `tests/long-term-memory/shadow-log.test.ts`

**Interfaces:**
- `scheduleShadowRecallLog(args: { contextId; configId; contextType; readerModelId; turnRef; messages; steps }): void` — synchronous, returns immediately; schedules the real work in a `queueMicrotask` (pattern: `src/cache-db.ts`). Inside the microtask: guard `isShadowLoggingEnabled()` and `shouldSampleTurn(...)`; resolve scope via `resolveMemoryScope`; extract the **last user message text** from `messages` as the floor query; `runShadowRecall(...)`; `extractSearchMemoryPulls(steps)`; `buildShadowLogRow(...)`; `insertShadowLogRow(...)`. All wrapped so any failure logs `warn` and never surfaces to the turn.
- `insertShadowLogRow` accepts only `ShadowLogRow` (hashes/counts) — never the raw outcome.

- [ ] **Step 1: Write failing tests:**
  - **off hot path:** `scheduleShadowRecallLog` returns before any recall/insert runs (spied deps show 0 calls synchronously; they run after a microtask flush);
  - kill switch OFF ⇒ no recall, no row;
  - sampler excludes the turn ⇒ no recall, no row;
  - a full sampled turn writes exactly one row whose hashes match `keyedHash` of the inputs and whose `model_pulled`/`shadow_pull_overlap` reflect the `steps`;
  - a thrown error inside the microtask is swallowed (logged `warn`), no rethrow.
- [ ] **Step 2: Implement** the hook and the store insert; wire the single call site in `llm-orchestrator-invoke.ts` after `emitLlmEnd`. Thread `configId` through (already on the invocation opts) for the recall embedding creds.
- [ ] **Step 3: Run** the file + `bun test tests/llm-orchestrator*` to confirm no turn-path regression → PASS.

> **Hot-path proof:** the call site is *after* `emitLlmEnd`, the body is a `queueMicrotask`, and Step 1 asserts synchronous return with zero pre-flush work. This is the load-bearing "zero latency, injects nothing" guarantee.

---

### Task 7: Funnel aggregation reader + operator script

**Files:**
- Create: `src/long-term-memory/shadow-funnel.ts`
- Create: `scripts/memory-shadow-funnel.ts` (bun script; prints the funnel)
- Test: `tests/long-term-memory/shadow-funnel.test.ts`

**Interfaces:**
- `computeShadowFunnel(opts?: { readerModelId?: string }): ReadonlyArray<{ readerModelId; memoryBearingTurns; shadowHitTurns; underTriggerTurns; underTriggerRate; overlapWhenPulled; overPullTurns }>` — aggregates rows **keyed per reader model**; **refuses to average across model ids** (returns one entry per model). `underTriggerTurns` = rows where `shadow_hit_count ≥ 1 (above threshold) AND model_pulled = false`.

- [ ] **Step 1: Write failing tests:** on a seeded set of rows spanning two reader models, the funnel counts each bucket correctly and returns **two** entries (no cross-model averaging); the `shadow_hit` threshold is applied; `underTriggerRate = underTriggerTurns / memoryBearingTurns`.
- [ ] **Step 2: Implement** the aggregation (SQL `GROUP BY reader_model_id`) and the print script.
- [ ] **Step 3: Run** → PASS.

---

### Task 8: Pre-registration note + docs cross-link

**Files:**
- Modify: `docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md` (fill the concrete pre-registered numbers once chosen: sample rate, `shadow_hit` score/rank threshold, bucket-3 stop threshold, N sampled turns, M distinct scopes)
- Modify: `docs/architecture/environment.md` (document `MEMORY_SHADOW_LOG_ENABLED`, `MEMORY_SHADOW_LOG_SAMPLE_RATE`)
- Modify: `docs/research/agent-memory/implementation-status.md` ("Reader-level evaluation" → note P1 shadow-logging landed as the first thread-B code)

- [ ] **Step 1:** Record the pre-registered thresholds **before** enabling collection on any deployment (frozen-protocol discipline — no post-hoc goalpost-moving).
- [ ] **Step 2:** Update the env + status docs.
- [ ] **Step 3:** Leave the kill switch **OFF** in committed defaults; enabling is an explicit per-deployment opt-in.

---

## Sequencing & rollout

1. Tasks 1→2→3→4→5 are independent leaf modules — can be built in any order (or parallel), each fully TDD'd.
2. Task 6 composes them at the single orchestrator seam; Task 7 reads what 6 writes.
3. **Ship dark:** merge with the kill switch OFF. Validate the funnel on the frozen synthetic corpus first (the spec's dry-run option) before any deployment opts in.
4. Enable on an opted-in deployment; collect to the pre-registered N/M; run `computeShadowFunnel`; record the go/no-go in the spec.
5. **Gate:** below-threshold bucket-3 ⇒ shelve `deriveInjectionQuery`, do **not** build P2/Tier 3. At/above + high overlap ⇒ proceed to P2 (`2026-07-24-memory-abstention-measurement-design.md`).

## Definition of done

- All eight tasks' tests pass; `bun run typecheck` clean; no lint/format/license/hook violations.
- Anonymity guard test (Task 2) is present and would fail if a free-text column were added.
- Hot-path proof test (Task 6) is present and asserts synchronous return with zero pre-flush work.
- Kill switch defaults OFF; both env vars documented.
- The instrument, when enabled, writes content-free rows and `computeShadowFunnel` reports the per-reader-model under-trigger funnel.
