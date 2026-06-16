<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory Foundation Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the storage + capture + embedding infrastructure for the cross-thread memory bridge: a provisional record tier, an idle-debounce capture pipeline that writes durable knowledge from even short threads, embeddings for semantic recall, and a scheduler backstop — all behind the `cross_thread_memory` flag (default OFF ⇒ reference-identical to today).

**Architecture:** Extends the existing long-term memory subsystem (`src/long-term-memory/`) rather than adding a new table. `memory_records` gains a `thread_context_id` column and a `provisional` status; a new `memory_extraction_state` table tracks per-context activity/extraction watermarks. Capture runs the existing `extractMemoryPatch` extractor against a thread's history (debounced on idle, with a scheduler sweep backstop) and writes provisional, thread-tagged records with populated embeddings. The user-visible recall (`recall` tool, cascade, promotion) is built on this foundation in **Plan 2**.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Drizzle ORM over `bun:sqlite`, Zod v4, Vercel AI SDK. Tests: `bun test --parallel` (`bun run test`), DI-first per `tests/CLAUDE.md`.

**Scope note:** This plan is infrastructure. When the flag is ON it captures provisional records but does not yet surface them — Plan 2 (`recall` cascade + promotion) makes them user-visible. The acceptance test for "stop rediscovering" lives in Plan 2; Plan 1 is verified by unit/integration tests on each layer.

**Reference spec:** `docs/superpowers/specs/2026-06-16-cross-thread-memory-and-context-scope-design.md`

---

## File Structure

| File                                          | Responsibility                                                                         | Change |
| --------------------------------------------- | -------------------------------------------------------------------------------------- | ------ |
| `src/db/migrations/056_provisional_memory.ts` | Add `thread_context_id`, create `memory_extraction_state`, add index                   | Create |
| `src/db/index.ts`                             | Register migration 056                                                                 | Modify |
| `src/db/long-term-memory-schema.ts`           | Drizzle: `threadContextId` column, `provisional` status, `memoryExtractionState` table | Modify |
| `src/db/schema.ts`                            | Re-export `memoryExtractionState`                                                      | Modify |
| `src/long-term-memory/types.ts`               | `provisional` status, `threadContextId`, `evidence.threads`                            | Modify |
| `src/long-term-memory/store.ts`               | Persist/read `threadContextId`; `listProvisionalRecords`                               | Modify |
| `src/tools/feature-flags.ts`                  | `crossThreadMemory` flag + `resolveCrossThreadMemoryFlag`                              | Modify |
| `src/long-term-memory/semantic-search.ts`     | Cosine ranking over record embeddings                                                  | Create |
| `src/long-term-memory/embedding-writer.ts`    | `saveMemoryRecordWithEmbedding` (save + fire-and-forget embed)                         | Create |
| `src/long-term-memory/extraction-state.ts`    | `memory_extraction_state` read/write (watermarks)                                      | Create |
| `src/long-term-memory/capture.ts`             | `runMemoryCapture` — extract → provisional records                                     | Create |
| `src/long-term-memory/capture-debounce.ts`    | `armMemoryCapture` — per-context idle debounce                                         | Create |
| `src/long-term-memory/capture-sweep.ts`       | `sweepDirtyContexts` — scheduler backstop                                              | Create |
| `src/llm-history.ts`                          | Arm capture on each group-thread turn                                                  | Modify |
| `src/scheduler-instance.ts`                   | Register the capture sweep                                                             | Modify |

---

## Task 1: Migration 056 + schema + types

**Files:**

- Create: `src/db/migrations/056_provisional_memory.ts`
- Modify: `src/db/index.ts` (import + append to `MIGRATIONS`)
- Modify: `src/db/long-term-memory-schema.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/long-term-memory/types.ts`
- Test: `tests/db/migration-056.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/db/migration-056.test.ts
import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { runMigrations } from '../../src/db/migrate.js'
import { MIGRATIONS } from '../../src/db/index.js'

const columnNames = (db: Database, table: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name)

const tableExists = (db: Database, table: string): boolean =>
  db.query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table) !==
  null

describe('migration 056', () => {
  test('adds thread_context_id and memory_extraction_state', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(columnNames(db, 'memory_records')).toContain('thread_context_id')
    expect(tableExists(db, 'memory_extraction_state')).toBe(true)
    expect(columnNames(db, 'memory_extraction_state')).toEqual(
      expect.arrayContaining([
        'context_id',
        'context_type',
        'config_context_id',
        'last_activity_at',
        'last_extracted_at',
        'last_history_len',
      ]),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/db/migration-056.test.ts`
Expected: FAIL — `thread_context_id` not in column list / `memory_extraction_state` does not exist.

- [ ] **Step 3: Create the migration**

```typescript
// src/db/migrations/056_provisional_memory.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:056' })

const columnExists = (db: Database, table: string, column: string): boolean => {
  const rows = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all()
  return rows.some((row) => row.name === column)
}

const up = (db: Database): void => {
  if (!columnExists(db, 'memory_records', 'thread_context_id')) {
    db.run(`ALTER TABLE memory_records ADD COLUMN thread_context_id TEXT`)
  }
  db.run(`CREATE INDEX IF NOT EXISTS idx_memory_records_thread
    ON memory_records(scope_id, thread_context_id, status)`)
  db.run(`CREATE TABLE IF NOT EXISTS memory_extraction_state (
    context_id TEXT PRIMARY KEY,
    context_type TEXT NOT NULL,
    config_context_id TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    last_extracted_at TEXT,
    last_history_len INTEGER NOT NULL DEFAULT 0
  )`)
  log.info('migration 056: provisional memory tier + extraction-state added')
}

export const migration056ProvisionalMemory: Migration = {
  id: '056_provisional_memory',
  up,
}

export default migration056ProvisionalMemory
```

- [ ] **Step 4: Register the migration**

In `src/db/index.ts`, add the import next to the other migration imports:

```typescript
import { migration056ProvisionalMemory } from './migrations/056_provisional_memory.js'
```

Append it as the **last** element of the `MIGRATIONS` array (after `migration055UserConfigKeyIndex`):

```typescript
  migration055UserConfigKeyIndex,
  migration056ProvisionalMemory,
]
```

- [ ] **Step 5: Update the Drizzle schema**

In `src/db/long-term-memory-schema.ts`, add `provisional` to the status enum and the `threadContextId` column inside the `memoryRecords` definition (place `threadContextId` right after `status`):

```typescript
    status: text('status', { enum: ['active', 'stale', 'archived', 'contradicted', 'provisional'] }).notNull(),
    threadContextId: text('thread_context_id'),
```

Append a new table + its row type at the end of the file:

```typescript
export const memoryExtractionState = sqliteTable('memory_extraction_state', {
  contextId: text('context_id').primaryKey(),
  contextType: text('context_type', { enum: ['dm', 'group'] }).notNull(),
  configContextId: text('config_context_id').notNull(),
  lastActivityAt: text('last_activity_at').notNull(),
  lastExtractedAt: text('last_extracted_at'),
  lastHistoryLen: integer('last_history_len').notNull().default(0),
})

export type MemoryExtractionStateRow = typeof memoryExtractionState.$inferSelect
```

- [ ] **Step 6: Re-export from `src/db/schema.ts`**

Extend the existing long-term-memory re-export block:

```typescript
export {
  memoryProfiles,
  memoryRecords,
  memoryExtractionState,
  type MemoryProfileRow,
  type MemoryRecordRow,
  type MemoryExtractionStateRow,
} from './long-term-memory-schema.js'
```

- [ ] **Step 7: Update domain types**

In `src/long-term-memory/types.ts`:

```typescript
// widen the status enum
export const MemoryStatusSchema = z.enum(['active', 'stale', 'archived', 'contradicted', 'provisional'])

// add `threads` to MemoryEvidence
export type MemoryEvidence = Readonly<{
  messageIds?: readonly string[]
  actorIds?: readonly string[]
  timestamps?: readonly string[]
  contextId?: string
  threads?: readonly string[]
}>

// add threadContextId to MemoryRecord (after `evidence`)
//   threadContextId?: string | null
```

Add `threadContextId?: string | null` to the `MemoryRecord` type body. `MemoryRecordInput` inherits it via `Omit<MemoryRecord, 'embedding'>`.

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test tests/db/migration-056.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck + commit**

```bash
bun typecheck
git add src/db/migrations/056_provisional_memory.ts src/db/index.ts src/db/long-term-memory-schema.ts src/db/schema.ts src/long-term-memory/types.ts tests/db/migration-056.test.ts
git commit -m "feat(memory): provisional record tier + extraction-state schema (056)"
```

---

## Task 2: Store — persist `threadContextId` + `listProvisionalRecords`

**Files:**

- Modify: `src/long-term-memory/store.ts`
- Test: `tests/long-term-memory/provisional-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/long-term-memory/provisional-store.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { setupTestDb } from '../utils/test-helpers.js'
import { saveMemoryRecord, listProvisionalRecords } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'

const provisional = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'group-1',
  scopeType: 'group',
  kind: 'fact',
  content: 'Deploys happen on Fridays.',
  summary: null,
  tags: [],
  confidence: 0.5,
  status: 'provisional',
  source: 'background',
  evidence: { threads: ['thread-a'], contextId: 'thread-a' },
  threadContextId: 'thread-a',
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
  ...overrides,
})

describe('provisional record store', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('round-trips thread_context_id', () => {
    saveMemoryRecord(provisional({ id: 'mem-1' }))
    const rows = listProvisionalRecords({ scopeId: 'group-1', scopeType: 'group' })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.threadContextId).toBe('thread-a')
    expect(rows[0]?.status).toBe('provisional')
  })

  test('filters by thread and excludes other statuses', () => {
    saveMemoryRecord(provisional({ id: 'mem-1', threadContextId: 'thread-a' }))
    saveMemoryRecord(provisional({ id: 'mem-2', threadContextId: 'thread-b' }))
    saveMemoryRecord(provisional({ id: 'mem-3', status: 'active', threadContextId: null, evidence: {} }))
    expect(
      listProvisionalRecords({ scopeId: 'group-1', scopeType: 'group', threadContextId: 'thread-a' }),
    ).toHaveLength(1)
    expect(
      listProvisionalRecords({ scopeId: 'group-1', scopeType: 'group', excludeThreadContextId: 'thread-a' }),
    ).toHaveLength(1)
    expect(listProvisionalRecords({ scopeId: 'group-1', scopeType: 'group' })).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/provisional-store.test.ts`
Expected: FAIL — `listProvisionalRecords` not exported; `threadContextId` undefined on results.

- [ ] **Step 3: Persist + read `threadContextId`**

In `src/long-term-memory/store.ts`, add `threadContextId` to `rowToRecord` (after `evidence`):

```typescript
  threadContextId: row.threadContextId ?? null,
```

Add it to `inputToRecordValues` (after `evidence`):

```typescript
  threadContextId: input.threadContextId ?? null,
```

- [ ] **Step 4: Add `listProvisionalRecords`**

Append to `src/long-term-memory/store.ts`:

```typescript
export type ListProvisionalFilter = MemoryScope &
  Readonly<{ threadContextId?: string; excludeThreadContextId?: string; limit?: number }>

export function listProvisionalRecords(filter: ListProvisionalFilter): readonly MemoryRecord[] {
  const conditions: SQL[] = [
    eq(memoryRecords.scopeId, filter.scopeId),
    eq(memoryRecords.scopeType, filter.scopeType),
    eq(memoryRecords.status, 'provisional'),
  ]
  if (filter.threadContextId !== undefined) {
    conditions.push(eq(memoryRecords.threadContextId, filter.threadContextId))
  }
  if (filter.excludeThreadContextId !== undefined) {
    conditions.push(ne(memoryRecords.threadContextId, filter.excludeThreadContextId))
  }
  return getDrizzleDb()
    .select()
    .from(memoryRecords)
    .where(and(...conditions))
    .orderBy(desc(memoryRecords.lastSeenAt))
    .limit(filter.limit ?? DEFAULT_LIST_LIMIT)
    .all()
    .map(rowToRecord)
}
```

Add `ne` to the `drizzle-orm` import on line 6: `import { and, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm'`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/long-term-memory/provisional-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/long-term-memory/store.ts tests/long-term-memory/provisional-store.test.ts
git commit -m "feat(memory): persist thread_context_id + listProvisionalRecords"
```

---

## Task 3: Feature flag `cross_thread_memory`

**Files:**

- Modify: `src/tools/feature-flags.ts`
- Test: `tests/tools/feature-flags-cross-thread.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tools/feature-flags-cross-thread.test.ts
import { describe, expect, test } from 'bun:test'
import { parseReductionFlagsJson } from '../../src/tools/feature-flags.js'

describe('cross_thread_memory flag', () => {
  test('off by default', () => {
    expect(parseReductionFlagsJson(null).crossThreadMemory).toBe(false)
    expect(parseReductionFlagsJson('{}').crossThreadMemory).toBe(false)
  })
  test('only literal true enables it', () => {
    expect(parseReductionFlagsJson('{"cross_thread_memory":true}').crossThreadMemory).toBe(true)
    expect(parseReductionFlagsJson('{"cross_thread_memory":"true"}').crossThreadMemory).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/feature-flags-cross-thread.test.ts`
Expected: FAIL — `crossThreadMemory` does not exist on the result type.

- [ ] **Step 3: Add the flag**

In `src/tools/feature-flags.ts`: add `crossThreadMemory: boolean` to the `ReductionFlags` interface, `crossThreadMemory: false` to `ALL_OFF`, this line inside the `parseReductionFlagsJson` returned object:

```typescript
      crossThreadMemory: parsed['cross_thread_memory'] === true,
```

Append a convenience resolver at the end of the file:

```typescript
/** True when the cross-thread memory bridge is enabled for this storage context. */
export function resolveCrossThreadMemoryFlag(storageContextId: string): boolean {
  return resolveReductionFlags(storageContextId).crossThreadMemory
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/feature-flags-cross-thread.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/feature-flags.ts tests/tools/feature-flags-cross-thread.test.ts
git commit -m "feat(memory): cross_thread_memory feature flag"
```

---

## Task 4: Semantic search over record embeddings

**Files:**

- Create: `src/long-term-memory/semantic-search.ts`
- Test: `tests/long-term-memory/semantic-search.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/long-term-memory/semantic-search.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { setupTestDb } from '../utils/test-helpers.js'
import { saveMemoryRecord } from '../../src/long-term-memory/store.js'
import { rankRecordsBySimilarity } from '../../src/long-term-memory/semantic-search.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'

const rec = (id: string, embedding: Float32Array): MemoryRecordInput => ({
  id,
  scopeId: 'group-1',
  scopeType: 'group',
  kind: 'fact',
  content: id,
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'background',
  evidence: {},
  embedding,
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
})

describe('rankRecordsBySimilarity', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns nearest record first, drops below threshold', () => {
    saveMemoryRecord(rec('near', new Float32Array([1, 0, 0])))
    saveMemoryRecord(rec('far', new Float32Array([0, 1, 0])))
    const out = rankRecordsBySimilarity({ scopeId: 'group-1', scopeType: 'group' }, [1, 0, 0], {
      threshold: 0.65,
      limit: 10,
    })
    expect(out.map((r) => r.id)).toEqual(['near'])
  })

  test('empty when no embeddings stored', () => {
    saveMemoryRecord({ ...rec('x', new Float32Array([1, 0, 0])), embedding: null })
    expect(rankRecordsBySimilarity({ scopeId: 'group-1', scopeType: 'group' }, [1, 0, 0], {})).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/semantic-search.test.ts`
Expected: FAIL — module `semantic-search.js` not found.

- [ ] **Step 3: Implement the module**

```typescript
// src/long-term-memory/semantic-search.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, inArray, type SQL } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords, type MemoryRecordRow } from '../db/schema.js'
import type { MemoryRecord, MemoryScope, MemoryStatus } from './types.js'
import { listMemoryRecords } from './store.js'

export type SimilarityOptions = Readonly<{
  threshold?: number
  limit?: number
  statuses?: readonly MemoryStatus[]
}>

const DEFAULT_THRESHOLD = 0.65
const DEFAULT_LIMIT = 10

const toFloat32 = (embedding: MemoryRecordRow['embedding']): Float32Array | null => {
  if (embedding === null) return null
  if (embedding instanceof ArrayBuffer) return new Float32Array(embedding.slice(0))
  if (ArrayBuffer.isView(embedding)) {
    const copy = new Uint8Array(embedding.byteLength)
    copy.set(new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength))
    return new Float32Array(copy.buffer)
  }
  return null
}

export const cosineSimilarity = (a: readonly number[], b: Float32Array): number => {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** Rank stored records in a scope against a query embedding by cosine similarity. */
export function rankRecordsBySimilarity(
  scope: MemoryScope,
  queryEmbedding: readonly number[],
  options: SimilarityOptions,
): readonly MemoryRecord[] {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const limit = options.limit ?? DEFAULT_LIMIT
  const statuses = options.statuses ?? ['active']

  const conditions: SQL[] = [eq(memoryRecords.scopeId, scope.scopeId), eq(memoryRecords.scopeType, scope.scopeType)]
  conditions.push(inArray(memoryRecords.status, [...statuses]))

  const rows = getDrizzleDb()
    .select()
    .from(memoryRecords)
    .where(and(...conditions))
    .all()
  const scored = rows
    .map((row) => ({ row, vec: toFloat32(row.embedding) }))
    .filter((entry): entry is { row: MemoryRecordRow; vec: Float32Array } => entry.vec !== null)
    .map((entry) => ({ id: entry.row.id, score: cosineSimilarity(queryEmbedding, entry.vec) }))
    .filter((entry) => entry.score >= threshold)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)

  if (scored.length === 0) return []
  const byId = new Map(
    listMemoryRecords({ scopeId: scope.scopeId, scopeType: scope.scopeType, limit: 1000 }).map((r) => [r.id, r]),
  )
  return scored.map((entry) => byId.get(entry.id)).filter((r): r is MemoryRecord => r !== undefined)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/long-term-memory/semantic-search.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/semantic-search.ts tests/long-term-memory/semantic-search.test.ts
git commit -m "feat(memory): cosine semantic ranking over record embeddings"
```

---

## Task 5: Embedding-writing save wrapper

**Files:**

- Create: `src/long-term-memory/embedding-writer.ts`
- Test: `tests/long-term-memory/embedding-writer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/long-term-memory/embedding-writer.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { setupTestDb } from '../utils/test-helpers.js'
import { listMemoryRecords } from '../../src/long-term-memory/store.js'
import { saveMemoryRecordWithEmbedding } from '../../src/long-term-memory/embedding-writer.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'

const input = (): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'group-1',
  scopeType: 'group',
  kind: 'fact',
  content: 'X',
  summary: null,
  tags: [],
  confidence: 1,
  status: 'provisional',
  source: 'background',
  evidence: {},
  threadContextId: 't',
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
})

describe('saveMemoryRecordWithEmbedding', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('saves the row synchronously and applies the embedding when it resolves', async () => {
    const saved = await saveMemoryRecordWithEmbedding(input(), 'cfg-1', {
      getEmbedding: () => Promise.resolve([0.1, 0.2, 0.3]),
    })
    expect(saved.id).toBe('mem-1')
    const [row] = listMemoryRecords({ scopeId: 'group-1', scopeType: 'group', limit: 10 })
    expect(Array.from(row?.embedding ?? [])).toEqual(expect.arrayContaining([expect.any(Number)]))
    expect(row?.embedding).not.toBeNull()
  })

  test('still saves the row when embedding is unavailable', async () => {
    const saved = await saveMemoryRecordWithEmbedding(input(), 'cfg-1', { getEmbedding: () => Promise.resolve(null) })
    expect(saved.id).toBe('mem-1')
    const [row] = listMemoryRecords({ scopeId: 'group-1', scopeType: 'group', limit: 10 })
    expect(row?.embedding ?? null).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/embedding-writer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the wrapper**

```typescript
// src/long-term-memory/embedding-writer.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import { getEmbeddingForContext } from '../embeddings.js'
import { logger } from '../logger.js'
import { saveMemoryRecord } from './store.js'
import type { MemoryRecord, MemoryRecordInput } from './types.js'

const log = logger.child({ scope: 'memory:embedding-writer' })

export type EmbeddingWriterDeps = Readonly<{
  getEmbedding: (text: string, configContextId: string) => Promise<number[] | null>
}>

const defaultDeps: EmbeddingWriterDeps = {
  getEmbedding: (text, configContextId) =>
    getEmbeddingForContext(text, configContextId, {
      storageContextId: configContextId,
      contextType: 'group',
      chatUserId: configContextId,
    }),
}

const persistEmbedding = (recordId: string, embedding: number[]): void => {
  const buffer = Buffer.from(new Float32Array(embedding).buffer)
  getDrizzleDb().update(memoryRecords).set({ embedding: buffer }).where(eq(memoryRecords.id, recordId)).run()
}

/**
 * Save a record, then asynchronously compute + persist its embedding.
 * Awaits embedding completion (so promotion clustering can rely on it) but never throws on embed failure.
 */
export async function saveMemoryRecordWithEmbedding(
  input: MemoryRecordInput,
  configContextId: string,
  deps: EmbeddingWriterDeps = defaultDeps,
): Promise<MemoryRecord> {
  const saved = saveMemoryRecord(input)
  try {
    const embedding = await deps.getEmbedding(input.content, configContextId)
    if (embedding !== null) persistEmbedding(saved.id, embedding)
  } catch (error) {
    log.warn(
      { recordId: saved.id, error: error instanceof Error ? error.message : String(error) },
      'Embedding failed; FTS fallback',
    )
  }
  return saved
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/long-term-memory/embedding-writer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/embedding-writer.ts tests/long-term-memory/embedding-writer.test.ts
git commit -m "feat(memory): save records with populated embeddings"
```

---

## Task 6: Extraction-state watermark store

**Files:**

- Create: `src/long-term-memory/extraction-state.ts`
- Test: `tests/long-term-memory/extraction-state.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/long-term-memory/extraction-state.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { setupTestDb } from '../utils/test-helpers.js'
import { markActivity, markExtracted, listDirtyContexts } from '../../src/long-term-memory/extraction-state.js'

describe('extraction-state watermarks', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('a context with newer activity than extraction is dirty once idle', () => {
    markActivity(
      { contextId: 'c1', contextType: 'group', configContextId: 'cfg1', historyLen: 4 },
      '2026-06-16T10:00:00.000Z',
    )
    // never extracted -> dirty when the idle cutoff is after its activity
    expect(listDirtyContexts('2026-06-16T10:10:00.000Z').map((c) => c.contextId)).toEqual(['c1'])
    markExtracted('c1', 4, '2026-06-16T10:11:00.000Z')
    expect(listDirtyContexts('2026-06-16T10:20:00.000Z')).toHaveLength(0)
  })

  test('not dirty while still active (within idle window)', () => {
    markActivity(
      { contextId: 'c1', contextType: 'group', configContextId: 'cfg1', historyLen: 4 },
      '2026-06-16T10:09:50.000Z',
    )
    expect(listDirtyContexts('2026-06-16T10:10:00.000Z', 60_000)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/extraction-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/long-term-memory/extraction-state.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryExtractionState, type MemoryExtractionStateRow } from '../db/schema.js'
import type { ContextType } from '../chat/types.js'

export const DEFAULT_IDLE_MS = 600_000 // ~10 min — matches MEMORY_CAPTURE_DEBOUNCE_MS

export type ActivityInput = Readonly<{
  contextId: string
  contextType: ContextType
  configContextId: string
  historyLen: number
}>

export function markActivity(input: ActivityInput, now: string): void {
  getDrizzleDb()
    .insert(memoryExtractionState)
    .values({
      contextId: input.contextId,
      contextType: input.contextType,
      configContextId: input.configContextId,
      lastActivityAt: now,
      lastHistoryLen: input.historyLen,
    })
    .onConflictDoUpdate({
      target: memoryExtractionState.contextId,
      set: {
        contextType: input.contextType,
        configContextId: input.configContextId,
        lastActivityAt: now,
        lastHistoryLen: input.historyLen,
      },
    })
    .run()
}

export function markExtracted(contextId: string, historyLen: number, now: string): void {
  getDrizzleDb()
    .update(memoryExtractionState)
    .set({ lastExtractedAt: now, lastHistoryLen: historyLen })
    .where(eq(memoryExtractionState.contextId, contextId))
    .run()
}

/** Contexts with unextracted activity that have been idle for at least `idleMs`. */
export function listDirtyContexts(now: string, idleMs: number = DEFAULT_IDLE_MS): readonly MemoryExtractionStateRow[] {
  const cutoff = new Date(new Date(now).getTime() - idleMs).toISOString()
  return getDrizzleDb()
    .select()
    .from(memoryExtractionState)
    .where(
      and(
        lte(memoryExtractionState.lastActivityAt, cutoff),
        or(
          isNull(memoryExtractionState.lastExtractedAt),
          sql`${memoryExtractionState.lastActivityAt} > ${memoryExtractionState.lastExtractedAt}`,
        ),
      ),
    )
    .all()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/long-term-memory/extraction-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/extraction-state.ts tests/long-term-memory/extraction-state.test.ts
git commit -m "feat(memory): extraction-state watermark store"
```

---

## Task 7: Capture executor

**Files:**

- Create: `src/long-term-memory/capture.ts`
- Test: `tests/long-term-memory/capture.test.ts`

The executor runs the existing `extractMemoryPatch`, writes each extracted fact as a **provisional** group-scoped record tagged with the current thread, and updates the watermark. It is a no-op for DM contexts, when the flag is off, or when the group profile has capture disabled.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/long-term-memory/capture.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { setupTestDb } from '../utils/test-helpers.js'
import { listProvisionalRecords } from '../../src/long-term-memory/store.js'
import { runMemoryCapture } from '../../src/long-term-memory/capture.js'
import type { MemoryPatch } from '../../src/long-term-memory/extractor.js'

const patch: MemoryPatch = {
  profile: null,
  records: [
    {
      kind: 'fact',
      content: 'Deploys happen on Fridays.',
      summary: null,
      tags: [],
      confidence: 0.5,
      source: 'background',
      evidence: {},
    },
  ],
  updates: [],
}

describe('runMemoryCapture', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('writes provisional records tagged with the current thread', async () => {
    await runMemoryCapture(
      {
        storageContextId: 'group-1:thread:abc',
        configContextId: 'group-1',
        contextType: 'group',
        history: [{ role: 'user', content: 'hi' }],
      },
      {
        flagEnabled: () => true,
        extractMemoryPatch: () => Promise.resolve(patch),
        getEmbedding: () => Promise.resolve(null),
        now: () => '2026-06-16T00:00:00.000Z',
        randomUUID: () => 'mem-new',
      },
    )
    const rows = listProvisionalRecords({ scopeId: 'group-1', scopeType: 'group' })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.threadContextId).toBe('group-1:thread:abc')
    expect(rows[0]?.evidence.threads).toEqual(['group-1:thread:abc'])
    expect(rows[0]?.scopeType).toBe('group')
  })

  test('no-op when the flag is off', async () => {
    await runMemoryCapture(
      {
        storageContextId: 'group-1:thread:abc',
        configContextId: 'group-1',
        contextType: 'group',
        history: [{ role: 'user', content: 'hi' }],
      },
      {
        flagEnabled: () => false,
        extractMemoryPatch: () => Promise.resolve(patch),
        getEmbedding: () => Promise.resolve(null),
        now: () => 'x',
        randomUUID: () => 'y',
      },
    )
    expect(listProvisionalRecords({ scopeId: 'group-1', scopeType: 'group' })).toHaveLength(0)
  })

  test('no-op for DM contexts', async () => {
    await runMemoryCapture(
      {
        storageContextId: 'user-1',
        configContextId: 'user-1',
        contextType: 'dm',
        history: [{ role: 'user', content: 'hi' }],
      },
      {
        flagEnabled: () => true,
        extractMemoryPatch: () => Promise.resolve(patch),
        getEmbedding: () => Promise.resolve(null),
        now: () => 'x',
        randomUUID: () => 'y',
      },
    )
    expect(listProvisionalRecords({ scopeId: 'user-1', scopeType: 'group' })).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/capture.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the executor**

```typescript
// src/long-term-memory/capture.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import type { ModelMessage } from 'ai'

import { hasThreadContextId } from '../chat/scoped-context.js'
import type { ContextType } from '../chat/types.js'
import { getEmbeddingForContext } from '../embeddings.js'
import { resolveEffectiveLlmConfig } from '../llm-config-resolver.js'
import { buildChatModel } from '../llm-model-builder.js'
import { logger } from '../logger.js'
import { resolveCrossThreadMemoryFlag } from '../tools/feature-flags.js'
import { saveMemoryRecordWithEmbedding } from './embedding-writer.js'
import { markExtracted } from './extraction-state.js'
import { extractMemoryPatch, type MemoryPatch } from './extractor.js'
import { resolveMemoryScope } from './scope.js'
import { getMemoryProfile } from './store.js'
import type { MemoryRecordInput } from './types.js'

const log = logger.child({ scope: 'memory:capture' })

const EMPTY_PATCH: MemoryPatch = { profile: null, records: [], updates: [] }

export type RunMemoryCaptureInput = Readonly<{
  storageContextId: string
  configContextId: string
  contextType: ContextType
  history: readonly ModelMessage[]
}>

export type CaptureExtractInput = Readonly<{
  history: readonly ModelMessage[]
  profile: string
  configContextId: string
}>

export type RunMemoryCaptureDeps = Readonly<{
  flagEnabled: (storageContextId: string) => boolean
  extractMemoryPatch: (input: CaptureExtractInput) => Promise<MemoryPatch>
  getEmbedding: (text: string, configContextId: string) => Promise<number[] | null>
  now: () => string
  randomUUID: () => string
}>

// Production extractor: resolves BYOK-aware config, builds the small model exactly like runner.ts,
// then calls the shared extractMemoryPatch. Returns an empty patch (no-op) when config is unavailable.
const defaultExtract = (input: CaptureExtractInput): Promise<MemoryPatch> => {
  const resolved = resolveEffectiveLlmConfig(input.configContextId)
  if (!resolved.ok) {
    log.warn(
      { configContextId: input.configContextId, source: resolved.source, type: resolved.type },
      'LLM config unavailable for capture',
    )
    return Promise.resolve(EMPTY_PATCH)
  }
  const model = buildChatModel(resolved.llmApiKey, resolved.llmBaseUrl, resolved.smallModel)
  return extractMemoryPatch({ history: input.history, profile: input.profile, records: [], model })
}

const defaultDeps: RunMemoryCaptureDeps = {
  flagEnabled: resolveCrossThreadMemoryFlag,
  extractMemoryPatch: defaultExtract,
  getEmbedding: (text, configContextId) =>
    getEmbeddingForContext(text, configContextId, {
      storageContextId: configContextId,
      contextType: 'group',
      chatUserId: configContextId,
    }),
  now: () => new Date().toISOString(),
  randomUUID: () => randomUUID(),
}

export async function runMemoryCapture(
  input: RunMemoryCaptureInput,
  deps: RunMemoryCaptureDeps = defaultDeps,
): Promise<void> {
  if (!deps.flagEnabled(input.storageContextId)) return
  if (input.contextType !== 'group' || !hasThreadContextId(input.storageContextId)) return

  const scope = resolveMemoryScope({ storageContextId: input.storageContextId, contextType: input.contextType })
  const profile = getMemoryProfile(scope)
  if (profile?.enabled === false) return

  let patch: MemoryPatch
  try {
    patch = await deps.extractMemoryPatch({
      history: input.history,
      profile: profile?.profile ?? '',
      configContextId: input.configContextId,
    })
  } catch (error) {
    log.warn(
      { contextId: input.storageContextId, error: error instanceof Error ? error.message : String(error) },
      'Capture extraction failed',
    )
    return
  }

  const now = deps.now()
  for (const candidate of patch.records) {
    const record: MemoryRecordInput = {
      id: deps.randomUUID(),
      scopeId: scope.scopeId,
      scopeType: scope.scopeType,
      kind: candidate.kind,
      content: candidate.content,
      summary: candidate.summary ?? null,
      tags: candidate.tags,
      confidence: candidate.confidence,
      status: 'provisional',
      source: 'background',
      evidence: { ...candidate.evidence, threads: [input.storageContextId], contextId: input.storageContextId },
      threadContextId: input.storageContextId,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    }
    await saveMemoryRecordWithEmbedding(record, input.configContextId, { getEmbedding: deps.getEmbedding })
  }

  markExtracted(input.storageContextId, input.history.length, now)
  log.debug({ contextId: input.storageContextId, captured: patch.records.length }, 'Memory capture complete')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/long-term-memory/capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/capture.ts tests/long-term-memory/capture.test.ts
git commit -m "feat(memory): provisional capture executor"
```

---

## Task 8: Idle-debounce manager + turn-path wiring

**Files:**

- Create: `src/long-term-memory/capture-debounce.ts`
- Modify: `src/llm-history.ts`
- Test: `tests/long-term-memory/capture-debounce.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/long-term-memory/capture-debounce.test.ts
import { describe, expect, test } from 'bun:test'
import { armMemoryCapture } from '../../src/long-term-memory/capture-debounce.js'

describe('armMemoryCapture', () => {
  test('coalesces rapid arms into a single deferred capture', async () => {
    let captures = 0
    const timers = new Map<string, () => void>()
    const deps = {
      flagEnabled: () => true,
      markActivity: () => undefined,
      runCapture: () => {
        captures += 1
        return Promise.resolve()
      },
      schedule: (fn: () => void) => {
        timers.set('t', fn)
        return 't' as unknown as ReturnType<typeof setTimeout>
      },
      clear: () => timers.delete('t'),
      debounceMs: 600_000,
      now: () => '2026-06-16T00:00:00.000Z',
    }
    const input = { storageContextId: 'g:thread:a', configContextId: 'g', contextType: 'group' as const, history: [] }
    armMemoryCapture(input, deps)
    armMemoryCapture(input, deps)
    expect(captures).toBe(0) // nothing fired yet
    timers.get('t')?.() // simulate the debounce elapsing
    await Promise.resolve()
    expect(captures).toBe(1) // exactly one capture despite two arms
  })

  test('no-op when flag disabled', () => {
    let activity = 0
    armMemoryCapture(
      { storageContextId: 'g:thread:a', configContextId: 'g', contextType: 'group', history: [] },
      {
        flagEnabled: () => false,
        markActivity: () => {
          activity += 1
        },
        runCapture: () => Promise.resolve(),
        schedule: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clear: () => undefined,
        debounceMs: 1,
        now: () => 'x',
      },
    )
    expect(activity).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/capture-debounce.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the debounce manager**

```typescript
// src/long-term-memory/capture-debounce.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import type { ContextType } from '../chat/types.js'
import { logger } from '../logger.js'
import { resolveCrossThreadMemoryFlag } from '../tools/feature-flags.js'
import { runMemoryCapture, type RunMemoryCaptureInput } from './capture.js'
import { markActivity } from './extraction-state.js'

const log = logger.child({ scope: 'memory:capture-debounce' })

export const MEMORY_CAPTURE_DEBOUNCE_MS = 600_000 // ~10 min

export type ArmCaptureDeps = Readonly<{
  flagEnabled: (storageContextId: string) => boolean
  markActivity: (input: RunMemoryCaptureInput, historyLen: number, now: string) => void
  runCapture: (input: RunMemoryCaptureInput) => Promise<void>
  schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clear: (timer: ReturnType<typeof setTimeout>) => void
  debounceMs: number
  now: () => string
}>

const pending = new Map<string, ReturnType<typeof setTimeout>>()

const defaultDeps: ArmCaptureDeps = {
  flagEnabled: resolveCrossThreadMemoryFlag,
  markActivity: (input, historyLen, now) =>
    markActivity(
      {
        contextId: input.storageContextId,
        contextType: input.contextType,
        configContextId: input.configContextId,
        historyLen,
      },
      now,
    ),
  runCapture: (input) => runMemoryCapture(input),
  schedule: (fn, ms) => setTimeout(fn, ms),
  clear: (timer) => clearTimeout(timer),
  debounceMs: MEMORY_CAPTURE_DEBOUNCE_MS,
  now: () => new Date().toISOString(),
}

/** Record activity and (re)arm a debounced capture for this context. Safe to call every turn. */
export function armMemoryCapture(input: RunMemoryCaptureInput, deps: ArmCaptureDeps = defaultDeps): void {
  if (!deps.flagEnabled(input.storageContextId)) return
  if (input.contextType !== 'group') return

  deps.markActivity(input, input.history.length, deps.now())

  const existing = pending.get(input.storageContextId)
  if (existing !== undefined) deps.clear(existing)

  const timer = deps.schedule(() => {
    pending.delete(input.storageContextId)
    void deps.runCapture(input).catch((error) => {
      log.warn(
        { contextId: input.storageContextId, error: error instanceof Error ? error.message : String(error) },
        'Debounced capture failed',
      )
    })
  }, deps.debounceMs)
  pending.set(input.storageContextId, timer)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/long-term-memory/capture-debounce.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the turn path**

In `src/llm-history.ts`, add the import:

```typescript
import { armMemoryCapture } from './long-term-memory/capture-debounce.js'
```

Immediately **after** the existing `if (shouldTriggerTrim(...)) { ... }` block (the one that calls `runMemoryExtractionInBackground`), add an unconditional arm (it self-gates on the flag + group context):

```typescript
armMemoryCapture({ storageContextId: contextId, configContextId: configId, contextType, history: combined })
```

- [ ] **Step 6: Run the memory suite + typecheck**

Run: `bun test tests/long-term-memory/ && bun typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/long-term-memory/capture-debounce.ts src/llm-history.ts tests/long-term-memory/capture-debounce.test.ts
git commit -m "feat(memory): idle-debounce capture armed from the turn path"
```

---

## Task 9: Scheduler backstop sweep

**Files:**

- Create: `src/long-term-memory/capture-sweep.ts`
- Modify: `src/scheduler-instance.ts`
- Test: `tests/long-term-memory/capture-sweep.test.ts`

The sweep recovers debounced captures lost to a restart: it finds idle, unextracted contexts, loads their history, and runs capture.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/long-term-memory/capture-sweep.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { setupTestDb } from '../utils/test-helpers.js'
import { markActivity } from '../../src/long-term-memory/extraction-state.js'
import { sweepDirtyContexts } from '../../src/long-term-memory/capture-sweep.js'

describe('sweepDirtyContexts', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('runs capture for idle unextracted group contexts', async () => {
    markActivity(
      { contextId: 'g:thread:a', contextType: 'group', configContextId: 'g', historyLen: 3 },
      '2026-06-16T10:00:00.000Z',
    )
    const captured: string[] = []
    await sweepDirtyContexts('2026-06-16T10:20:00.000Z', {
      idleMs: 600_000,
      loadHistory: () => [{ role: 'user', content: 'hi' }],
      runCapture: (input) => {
        captured.push(input.storageContextId)
        return Promise.resolve()
      },
    })
    expect(captured).toEqual(['g:thread:a'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/capture-sweep.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the sweep**

```typescript
// src/long-term-memory/capture-sweep.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import { getCachedHistory } from '../cache.js'
import type { ContextType } from '../chat/types.js'
import { logger } from '../logger.js'
import { runMemoryCapture, type RunMemoryCaptureInput } from './capture.js'
import { DEFAULT_IDLE_MS, listDirtyContexts } from './extraction-state.js'

const log = logger.child({ scope: 'memory:capture-sweep' })

export type SweepDeps = Readonly<{
  idleMs: number
  loadHistory: (storageContextId: string) => readonly ModelMessage[]
  runCapture: (input: RunMemoryCaptureInput) => Promise<void>
}>

const defaultDeps: SweepDeps = {
  idleMs: DEFAULT_IDLE_MS,
  loadHistory: (storageContextId) => getCachedHistory(storageContextId),
  runCapture: (input) => runMemoryCapture(input),
}

export async function sweepDirtyContexts(now: string, deps: SweepDeps = defaultDeps): Promise<void> {
  const dirty = listDirtyContexts(now, deps.idleMs)
  for (const row of dirty) {
    const history = deps.loadHistory(row.contextId)
    if (history.length === 0) continue
    try {
      await deps.runCapture({
        storageContextId: row.contextId,
        configContextId: row.configContextId,
        contextType: row.contextType as ContextType,
        history,
      })
    } catch (error) {
      log.warn(
        { contextId: row.contextId, error: error instanceof Error ? error.message : String(error) },
        'Sweep capture failed',
      )
    }
  }
}
```

`getCachedHistory(userId: string): readonly ModelMessage[]` (`src/cache.ts:46`) returns messages directly — the same accessor `lookup_group_history` uses — so no mapping is needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/long-term-memory/capture-sweep.test.ts`
Expected: PASS.

- [ ] **Step 5: Register the sweep**

In `src/scheduler-instance.ts`, add the import:

```typescript
import { sweepDirtyContexts } from './long-term-memory/capture-sweep.js'
```

Register it next to `long-term-memory-maintenance` (the sweep self-gates per context via the flag inside `runMemoryCapture`):

```typescript
scheduler.register('memory-capture-sweep', {
  interval: 5 * 60 * 1000, // every 5 minutes
  handler: () => {
    void sweepDirtyContexts(new Date().toISOString())
  },
  options: { immediate: false },
})
```

- [ ] **Step 6: Run the full memory suite + typecheck**

Run: `bun test tests/long-term-memory/ && bun typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/long-term-memory/capture-sweep.ts src/scheduler-instance.ts tests/long-term-memory/capture-sweep.test.ts
git commit -m "feat(memory): scheduler backstop sweep for dirty contexts"
```

---

## Final verification

- [ ] **Run the whole server suite**

Run: `bun run test`
Expected: all suites pass (no regressions from the schema/flag/turn-path changes).

- [ ] **Confirm flag-OFF parity**

With `cross_thread_memory` unset, `armMemoryCapture`/`runMemoryCapture` early-return, no `memory_extraction_state` rows are written from real turns, and `search`/injection behavior is unchanged. Verify by grepping that every new entry point guards on `flagEnabled`/`resolveCrossThreadMemoryFlag` before any write.

- [ ] **Run the staged-file checks**

Run: `bun check`
Expected: lint + typecheck + format pass on staged files.

---

## Handoff to Plan 2

Plan 1 leaves provisional records accumulating (flag-gated) with populated embeddings, a watermark table, and a semantic-ranking + hybrid-ready library. **Plan 2 (Cascade & Promotion)** builds: the `recall` tool with the server-side 3-layer cascade (using `searchMemoryRecords` for FTS + `rankRecordsBySimilarity` for semantic), the cross-thread clustering + hybrid promotion engine (frequency gate `MEMORY_PROMOTION_MIN_THREADS = 3` + SMALL_MODEL confirm → flip provisional rows to `active`), the system-prompt preamble, and the "stop rediscovering" acceptance test.
</content>
