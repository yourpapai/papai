<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# `search-memos.ts` Mutation Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the paired mutation score of `src/tools/search-memos.ts` from 0.18 to ≥ 0.90 by adding a dedicated companion test file.

**Architecture:** Test-only change. New companion test file `tests/tools/search-memos.test.ts` mirrors two proven harnesses: the hoisted `mock.module('../../src/embeddings.js')` pattern from `tests/tools/search-chat-history.test.ts` (controls `getEmbeddingForContext`, which has no per-call DI) and the cache-busted module reload + tracked-logger pattern from `tests/history.test.ts` (handles `logger.child()` bound at module-eval time). Memos and embeddings are seeded into the real in-memory test DB via `saveMemo()` + `updateMemoEmbedding()`; no production code changes.

**Tech Stack:** Bun test runner (`bun:test`), zod v4, Vercel AI SDK `tool()`, Stryker via `bun test:mutate:file`.

**Spec:** `docs/superpowers/specs/2026-08-04-search-memos-mutation-design.md`

## Global Constraints

- Runtime is **Bun**; tests use `bun:test` (no Jest/Vitest).
- Strict TypeScript; use `.js` extension in all import paths.
- **No lint-disable or type-ignore comments** — the write hook blocks them.
- **No comments in test code** unless they encode a non-obvious constraint (the two harness-pattern explanation comments below are intentional and mirror the referenced precedent files).
- No production source changes anywhere in this plan.
- Error extraction convention: `error instanceof Error ? error.message : String(error)`.
- The standard red-step of TDD does not apply here: the production code is correct and the new tests pass immediately. The quality gate is the **mutation score** in Task 6, not test redness.
- Commit message style: conventional, e.g. `test: add search_memos companion test harness`.

## File Structure

- **Create `tests/tools/search-memos.test.ts`** — companion test for `src/tools/search-memos.ts` (the exact path the paired mutation runner and TDD hook expect). Owns all `search_memos` tests after Task 1.
- **Modify `tests/tools/memo-tools.test.ts`** — remove the `search_memos` describe block (moved to the new file) and its unused import. All other suites untouched.

## Vector fixtures (shared by all semantic tests)

2D vectors with known cosine similarity vs `QUERY_VEC = [1, 0]`:

| Fixture | Value | Cosine vs query | vs threshold 0.65 |
| --- | --- | --- | --- |
| `VEC_HIGH` | `[0.9, 0.1]` | ≈ 0.994 | above |
| `VEC_MID` | `[0.85, 0.5]` | ≈ 0.862 | above |
| `VEC_PASS` | `[0.7, 0.7]` | ≈ 0.707 | above |
| `VEC_BELOW` | `[0.5, 0.87]` | ≈ 0.498 | below |
| `VEC_ORTHO` | `[0.0, 1.0]` | 0 | below |

---

### Task 1: Test harness + moved keyword tests

**Files:**
- Create: `tests/tools/search-memos.test.ts`
- Modify: `tests/tools/memo-tools.test.ts` (remove lines 17 and 62–93)
- Source under test (read-only): `src/tools/search-memos.ts`

**Interfaces:**
- Consumes: `saveMemo(userId, content, tags)` and `updateMemoEmbedding(userId, memoId, Float32Array)` from `src/memos.js`; `getToolExecutor`, `schemaValidates`, `setupTestDb` from `tests/utils/test-helpers.js`; `createTrackedLoggerMock`, `LogCall`, `TrackedLoggerMock` from `tests/utils/logger-mock.js`; `userCachesForTesting` from `src/cache.js`.
- Produces (used by Tasks 2–5, same file): `loadSearchMemosModule(tracked: TrackedLoggerMock): Promise<SearchMemosModule>`; `mockEmbeddings(): void` + `setQueryVec(v: number[] | null): void` + `embeddingCall` capture var; `seedMemoWithEmbedding(content: string, vec: number[]): Memo`; `findCall(tracked, level, message): LogCall | undefined`; `isSearchMemosResult(value: unknown)`; fixtures `QUERY_VEC`, `VEC_HIGH`, `VEC_MID`, `VEC_PASS`, `VEC_BELOW`, `VEC_ORTHO`; constant `USER = 'user1'`.

- [ ] **Step 1: Create the test file with harness and the 3 moved/strengthened keyword tests**

Create `tests/tools/search-memos.test.ts` with exactly this content:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { userCachesForTesting } from '../../src/cache.js'
import type { Memo } from '../../src/memos.js'
import { saveMemo, updateMemoEmbedding } from '../../src/memos.js'
import { createTrackedLoggerMock, type LogCall, type TrackedLoggerMock } from '../utils/logger-mock.js'
import { getToolExecutor, setupTestDb } from '../utils/test-helpers.js'

type SearchMemosModule = typeof import('../../src/tools/search-memos.js')

const isSearchMemosModule = (value: unknown): value is SearchMemosModule =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'makeSearchMemosTool') === 'function'

// Legacy module-mock pattern (tests/AGENTS.md): getEmbeddingForContext has no
// per-call DI, so control it via mock.module. Re-applied in beforeEach after
// the preload reset restores src/embeddings.js originals (tests/mock-reset.ts).
let nextQueryVec: number[] | null = null
let embeddingCall: { text: string; configContextId: string; context: unknown } | null = null

const setQueryVec = (v: number[] | null): void => {
  nextQueryVec = v
}

const mockEmbeddings = (): void => {
  void mock.module('../../src/embeddings.js', () => ({
    getEmbeddingForContext: (text: string, configContextId: string, context?: unknown): Promise<number[] | null> => {
      embeddingCall = { text, configContextId, context }
      return Promise.resolve(nextQueryVec)
    },
  }))
}

// src/tools/search-memos.ts binds `logger.child({ scope: 'tool:memo' })` at
// module-eval time. Install the tracked mock and force a fresh evaluation with
// a cache-busting query so the module binds the tracked child (mirrors
// tests/history.test.ts).
async function loadSearchMemosModule(tracked: TrackedLoggerMock): Promise<SearchMemosModule> {
  void mock.module('../../src/logger.js', () => ({
    getLogLevel: tracked.getLogLevel,
    logger: tracked.logger,
  }))
  const loaded: unknown = await import(`../../src/tools/search-memos.js?t=${crypto.randomUUID()}`)
  if (!isSearchMemosModule(loaded)) {
    throw new Error('search-memos module did not export expected shape')
  }
  return loaded
}

type SearchMemosResult = { results: (Memo & { score?: number })[]; mode: string }

function isSearchMemosResult(value: unknown): value is SearchMemosResult {
  return (
    typeof value === 'object' && value !== null && 'results' in value && 'mode' in value && Array.isArray(value.results)
  )
}

function findCall(tracked: TrackedLoggerMock, level: LogCall['level'], message: string): LogCall | undefined {
  return tracked.getCallsByLevel(level).find((call) => call.args[1] === message)
}

const USER = 'user1'

const QUERY_VEC = [1, 0]
const VEC_HIGH = [0.9, 0.1]
const VEC_MID = [0.85, 0.5]
const VEC_PASS = [0.7, 0.7]
const VEC_BELOW = [0.5, 0.87]
const VEC_ORTHO = [0.0, 1.0]

const seedMemoWithEmbedding = (content: string, vec: number[]): Memo => {
  const memo = saveMemo(USER, content, [])
  updateMemoEmbedding(USER, memo.id, new Float32Array(vec))
  return memo
}

describe('search_memos tool', () => {
  beforeEach(async () => {
    userCachesForTesting.clear()
    await setupTestDb()
    setQueryVec(null)
    embeddingCall = null
    mockEmbeddings()
  })

  test('keyword mode returns matching memos only', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    const lease = saveMemo(USER, 'lease renewal deadline', ['landlord'])
    saveMemo(USER, 'buy groceries', ['shopping'])

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'lease', mode: 'keyword' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('keyword')
    expect(result.results.map((r) => r.id)).toEqual([lease.id])
  })

  test('keyword mode returns empty results on no match', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    saveMemo(USER, 'some content', [])

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'nonexistent', mode: 'keyword' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('keyword')
    expect(result.results).toEqual([])
  })

  test('auto mode falls back to keyword when no embedding model resolves', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    const memo = saveMemo(USER, 'important project deadline', [])
    setQueryVec(null)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'deadline', mode: 'auto' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('keyword_fallback')
    expect(result.results.map((r) => r.id)).toEqual([memo.id])
  })
})
```

- [ ] **Step 2: Run the new test file**

Run: `bun test tests/tools/search-memos.test.ts`
Expected: PASS — 3 tests, 0 failures.

- [ ] **Step 3: Remove the moved suite from `memo-tools.test.ts`**

In `tests/tools/memo-tools.test.ts`:
- Delete the import line `import { makeSearchMemosTool } from '../../src/tools/search-memos.js'` (line 17).
- Delete the entire `describe('search_memos tool', ...)` block (lines 62–93, from `describe('search_memos tool', () => {` through its closing `})`).

No other changes to this file.

- [ ] **Step 4: Run both test files**

Run: `bun test tests/tools/search-memos.test.ts tests/tools/memo-tools.test.ts`
Expected: PASS — all tests green in both files (memo-tools keeps its save/list/archive/promote suites).

- [ ] **Step 5: Commit**

```bash
git add tests/tools/search-memos.test.ts tests/tools/memo-tools.test.ts
git commit -m "test: add search_memos companion harness with keyword-mode tests"
```

---

### Task 2: Schema contract tests

**Files:**
- Modify: `tests/tools/search-memos.test.ts` (append tests inside the existing `describe` block)

**Interfaces:**
- Consumes (from Task 1): `loadSearchMemosModule`, `createTrackedLoggerMock`, `USER`.
- Adds import: `schemaValidates` from `../utils/test-helpers.js` and `z` from `zod`.

- [ ] **Step 1: Add the two schema tests**

First, extend the import from test-helpers at the top of `tests/tools/search-memos.test.ts`:

```typescript
import { getToolExecutor, schemaValidates, setupTestDb } from '../utils/test-helpers.js'
```

and add the zod import after the `node:assert/strict` import:

```typescript
import { z } from 'zod'
```

Then append these two tests inside the `describe('search_memos tool', ...)` block:

```typescript
  test('input schema validates query/mode/limit constraints', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    const tool = makeSearchMemosTool(USER)

    expect(schemaValidates(tool, { query: 'x' })).toBe(true)
    expect(schemaValidates(tool, { query: 'x', mode: 'keyword' })).toBe(true)
    expect(schemaValidates(tool, { query: 'x', mode: 'semantic' })).toBe(true)
    expect(schemaValidates(tool, { query: 'x', mode: 'auto' })).toBe(true)
    expect(schemaValidates(tool, { query: 'x', mode: 'bogus' })).toBe(false)
    expect(schemaValidates(tool, { query: '' })).toBe(false)
    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { query: 'x', limit: 0 })).toBe(false)
    expect(schemaValidates(tool, { query: 'x', limit: 21 })).toBe(false)
    expect(schemaValidates(tool, { query: 'x', limit: 2.5 })).toBe(false)
    expect(schemaValidates(tool, { query: 'x', limit: 1 })).toBe(true)
    expect(schemaValidates(tool, { query: 'x', limit: 20 })).toBe(true)
  })

  test('exposes non-empty LLM-facing descriptions, enum, and defaults', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    const tool = makeSearchMemosTool(USER)

    expect(tool.description).toContain('Search personal notes')

    const asRecord = (v: unknown): Record<string, unknown> =>
      typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
    const props = asRecord(asRecord(z.toJSONSchema(tool.inputSchema)).properties)
    for (const field of ['query', 'mode', 'limit']) {
      const description = asRecord(props[field]).description
      expect(typeof description).toBe('string')
      assert(typeof description === 'string')
      expect(description.length).toBeGreaterThan(0)
    }
    expect(asRecord(props.mode).enum).toEqual(['keyword', 'semantic', 'auto'])
    expect(asRecord(props.mode).default).toBe('auto')
    expect(asRecord(props.limit).default).toBe(5)
    expect(asRecord(props.limit).minimum).toBe(1)
    expect(asRecord(props.limit).maximum).toBe(20)
  })
```

- [ ] **Step 2: Run the test file**

Run: `bun test tests/tools/search-memos.test.ts`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add tests/tools/search-memos.test.ts
git commit -m "test: assert search_memos schema contract and descriptions"
```

---

### Task 3: Semantic routing tests (no-coverage block)

**Files:**
- Modify: `tests/tools/search-memos.test.ts` (append tests inside the existing `describe` block)

**Interfaces:**
- Consumes (from Task 1): `loadSearchMemosModule`, `seedMemoWithEmbedding`, `setQueryVec`, `findCall`, `isSearchMemosResult`, fixtures `QUERY_VEC`, `VEC_HIGH`, `VEC_MID`, `VEC_ORTHO`, `USER`; `saveMemo`; `getToolExecutor`; `assert`.
- These tests execute the entire `trySemanticSearch` body and the L61–71 routing branches for the first time.

- [ ] **Step 1: Add the five semantic routing tests**

Append inside the `describe('search_memos tool', ...)` block:

```typescript
  test('auto mode still falls back to keyword when embeddings exist but no query vector resolves', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    const memo = seedMemoWithEmbedding('deadline notes', VEC_HIGH)
    setQueryVec(null)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'deadline', mode: 'auto' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('keyword_fallback')
    expect(result.results.map((r) => r.id)).toEqual([memo.id])
  })

  test('auto mode returns semantic hits sorted by descending score', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    const mid = seedMemoWithEmbedding('rotate the credentials', VEC_MID)
    const high = seedMemoWithEmbedding('cycle api keys soon', VEC_HIGH)
    seedMemoWithEmbedding('unrelated lunch note', VEC_ORTHO)
    setQueryVec(QUERY_VEC)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'security rotation', mode: 'auto' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('semantic')
    expect(result.results.map((r) => r.id)).toEqual([high.id, mid.id])
    expect(typeof result.results[0]?.score).toBe('number')

    const done = findCall(tracked, 'info', 'Semantic search completed')
    expect(done?.args[0]).toEqual({ mode: 'semantic', resultCount: 2 })
  })

  test('auto mode falls back to keyword when semantic yields zero hits', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    const memo = seedMemoWithEmbedding('deploy runbook', VEC_ORTHO)
    setQueryVec(QUERY_VEC)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'deploy', mode: 'auto' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('keyword_fallback')
    expect(result.results.map((r) => r.id)).toEqual([memo.id])
  })

  test('semantic mode returns an empty semantic result when nothing passes the threshold', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    seedMemoWithEmbedding('deploy runbook', VEC_ORTHO)
    setQueryVec(QUERY_VEC)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'deploy', mode: 'semantic' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('semantic')
    expect(result.results).toEqual([])
  })

  test('semantic mode returns an empty result and warns when no embedding model resolves', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    saveMemo(USER, 'deploy runbook', [])
    setQueryVec(null)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'deploy', mode: 'semantic' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('semantic')
    expect(result.results).toEqual([])
    expect(findCall(tracked, 'warn', 'Semantic search unavailable')).toBeDefined()
  })
```

- [ ] **Step 2: Run the test file**

Run: `bun test tests/tools/search-memos.test.ts`
Expected: PASS — 10 tests, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add tests/tools/search-memos.test.ts
git commit -m "test: cover search_memos semantic routing and fallback modes"
```

---

### Task 4: Ranking semantics + embedding-call wiring tests

**Files:**
- Modify: `tests/tools/search-memos.test.ts` (append tests inside the existing `describe` block)

**Interfaces:**
- Consumes (from Task 1): `seedMemoWithEmbedding`, `setQueryVec`, `embeddingCall`, `isSearchMemosResult`, fixtures `QUERY_VEC`, `VEC_HIGH`, `VEC_MID`, `VEC_PASS`, `VEC_BELOW`, `USER`.

- [ ] **Step 1: Add the three tests**

Append inside the `describe('search_memos tool', ...)` block:

```typescript
  test('semantic search excludes memos below the similarity threshold', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    seedMemoWithEmbedding('vaguely related', VEC_BELOW)
    const high = seedMemoWithEmbedding('directly related', VEC_HIGH)
    setQueryVec(QUERY_VEC)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'topic', mode: 'semantic' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('semantic')
    expect(result.results.map((r) => r.id)).toEqual([high.id])
  })

  test('semantic search keeps only the top limit results', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    seedMemoWithEmbedding('third best', VEC_PASS)
    const mid = seedMemoWithEmbedding('second best', VEC_MID)
    const high = seedMemoWithEmbedding('best match', VEC_HIGH)
    setQueryVec(QUERY_VEC)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'topic', mode: 'semantic', limit: 2 })

    assert(isSearchMemosResult(result))
    expect(result.results.map((r) => r.id)).toEqual([high.id, mid.id])
  })

  test('resolves the query embedding against the user scope', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    seedMemoWithEmbedding('anything', VEC_HIGH)
    setQueryVec(QUERY_VEC)

    await getToolExecutor(makeSearchMemosTool(USER))({ query: 'find this', mode: 'auto' })

    expect(embeddingCall).toEqual({
      text: 'find this',
      configContextId: USER,
      context: { storageContextId: USER, contextType: 'dm', chatUserId: USER },
    })
  })
```

- [ ] **Step 2: Run the test file**

Run: `bun test tests/tools/search-memos.test.ts`
Expected: PASS — 13 tests, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add tests/tools/search-memos.test.ts
git commit -m "test: assert search_memos ranking, threshold, limit, and embedding scope"
```

---

### Task 5: Log contract tests

**Files:**
- Modify: `tests/tools/search-memos.test.ts` (append tests inside the existing `describe` block)

**Interfaces:**
- Consumes (from Task 1): `loadSearchMemosModule`, `findCall`, `createTrackedLoggerMock`, `USER`; `saveMemo`; `getToolExecutor`.

- [ ] **Step 1: Add the two log tests**

Append inside the `describe('search_memos tool', ...)` block:

```typescript
  test('binds the tool child logger with its scope', async () => {
    const tracked = createTrackedLoggerMock()
    await loadSearchMemosModule(tracked)

    expect(tracked.logger.child).toHaveBeenCalledWith({ scope: 'tool:memo' })
  })

  test('logs entry params and keyword completion payload', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    saveMemo(USER, 'lease renewal deadline', [])

    await getToolExecutor(makeSearchMemosTool(USER))({ query: 'lease', mode: 'keyword', limit: 3 })

    const entry = findCall(tracked, 'debug', 'search_memos called')
    expect(entry?.args[0]).toEqual({ mode: 'keyword', limit: 3 })
    const done = findCall(tracked, 'info', 'Keyword search completed')
    expect(done?.args[0]).toEqual({ mode: 'keyword', resultCount: 1 })
  })
```

Note: the tool's own `'Keyword search completed'` info log (`{ mode, resultCount }`) is asserted here; `src/memos.js` logs the same message with a different payload, but it binds the real logger at file-load time, so it never reaches the tracked mock.

- [ ] **Step 2: Run the test file**

Run: `bun test tests/tools/search-memos.test.ts`
Expected: PASS — 15 tests, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add tests/tools/search-memos.test.ts
git commit -m "test: assert search_memos log contracts"
```

---

### Task 6: Mutation verification

**Files:**
- None modified (measurement only), unless Step 2 uncovers a fixable survivor.

**Interfaces:**
- Consumes: everything from Tasks 1–5.

- [ ] **Step 1: Run the paired mutation measurement**

Run: `bun test:mutate:file src/tools/search-memos.ts`
Expected: score **≥ 0.90**. (Previous baseline: 0.18 — 17 killed / 28 survived / 51 no-coverage of 96 mutants.)

- [ ] **Step 2: Triage any survivors above the accepted residuals**

Accepted residuals (documented in the spec — do not chase):
- L28 `>=` vs `>` at exactly 0.65 (threshold is not float-representable).
- L37 `r === null` filter-predicate flip (defensive `getMemo`-null branch, unreachable via the public API).

Any other survivor means a missing assertion — extend the relevant test in `tests/tools/search-memos.test.ts`, re-run `bun test tests/tools/search-memos.test.ts`, then re-run Step 1. Commit any such additions with `test: kill residual search_memos mutants`.

- [ ] **Step 3: Full local verification**

Run: `bun test tests/tools/search-memos.test.ts tests/tools/memo-tools.test.ts`
Expected: PASS — all green.
Run lint and typecheck per the repo's `package.json` scripts (e.g. `bun run lint`, `bun run typecheck`).
Expected: clean.

- [ ] **Step 4: Do NOT edit `scripts/mutation/baseline.json`**

The floor ratchets automatically via the master CI `mutation-baseline` job (`seedMerge`, per-key max) after merge. No commit in this task unless Step 2 added tests.
