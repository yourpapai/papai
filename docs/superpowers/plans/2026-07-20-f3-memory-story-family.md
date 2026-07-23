<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# F3 Memory Story Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 12 `memo-*`/`memory-*`/`instructions-*`/`history-lookup` scenarios real, moving the catalog ledger from 69 to 81 executable stories, and reclassify `fetch-chat-link`.

**Architecture:** 13 production capability-id entries first (reviewed alone); then harness seams (a strict-http in-flight drain, a deterministic embeddings fixture, DB seed helpers, and two single-pass sweep primitives); then three story files plus a history-lookup story; then the ledger + totals update; then a spec reconciliation.

**Tech Stack:** Bun, TypeScript (strict), bun:test.

**Spec:** `docs/superpowers/specs/2026-07-20-f3-memory-story-family-design.md`

**Ledger after this plan:** 128 ids, 81 executable, 47 pending (2 `executable-as-is`, 23 `needs-seam`, 22 `blocked`). Story suite grows by 12 scenarios.

**Frozen-tree note:** this plan changes frozen inputs (harness `strict-http.ts`, `world.ts`, `scenario.ts`, `fixtures.ts`, new harness files, catalog `coverage.ts`). Re-record the compat baseline after landing. Stories run sandboxed (`bun test:stories`, Docker required); contract files run via `bun test:stories:contracts`.

## Global Constraints

- Strict TypeScript; **use `.js` extension in import paths** (repo convention).
- **Never add lint-disable or type-ignore comments** — the write hook blocks them.
- Error extraction: `error instanceof Error ? error.message : String(error)`.
- Prefer DI over module mocking. Harness DB access is always "import the real `src/*` function that calls `getDrizzleDb()`" or a `getTestDb().insert(...)` helper — there is no `world.db`.
- Every new/edited file keeps the BUSL license header already present in its siblings.
- Roadmap rules: (2) the capability seam lands first and is reviewed independently; (3) no assertion-only stories — every scenario qualifies through a reply or a durable change on a following turn; (5) ledger updates ride in this PR; (6) reclassification records its rationale.

## Domain facts (verified against src/) — read before writing any task

- **Capability registration** (`src/tools/core-capabilities.ts:71-75`): `registerOfferedCoreToolCapabilities` iterates `CORE_TOOL_CAPABILITIES` and registers `catalog.register(id, wireName)` **only when `tools[wireName] !== undefined`** in the offered set. Adding a map entry is sufficient; conditional gating (`promote_memo` needs a task provider, `lookup_group_history` needs a thread-scoped group context) is honored for free.
- **Scripted tool calls** (`tests/stories/harness/scripted-llm.ts`): `callCapability(id, input)` + `answer(text)`. `autoLoadTools: true` is wired (`world.ts:397`), so the **first** capability call to a not-yet-advertised tool auto-inserts one `load_tool` hop transparently — scripted decision lists stay `[callCapability(...), answer(...)]`, no manual `load_tool`.
- **Recall path** (`src/tools/search-memos.ts`, `src/long-term-memory/recall-cascade.ts`): because the world seeds LLM config (`seedSystemLlmConfig`, `world.ts:427`), `getEmbeddingForContext` resolves and the semantic layer runs first, calling embeddings. Memo semantic hits carry `score`; keyword hits do not. Memory recall over records **without** an embedding falls back to the keyword layer even though the query embed still fires.
- **`save_memo` embed is fire-and-forget** (`src/tools/save-memo.ts:33-48`, `void getEmbeddingForContext(...).then(updateMemoEmbedding)`), so it emits a floating `POST /embeddings`. `world.settle()` must drain in-flight strict-http requests (Task 2) or that request is undeclared/unconsumed at teardown.
- **`remember_memory` writes NO vector** (`src/tools/memory.ts:96` → `saveMemoryRecord`), so `memory-recall` is keyword-only by production truth.
- **Capture sweep** (`src/long-term-memory/capture-sweep.ts:27`, `capture.ts:99`): `runMemoryCapture` **returns early unless `contextType === 'group' && hasThreadContextId(storageContextId)`** and the scope's `memory_profiles.enabled !== false` (a missing profile is fine). It writes records with `status: 'provisional'`, `source: 'background'`, and awaits `saveMemoryRecordWithEmbedding` (a real, awaited `POST /embeddings`).
- **Promotion sweep** (`src/long-term-memory/promotion-sweep.ts:62`, `promotion.ts:84`): `defaultListScopes` selects distinct provisional `scopeType: 'group'` scopes. `evaluatePromotion` promotes only when the candidate's cluster (identical trimmed-lowercased `content`, or embeddings cosine ≥ 0.8) spans **≥ `MEMORY_PROMOTION_MIN_THREADS` (3)** distinct threads (from `threadContextId` + `evidence.threads`), and then `confirmDurable` returns yes. `SweepPromotionsDeps` exposes only `evaluate`/`listScopes`, so the harness injects a custom `evaluate` that binds `confirmDurable: async () => true`.
- **Production drives both sweeps with default deps** (`src/scheduler-instance.ts:83,90`): `sweepDirtyContexts(new Date().toISOString())` and `sweepPromotions()`. The harness primitives mirror this and substitute only model/embedding I/O.
- **Tool schemas** (exact, used verbatim in scripted inputs):
  - `save_memo`: `{ content: string(min1), tags?: string[], summary?: string }` → `{ id, content, tags, createdAt }`.
  - `search_memos`: `{ query: string(min1), mode?: 'keyword'|'semantic'|'auto'(=auto), limit?: int1-20(=5) }` → `{ results, mode }`; semantic hits add `score`.
  - `list_memos`: `{ limit?: int1-50(=10), status?: 'active'|'archived'(=active) }` → `{ memos }`.
  - `archive_memos`: `{ tag?, beforeDate?, memoIds?: string[], confidence: number(0-1, REQUIRED) }`; the confidence gate (≥0.85) is skipped on the `memoIds` path → `{ status: 'archived', count }`.
  - `promote_memo`: `{ memoId: string, projectId: string, title?, dueDate?: { date, time? } }` → `{ status: 'promoted', taskId, taskTitle, taskUrl, memoId, dueDate }`; calls `provider.createTask`, then archives the memo.
  - `remember_memory`: `{ content: string(3-2000), kind: MemoryKind, tags?, expiresAt? }` → `{ status: 'saved', id, kind }`. `MemoryKind ∈ preference|fact|decision|project_context|person_context|procedure|episode|reference`.
  - `search_memory`: `{ query: string(1-500), include_stale?, kind?, limit? }` → `{ records }` (each has `provenance`).
  - `list_memory`: `{ kind?, status?: MemoryStatus(=active), limit? }` → `{ records }`.
  - `forget_memory`: `{ memory_id?, query? }` → `{ status: 'forgotten', id } | { status: 'not_found' }`.
  - `save_instruction`: `{ text: string(min1) }` → `{ status: 'saved', instruction: { id, text } } | 'duplicate' | 'cap_reached' | 'invalid'`.
  - `list_instructions`: `{}` → `{ instructions: { id, text }[] }`.
  - `delete_instruction`: `{ id: string }` → `{ status: 'deleted' } | { status: 'not_found' }`.
  - `lookup_group_history`: `{ queries: string[] }` → a bare `string`.

## Refinements to reconcile into the spec (Task 8 rewrites these rows)

- **memo-recall** seeds an embedded memo directly (fixture) + one live query embed, instead of the spec's "save then recall" two-turn shape — sidesteps `save_memo`'s fire-and-forget embed for the ranking-under-test.
- **memory-capture-sweep / memory-promotion-sweep** realize `memory-extraction-llm` as **deterministic injected results** (a canned `MemoryPatch`; `confirmDurable → true`) via `deps`, not a live scripted-model generation. The embeddings endpoint is still exercised by the capture record's awaited embed and memo-recall's query embed.
- **memory-recall** still emits one query embed before the keyword layer wins (config resolves); the spec's "deliberately does not use it" becomes "the query embed fires but the record has no vector, so the keyword layer is what matches."
- Spec risk #1 is resolved by the `world.settle()` strict-http drain (Task 2), not a bespoke promise-drain.

---

### Task 1: Register 13 builtin capability ids (production seam)

**Files:**

- Modify: `src/tools/core-capabilities.ts:10-69` (`CORE_TOOL_CAPABILITIES`)
- Test: `tests/tools/core-capabilities.test.ts`

**Interfaces:**

- Produces: capability ids `memos.save/search/list/archive/promote`, `memory.remember/search/forget/list`, `instructions.save/list/delete`, `history.lookup` → their snake_case wire names. Later story tasks call these via `callCapability(id, input)`.

- [ ] **Step 1: Add the failing expectation first** — in `tests/tools/core-capabilities.test.ts`, extend the assertion that pins `CORE_TOOL_CAPABILITIES` entries (find the test that checks specific `id → wireName` pairs) to include the 13 new pairs:

```ts
expect(CORE_TOOL_CAPABILITIES['memos.save']).toBe('save_memo')
expect(CORE_TOOL_CAPABILITIES['memos.search']).toBe('search_memos')
expect(CORE_TOOL_CAPABILITIES['memos.list']).toBe('list_memos')
expect(CORE_TOOL_CAPABILITIES['memos.archive']).toBe('archive_memos')
expect(CORE_TOOL_CAPABILITIES['memos.promote']).toBe('promote_memo')
expect(CORE_TOOL_CAPABILITIES['memory.remember']).toBe('remember_memory')
expect(CORE_TOOL_CAPABILITIES['memory.search']).toBe('search_memory')
expect(CORE_TOOL_CAPABILITIES['memory.forget']).toBe('forget_memory')
expect(CORE_TOOL_CAPABILITIES['memory.list']).toBe('list_memory')
expect(CORE_TOOL_CAPABILITIES['instructions.save']).toBe('save_instruction')
expect(CORE_TOOL_CAPABILITIES['instructions.list']).toBe('list_instructions')
expect(CORE_TOOL_CAPABILITIES['instructions.delete']).toBe('delete_instruction')
expect(CORE_TOOL_CAPABILITIES['history.lookup']).toBe('lookup_group_history')
```

If no such pinning test exists, add a `test('registers the F3 builtin capability ids', () => { ... })` with the block above.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/tools/core-capabilities.test.ts`
Expected: FAIL — the new keys are `undefined`.

- [ ] **Step 3: Add the entries** — append to the `CORE_TOOL_CAPABILITIES` object literal (`src/tools/core-capabilities.ts`, before the closing `} as const)`):

```ts
  'memos.save': 'save_memo',
  'memos.search': 'search_memos',
  'memos.list': 'list_memos',
  'memos.archive': 'archive_memos',
  'memos.promote': 'promote_memo',
  'memory.remember': 'remember_memory',
  'memory.search': 'search_memory',
  'memory.forget': 'forget_memory',
  'memory.list': 'list_memory',
  'instructions.save': 'save_instruction',
  'instructions.list': 'list_instructions',
  'instructions.delete': 'delete_instruction',
  'history.lookup': 'lookup_group_history',
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/tools/core-capabilities.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint, then commit**

```bash
bun run typecheck && bun run lint
git add src/tools/core-capabilities.ts tests/tools/core-capabilities.test.ts
git commit -m "feat(tools): register memory/memo/instruction capabilities"
```

---

### Task 2: Strict-http in-flight drain + deterministic embeddings fixture

**Files:**

- Modify: `tests/stories/harness/strict-http.ts` (add in-flight tracking + `idle()`)
- Modify: `tests/stories/harness/world.ts` (`settle()` awaits `http.idle()`)
- Create: `tests/stories/harness/embeddings.ts` (constants + `expectEmbedding`)
- Test: `tests/stories/harness/strict-http.test.ts`, `tests/stories/harness/embeddings.test.ts`

**Interfaces:**

- Produces:
  - `StrictHttpDispatcher.idle(): Promise<void>` — resolves when no responder is in flight.
  - `MATCH_EMBEDDING: readonly number[]` = `[1, 0, 0, 0]`, `MISMATCH_EMBEDDING: readonly number[]` = `[0, 1, 0, 0]`.
  - `expectEmbedding(http: StrictHttpDispatcher, embedding?: readonly number[]): void` — declares one `POST https://llm.invalid/v1/embeddings` expectation returning `{ data: [{ embedding }] }` (default `MATCH_EMBEDDING`).

- [ ] **Step 1: Write the failing strict-http drain test** — add to `tests/stories/harness/strict-http.test.ts`:

```ts
test('idle() resolves after an in-flight responder settles', async () => {
  const http = createStrictHttpDispatcher(createScenarioEvents('idle drain'))
  let release = (): void => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  http.expect({ method: 'POST', url: 'https://api.test/slow' }, async () => {
    await gate
    return new Response(null, { status: 204 })
  })

  const inFlight = http.fetch('https://api.test/slow', { method: 'POST' })
  let idleResolved = false
  const idle = http.idle().then(() => {
    idleResolved = true
  })
  expect(idleResolved).toBe(false)
  release()
  await inFlight
  await idle
  expect(idleResolved).toBe(true)
  expect(() => http.verifyConsumed()).not.toThrow()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/stories/harness/strict-http.test.ts`
Expected: FAIL — `http.idle is not a function`.

- [ ] **Step 3: Implement in-flight tracking** — in `tests/stories/harness/strict-http.ts`, add to the `StrictHttpDispatcher` type: `idle(): Promise<void>`. In `createStrictHttpDispatcher`, track a `Set<Promise<Response>>` of in-flight responder promises: wrap the `runResponder(...)` call so the promise is added on start and removed on settle (both resolve and reject), and implement `idle` to await a snapshot of the set until it drains:

```ts
let inFlight: Set<Promise<unknown>> = new Set()
// inside fetch(), where the responder runs:
const pending = runResponder(expectation, request, events, actual)
inFlight.add(pending)
void pending.finally(() => {
  inFlight.delete(pending)
})
return pending
// idle():
async idle(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight])
  }
},
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/stories/harness/strict-http.test.ts`
Expected: PASS (all existing cases + the new one).

- [ ] **Step 5: Wire settle() to drain http** — in `tests/stories/harness/world.ts`, find `settle()` (delegates to `pending.settle`) and change it to drain http first:

```ts
settle: async (): Promise<void> => {
  await pending.settle()
  await http.idle()
},
```

(Keep the existing rethrow-of-failures behavior of `pending.settle`; `http.idle()` runs after.)

- [ ] **Step 6: Write the embeddings fixture + its test** — create `tests/stories/harness/embeddings.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { StrictHttpDispatcher } from './strict-http.js'

export const EMBEDDINGS_URL = 'https://llm.invalid/v1/embeddings'
export const MATCH_EMBEDDING: readonly number[] = [1, 0, 0, 0]
export const MISMATCH_EMBEDDING: readonly number[] = [0, 1, 0, 0]

export function expectEmbedding(http: StrictHttpDispatcher, embedding: readonly number[] = MATCH_EMBEDDING): void {
  http.expect({ method: 'POST', url: EMBEDDINGS_URL }, () => Response.json({ data: [{ embedding: [...embedding] }] }))
}
```

Create `tests/stories/harness/embeddings.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createScenarioEvents } from './events.js'
import { EMBEDDINGS_URL, MATCH_EMBEDDING, expectEmbedding } from './embeddings.js'
import { createStrictHttpDispatcher } from './strict-http.js'

describe('embeddings fixture', () => {
  test('serves a declared embedding vector on the OpenAI-compatible route', async () => {
    const http = createStrictHttpDispatcher(createScenarioEvents('embeddings'))
    expectEmbedding(http)
    const response = await http.fetch(EMBEDDINGS_URL, {
      method: 'POST',
      body: JSON.stringify({
        model: 'scenario-main-model',
        input: ['hello'],
        encoding_format: 'float',
      }),
    })
    expect(await response.json()).toEqual({
      data: [{ embedding: [...MATCH_EMBEDDING] }],
    })
    expect(() => http.verifyConsumed()).not.toThrow()
  })
})
```

- [ ] **Step 7: Run both harness tests**

Run: `bun test tests/stories/harness/strict-http.test.ts tests/stories/harness/embeddings.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck + lint, then commit**

```bash
bun run typecheck && bun run lint
git add tests/stories/harness/strict-http.ts tests/stories/harness/strict-http.test.ts tests/stories/harness/world.ts tests/stories/harness/embeddings.ts tests/stories/harness/embeddings.test.ts
git commit -m "test(stories): add strict-http drain and embeddings fixture"
```

---

### Task 3: DB seed helpers + sweep-trigger primitives

**Files:**

- Modify: `tests/utils/test-helpers.ts` (raw insert helpers)
- Modify: `tests/stories/harness/fixtures.ts` (`ScenarioFixtures` seed methods)
- Modify: `tests/stories/harness/scenario.ts` (`given.memo`/`given.memoryRecord`/`given.dirtyContext`/`given.instruction`, `when.captureSweep`/`when.promotionSweep`)
- Create: `tests/stories/harness/memory-seed.test.ts`
- Test: `tests/stories/harness/scenario.test.ts` (sweep primitives)

**Interfaces:**

- Consumes: `getTestDb()` and `schema` (`tests/utils/test-helpers.ts`); `saveMemo`, `updateMemoEmbedding` (`src/memos.ts`); `saveMemoryRecord` (`src/long-term-memory/store.ts`); `sweepDirtyContexts` (`src/long-term-memory/capture-sweep.ts`), `sweepPromotions` (`src/long-term-memory/promotion-sweep.ts`), `evaluatePromotion` (`src/long-term-memory/promotion.ts`), `runMemoryCapture` (`src/long-term-memory/capture.ts`).
- Produces (given/when DSL):
  - `given.memo(user, input: { content, tags?, summary?, embedding? }): { id: string }`
  - `given.memoryRecord(input: { scopeId, kind, content, status?, threadContextId?, threads?: string[], confidence?, embedding? }): { id: string }`
  - `given.dirtyContext(input: { storageContextId, configContextId, contextType?: 'group', history: string[], lastActivityAt?: string }): void`
  - `given.instruction(context, text: string): { id: string }`
  - `when.captureSweep(input: { records: MemoryPatchRecord[] }): Promise<void>` — runs `sweepDirtyContexts(FIXED_NOW, deps)` with a canned extraction patch + live embeddings.
  - `when.promotionSweep(): Promise<void>` — runs `sweepPromotions({ evaluate })` with `confirmDurable → true`.
- Constant produced: `FIXED_SWEEP_NOW = '2026-07-20T00:00:00.000Z'`.

- [ ] **Step 1: Write the failing seed-helper contract test** — create `tests/stories/harness/memory-seed.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { listMemos } from '../../../src/memos.js'
import { listMemoryRecords } from '../../../src/long-term-memory/store.js'
import { executeScenario } from './scenario.js'

describe('memory seed helpers', () => {
  test('given.memo persists a retrievable active memo with an embedding', async () => {
    await executeScenario('seed-memo', async ({ given }) => {
      const alice = given.user('alice')
      const seeded = given.memo(alice, {
        content: 'Deploy runbook lives in Notion',
        embedding: [1, 0, 0, 0],
      })
      expect(seeded.id).toBeTruthy()
      const memos = listMemos('alice', 10, 'active')
      expect(memos.map((m) => m.content)).toContain('Deploy runbook lives in Notion')
    })
  })

  test('given.memoryRecord persists a provisional group record', async () => {
    await executeScenario('seed-record', async ({ given }) => {
      given.memoryRecord({
        scopeId: 'group:g1',
        kind: 'fact',
        content: 'Team standup is at 10am',
        status: 'provisional',
        threadContextId: 'thread-1',
      })
      const rows = listMemoryRecords({
        scopeId: 'group:g1',
        scopeType: 'group',
        statuses: ['provisional'],
      })
      expect(rows.map((r) => r.content)).toContain('Team standup is at 10am')
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/stories/harness/memory-seed.test.ts` (or via `bun test:stories:contracts` scoping)
Expected: FAIL — `given.memo is not a function`.

- [ ] **Step 3: Add raw insert helpers** — in `tests/utils/test-helpers.ts`, after the existing `seedTestPlatformInstance` pattern, add:

```ts
export function seedTestMemoryExtractionState(input: {
  contextId: string
  contextType: 'dm' | 'group'
  configContextId: string
  lastActivityAt: string
  lastExtractedAt?: string
  lastHistoryLen?: number
}): void {
  getTestDb()
    .insert(schema.memoryExtractionState)
    .values({
      contextId: input.contextId,
      contextType: input.contextType,
      configContextId: input.configContextId,
      lastActivityAt: input.lastActivityAt,
      lastExtractedAt: input.lastExtractedAt ?? null,
      lastHistoryLen: input.lastHistoryLen ?? 0,
    })
    .onConflictDoNothing({ target: schema.memoryExtractionState.contextId })
    .run()
}

export function seedTestConversationHistory(input: { userId: string; messages: string }): void {
  getTestDb()
    .insert(schema.conversationHistory)
    .values({ userId: input.userId, messages: input.messages })
    .onConflictDoNothing({ target: schema.conversationHistory.userId })
    .run()
}

export function seedTestUserInstruction(input: { id: string; contextId: string; text: string }): void {
  getTestDb()
    .insert(schema.userInstructions)
    .values({ id: input.id, contextId: input.contextId, text: input.text })
    .onConflictDoNothing({ target: schema.userInstructions.id })
    .run()
}
```

(`schema` is already imported in `test-helpers.ts`; `memoryExtractionState`, `conversationHistory`, and `userInstructions` are re-exported from `src/db/schema.ts`.)

- [ ] **Step 4: Add fixtures seed methods** — in `tests/stories/harness/fixtures.ts`, import the memo/memory store functions and the new test-helpers, then add these `ScenarioFixtures` methods (and their type signatures in the `ScenarioFixtures` type):

```ts
// imports
import { saveMemo, updateMemoEmbedding } from '../../../src/memos.js'
import { saveMemoryRecord } from '../../../src/long-term-memory/store.js'
import { seedTestConversationHistory, seedTestMemoryExtractionState, seedTestUserInstruction } from '../../utils/test-helpers.js'

// methods
seedMemo(input: { userId: string; content: string; tags?: readonly string[]; summary?: string; embedding?: readonly number[] }): { id: string } {
  const memo = saveMemo(input.userId, input.content, input.tags ?? [], input.summary)
  if (input.embedding !== undefined) updateMemoEmbedding(memo.id, [...input.embedding])
  return { id: memo.id }
},
seedMemoryRecord(input: {
  id: string
  scopeId: string
  scopeType?: 'personal' | 'group'
  kind: string
  content: string
  status?: string
  source?: string
  threadContextId?: string
  threads?: readonly string[]
  confidence?: number
  embedding?: readonly number[]
  now: string
}): { id: string } {
  saveMemoryRecord({
    id: input.id,
    scopeId: input.scopeId,
    scopeType: input.scopeType ?? 'group',
    kind: input.kind as never,
    content: input.content,
    summary: null,
    tags: [],
    confidence: input.confidence ?? 0.6,
    status: (input.status ?? 'provisional') as never,
    source: (input.source ?? 'background') as never,
    evidence: { threads: [...(input.threads ?? (input.threadContextId ? [input.threadContextId] : []))] },
    threadContextId: input.threadContextId ?? null,
    createdAt: input.now,
    updatedAt: input.now,
    lastSeenAt: input.now,
    embedding: input.embedding ? new Float32Array([...input.embedding]) : null,
  })
  return { id: input.id }
},
seedDirtyContext(input: { storageContextId: string; configContextId: string; contextType?: 'dm' | 'group'; history: readonly string[]; lastActivityAt: string }): void {
  seedTestConversationHistory({
    userId: input.storageContextId,
    messages: JSON.stringify(input.history.map((content) => ({ role: 'user', content }))),
  })
  seedTestMemoryExtractionState({
    contextId: input.storageContextId,
    contextType: input.contextType ?? 'group',
    configContextId: input.configContextId,
    lastActivityAt: input.lastActivityAt,
  })
},
seedInstruction(input: { contextId: string; text: string }): { id: string } {
  const id = `instruction-${this.nextInstructionId()}`
  seedTestUserInstruction({ id, contextId: input.contextId, text: input.text })
  return { id }
},
```

(Add a small monotonic `nextInstructionId` counter to the fixtures closure, mirroring the existing `nextId` pattern. `saveMemoryRecord`'s `MemoryRecordInput` uses `Float32Array | null` for `embedding`; the `as never` casts satisfy the enum-typed columns without widening the public helper signature.)

- [ ] **Step 5: Add given/when DSL wiring** — in `tests/stories/harness/scenario.ts`:

Add to `ScenarioGiven` and `createGiven` (each begins with `prerequisite('given.<name>')`):

```ts
memo(user, input): { id: string } {
  prerequisite('given.memo')
  return world.fixtures.seedMemo({ userId: user.id, ...input })
},
memoryRecord(input): { id: string } {
  prerequisite('given.memoryRecord')
  return world.fixtures.seedMemoryRecord({ id: `memrec-${world.ids.next()}`, now: FIXED_SWEEP_NOW, ...input })
},
dirtyContext(input): void {
  prerequisite('given.dirtyContext')
  world.fixtures.seedDirtyContext(input)
},
instruction(context, text): { id: string } {
  prerequisite('given.instruction')
  return world.fixtures.seedInstruction({ contextId: scopedConfigContextId(context), text })
},
```

Add to `ScenarioWhen` and `createWhen` (mirroring `when.message`):

```ts
async captureSweep(input): Promise<void> {
  world.events.setPhase('when.captureSweep')
  await world.ensureStarted()
  await sweepDirtyContexts(FIXED_SWEEP_NOW, {
    idleMs: DEFAULT_SWEEP_IDLE_MS,
    loadHistory: (storageContextId) => getCachedHistory(storageContextId),
    runCapture: (captureInput) =>
      runMemoryCapture(captureInput, {
        extractMemoryPatch: async () => ({ records: input.records }),
        getEmbedding: (text, configContextId) =>
          getEmbeddingForContext(text, configContextId, {
            storageContextId: configContextId,
            contextType: 'group',
            chatUserId: configContextId,
          }),
        now: () => FIXED_SWEEP_NOW,
        randomUUID: () => `capture-${world.ids.next()}`,
      }),
  })
  await world.settle()
},
async promotionSweep(): Promise<void> {
  world.events.setPhase('when.promotionSweep')
  await world.ensureStarted()
  await sweepPromotions({
    listScopes: defaultPromotionScopes,
    evaluate: (scope, candidate) =>
      evaluatePromotion(scope, candidate, { confirmDurable: async () => true, now: () => FIXED_SWEEP_NOW }),
  })
  await world.settle()
},
```

Add imports at the top of `scenario.ts`:

```ts
import {
  sweepDirtyContexts,
  DEFAULT_IDLE_MS as DEFAULT_SWEEP_IDLE_MS,
} from '../../../src/long-term-memory/capture-sweep.js'
import { runMemoryCapture } from '../../../src/long-term-memory/capture.js'
import { sweepPromotions } from '../../../src/long-term-memory/promotion-sweep.js'
import { evaluatePromotion } from '../../../src/long-term-memory/promotion.js'
import { getCachedHistory } from '../../../src/cache.js'
import { getEmbeddingForContext } from '../../../src/embeddings.js'
```

Add `export const FIXED_SWEEP_NOW = '2026-07-20T00:00:00.000Z'` near the top. For `defaultPromotionScopes`, import the production default if exported; otherwise inline the same distinct-provisional-group-scope query used by `promotion-sweep.ts` via `listMemoryRecords`. Confirm `DEFAULT_IDLE_MS` is exported from `capture-sweep.ts` (it is, per `extraction-state.ts:13` re-export); if not, hardcode `600_000` with a comment.

- [ ] **Step 6: Add the sweep-primitive contract test** — append to `tests/stories/harness/memory-seed.test.ts`:

```ts
test('when.captureSweep persists a durable-eligible provisional record from a dirty context', async () => {
  await executeScenario('capture-sweep-primitive', async ({ given, when }) => {
    const g1 = given.group('g1')
    const thread = given.thread(g1, 'thread-1')
    given.dirtyContext({
      storageContextId: threadStorageId(thread),
      configContextId: 'g1',
      history: ['We always deploy on Fridays'],
      lastActivityAt: '2026-07-19T00:00:00.000Z',
    })
    await when.captureSweep({
      records: [
        {
          kind: 'fact',
          content: 'Team deploys on Fridays',
          confidence: 0.7,
          tags: [],
          evidence: {},
        },
      ],
    })
    const rows = listMemoryRecords({
      scopeId: scopeIdForThread(thread),
      scopeType: 'group',
      statuses: ['provisional'],
    })
    expect(rows.map((r) => r.content)).toContain('Team deploys on Fridays')
  })
})
```

Resolve `threadStorageId`/`scopeIdForThread` against the harness's `scopedStorageContextId` and `resolveMemoryScope` — the implementer computes the exact scope id the sweep writes (from `capture.ts` `resolveMemoryScope(storageContextId, 'group')`) and asserts against it. If the scope id is opaque, assert on the run instead by listing all provisional group records and matching content.

- [ ] **Step 7: Run the harness contract tests**

Run: `bun test tests/stories/harness/memory-seed.test.ts`
Expected: PASS. (If capture writes to an unexpected scope, fix the seed context/scope mapping until the persisted record is found.)

- [ ] **Step 8: Typecheck + lint, then commit**

```bash
bun run typecheck && bun run lint
git add tests/utils/test-helpers.ts tests/stories/harness/fixtures.ts tests/stories/harness/scenario.ts tests/stories/harness/memory-seed.test.ts
git commit -m "test(stories): add memory seed helpers and sweep primitives"
```

---

### Task 4: Memos story file (4 scenarios)

**Files:**

- Create: `tests/stories/memory/memos.story.test.ts`

**Interfaces:**

- Consumes: `scenario` (`../harness/scenario.js`), `callCapability`/`answer` (`../harness/scripted-llm.js`), `expectEmbedding`/`MATCH_EMBEDDING`/`MISMATCH_EMBEDDING` (`../harness/embeddings.js`).

- [ ] **Step 1: Write the four scenarios**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { MATCH_EMBEDDING, MISMATCH_EMBEDDING, expectEmbedding } from '../harness/embeddings.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

scenario('SCN-memo-save: saves a note and reads it back on a later turn', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  expectEmbedding(world.http) // save_memo fires a fire-and-forget embed; settle drains it
  given.llm([
    callCapability('memos.save', {
      content: 'Deploy runbook lives in Notion',
      tags: ['ops'],
    }),
    answer('Saved your note about the deploy runbook.'),
  ])
  await when.message(alice, dm, 'Remember: deploy runbook lives in Notion')
  then.replyTo(alice).equals('Saved your note about the deploy runbook.')

  given.llm([callCapability('memos.list', {}), answer('Your notes: Deploy runbook lives in Notion.')])
  await when.message(alice, dm, 'What notes do I have?')
  then.replyTo(alice).contains('Deploy runbook')
})

scenario('SCN-memo-recall: recalls a saved note by semantic search', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.memo(alice, {
    content: 'Deploy runbook lives in Notion',
    tags: ['ops'],
    embedding: MATCH_EMBEDDING,
  })
  expectEmbedding(world.http, MATCH_EMBEDDING) // the query embed
  given.llm([
    callCapability('memos.search', {
      query: 'where is the deploy runbook',
      mode: 'semantic',
    }),
    answer('Your deploy runbook lives in Notion.'),
  ])
  await when.message(alice, dm, 'Where did I put the deploy runbook?')
  then.replyTo(alice).contains('Notion')
})

scenario('SCN-memo-archive: archives notes by id and excludes them from active list', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const stale = given.memo(alice, { content: 'Old standup link' })
  given.memo(alice, { content: 'Current sprint goals' })
  given.llm([callCapability('memos.archive', { memoIds: [stale.id], confidence: 0.9 }), answer('Archived 1 note.')])
  await when.message(alice, dm, 'Archive the old standup note')
  then.replyTo(alice).equals('Archived 1 note.')

  given.llm([callCapability('memos.list', { status: 'active' }), answer('Active notes: Current sprint goals.')])
  await when.message(alice, dm, 'List my active notes')
  then.replyTo(alice).contains('Current sprint goals')
})

scenario('SCN-memo-promote: promotes a note into a task', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  const memo = given.memo(alice, {
    content: 'Write the incident postmortem',
  })
  given.llm([
    callCapability('memos.promote', {
      memoId: memo.id,
      projectId: 'proj-1',
      title: 'Write the incident postmortem',
    }),
    answer('Promoted your note to a task.'),
  ])
  await when.message(alice, dm, 'Turn that note into a task')
  then.replyTo(alice).equals('Promoted your note to a task.')
  await then.task('Write the incident postmortem').exists()
})
```

- [ ] **Step 2: Run the story file sandboxed**

Run: `bun test:stories 2>&1 | grep -iE "memo|fail|pass"`
Expected: the four `SCN-memo-*` scenarios PASS. Note: `MISMATCH_EMBEDDING` is imported for parity with the memory file; if unused here, drop the import to satisfy lint.

- [ ] **Step 3: Diagnose real failures, not the guards** — if `search_memos` returns `mode: 'keyword_fallback'` instead of a semantic hit, verify the seeded embedding and the declared query embed both use `MATCH_EMBEDDING`. If an undeclared `/embeddings` request fails `SCN-memo-save`, confirm Task 2's `settle()` drain landed.

- [ ] **Step 4: Typecheck + lint, then commit**

```bash
bun run typecheck && bun run lint
git add tests/stories/memory/memos.story.test.ts
git commit -m "test(stories): cover the memo tool surface"
```

---

### Task 5: Memory story file (5 scenarios)

**Files:**

- Create: `tests/stories/memory/memory.story.test.ts`

- [ ] **Step 1: Write the five scenarios**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { MATCH_EMBEDDING, expectEmbedding } from '../harness/embeddings.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

scenario('SCN-memory-remember: stores a durable memory and lists it', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.llm([
    callCapability('memory.remember', {
      content: 'Prefers metric units',
      kind: 'preference',
    }),
    answer("Noted — I'll use metric units."),
  ])
  await when.message(alice, dm, 'Always use metric units with me')
  then.replyTo(alice).contains('metric')

  given.llm([callCapability('memory.list', {}), answer('I remember: prefers metric units.')])
  await when.message(alice, dm, 'What do you remember about me?')
  then.replyTo(alice).contains('metric')
})

scenario('SCN-memory-recall: recalls a stored memory by keyword', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.llm([
    callCapability('memory.remember', {
      content: 'Home airport is SFO',
      kind: 'fact',
    }),
    answer('Got it.'),
  ])
  await when.message(alice, dm, 'My home airport is SFO')
  then.replyTo(alice).equals('Got it.')

  expectEmbedding(world.http) // recall cascade embeds the query before the keyword layer wins
  given.llm([callCapability('memory.search', { query: 'home airport' }), answer('Your home airport is SFO.')])
  await when.message(alice, dm, 'Which airport do I fly from?')
  then.replyTo(alice).contains('SFO')
})

scenario('SCN-memory-forget: forgets a stored memory by query', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.llm([
    callCapability('memory.remember', {
      content: 'Old office is on 3rd street',
      kind: 'fact',
    }),
    answer('Noted.'),
  ])
  await when.message(alice, dm, 'My office is on 3rd street')
  then.replyTo(alice).equals('Noted.')

  expectEmbedding(world.http) // forget-by-query resolves the record through the same recall path
  given.llm([callCapability('memory.forget', { query: 'office on 3rd street' }), answer('Forgotten.')])
  await when.message(alice, dm, 'Forget where my office is')
  then.replyTo(alice).equals('Forgotten.')

  given.llm([callCapability('memory.list', {}), answer('I have no memories about your office.')])
  await when.message(alice, dm, 'What do you remember about my office?')
  then.replyTo(alice).contains('no memories')
})

scenario(
  'SCN-memory-capture-sweep: captures a memory from an idle group thread',
  async ({ given, when, then, world }) => {
    const g1 = given.group('g1')
    const alice = given.user('alice')
    given.member(g1, alice)
    const thread = given.thread(g1, 'thread-1')
    given.dirtyContext({
      storageContextId: world.scopedStorageContextId(thread),
      configContextId: g1.id,
      history: ['We always cut releases on Fridays'],
      lastActivityAt: '2026-07-19T00:00:00.000Z',
    })
    expectEmbedding(world.http) // capture awaits the record embed
    await when.captureSweep({
      records: [
        {
          kind: 'fact',
          content: 'Team cuts releases on Fridays',
          confidence: 0.7,
          tags: [],
          evidence: {},
        },
      ],
    })

    given.llm([
      callCapability('memory.search', { query: 'when do we cut releases' }),
      answer('Your team cuts releases on Fridays.'),
    ])
    expectEmbedding(world.http) // the recall query embed
    await when.message(alice, thread, 'When do we usually release?')
    then.replyTo(alice).contains('Fridays')
  },
)

scenario(
  'SCN-memory-promotion-sweep: promotes a cross-thread provisional cluster to durable',
  async ({ given, when, then, world }) => {
    const g1 = given.group('g1')
    const alice = given.user('alice')
    given.member(g1, alice)
    const scopeId = world.groupScopeId(g1)
    for (const thread of ['thread-1', 'thread-2', 'thread-3']) {
      given.memoryRecord({
        scopeId,
        kind: 'fact',
        content: 'Team standup is at 10am',
        status: 'provisional',
        threadContextId: thread,
      })
    }
    await when.promotionSweep()

    const mainThread = given.thread(g1, 'thread-9')
    given.llm([callCapability('memory.list', { status: 'active' }), answer('I durably remember: standup is at 10am.')])
    expectEmbedding(world.http) // if list triggers no embed this line is dropped during diagnosis
    await when.message(alice, mainThread, 'What do you durably remember?')
    then.replyTo(alice).contains('10am')
  },
)
```

- [ ] **Step 2: Run the story file sandboxed**

Run: `bun test:stories 2>&1 | grep -iE "memory|fail|pass"`
Expected: the five `SCN-memory-*` scenarios PASS.

- [ ] **Step 3: Diagnose against the domain facts** — `list_memory` defaults to `status: 'active'`, so provisional records are invisible until promoted; the promotion scenario asserts the promoted record appears. Capture only fires for `group` + thread context; confirm `world.scopedStorageContextId`/`world.groupScopeId` expose the exact ids the sweep writes to (add thin accessors on `world` in Task 3 if missing, and update this file's calls to match). Remove any `expectEmbedding` line whose embed does not actually fire (an unconsumed expectation fails `verifyConsumed()`); keep only the ones the run demands.

- [ ] **Step 4: Typecheck + lint, then commit**

```bash
bun run typecheck && bun run lint
git add tests/stories/memory/memory.story.test.ts
git commit -m "test(stories): cover the long-term memory tool surface"
```

---

### Task 6: Instructions + history-lookup stories (3 scenarios)

**Files:**

- Create: `tests/stories/memory/instructions.story.test.ts`
- Create: `tests/stories/context/history-lookup.story.test.ts`

- [ ] **Step 1: Write the two instruction scenarios** — `tests/stories/memory/instructions.story.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

scenario('SCN-instructions-save: saves a custom instruction and lists it', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.llm([
    callCapability('instructions.save', { text: 'Always reply in Spanish' }),
    answer('Saved that instruction.'),
  ])
  await when.message(alice, dm, 'Always reply to me in Spanish')
  then.replyTo(alice).equals('Saved that instruction.')

  given.llm([callCapability('instructions.list', {}), answer('Your instructions: Always reply in Spanish.')])
  await when.message(alice, dm, 'What instructions do you have?')
  then.replyTo(alice).contains('Always reply in Spanish')
})

scenario('SCN-instructions-list-delete: lists then deletes an instruction', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const seeded = given.instruction(dm, 'Never use emojis')
  given.llm([callCapability('instructions.list', {}), answer('Your instructions: Never use emojis.')])
  await when.message(alice, dm, 'List my instructions')
  then.replyTo(alice).contains('Never use emojis')

  given.llm([callCapability('instructions.delete', { id: seeded.id }), answer('Deleted that instruction.')])
  await when.message(alice, dm, 'Delete the no-emoji rule')
  then.replyTo(alice).equals('Deleted that instruction.')

  given.llm([callCapability('instructions.list', {}), answer('You have no saved instructions.')])
  await when.message(alice, dm, 'List my instructions')
  then.replyTo(alice).contains('no saved instructions')
})
```

- [ ] **Step 2: Write the history-lookup scenario** — `tests/stories/context/history-lookup.story.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

scenario('SCN-history-lookup: searches the main group history from a thread', async ({ given, when, then, world }) => {
  const g1 = given.group('g1')
  const alice = given.user('alice')
  given.member(g1, alice)
  const thread = given.thread(g1, 'thread-1')
  // Seed the MAIN group history (threadId undefined) that lookup_group_history reads.
  given.dirtyContext({
    storageContextId: world.mainGroupStorageId(g1),
    configContextId: g1.id,
    history: ['Bob: the launch date moved to March 3rd', 'Alice: thanks, updating the calendar'],
    lastActivityAt: '2026-07-19T00:00:00.000Z',
  })
  given.llm([
    callCapability('history.lookup', { queries: ['launch date'] }),
    answer('The launch date moved to March 3rd.'),
  ])
  await when.message(alice, thread, 'What did the group say about the launch date?')
  then.replyTo(alice).contains('March 3rd')
})
```

`lookup_group_history` runs its own extraction generation through `getSmallModel`/`generateText`; the scripted world model answers it. During diagnosis, if the extraction generation consumes a scripted decision, script it (`answer('The launch date moved to March 3rd.')` is the outer turn's answer; add an inner scripted step if the run shows the tool making its own model call). `world.mainGroupStorageId(g1)` returns the group-only (threadId `undefined`) storage id — add it as a thin accessor in Task 3 if not present.

- [ ] **Step 3: Run both story files sandboxed**

Run: `bun test:stories 2>&1 | grep -iE "instruction|history|fail|pass"`
Expected: the three scenarios PASS.

- [ ] **Step 4: Typecheck + lint, then commit**

```bash
bun run typecheck && bun run lint
git add tests/stories/memory/instructions.story.test.ts tests/stories/context/history-lookup.story.test.ts
git commit -m "test(stories): cover instructions and group history lookup"
```

---

### Task 7: Ledger + totals update

**Files:**

- Modify: `tests/stories/catalog/coverage.ts` (`EXECUTABLE_STORY_MAPPINGS` + `AUDIT_RECORDS`)
- Modify: `tests/stories/harness/catalog-coverage.test.ts` (totals)
- Modify: `tests/scripts/story-coverage-totals.test.ts` (totals line)

**Interfaces:**

- Consumes: story ids exactly as they appear in the four new files (`<relative path>#<scenario name>`).

- [ ] **Step 1: Update the failing contract totals first** — in `tests/stories/harness/catalog-coverage.test.ts`: line 196 `toHaveLength(69)` → `81`; line 232 `toHaveLength(59)` → `47`; line 262 `needs-seam` `toHaveLength(35)` → `23`. In `tests/scripts/story-coverage-totals.test.ts:22`, change the expected string to:

```ts
'story catalog: 81/128 executable; pending 47 (2 executable-as-is, 23 needs-seam, 22 blocked)',
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test:stories:contracts 2>&1 | grep -iE "coverage|totals|fail"`
Expected: FAIL — mapping/audit counts don't match yet.

- [ ] **Step 3: Move the 12 entries to `EXECUTABLE_STORY_MAPPINGS`** — add (each `verifiedAt: '2026-07-20'`, `storyIds` matching the exact scenario names):

```ts
  'SCN-memo-save': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/memory/memos.story.test.ts#SCN-memo-save: saves a note and reads it back on a later turn'] },
  'SCN-memo-recall': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/memory/memos.story.test.ts#SCN-memo-recall: recalls a saved note by semantic search'] },
  'SCN-memo-archive': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/memory/memos.story.test.ts#SCN-memo-archive: archives notes by id and excludes them from active list'] },
  'SCN-memo-promote': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/memory/memos.story.test.ts#SCN-memo-promote: promotes a note into a task'] },
  'SCN-memory-remember': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/memory/memory.story.test.ts#SCN-memory-remember: stores a durable memory and lists it'] },
  'SCN-memory-recall': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/memory/memory.story.test.ts#SCN-memory-recall: recalls a stored memory by keyword'] },
  'SCN-memory-forget': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/memory/memory.story.test.ts#SCN-memory-forget: forgets a stored memory by query'] },
  'SCN-memory-capture-sweep': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/memory/memory.story.test.ts#SCN-memory-capture-sweep: captures a memory from an idle group thread'] },
  'SCN-memory-promotion-sweep': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/memory/memory.story.test.ts#SCN-memory-promotion-sweep: promotes a cross-thread provisional cluster to durable'] },
  'SCN-instructions-save': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/memory/instructions.story.test.ts#SCN-instructions-save: saves a custom instruction and lists it'] },
  'SCN-instructions-list-delete': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/memory/instructions.story.test.ts#SCN-instructions-list-delete: lists then deletes an instruction'] },
  'SCN-history-lookup': { verifiedAt: '2026-07-20', storyIds: ['tests/stories/context/history-lookup.story.test.ts#SCN-history-lookup: searches the main group history from a thread'] },
```

Delete the same 12 keys from `AUDIT_RECORDS` (the `F3` `needs(...)` block).

- [ ] **Step 4: Reclassify `SCN-fetch-chat-link`** — replace its `AUDIT_RECORDS` entry with:

```ts
  'SCN-fetch-chat-link': needs(
    'F3',
    ['capability-ids', 'platform-adapter-fakes'],
    'fetch_chat_link resolves Mattermost permalinks through the authenticated Mattermost REST API (resolveChatLink), never assertPublicUrl (that DNS/SSRF guard is web_fetch, family F6). Needs a Mattermost REST resolver fake, not built speculatively.',
  ),
```

- [ ] **Step 5: Run the ledger contract tests**

Run: `bun test:stories:contracts 2>&1 | grep -iE "coverage|totals|fail|pass"`
Expected: PASS — 81 executable / 47 pending / 23 needs-seam; the totals-line test matches. (The "executable references are unique + local" test also passes because story ids match the files.)

- [ ] **Step 6: Commit**

```bash
bun run typecheck && bun run lint
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts
git commit -m "test(stories): map F3 scenarios in the catalog"
```

---

### Task 8: Spec reconciliation

**Files:**

- Modify: `docs/superpowers/specs/2026-07-20-f3-memory-story-family-design.md`

- [ ] **Step 1: Reconcile the four refinements** — update these spec sections to match what shipped: (a) the `memo-recall` row → "seed an embedded memo + one live query embed" (not two-turn save-then-recall); (b) the harness-seam #2 and #4 text → capture/promotion model calls are deterministic injected results (`records` patch, `confirmDurable → true`) via `deps`, and settle drains the fire-and-forget embed via the strict-http `idle()` drain; (c) the "No embeddings endpoint for memory-recall" exclusion → "memory-recall emits one query embed but the record has no vector, so the keyword layer matches"; (d) risk #1 → resolved by the `world.settle()` strict-http drain. Add a dated `## Post-implementation deviations (2026-07-20)` section listing them (mirroring the F1 spec's precedent).

- [ ] **Step 2: Format + commit**

```bash
bunx prettier --write docs/superpowers/specs/2026-07-20-f3-memory-story-family-design.md
git add docs/superpowers/specs/2026-07-20-f3-memory-story-family-design.md
git commit -m "docs(testing): reconcile F3 spec with implementation learnings"
```

---

### Task 9: Final verification gate

- [ ] **Step 1: Sandboxed story suite** — `bun test:stories` → all stories pass, including the 12 new `SCN-memo-*`/`SCN-memory-*`/`SCN-instructions-*`/`SCN-history-lookup` scenarios, 0 fail.
- [ ] **Step 2: Sandboxed contract suites** — `bun test:stories:contracts` → all pass (catalog coverage, strict-http, embeddings, memory-seed, scenario).
- [ ] **Step 3: Touched unit suites** — `bun test tests/tools/core-capabilities.test.ts tests/scripts/story-coverage-totals.test.ts` → pass.
- [ ] **Step 4: Typecheck and lint** — `bun run typecheck && bun run lint` → clean.
- [ ] **Step 5: Totals line + clean tree + compat** — `bun test:stories:manifest 2>&1 | grep "story catalog"` prints `story catalog: 81/128 executable; pending 47 (2 executable-as-is, 23 needs-seam, 22 blocked)`; then `git status --short` (clean). Because this plan changed frozen harness inputs, re-record the compat baseline per the repo procedure and confirm `BASE_REF=<new-baseline-sha> bun test:stories:compat --manifest-only` (or the documented equivalent) reports the intended harness delta rather than an accidental one.

## Self-Review

- **Spec coverage:** 13 capability ids (Task 1) ✓; embeddings endpoint + settle drain (Task 2) ✓; sweep primitives + seed fixtures (Task 3) ✓; memos 4 / memory 5 / instructions 2 / history 1 = 12 scenarios (Tasks 4–6) ✓; fetch-chat-link reclassification + ledger + totals (Task 7) ✓; deliberate exclusions honored (memory-recall keyword; no new seam ids) ✓; spec reconciliation (Task 8) ✓; verification incl. compat rebaseline (Task 9) ✓.
- **Placeholder scan:** every code step carries real code or an exact command; the only deferred specifics are the two `world` scope-id accessors (`scopedStorageContextId`/`groupScopeId`/`mainGroupStorageId`), which Task 3 introduces and Tasks 5–6 consume — flagged explicitly, not silent.
- **Type consistency:** `callCapability(id, input)`/`answer(text)`, `then.replyTo(user).equals/contains`, `then.task(title).exists()`, `expectEmbedding(world.http, vec?)`, `given.memo/memoryRecord/dirtyContext/instruction`, `when.captureSweep({records})/promotionSweep()` are used identically across tasks; capability ids match Task 1's map exactly.
