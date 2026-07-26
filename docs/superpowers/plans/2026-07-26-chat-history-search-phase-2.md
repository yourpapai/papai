<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Chat history search — Phase 2 (semantic/embedding) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a semantic/embedding search layer to `message_metadata` so the agent can find past messages by meaning (not just FTS5 keyword), exposed via the existing `search_chat_history` tool with a `keyword|semantic|auto` mode selector.

**Architecture:** A new side table `message_embeddings` (BLOB) is owned by a `MessageVectorStore` seam (`src/message-cache/vector-store.ts`) that does scope-bounded in-memory cosine search. Embeddings are generated two ways: inline fire-and-forget at the cache chokepoint (`src/bot-message-caching.ts`, mirroring `save-memo.ts`), and a scheduled `message-embedding-sweep` task that backfills, retries failures, and re-embeds on model change (mirroring `memory-capture-sweep`). The `search_chat_history` tool gains a `mode` param and an `auto` cascade mirroring `search-memos.ts`. sqlite-vec stays deferred behind the seam.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Drizzle ORM over `bun:sqlite`, Vercel AI SDK (`ai` v7 — `embed`, `embedMany`, `cosineSimilarity`), Zod v4, pino, `p-limit`.

## Global Constraints

(From the spec `docs/superpowers/specs/2026-07-26-chat-history-search-phase-2-design.md`; every task implicitly respects these.)

- Runtime **Bun**; validation **Zod v4**; LLM/embeddings via **Vercel AI SDK** (`ai` v7.0.31 — `embed`, `embedMany`, `cosineSimilarity` all confirmed exported).
- Strict TypeScript; **use `.js` extension in import paths**.
- Error extraction: `error instanceof Error ? error.message : String(error)`.
- Use **`p-limit`** for bounded concurrency over remote ops, never unbounded `Promise.all`.
- **Never add `lint-disable` or `// @ts-ignore`** — hook policy blocks them.
- **BUSL-1.1 SPDX header** at the top of every new file (copy from any existing `src/*.ts`).
- **Logging:** pino, metadata-first. `debug` entry/params, `info` success with counts/lengths only, `warn` degraded/blocked, `error` caught exceptions. **Never log message text or query text at `info`** (query at `debug` only).
- **Float32 ↔ BLOB encoding** mirrors `src/memos.ts:126` (store) and `src/memos.ts:180` (read) exactly.
- Tests: **Bun test runner** (`bun:test`), DI-first per `tests/AGENTS.md`; `setupTestDb()` snapshots the migration set (adding 071 rebuilds the snapshot automatically).
- Scope model inherited from Phase 1 unchanged: `MessageScope` + `scopeWhere` (`src/message-cache/store.ts:42-47`); group-wide in groups, DM-scoped in DMs.
- Knip is run separately as `bun run knip` (NOT in the write-hook gate).

---

## File Structure

**New files:**
- `src/db/migrations/071_message_embeddings.ts` — migration: creates the side table.
- `src/db/message-embeddings-schema.ts` — Drizzle schema for `message_embeddings` (mirrors `memos-schema.ts`).
- `src/message-cache/vector-store.ts` — the `MessageVectorStore` seam: storage + scope-bounded cosine search + pending-batch queries.
- `src/message-cache/embed-message.ts` — single-message embed orchestrator (inline path): resolve config → embed → store, fire-and-forget safe.
- `src/message-embedding-sweep.ts` — batch sweep: backfill NULLs, retry failures, re-embed model-mismatches; registered as a scheduler default task.
- `tests/message-cache/vector-store.test.ts`
- `tests/message-cache/embed-message.test.ts`
- `tests/message-embedding-sweep.test.ts`
- `tests/db/migrations/071_message_embeddings.test.ts`

**Modified files:**
- `src/db/index.ts` — import + append `migration071MessageEmbeddings` to `MIGRATIONS`.
- `src/db/schema.ts` — re-export `messageEmbeddings` from the new schema file (mirrors line 189's memos re-export).
- `src/bot-message-caching.ts` — fire-and-forget call to `embedAndStoreMessage` after caching (text non-empty only).
- `src/scheduler-instance.ts` — register `message-embedding-sweep` in `registerDefaultSchedulerTasks` + add to `DEFAULT_SCHEDULER_TASK_NAMES`.
- `src/tools/search-chat-history.ts` — add `mode` param, async `execute`, `auto` cascade, `score`/`mode` output, updated description.
- `tests/db/migration-registration.test.ts` — assert 071 is the last migration (update the existing 070-last assertion).
- `tests/tools/search-chat-history.test.ts` — add semantic/auto/keyword-fallback cases.
- `src/tools/CLAUDE.md` — note `search_chat_history` now supports `semantic`/`auto` mode.

---

## Interfaces (cross-task contract)

These exact names/signatures are the contract between tasks. An implementer of a later task sees only their own task; this block is how they learn what earlier tasks provide.

From **Task 1** (migration + schema):
- Drizzle table `messageEmbeddings` (`src/db/message-embeddings-schema.ts`, re-exported from `src/db/schema.ts`) with columns: `contextId` (text, PK part), `messageId` (text, PK part), `embedding` (blob, nullable), `embeddingModel` (text, nullable), `embeddingDim` (integer, nullable), `embeddedAt` (text, nullable); composite PK `(contextId, messageId)`.

From **Task 2** (vector-store):
- `storeEmbedding(contextId: string, messageId: string, vec: Float32Array, model: string, dim: number): void`
- `loadEmbeddingsForScope(scope: MessageScope): { messageId: string; vec: Float32Array; authorId: string | null; timestamp: number; contextId: string }[]`
- `searchKnn(queryVec: number[], scope: MessageScope, filters: SearchFilters, limit: number, threshold?: number): { messageId: string; score: number }[]` (threshold default `0.65`)
- `pendingConfigContexts(limit: number): string[]`
- `nextPendingBatchForContext(configContextId: string, currentModel: string, limit: number): { contextId: string; messageId: string; text: string | null }[]`
- `countPending(): number`
- Constants `SIMILARITY_THRESHOLD = 0.65`, `COSINE_COMFORT_WARN = 5000`.

From **Task 3** (embed-message):
- `embedAndStoreMessage(args: { text: string; contextId: string; messageId: string; configContextId: string; embeddingCtx: EmbeddingCallContext }, deps?: EmbedMessageDeps): Promise<void>` — never throws.

From **Task 4** (sweep):
- `runMessageEmbeddingSweep(deps?: SweepDeps): Promise<{ embedded: number; contexts: number }>`

From **Task 5** (tool):
- `makeSearchChatHistoryTool(chatUserId: string, storageContextId: string, contextType: ContextType): Tool` — signature unchanged; now async, accepts `mode`.

---

## Task 1: Migration 071 + Drizzle schema for `message_embeddings`

**Files:**
- Create: `src/db/migrations/071_message_embeddings.ts`
- Create: `src/db/message-embeddings-schema.ts`
- Modify: `src/db/index.ts:83` (import) and `src/db/index.ts:188` (append to `MIGRATIONS`)
- Modify: `src/db/schema.ts:189` (re-export)
- Create: `tests/db/migrations/071_message_embeddings.test.ts`
- Modify: `tests/db/migration-registration.test.ts:26-29`

**Interfaces:**
- Produces: Drizzle table `messageEmbeddings` and the applied `message_embeddings` SQLite table for all later tasks.

- [ ] **Step 1: Write the failing migration-registration test**

Modify `tests/db/migration-registration.test.ts` — replace the "070 is last" test with a "071 is last" test, keeping 070 as a non-last membership assertion:

```typescript
  test('includes migration 070_message_metadata_history_search', () => {
    const ids = MIGRATIONS.map((m) => m.id)
    expect(ids).toContain('070_message_metadata_history_search')
  })

  test('071_message_embeddings is the last migration', () => {
    const lastMigration = requireDefined(MIGRATIONS.at(-1))
    expect(lastMigration.id).toBe('071_message_embeddings')
  })
```

- [ ] **Step 2: Write the failing migration test**

Create `tests/db/migrations/071_message_embeddings.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { sql } from 'drizzle-orm'
import { initDb } from '../../../src/db/index.js'

describe('migration 071_message_embeddings', () => {
  test('creates the message_embeddings table with the expected columns', () => {
    initDb()
    const db = getDrizzleDb().$client
    const cols = db
      .prepare(`PRAGMA table_info(message_embeddings)`)
      .all() as { name: string; notnull: number; pk: number }[]
    const names = cols.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'context_id',
        'message_id',
        'embedding',
        'embedding_model',
        'embedding_dim',
        'embedded_at',
      ]),
    )
    const pkCols = cols.filter((c) => c.pk === 1).map((c) => c.name)
    expect(pkCols).toEqual(['context_id', 'message_id'])
  })

  test('embedding column is nullable/blob', () => {
    initDb()
    const db = getDrizzleDb().$client
    const row = db
      .prepare(`SELECT type, notnull FROM pragma_table_info('message_embeddings') WHERE name='embedding'`)
      .get() as { type: string; notnull: number }
    expect(row.type).toBe('BLOB')
    expect(row.notnull).toBe(0)
  })

  test('a row can be inserted with a null embedding', () => {
    initDb()
    const db = getDrizzleDb().$client
    db.prepare(
      `INSERT INTO message_embeddings (context_id, message_id, embedding, embedding_model, embedding_dim, embedded_at)
       VALUES ('c1', 'm1', NULL, NULL, NULL, NULL)`,
    ).run()
    const cnt = sql`SELECT COUNT(*) as n FROM message_embeddings`
    void cnt
    const n = db.prepare(`SELECT COUNT(*) as n FROM message_embeddings`).get() as { n: number }
    expect(n.n).toBe(1)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/db/migration-registration.test.ts tests/db/migrations/071_message_embeddings.test.ts`
Expected: FAIL — `071_message_embeddings` not found / table missing.

- [ ] **Step 4: Create the Drizzle schema**

Create `src/db/message-embeddings-schema.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { blob, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const messageEmbeddings = sqliteTable(
  'message_embeddings',
  {
    contextId: text('context_id').notNull(),
    messageId: text('message_id').notNull(),
    embedding: blob('embedding'),
    embeddingModel: text('embedding_model'),
    embeddingDim: integer('embedding_dim'),
    embeddedAt: text('embedded_at'),
  },
  (table) => [primaryKey({ columns: [table.contextId, table.messageId] })],
)
```

- [ ] **Step 5: Re-export from schema.ts**

In `src/db/schema.ts`, after the existing `export { memos, memoLinks } from './memos-schema.js'` line (line 189), add:

```typescript
export { messageEmbeddings } from './message-embeddings-schema.js'
```

- [ ] **Step 6: Create the migration**

Create `src/db/migrations/071_message_embeddings.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:071' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE message_embeddings (
      context_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      embedding BLOB,
      embedding_model TEXT,
      embedding_dim INTEGER,
      embedded_at TEXT,
      PRIMARY KEY (context_id, message_id)
    )
  `)
  log.info('migration 071: message_embeddings side table created')
}

export const migration071MessageEmbeddings: Migration = {
  id: '071_message_embeddings',
  up,
}

export default migration071MessageEmbeddings
```

- [ ] **Step 7: Register in MIGRATIONS**

In `src/db/index.ts`, add the import (after line 83, the 070 import):

```typescript
import { migration071MessageEmbeddings } from './migrations/071_message_embeddings.js'
```

And append to the `MIGRATIONS` array (after line 188, the `migration070MessageMetadataHistorySearch,` entry):

```typescript
  migration070MessageMetadataHistorySearch,
  migration071MessageEmbeddings,
]
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test tests/db/migration-registration.test.ts tests/db/migrations/071_message_embeddings.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/db/migrations/071_message_embeddings.ts src/db/message-embeddings-schema.ts src/db/index.ts src/db/schema.ts tests/db/migrations/071_message_embeddings.test.ts tests/db/migration-registration.test.ts
git commit -m "feat(db): migration 071 message_embeddings side table"
```

---

## Task 2: `MessageVectorStore` — storage + scope-bounded cosine search

**Files:**
- Create: `src/message-cache/vector-store.ts`
- Create: `tests/message-cache/vector-store.test.ts`

**Interfaces:**
- Consumes: `messageEmbeddings` table (Task 1); `messageMetadata` + `MessageScope` + `scopeWhere` + `SearchFilters` from `src/message-cache/store.ts` (`store.ts:42-58`); `cosineSimilarity` from `ai`.
- Produces: `storeEmbedding`, `loadEmbeddingsForScope`, `searchKnn`, `pendingConfigContexts`, `nextPendingBatchForContext`, `countPending` (see Interfaces block above).

- [ ] **Step 1: Write the failing tests (storage + round-trip)**

Create `tests/message-cache/vector-store.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { cacheMessage } from '../../src/message-cache/cache.js'
import {
  countPending,
  loadEmbeddingsForScope,
  nextPendingBatchForContext,
  pendingConfigContexts,
  searchKnn,
  storeEmbedding,
} from '../../src/message-cache/vector-store.js'
import type { MessageScope } from '../../src/message-cache/store.js'
import { flushPendingWrites, mockLogger, setupTestDb } from '../utils/test-helpers.js'

const groupScope = (g: string): MessageScope => ({ kind: 'group', groupContextId: g })
const dmScope = (c: string): MessageScope => ({ kind: 'dm', contextId: c })

const vec = (...v: number[]): Float32Array => new Float32Array(v)

describe('message vector store: storeEmbedding + load round-trip', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('stores and loads a Float32 embedding, preserving values', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'hi', timestamp: 1 })
    await flushPendingWrites()
    storeEmbedding('g:t1', 'm1', vec(0.1, 0.2, 0.3), 'text-embedding-3-small', 3)
    const loaded = loadEmbeddingsForScope(groupScope('g'))
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.messageId).toBe('m1')
    expect(Array.from(loaded[0]?.vec ?? [])).toEqual([0.1, 0.2, 0.3])
    expect(loaded[0]?.contextId).toBe('g:t1')
  })

  test('upserts on repeat store (idempotent by PK)', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'hi', timestamp: 1 })
    await flushPendingWrites()
    storeEmbedding('g:t1', 'm1', vec(1, 0, 0), 'model-a', 3)
    storeEmbedding('g:t1', 'm1', vec(0, 1, 0), 'model-b', 3)
    const loaded = loadEmbeddingsForScope(groupScope('g'))
    expect(loaded).toHaveLength(1)
    expect(Array.from(loaded[0]?.vec ?? [])).toEqual([0, 1, 0])
  })
})

describe('message vector store: scope bounding', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('group A cannot see group B embeddings', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'a:t1', groupContextId: 'a', text: 'x', timestamp: 1 })
    cacheMessage({ messageId: 'm2', contextId: 'b:t1', groupContextId: 'b', text: 'y', timestamp: 2 })
    await flushPendingWrites()
    storeEmbedding('a:t1', 'm1', vec(1, 0), 'm', 2)
    storeEmbedding('b:t1', 'm2', vec(1, 0), 'm', 2)
    expect(loadEmbeddingsForScope(groupScope('a')).map((r) => r.messageId)).toEqual(['m1'])
    expect(loadEmbeddingsForScope(groupScope('b')).map((r) => r.messageId)).toEqual(['m2'])
  })

  test('dm scope loads only that dm (group_context_id IS NULL)', async () => {
    cacheMessage({ messageId: 'dm1', contextId: 'dm-alice', text: 'secret', timestamp: 1 })
    cacheMessage({ messageId: 'g1', contextId: 'g:t1', groupContextId: 'g', text: 'group', timestamp: 2 })
    await flushPendingWrites()
    storeEmbedding('dm-alice', 'dm1', vec(1, 0), 'm', 2)
    storeEmbedding('g:t1', 'g1', vec(1, 0), 'm', 2)
    expect(loadEmbeddingsForScope(dmScope('dm-alice')).map((r) => r.messageId)).toEqual(['dm1'])
  })
})

describe('message vector store: searchKnn', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns scored results above threshold, sorted desc by similarity', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'rotate credentials', timestamp: 1 })
    cacheMessage({ messageId: 'm2', contextId: 'g:t1', groupContextId: 'g', text: 'cycle api keys', timestamp: 2 })
    cacheMessage({ messageId: 'm3', contextId: 'g:t1', groupContextId: 'g', text: 'lunch menu', timestamp: 3 })
    await flushPendingWrites()
    storeEmbedding('g:t1', 'm1', vec(0.9, 0.1), 'm', 2)
    storeEmbedding('g:t1', 'm2', vec(0.85, 0.15), 'm', 2)
    storeEmbedding('g:t1', 'm3', vec(0.0, 1.0), 'm', 2)
    const results = searchKnn([0.95, 0.05], groupScope('g'), {}, 5)
    expect(results.map((r) => r.messageId)).toEqual(['m1', 'm2'])
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? -1)
  })

  test('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      cacheMessage({ messageId: `m${i}`, contextId: 'g:t1', groupContextId: 'g', text: 'x', timestamp: i })
    }
    await flushPendingWrites()
    for (let i = 0; i < 5; i++) storeEmbedding('g:t1', `m${i}`, vec(1, 0), 'm', 2)
    expect(searchKnn([1, 0], groupScope('g'), {}, 2)).toHaveLength(2)
  })

  test('author filter narrows the candidate set', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'x', authorUsername: 'alice', timestamp: 1 })
    cacheMessage({ messageId: 'm2', contextId: 'g:t1', groupContextId: 'g', text: 'y', authorUsername: 'bob', timestamp: 2 })
    await flushPendingWrites()
    storeEmbedding('g:t1', 'm1', vec(1, 0), 'm', 2)
    storeEmbedding('g:t1', 'm2', vec(1, 0), 'm', 2)
    expect(searchKnn([1, 0], groupScope('g'), { author: 'alice' }, 5).map((r) => r.messageId)).toEqual(['m1'])
  })

  test('returns [] for an out-of-scope query', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'a:t1', groupContextId: 'a', text: 'x', timestamp: 1 })
    await flushPendingWrites()
    storeEmbedding('a:t1', 'm1', vec(1, 0), 'm', 2)
    expect(searchKnn([1, 0], groupScope('other'), {}, 5)).toEqual([])
  })
})

describe('message vector store: pending queries', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('pendingConfigContexts lists config contexts with NULL embeddings', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'x', timestamp: 1 })
    cacheMessage({ messageId: 'm2', contextId: 'dm-alice', text: 'y', timestamp: 2 })
    await flushPendingWrites()
    // group config-context id is COALESCE(group_context_id, context_id) => 'g' and 'dm-alice'
    expect(pendingConfigContexts(10).sort()).toEqual(['dm-alice', 'g'])
  })

  test('countPending counts NULL-embedding rows', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'x', timestamp: 1 })
    cacheMessage({ messageId: 'm2', contextId: 'g:t2', groupContextId: 'g', text: 'y', timestamp: 2 })
    await flushPendingWrites()
    expect(countPending()).toBe(2)
    storeEmbedding('g:t1', 'm1', vec(1, 0), 'm', 2)
    expect(countPending()).toBe(1)
  })

  test('nextPendingBatchForContext returns NULLs and model-mismatched rows', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'one', timestamp: 1 })
    cacheMessage({ messageId: 'm2', contextId: 'g:t2', groupContextId: 'g', text: 'two', timestamp: 2 })
    await flushPendingWrites()
    storeEmbedding('g:t1', 'm1', vec(1, 0), 'old-model', 2) // present but stale model
    // m2 has NULL embedding
    const batch = nextPendingBatchForContext('g', 'new-model', 10)
    expect(batch.map((r) => r.messageId).sort()).toEqual(['m1', 'm2'])
  })

  test('nextPendingBatchForContext excludes rows matching current model', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'one', timestamp: 1 })
    await flushPendingWrites()
    storeEmbedding('g:t1', 'm1', vec(1, 0), 'current-model', 2)
    expect(nextPendingBatchForContext('g', 'current-model', 10)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/message-cache/vector-store.test.ts`
Expected: FAIL — module `../../src/message-cache/vector-store.js` not found.

- [ ] **Step 3: Implement `vector-store.ts`**

Create `src/message-cache/vector-store.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { cosineSimilarity } from 'ai'
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { messageEmbeddings } from '../db/schema.js'
import { logger } from '../logger.js'
import { messageMetadata } from '../db/schema.js'
import type { MessageScope, SearchFilters } from './store.js'

const log = logger.child({ scope: 'message-vector-store' })

export const SIMILARITY_THRESHOLD = 0.65
export const COSINE_COMFORT_WARN = 5000

const scopeWhere = (scope: MessageScope) =>
  scope.kind === 'group'
    ? eq(messageMetadata.groupContextId, scope.groupContextId)
    : and(isNull(messageMetadata.groupContextId), eq(messageMetadata.contextId, scope.contextId))!

const configContextExpr = sql<string>`${messageEmbeddings.embeddingModel}`

/** Store (upsert) a Float32 embedding + its provenance for one message. */
export function storeEmbedding(
  contextId: string,
  messageId: string,
  vec: Float32Array,
  model: string,
  dim: number,
): void {
  log.debug({ contextId, messageId, model, dim }, 'storeEmbedding called')
  const buffer = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)
  getDrizzleDb()
    .insert(messageEmbeddings)
    .values({
      contextId,
      messageId,
      embedding: buffer,
      embeddingModel: model,
      embeddingDim: dim,
      embeddedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [messageEmbeddings.contextId, messageEmbeddings.messageId],
      set: {
        embedding: buffer,
        embeddingModel: model,
        embeddingDim: dim,
        embeddedAt: new Date().toISOString(),
      },
    })
    .run()
}

export type ScopedEmbedding = {
  messageId: string
  vec: Float32Array
  authorId: string | null
  timestamp: number
  contextId: string
}

/** Load all embeddings in a scope (joins message_metadata to apply scope + carry filter columns). */
export function loadEmbeddingsForScope(scope: MessageScope): ScopedEmbedding[] {
  log.debug({ scopeKind: scope.kind }, 'loadEmbeddingsForScope called')
  const rows = getDrizzleDb()
    .select({
      messageId: messageMetadata.messageId,
      embedding: messageEmbeddings.embedding,
      authorId: messageMetadata.authorId,
      timestamp: messageMetadata.timestamp,
      contextId: messageMetadata.contextId,
    })
    .from(messageEmbeddings)
    .innerJoin(
      messageMetadata,
      and(
        eq(messageEmbeddings.contextId, messageMetadata.contextId),
        eq(messageEmbeddings.messageId, messageMetadata.messageId),
      ),
    )
    .where(and(scopeWhere(scope), sql`${messageEmbeddings.embedding} IS NOT NULL`))
    .all()
  if (rows.length >= COSINE_COMFORT_WARN) {
    log.warn({ scopeKind: scope.kind, count: rows.length }, 'scope exceeding cosine-comfort threshold; consider sqlite-vec')
  }
  return rows
    .filter((r): r is { messageId: string; embedding: Buffer; authorId: string | null; timestamp: number; contextId: string } => r.embedding !== null)
    .map((r) => ({
      messageId: r.messageId,
      vec: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4),
      authorId: r.authorId,
      timestamp: r.timestamp,
      contextId: r.contextId,
    }))
}

const matchesFilters = (row: ScopedEmbedding, f: SearchFilters): boolean => {
  if (f.author !== undefined && row.authorId !== f.author) {
    return false
  }
  if (f.contextId !== undefined && row.contextId !== f.contextId) {
    return false
  }
  if (f.since !== undefined && row.timestamp <= f.since) {
    return false
  }
  if (f.until !== undefined && row.timestamp >= f.until) {
    return false
  }
  return true
}

/** In-memory cosine KNN within a scope, filter-then-score. No indexed ANN. */
export function searchKnn(
  queryVec: number[],
  scope: MessageScope,
  filters: SearchFilters,
  limit: number,
  threshold: number = SIMILARITY_THRESHOLD,
): { messageId: string; score: number }[] {
  log.debug({ scopeKind: scope.kind, limit, threshold }, 'searchKnn called')
  const candidates = loadEmbeddingsForScope(scope).filter((r) => matchesFilters(r, filters))
  return candidates
    .map((r) => ({ messageId: r.messageId, score: cosineSimilarity(queryVec, Array.from(r.vec)) }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** Distinct config-context ids (COALESCE(group_context_id, context_id)) that have NULL-embedding rows. */
export function pendingConfigContexts(limit: number): string[] {
  const rows = getDrizzleDb()
    .select({
      configContextId: sql<string>`COALESCE(${messageMetadata.groupContextId}, ${messageMetadata.contextId})`,
    })
    .from(messageEmbeddings)
    .innerJoin(
      messageMetadata,
      and(
        eq(messageEmbeddings.contextId, messageMetadata.contextId),
        eq(messageEmbeddings.messageId, messageMetadata.messageId),
      ),
    )
    .where(sql`${messageEmbeddings.embedding} IS NULL`)
    .groupBy(sql`COALESCE(${messageMetadata.groupContextId}, ${messageMetadata.contextId})`)
    .limit(limit)
    .all()
  return rows.map((r) => r.configContextId)
}

/** Pending rows for one config-context: NULL embedding OR model != currentModel. */
export function nextPendingBatchForContext(
  configContextId: string,
  currentModel: string,
  limit: number,
): { contextId: string; messageId: string; text: string | null }[] {
  return getDrizzleDb()
    .select({
      contextId: messageMetadata.contextId,
      messageId: messageMetadata.messageId,
      text: messageMetadata.text,
    })
    .from(messageEmbeddings)
    .innerJoin(
      messageMetadata,
      and(
        eq(messageEmbeddings.contextId, messageMetadata.contextId),
        eq(messageEmbeddings.messageId, messageMetadata.messageId),
      ),
    )
    .where(
      and(
        eq(sql`COALESCE(${messageMetadata.groupContextId}, ${messageMetadata.contextId})`, configContextId),
        or(isNull(messageEmbeddings.embedding), ne(messageEmbeddings.embeddingModel, currentModel))!,
      ),
    )
    .limit(limit)
    .all()
}

/** Total rows with a NULL embedding (for info logging). */
export function countPending(): number {
  const row = getDrizzleDb()
    .select({ n: sql<number>`COUNT(*)` })
    .from(messageEmbeddings)
    .where(sql`${messageEmbeddings.embedding} IS NULL`)
    .get()
  return row?.n ?? 0
}
```

Note: the local `configContextExpr` placeholder line is unused — remove it. (Keep the file clean: do not leave unused bindings; the linter will reject them.)

- [ ] **Step 4: Remove the unused binding**

Delete the line `const configContextExpr = sql\`${messageEmbeddings.embeddingModel}\`` from `vector-store.ts` (it is unused). Also remove the now-unused `messageMetadata` re-import duplication: the file imports `messageMetadata` once from `'../db/schema.js'` — keep a single import statement combining both `messageEmbeddings` and `messageMetadata`:

```typescript
import { getDrizzleDb } from '../db/drizzle.js'
import { messageEmbeddings, messageMetadata } from '../db/schema.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/message-cache/vector-store.test.ts`
Expected: PASS (all 14 cases).

- [ ] **Step 6: Run typecheck + lint on the new file**

Run: `bun run typecheck && bun run lint`
Expected: PASS (no errors; if `bun run lint` is not the script name, run `bunx eslint src/message-cache/vector-store.ts`).

- [ ] **Step 7: Commit**

```bash
git add src/message-cache/vector-store.ts tests/message-cache/vector-store.test.ts
git commit -m "feat(message-cache): MessageVectorStore — storage + scope-bounded cosine search"
```

---

## Task 3: Inline embed orchestrator + wire into the caching chokepoint

**Files:**
- Create: `src/message-cache/embed-message.ts`
- Create: `tests/message-cache/embed-message.test.ts`
- Modify: `src/bot-message-caching.ts`
- Modify: `tests/bot-message-caching.test.ts` (add a case asserting the embed is kicked off; follow the existing suite's pattern)

**Interfaces:**
- Consumes: `storeEmbedding` (Task 2); `resolveLlmConfig` from `src/llm-providers/resolver.js`; `tryGetEmbedding` + `EmbeddingCallContext` from `src/embeddings.js`.
- Produces: `embedAndStoreMessage` (see Interfaces block).

- [ ] **Step 1: Write the failing tests for `embedAndStoreMessage`**

Create `tests/message-cache/embed-message.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { embedAndStoreMessage } from '../../src/message-cache/embed-message.js'
import type { EmbedMessageDeps } from '../../src/message-cache/embed-message.js'
import { cacheMessage } from '../../src/message-cache/cache.js'
import { loadEmbeddingsForScope } from '../../src/message-cache/vector-store.js'
import { flushPendingWrites, mockLogger, setupTestDb } from '../utils/test-helpers.js'
import type { MessageScope } from '../../src/message-cache/store.js'

const groupScope = (g: string): MessageScope => ({ kind: 'group', groupContextId: g })

describe('embedAndStoreMessage', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('no-op (no store) when LLM config does not resolve', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'hi', timestamp: 1 })
    await flushPendingWrites()
    const embedOne = mock(() => Promise.resolve([0.1, 0.2]))
    const deps: EmbedMessageDeps = {
      resolve: () => ({ ok: false, source: 'global', type: 'missing', missing: ['embedding_model'] }) as never,
      embedOne,
    }
    await embedAndStoreMessage(
      { text: 'hi', contextId: 'g:t1', messageId: 'm1', configContextId: 'g', embeddingCtx: { storageContextId: 'g:t1', contextType: 'group', chatUserId: 'u1' } },
      deps,
    )
    expect(embedOne).toHaveBeenCalledTimes(0)
    expect(loadEmbeddingsForScope(groupScope('g'))).toHaveLength(0)
  })

  test('no-op (no store), no throw when embed call fails', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'hi', timestamp: 1 })
    await flushPendingWrites()
    const deps: EmbedMessageDeps = {
      resolve: () => ({ ok: true, source: 'global', embedding: { apiKey: 'k', baseUrl: 'u', model: 'm' } }) as never,
      embedOne: () => Promise.reject(new Error('boom')),
    }
    await expect(
      embedAndStoreMessage(
        { text: 'hi', contextId: 'g:t1', messageId: 'm1', configContextId: 'g', embeddingCtx: { storageContextId: 'g:t1', contextType: 'group', chatUserId: 'u1' } },
        deps,
      ),
    ).resolves.toBeUndefined()
    expect(loadEmbeddingsForScope(groupScope('g'))).toHaveLength(0)
  })

  test('stores the embedding with model + dim on success', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'hi', timestamp: 1 })
    await flushPendingWrites()
    const deps: EmbedMessageDeps = {
      resolve: () => ({ ok: true, source: 'global', embedding: { apiKey: 'k', baseUrl: 'u', model: 'text-emb' } }) as never,
      embedOne: async () => [0.4, 0.5, 0.6],
    }
    await embedAndStoreMessage(
      { text: 'hi', contextId: 'g:t1', messageId: 'm1', configContextId: 'g', embeddingCtx: { storageContextId: 'g:t1', contextType: 'group', chatUserId: 'u1' } },
      deps,
    )
    const loaded = loadEmbeddingsForScope(groupScope('g'))
    expect(loaded).toHaveLength(1)
    expect(Array.from(loaded[0]?.vec ?? [])).toEqual([0.4, 0.5, 0.6])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/message-cache/embed-message.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `embed-message.ts`**

Create `src/message-cache/embed-message.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tryGetEmbedding, type EmbeddingCallContext } from '../embeddings.js'
import { logger } from '../logger.js'
import { resolveLlmConfig } from '../llm-providers/resolver.js'
import { storeEmbedding } from './vector-store.js'

const log = logger.child({ scope: 'embed-message' })

export type EmbedMessageDeps = {
  resolve: typeof resolveLlmConfig
  embedOne: (text: string, apiKey: string, baseUrl: string, model: string, ctx: EmbeddingCallContext) => Promise<number[] | null>
}

const defaultDeps: EmbedMessageDeps = {
  resolve: resolveLlmConfig,
  embedOne: (text, apiKey, baseUrl, model, ctx) => tryGetEmbedding(text, apiKey, baseUrl, model, ctx),
}

export type EmbedAndStoreArgs = {
  text: string
  contextId: string
  messageId: string
  configContextId: string
  embeddingCtx: EmbeddingCallContext
}

/**
 * Resolve the embedding model for the config-context, embed the text, and store
 * the result with its provenance. Never throws — failures are logged and the
 * row is left without an embedding (the sweep retries).
 */
export async function embedAndStoreMessage(args: EmbedAndStoreArgs, deps: EmbedMessageDeps = defaultDeps): Promise<void> {
  const { text, contextId, messageId, configContextId, embeddingCtx } = args
  log.debug({ contextId, messageId, configContextId, textLength: text.length }, 'embedAndStoreMessage called')
  const resolved = deps.resolve(configContextId)
  if (!resolved.ok) {
    log.debug({ configContextId }, 'embedding config not available; skipping')
    return
  }
  const { apiKey, baseUrl, model } = resolved.embedding
  let vec: number[] | null
  try {
    vec = await deps.embedOne(text, apiKey, baseUrl, model, embeddingCtx)
  } catch (error) {
    log.warn({ messageId, error: error instanceof Error ? error.message : String(error) }, 'inline embed failed; sweep will retry')
    return
  }
  if (vec === null || vec.length === 0) {
    log.debug({ messageId }, 'embed returned null; skipping')
    return
  }
  storeEmbedding(contextId, messageId, new Float32Array(vec), model, vec.length)
  log.debug({ messageId, model, dim: vec.length }, 'embedding stored')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/message-cache/embed-message.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the caching chokepoint**

Modify `src/bot-message-caching.ts`. The current file (36 lines) caches then returns. Add a fire-and-forget embed call after `cacheMessage(...)` — only when the message has non-empty text. Replace the function body so it computes `configContextId` from `auth` and kicks off the embed:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getScopeKey } from './chat/context-scope.js'
import type { AuthorizationResult, IncomingMessage } from './chat/types.js'
import { logger } from './logger.js'
import { cacheMessage } from './message-cache/cache.js'
import { embedAndStoreMessage } from './message-cache/embed-message.js'

const log = logger.child({ scope: 'bot-message-caching' })

/**
 * Persist every allowed observed non-command message to message_metadata,
 * then fire-and-forget an embedding (semantic search). Runs for the full
 * observable history (not just bot-addressed messages) so group-wide search
 * sees all traffic; commands are excluded via commandMatch.
 */
export function cacheObservedIncomingMessage(msg: IncomingMessage, auth: AuthorizationResult): void {
  if (!auth.allowed) return
  if (msg.messageId === undefined) return
  if (msg.commandMatch !== undefined && msg.commandMatch !== '') return
  cacheMessage({
    messageId: msg.messageId,
    contextId: auth.storageContextId,
    groupContextId:
      msg.contextType === 'group'
        ? getScopeKey('group', {
            storageContextId: auth.storageContextId,
            chatUserId: msg.user.id,
            contextType: 'group',
          })
        : undefined,
    authorId: msg.user.id,
    authorUsername: msg.user.username ?? undefined,
    text: msg.text,
    replyToMessageId: msg.replyToMessageId,
    timestamp: Date.now(),
  })
  const text = msg.text ?? ''
  if (text.trim() !== '') {
    void embedAndStoreMessage({
      text,
      contextId: auth.storageContextId,
      messageId: msg.messageId,
      configContextId: auth.configContextId,
      embeddingCtx: {
        storageContextId: auth.storageContextId,
        contextType: msg.contextType,
        chatUserId: msg.user.id,
      },
    }).catch((error) => {
      log.warn({ messageId: msg.messageId, error: error instanceof Error ? error.message : String(error) }, 'embedAndStoreMessage rejected')
    })
  }
}
```

- [ ] **Step 6: Add a caching test asserting the embed is observable**

Add to `tests/bot-message-caching.test.ts` a case that caches a message with text and confirms an embedding row appears (using the real `embedAndStoreMessage` path requires an LLM config; instead assert the no-text path does NOT throw and command messages are skipped — follow the existing suite's import style). Minimal addition (append inside the existing `describe`):

```typescript
  test('does not throw when text is empty (no embed attempted)', () => {
    expect(() =>
      cacheObservedIncomingMessage(
        { messageId: 'm1', user: { id: 'u1' }, contextType: 'dm', text: '   ' } as never,
        { allowed: true, storageContextId: 'dm-1', configContextId: 'dm-1' } as never,
      ),
    ).not.toThrow()
  })
```

(If `tests/bot-message-caching.test.ts` already constructs `IncomingMessage`/`AuthorizationResult` via helpers like `createDmMessage`/`createAuth`, use those instead of the `as never` casts shown above — match the local pattern.)

- [ ] **Step 7: Run the full caching + embed suites**

Run: `bun test tests/bot-message-caching.test.ts tests/message-cache/embed-message.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/message-cache/embed-message.ts src/bot-message-caching.ts tests/message-cache/embed-message.test.ts tests/bot-message-caching.test.ts
git commit -m "feat(message-cache): inline fire-and-forget embedding at the caching chokepoint"
```

---

## Task 4: Scheduled `message-embedding-sweep`

**Files:**
- Create: `src/message-embedding-sweep.ts`
- Create: `tests/message-embedding-sweep.test.ts`
- Modify: `src/scheduler-instance.ts:29-36` (`DEFAULT_SCHEDULER_TASK_NAMES`) and `src/scheduler-instance.ts:38-63` (register in `registerImmediateDefaultTasks`)

**Interfaces:**
- Consumes: `pendingConfigContexts`, `nextPendingBatchForContext`, `storeEmbedding`, `countPending` (Task 2); `resolveLlmConfig`; `embedMany` from `ai`; `pLimit` from `p-limit`.
- Produces: `runMessageEmbeddingSweep(deps?)` returning `{ embedded, contexts }`.

- [ ] **Step 1: Write the failing sweep tests**

Create `tests/message-embedding-sweep.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { cacheMessage } from '../src/message-cache/cache.js'
import { countPending, loadEmbeddingsForScope } from '../src/message-cache/vector-store.js'
import { runMessageEmbeddingSweep } from '../src/message-embedding-sweep.js'
import type { SweepDeps } from '../src/message-embedding-sweep.js'
import { flushPendingWrites, mockLogger, setupTestDb } from './utils/test-helpers.js'
import type { MessageScope } from '../src/message-cache/store.js'

const groupScope = (g: string): MessageScope => ({ kind: 'group', groupContextId: g })

const okDeps = (vectors: number[][]): SweepDeps => {
  let i = 0
  return {
    resolve: () => ({ ok: true, source: 'global', embedding: { apiKey: 'k', baseUrl: 'u', model: 'sweep-model' } }) as never,
    embedMany: async () => ({ embeddings: vectors.map(() => vectors[i++ % vectors.length]!) }),
  }
}

describe('message-embedding-sweep', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('backfills NULL-embedding rows in a context', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'one', timestamp: 1 })
    cacheMessage({ messageId: 'm2', contextId: 'g:t2', groupContextId: 'g', text: 'two', timestamp: 2 })
    await flushPendingWrites()
    expect(countPending()).toBe(2)
    const res = await runMessageEmbeddingSweep(okDeps([[0.1, 0.2]]))
    expect(res.embedded).toBe(2)
    expect(countPending()).toBe(0)
    expect(loadEmbeddingsForScope(groupScope('g'))).toHaveLength(2)
  })

  test('re-embeds rows whose model differs from the current model', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'one', timestamp: 1 })
    await flushPendingWrites()
    // seed a stale-model embedding via the store
    const { storeEmbedding } = await import('../src/message-cache/vector-store.js')
    storeEmbedding('g:t1', 'm1', new Float32Array([9, 9]), 'old-model', 2)
    expect(countPending()).toBe(0) // not NULL, but stale
    await runMessageEmbeddingSweep(okDeps([[0.3, 0.4]]))
    const loaded = loadEmbeddingsForScope(groupScope('g'))
    expect(loaded).toHaveLength(1)
    expect(Array.from(loaded[0]?.vec ?? [])).toEqual([0.3, 0.4])
  })

  test('skips a context whose config does not resolve', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'one', timestamp: 1 })
    await flushPendingWrites()
    const embedMany = mock(() => Promise.resolve({ embeddings: [[0, 0]] }))
    const deps: SweepDeps = {
      resolve: () => ({ ok: false, source: 'global', type: 'missing', missing: ['embedding_model'] }) as never,
      embedMany,
    }
    await runMessageEmbeddingSweep(deps)
    expect(embedMany).toHaveBeenCalledTimes(0)
    expect(countPending()).toBe(1)
  })

  test('a transient embed failure leaves rows pending without crashing the sweep', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'one', timestamp: 1 })
    await flushPendingWrites()
    const deps: SweepDeps = {
      resolve: () => ({ ok: true, source: 'global', embedding: { apiKey: 'k', baseUrl: 'u', model: 'm' } }) as never,
      embedMany: () => Promise.reject(new Error('rate limited')),
    }
    await expect(runMessageEmbeddingSweep(deps)).resolves.toEqual({ embedded: 0, contexts: 0 })
    expect(countPending()).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/message-embedding-sweep.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the sweep**

Create `src/message-embedding-sweep.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { embedMany } from 'ai'
import pLimit from 'p-limit'

import { logger } from './logger.js'
import { resolveLlmConfig } from './llm-providers/resolver.js'
import {
  countPending,
  nextPendingBatchForContext,
  pendingConfigContexts,
  storeEmbedding,
} from './message-cache/vector-store.js'

const log = logger.child({ scope: 'message-embedding-sweep' })

const CONTEXT_FETCH_LIMIT = 50
const BATCH_PER_CONTEXT = 25
const CONCURRENCY = 3

export type SweepDeps = {
  resolve: typeof resolveLlmConfig
  embedMany: (values: readonly string[], apiKey: string, baseUrl: string, model: string) => Promise<readonly number[][]>
}

const defaultDeps: SweepDeps = {
  resolve: resolveLlmConfig,
  embedMany: async (values, apiKey, baseUrl, model) => {
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
    const provider = createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL: baseUrl })
    const result = await embedMany({ model: provider.embeddingModel(model), values: [...values] })
    return result.embeddings
  },
}

/**
 * Sweep pending embeddings: for each config-context with NULL or model-mismatched
 * rows, resolve the current model, batch-embed, and store. Bounded concurrency
 * across contexts. Never throws — per-context failures are logged and skipped.
 */
export async function runMessageEmbeddingSweep(deps: SweepDeps = defaultDeps): Promise<{ embedded: number; contexts: number }> {
  const before = countPending()
  if (before === 0) {
    log.debug('no pending embeddings')
    return { embedded: 0, contexts: 0 }
  }
  log.info({ pending: before }, 'message embedding sweep starting')

  const ctxIds = pendingConfigContexts(CONTEXT_FETCH_LIMIT)
  const limit = pLimit(CONCURRENCY)
  let embedded = 0
  let contexts = 0

  await Promise.all(
    ctxIds.map((ctxId) =>
      limit(async () => {
        const resolved = deps.resolve(ctxId)
        if (!resolved.ok) {
          log.debug({ configContextId: ctxId }, 'sweep: config not available, skipping context')
          return
        }
        const { apiKey, baseUrl, model } = resolved.embedding
        const rows = nextPendingBatchForContext(ctxId, model, BATCH_PER_CONTEXT)
        if (rows.length === 0) return
        const texts = rows.map((r) => r.text ?? '')
        let vectors: readonly number[][]
        try {
          vectors = await deps.embedMany(texts, apiKey, baseUrl, model)
        } catch (error) {
          log.warn(
            { configContextId: ctxId, count: rows.length, error: error instanceof Error ? error.message : String(error) },
            'sweep: batch embed failed; rows remain pending',
          )
          return
        }
        for (let i = 0; i < rows.length; i++) {
          const vec = vectors[i]
          if (vec === undefined) continue
          const row = rows[i]!
          storeEmbedding(row.contextId, row.messageId, new Float32Array(vec), model, vec.length)
          embedded++
        }
        contexts++
      }),
    ),
  )

  const after = countPending()
  log.info({ embedded, contexts, remaining: after }, 'message embedding sweep complete')
  return { embedded, contexts }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/message-embedding-sweep.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Register the sweep as a scheduler default task**

In `src/scheduler-instance.ts`:

1. Add the import near the other sweep imports (after line 14, the `sweepDirtyContexts` import):
```typescript
import { runMessageEmbeddingSweep } from './message-embedding-sweep.js'
```

2. Add `'message-embedding-sweep'` to the `DEFAULT_SCHEDULER_TASK_NAMES` array (line 29-36):
```typescript
export const DEFAULT_SCHEDULER_TASK_NAMES = [
  'user-cache-cleanup',
  'message-queue-cleanup',
  'staged-files-purge',
  'long-term-memory-maintenance',
  'memory-capture-sweep',
  'memory-promotion-sweep',
  'message-embedding-sweep',
] as const
```

3. Register it inside `registerImmediateDefaultTasks` (e.g. after the `long-term-memory-maintenance` block, before the closing brace):
```typescript
  scheduler.register('message-embedding-sweep', {
    interval: 5 * 60 * 1000,
    handler: () => {
      void runMessageEmbeddingSweep()
    },
    options: { immediate: false },
  })
```

(`immediate: false` so it doesn't fire on boot before configs settle; deferred like the memory sweeps.)

- [ ] **Step 6: Run typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/message-embedding-sweep.ts src/scheduler-instance.ts tests/message-embedding-sweep.test.ts
git commit -m "feat(scheduler): message-embedding-sweep — backfill, retry, model-mismatch re-embed"
```

---

## Task 5: Extend `search_chat_history` with semantic/auto mode

**Files:**
- Modify: `src/tools/search-chat-history.ts`
- Modify: `tests/tools/search-chat-history.test.ts`

**Interfaces:**
- Consumes: `searchMessages`, `MessageScope`, `SearchFilters` (Phase 1); `searchKnn` (Task 2); `getEmbeddingForContext` + `EmbeddingCallContext` from `src/embeddings.js`; `getConfigContextIdFromStorageContextId` from `src/chat/scoped-context.js`.
- Produces: `makeSearchChatHistoryTool(chatUserId, storageContextId, contextType): Tool` (signature unchanged; now async with `mode`).

- [ ] **Step 1: Write the failing semantic/auto tests**

Append to `tests/tools/search-chat-history.test.ts`. These need to control `getEmbeddingForContext`; use `mock.module` on `../../src/embeddings.js` (legacy module-mock pattern, documented as acceptable in `tests/AGENTS.md` when DI is unavailable — `getEmbeddingForContext` has no per-call DI at the function level). Add at the top of the file, after the existing imports, a helper to install/restore the mock, then new tests:

```typescript
import { mock } from 'bun:test'
import { storeEmbedding } from '../../src/message-cache/vector-store.js'

// Control getEmbeddingForContext across the semantic tests.
let nextQueryVec: number[] | null = null
const setQueryVec = (v: number[] | null): void => {
  nextQueryVec = v
}
mock.module('../../src/embeddings.js', () => ({
  getEmbeddingForContext: () => Promise.resolve(nextQueryVec),
}))
```

(Place the `mock.module` call at module top-level so it is installed before the tool imports it; the global `mock.reset()`/preload handles restoration. The existing keyword tests must still pass — they pass `mode` defaulting to `'auto'`; since `nextQueryVec` starts `null`, `auto` falls back to keyword, preserving existing assertions. Verify the existing `expect(result.mode).toBe('keyword')` assertions still hold under `auto`→fallback by asserting `mode` loosely where the existing tests assert `'keyword'` — OR set `mode: 'keyword'` explicitly in the existing keyword tests to keep them deterministic. Prefer the latter: update existing keyword tests to pass `{ query: '...', mode: 'keyword' }`.)

New semantic test cases (append inside the existing `describe`):

```typescript
  test('auto mode returns a semantic hit by meaning when a query vector is available', async () => {
    cacheMessage({ messageId: 's1', contextId: threadContextId, groupContextId, text: 'cycle the api keys', timestamp: 1 })
    cacheMessage({ messageId: 's2', contextId: threadContextId, groupContextId, text: 'lunch?', timestamp: 2 })
    await flushPendingWrites()
    storeEmbedding(threadContextId, 's1', new Float32Array([0.9, 0.1]), 'm', 2)
    storeEmbedding(threadContextId, 's2', new Float32Array([0.0, 1.0]), 'm', 2)
    setQueryVec([0.95, 0.05])
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ query: 'rotate credentials', mode: 'auto' })
    assert(isSearchResult(result), 'Invalid result')
    expect(result.results.map((r) => (r as { messageId: string }).messageId)).toEqual(['s1'])
    expect(result.mode).toBe('semantic')
    setQueryVec(null)
  })

  test('auto mode falls back to keyword when no embedding model resolves', async () => {
    cacheMessage({ messageId: 'k1', contextId: threadContextId, groupContextId, text: 'deploy', timestamp: 1 })
    await flushPendingWrites()
    setQueryVec(null)
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ query: 'deploy', mode: 'auto' })
    assert(isSearchResult(result), 'Invalid result')
    expect(result.mode).toBe('keyword_fallback')
    expect(result.results.map((r) => (r as { messageId: string }).messageId)).toEqual(['k1'])
  })

  test('auto mode falls back to keyword when semantic returns zero hits', async () => {
    cacheMessage({ messageId: 'k1', contextId: threadContextId, groupContextId, text: 'deploy', timestamp: 1 })
    await flushPendingWrites()
    setQueryVec([0.0, 1.0]) // vector present but matches nothing above threshold
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ query: 'deploy', mode: 'auto' })
    assert(isSearchResult(result), 'Invalid result')
    expect(result.mode).toBe('keyword_fallback')
    setQueryVec(null)
  })

  test('semantic mode returns semantic_unavailable when no embedding model resolves', async () => {
    cacheMessage({ messageId: 'k1', contextId: threadContextId, groupContextId, text: 'deploy', timestamp: 1 })
    await flushPendingWrites()
    setQueryVec(null)
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ query: 'deploy', mode: 'semantic' })
    assert(isSearchResult(result), 'Invalid result')
    expect(result.mode).toBe('semantic_unavailable')
    expect(result.results).toEqual([])
  })

  test('keyword mode is unchanged (explicit)', async () => {
    cacheMessage({ messageId: 'k1', contextId: threadContextId, groupContextId, text: 'deploy', timestamp: 1 })
    await flushPendingWrites()
    setQueryVec([0.95, 0.05]) // would produce a semantic hit if mode were auto
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ query: 'deploy', mode: 'keyword' })
    assert(isSearchResult(result), 'Invalid result')
    expect(result.mode).toBe('keyword')
    setQueryVec(null)
  })

  test('schema accepts mode keyword|semantic|auto (default auto)', () => {
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    expect(schemaValidates(tool, { query: 'x', mode: 'semantic' })).toBe(true)
    expect(schemaValidates(tool, { query: 'x', mode: 'bogus' })).toBe(false)
  })
```

Also update the existing keyword tests to pass `mode: 'keyword'` explicitly (so they remain deterministic regardless of `nextQueryVec`): in `returns matching messages within the group scope`, `hasMore is true when results hit the requested limit`, `returns empty result set on no match`, and `DM scope finds DM rows and group scope does not`, change the `getToolExecutor(tool)({ query: '...' })` calls to include `mode: 'keyword'`. The existing `expect(result.mode).toBe('keyword')` assertions then still hold.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/tools/search-chat-history.test.ts`
Expected: FAIL — `mode` not accepted by the schema / semantic modes not implemented.

- [ ] **Step 3: Implement the tool extension**

Replace `src/tools/search-chat-history.ts` contents with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { getScopeKey } from '../chat/context-scope.js'
import type { ContextType } from '../chat/types.js'
import { getEmbeddingForContext, type EmbeddingCallContext } from '../embeddings.js'
import { logger } from '../logger.js'
import { searchMessages, searchKnn, type MessageScope, type SearchFilters } from '../message-cache/store.js'

const log = logger.child({ scope: 'tool:search-chat-history' })

const toScope = (storageContextId: string, chatUserId: string, contextType: ContextType): MessageScope =>
  contextType === 'group'
    ? { kind: 'group', groupContextId: getScopeKey('group', { storageContextId, chatUserId, contextType }) }
    : { kind: 'dm', contextId: storageContextId }

type SearchMode = 'keyword' | 'semantic' | 'auto'
type ResultMode = 'keyword' | 'semantic' | 'keyword_fallback' | 'semantic_unavailable'

type SearchChatHistoryInput = Readonly<{
  query: string
  limit: number
  mode: SearchMode
  author?: string | undefined
  contextId?: string | undefined
  since?: string | undefined
  until?: string | undefined
}>

type ResultRow = {
  messageId: string
  authorUsername: string | null
  text: string
  timestamp: number
  contextId: string
  replyToMessageId?: string
  score?: number
}

type SearchChatHistoryOutput = {
  results: ResultRow[]
  total: number
  mode: ResultMode
  hasMore: boolean
}

const toFilters = ({ author, contextId, since, until }: Omit<SearchChatHistoryInput, 'query' | 'limit' | 'mode'>): SearchFilters => ({
  ...(author === undefined ? {} : { author }),
  ...(contextId === undefined ? {} : { contextId }),
  ...(since === undefined ? {} : { since: Date.parse(since) }),
  ...(until === undefined ? {} : { until: Date.parse(until) }),
})

function doKeywordSearch(scope: MessageScope, input: SearchChatHistoryInput, mode: ResultMode): SearchChatHistoryOutput {
  const filters = toFilters(input)
  const results = searchMessages(scope, input.query, filters, input.limit).map((m) => ({
    messageId: m.messageId,
    authorUsername: m.authorUsername ?? null,
    text: m.text ?? '',
    timestamp: m.timestamp,
    contextId: m.contextId,
    ...(m.replyToMessageId === undefined ? {} : { replyToMessageId: m.replyToMessageId }),
  }))
  log.info({ resultCount: results.length, mode }, 'keyword search completed')
  return { results, total: results.length, mode, hasMore: results.length === input.limit }
}

export function makeSearchChatHistoryTool(
  chatUserId: string,
  storageContextId: string,
  contextType: ContextType,
): Tool {
  const scope = toScope(storageContextId, chatUserId, contextType)
  const configContextId = getConfigContextIdFromStorageContextId(storageContextId)
  const embeddingCtx: EmbeddingCallContext = { storageContextId, contextType, chatUserId }
  return tool({
    description:
      'Search past chat messages in this context by keyword (exact) or meaning (semantic). ' +
      'Use mode "auto" (default) for semantic-first with keyword fallback, "keyword" for exact FTS5, ' +
      'or "semantic" for meaning-only. Use to recall decisions, find who said what, or locate prior discussion.',
    inputSchema: z.object({
      query: z.string().min(1).describe('Search query. In keyword mode multi-word queries match the exact phrase.'),
      mode: z.enum(['keyword', 'semantic', 'auto']).default('auto').describe('keyword = exact FTS5; semantic = embedding similarity; auto = semantic-first with keyword fallback'),
      limit: z.number().int().min(1).max(20).default(5).describe('Max results (default 5, max 20)'),
      author: z.string().optional().describe('Filter by author username or id'),
      contextId: z.string().optional().describe('Narrow to one thread-scoped context within the group (from a prior result)'),
      since: z.iso.datetime().optional().describe('ISO8601 lower bound (exclusive) on message time'),
      until: z.iso.datetime().optional().describe('ISO8601 upper bound (exclusive) on message time'),
    }),
    execute: async (input): Promise<SearchChatHistoryOutput> => {
      const parsed: SearchChatHistoryInput = { ...input, mode: input.mode, limit: input.limit }
      log.debug({ query: parsed.query, mode: parsed.mode, limit: parsed.limit }, 'search_chat_history called')
      if (parsed.mode === 'keyword') return doKeywordSearch(scope, parsed, 'keyword')

      const queryVec = await getEmbeddingForContext(parsed.query, configContextId, embeddingCtx)
      if (queryVec === null) {
        if (parsed.mode === 'semantic') {
          log.info('semantic unavailable; no embedding model resolved')
          return { results: [], total: 0, mode: 'semantic_unavailable', hasMore: false }
        }
        return doKeywordSearch(scope, parsed, 'keyword_fallback')
      }

      const knn = searchKnn(queryVec, scope, toFilters(parsed), parsed.limit)
      if (parsed.mode === 'semantic') {
        const rows = await resolveRows(scope, knn)
        log.info({ resultCount: rows.length, mode: 'semantic' }, 'semantic search completed')
        return { results: rows, total: rows.length, mode: 'semantic', hasMore: rows.length === parsed.limit }
      }
      if (knn.length > 0) {
        const rows = await resolveRows(scope, knn)
        log.info({ resultCount: rows.length, mode: 'semantic' }, 'auto: semantic hit')
        return { results: rows, total: rows.length, mode: 'semantic', hasMore: rows.length === parsed.limit }
      }
      return doKeywordSearch(scope, parsed, 'keyword_fallback')
    },
  })
}

/** Turn KNN ids+scores into full message rows via the scope-checked store. */
async function resolveRows(scope: MessageScope, knn: { messageId: string; score: number }[]): Promise<ResultRow[]> {
  const { getMessage } = await import('../message-cache/store.js')
  return knn
    .map(({ messageId, score }) => {
      const m = getMessage(scope, messageId)
      if (m === undefined) return null
      return {
        messageId: m.messageId,
        authorUsername: m.authorUsername ?? null,
        text: m.text ?? '',
        timestamp: m.timestamp,
        contextId: m.contextId,
        ...(m.replyToMessageId === undefined ? {} : { replyToMessageId: m.replyToMessageId }),
        score,
      }
    })
    .filter((r): r is ResultRow => r !== null)
}
```

Note: `searchKnn` is exported from `vector-store.ts` (Task 2), not `store.ts`. Fix the import to pull `searchMessages`, `getMessage`, `MessageScope`, `SearchFilters` from `./store.js` and `searchKnn` from `../message-cache/vector-store.js`:

```typescript
import { getMessage, searchMessages, type MessageScope, type SearchFilters } from '../message-cache/store.js'
import { searchKnn } from '../message-cache/vector-store.js'
```

and drop the dynamic `await import` in `resolveRows` in favor of the top-level `getMessage` import (cleaner; the dynamic import was only to avoid an import-order quirk that does not apply here).

- [ ] **Step 4: Run the tool tests to verify they pass**

Run: `bun test tests/tools/search-chat-history.test.ts`
Expected: PASS (existing keyword cases — now passing `mode: 'keyword'` — plus the 6 new semantic/auto cases).

- [ ] **Step 5: Run typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 6: Update the tool docs**

In `src/tools/CLAUDE.md`, find the `- chat-history search:` bullet (in the "Current Context-Sensitive Tool Areas" section). Append a note that `search_chat_history` now also supports `semantic`/`auto` mode (embedding-based, BYOK `embedding` role, falls back to keyword when no embedding model resolves). Keep it to one added sentence.

- [ ] **Step 7: Commit**

```bash
git add src/tools/search-chat-history.ts tests/tools/search-chat-history.test.ts src/tools/CLAUDE.md
git commit -m "feat(tools): search_chat_history semantic/auto mode (embedding similarity)"
```

---

## Task 6: Full-suite verification

**Files:** none (verification + knip).

- [ ] **Step 1: Run the full serial suite**

Run: `bun run test:serial` (or `CI=true bun run test` per `docs/architecture/commands.md`).
Expected: all green, 0 failures. Note the new total (Phase 1 was 8583 pass).

- [ ] **Step 2: Run typecheck + lint + knip**

Run: `bun run typecheck && bun run lint && bun run knip`
Expected: all clean. If knip flags an unused export (e.g. `SIMILARITY_THRESHOLD`/`COSINE_COMFORT_WARN` if not re-used), either add a knip ignore with a justification comment OR remove the export if truly unused — prefer keeping the named constant and adding a documented knip ignore entry the way the repo already does for exported constants.

- [ ] **Step 3: Spot-check a story run (optional but recommended)**

Run: `bun test:stories` (Tier 0 hermetic full-stack). Expected: no regressions in the architecture-refactor gate.

- [ ] **Step 4: Final commit if any fixups were needed**

Only if Steps 1-3 surfaced fixups. Otherwise the branch tip from Task 5 is the deliverable.

```bash
git add -A && git commit -m "chore: phase-2 verification fixups"
```

---

## Self-Review (completed during authoring)

**1. Spec coverage:** Every spec section maps to a task — §1 data model → Task 1; §2 the seam → Task 2; §3 write path (inline + sweep) → Tasks 3 + 4; §4 read path + hybrid → Task 5; §5 availability/permissions/privacy inherited (no new code — verified the tool degrades to keyword when `getEmbeddingForContext` returns null, which happens when the `embedding` role doesn't resolve); §6 scale ceiling → `COSINE_COMFORT_WARN` warn in `loadEmbeddingsForScope` (Task 2); §7 error handling/logging → every new module's logging discipline; testing → each task is TDD. Migration registration → Task 1. No spec requirement is unowned.

**2. Placeholder scan:** No TBD/TODO/"add appropriate error handling". Every code step shows complete code. The two advisory notes ("match the local pattern", "prefer keeping the named constant") describe a decision the implementer makes on the spot against existing code, not a missing plan detail.

**3. Type consistency:** `storeEmbedding(contextId, messageId, vec: Float32Array, model, dim)` — same in Tasks 2, 3, 4, 5. `searchKnn(queryVec, scope, filters, limit, threshold?)` — same in Task 2 (def) and Task 5 (use). `MessageScope`/`SearchFilters` imported from `store.js` consistently. `EmbeddingCallContext` from `embeddings.js` consistently. `pendingConfigContexts`/`nextPendingBatchForContext`/`countPending` — same names in Task 2 (def) and Task 4 (use). `runMessageEmbeddingSweep`/`SweepDeps` — same in Task 4. `embedAndStoreMessage`/`EmbedMessageDeps` — same in Task 3. The one intentional rename during Task 5 (`searchKnn` sourced from `vector-store.js`, `getMessage` as a top-level import) is called out inline so the implementer doesn't ship a broken import.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-26-chat-history-search-phase-2.md`.
