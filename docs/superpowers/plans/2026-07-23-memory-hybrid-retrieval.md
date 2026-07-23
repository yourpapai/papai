<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Hybrid Memory Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace papai's ASCII-only, either/or long-term-memory retrieval with a Unicode FTS5 lexical channel fused against a version-checked dense channel by weighted reciprocal rank fusion, with validity and expiry enforced at query time.

**Architecture:** Two independent retrieval channels feed one fusion step. The lexical channel runs SQLite FTS5 with the existing `unicode61` tokenizer, ranked by `bm25()`, driven by a Unicode tokenizer that emits quoted prefix terms joined by `OR`. The dense channel is the existing in-process cosine scan, newly restricted to records whose stored embedding identity matches the identity of the config context running the query. Weighted RRF (`k=60`, lexical `2`, dense `1`) merges the two ranked lists, so a record missing an embedding stays reachable. A shared SQL validity predicate is applied to every read path, and four new columns plus a post-boot backfill job give every embedding a recorded model, dimension, and version.

**Tech Stack:** Bun, TypeScript (strict), Drizzle ORM over `bun:sqlite`, SQLite FTS5, Zod v4, `p-limit`, `bun:test`.

**Source spec:** [`docs/superpowers/specs/2026-07-23-memory-hybrid-retrieval-design.md`](../specs/2026-07-23-memory-hybrid-retrieval-design.md)

## Global Constraints

- Runtime is **Bun**. Every import path uses the **`.js` extension**, including for `.ts` sources.
- Strict TypeScript. **Never add a lint-disable or type-ignore comment** — a hook blocks them; fix the underlying issue.
- Every new file starts with the four-line BUSL header used by every file in `src/` (copy it verbatim from any existing `src/long-term-memory/*.ts`).
- Error extraction is always `error instanceof Error ? error.message : String(error)`.
- Logging is mandatory and metadata-first via pino (`logger.child({ scope: '...' })`). **Never log an API key, token, or credential** — this plan touches `resolveLlmConfig`, which returns `apiKey`; log only `model`.
- Bounded concurrency over remote calls uses `p-limit`, never unbounded `Promise.all`.
- A `max-lines` or `max-lines-per-function` lint failure is a design signal: split the file or extract a function. Do not delete blank lines to get under the limit.
- Rank-fusion constants are fixed by the frozen benchmark and must not be retuned: offset `k = 60`, lexical weight `2`, dense weight `1`, dense-eligibility cosine threshold `0.65`.
- Validity is **half-open**: `validFrom <= now` and `validUntil > now`.
- TDD: write the test, run it, observe the failure, then implement. Commit after each task.

## Deviations from the spec (deliberate, agreed)

Three points where this plan is more specific than, or differs from, the spec. Implement the plan; the spec's intent is preserved in each case.

1. **`now` is a `string` parameter, not a `() => string` thunk.** The spec cited the `capture.ts` dependency pattern. That pattern exists for long-lived objects that read the clock repeatedly. The store functions here are synchronous single-shot queries, so an optional `now?: string` on the filter gives identical boundary testability with less machinery. `embedding-writer.ts` and `embedding-backfill.ts` keep the `now: () => string` thunk because they are long-running and stamp many rows.
2. **Channels return ranked `MemoryRecord[]`, not scored rows.** The spec said the dense channel should "return scores rather than bare records". RRF consumes *ranks* only — it never reads a channel's raw score. Returning ordered records keeps both channels on one interface and removes a type that nothing would read.
3. **A new `hybrid-search.ts` module.** The spec said `recall-cascade.ts` should "call unified hybrid search" without naming a home for it. Putting the channel orchestration in the cascade would push that file toward the `max-lines` limit and mix two responsibilities. It gets its own file.

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/db/migrations/068_memory_embedding_identity.ts` | Add four embedding-identity columns; stamp existing embedded rows `'unknown'`; create the backfill partial index |
| `src/long-term-memory/embedding-identity.ts` | The `${model}:${dimension}` version string, the `'unknown'` sentinel, and per-config-context model resolution |
| `src/long-term-memory/lexical-query.ts` | Unicode tokenizer and FTS5 `MATCH` expression builder (pure, no DB) |
| `src/long-term-memory/lexical-search.ts` | FTS5 + `bm25()` ranked lookup against `memory_records` |
| `src/long-term-memory/fusion.ts` | Weighted reciprocal rank fusion (pure, no DB) |
| `src/long-term-memory/hybrid-search.ts` | Runs both channels and fuses them; the single entry point for all three recall-cascade layers |
| `src/long-term-memory/embedding-backfill.ts` | Post-boot sweep that embeds and stamps rows missing a compatible vector |

**Modified**

| File | Change |
| --- | --- |
| `src/db/long-term-memory-schema.ts` | Four new columns on `memoryRecords` |
| `src/db/index.ts` | Register migration 068 |
| `src/long-term-memory/types.ts` | Embedding-identity fields on `MemoryRecord` |
| `src/long-term-memory/serialization.ts` | Map the four new columns in `rowToRecord` |
| `src/long-term-memory/record-conditions.ts` | Shared validity predicate and thread-scope predicate |
| `src/long-term-memory/store.ts` | Map the identity columns on insert; apply validity to `listMemoryRecords` and `searchMemoryRecords` |
| `src/long-term-memory/provisional-store.ts` | Apply validity to `listProvisionalRecords` |
| `src/long-term-memory/semantic-search.ts` | Version-compatibility predicate, validity, kind and thread filters, SQL-side status filter |
| `src/long-term-memory/recall-cascade.ts` | All three layers call `searchHybrid` |
| `src/long-term-memory/embedding-writer.ts` | Stamp model, dimension, version, and timestamp on write |
| `src/long-term-memory/extraction-state.ts` | Expose the context→config-context bindings the backfill needs |
| `src/scheduler-instance.ts` | Register the backfill job |

**Deleted**

| File | Reason |
| --- | --- |
| `src/long-term-memory/recall-ranking.ts` | The dead `[a-z0-9]+` token-overlap scorer this whole plan exists to remove |
| `tests/long-term-memory/recall-ranking.test.ts` | Tests the deleted module |

## Background an implementer needs

- **`setupTestDb()`** (from `tests/utils/test-helpers.ts`) creates a fresh in-memory database and runs every migration. Call it in `beforeEach`. It is `async`.
- **The FTS index already exists and already handles Cyrillic.** Migration 053 created `memory_records_fts` with the default `unicode61` tokenizer plus AFTER INSERT/UPDATE/DELETE triggers that keep it in sync. Nothing in this plan touches the FTS table or its triggers.
- **FTS5 does not stem.** Bare `маршрут` does not match `Маршруты`; `"маршрут"*` matches both `Маршруты` and `маршруту`. That is why the query builder emits prefix terms.
- **`bm25()` returns a negative number**, and *more negative is more relevant*. Order ascending.
- **Provisional records live in `memory_records`** with `status = 'provisional'`, so they are FTS-indexed like any other row. That is what lets one search serve all three cascade layers.
- **Timestamps are ISO-8601 UTC strings** written by `new Date().toISOString()`, fixed width, so `<` and `>` comparisons in SQL are correct. `maintenance.ts` already relies on this.
- **Embedding credentials are per-config-context.** `resolveLlmConfig(configContextId)` consults the BYOK bundle first and falls back to admin bindings, so two scopes can legitimately sit on different embedding models. There is no global "current model".

---

### Task 1: Migration 068 — embedding identity columns

**Files:**
- Create: `src/db/migrations/068_memory_embedding_identity.ts`
- Modify: `src/db/index.ts` (import near line 80, array entry near line 182)
- Modify: `src/db/long-term-memory-schema.ts:25-63`
- Modify: `src/long-term-memory/types.ts:51-72`
- Modify: `src/long-term-memory/serialization.ts:57-77`
- Modify: `src/long-term-memory/store.ts:42-63` (`inputToRecordValues`)
- Test: `tests/db/migrations/068-memory-embedding-identity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: columns `embedding_model`, `embedding_dimension`, `embedding_version`, `embedded_at` on `memory_records`; Drizzle fields `memoryRecords.embeddingModel: text`, `.embeddingDimension: integer`, `.embeddingVersion: text`, `.embeddedAt: text`; `MemoryRecord` fields `embeddingModel?: string | null`, `embeddingDimension?: number | null`, `embeddingVersion?: string | null`, `embeddedAt?: string | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/db/migrations/068-memory-embedding-identity.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { memoryRecords } from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

const baseRow = {
  scopeId: 'user-1',
  scopeType: 'personal' as const,
  kind: 'fact' as const,
  content: 'anything',
  tags: '[]',
  confidence: 1,
  status: 'active' as const,
  source: 'explicit' as const,
  evidence: '{}',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
}

describe('migration 068 embedding identity', () => {
  test('round-trips the four identity columns', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(memoryRecords)
      .values({
        ...baseRow,
        id: 'rec-1',
        embedding: Buffer.from(new Float32Array([0.1, 0.2]).buffer),
        embeddingModel: 'text-embedding-3-small',
        embeddingDimension: 2,
        embeddingVersion: 'text-embedding-3-small:2',
        embeddedAt: '2026-07-01T00:00:00.000Z',
      })
      .run()

    const row = getDrizzleDb().select().from(memoryRecords).where(eq(memoryRecords.id, 'rec-1')).get()
    expect(row?.embeddingModel).toBe('text-embedding-3-small')
    expect(row?.embeddingDimension).toBe(2)
    expect(row?.embeddingVersion).toBe('text-embedding-3-small:2')
    expect(row?.embeddedAt).toBe('2026-07-01T00:00:00.000Z')
  })

  test('leaves identity columns null for a record with no embedding', async () => {
    await setupTestDb()

    getDrizzleDb().insert(memoryRecords).values({ ...baseRow, id: 'rec-2' }).run()

    const row = getDrizzleDb().select().from(memoryRecords).where(eq(memoryRecords.id, 'rec-2')).get()
    expect(row?.embeddingVersion).toBeNull()
    expect(row?.embeddingModel).toBeNull()
    expect(row?.embeddingDimension).toBeNull()
    expect(row?.embeddedAt).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/db/migrations/068-memory-embedding-identity.test.ts`
Expected: FAIL — TypeScript rejects `embeddingModel` because it is not a property of the `memoryRecords` insert type.

- [ ] **Step 3: Add the four columns to the Drizzle schema**

In `src/db/long-term-memory-schema.ts`, inside the `memoryRecords` column object, replace the line `embedding: blob('embedding'),` with:

```ts
    embedding: blob('embedding'),
    embeddingModel: text('embedding_model'),
    embeddingDimension: integer('embedding_dimension'),
    embeddingVersion: text('embedding_version'),
    embeddedAt: text('embedded_at'),
```

`integer` and `text` are already imported at the top of the file.

- [ ] **Step 4: Write the migration**

Create `src/db/migrations/068_memory_embedding_identity.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:068' })

const COLUMNS: readonly (readonly [string, string])[] = [
  ['embedding_model', 'TEXT'],
  ['embedding_dimension', 'INTEGER'],
  ['embedding_version', 'TEXT'],
  ['embedded_at', 'TEXT'],
]

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  for (const [name, type] of COLUMNS) {
    if (!columnExists(db, 'memory_records', name)) {
      db.run(`ALTER TABLE memory_records ADD COLUMN ${name} ${type}`)
    }
  }

  // Rows embedded before this migration have an unidentifiable vector. Mark them
  // so the backfill can find them and the dense channel can exclude them.
  db.run(`
    UPDATE memory_records
       SET embedding_version = 'unknown'
     WHERE embedding IS NOT NULL
       AND embedding_version IS NULL
  `)

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memory_records_embedding_backfill
      ON memory_records(scope_type, scope_id)
      WHERE embedding IS NULL OR embedding_version = 'unknown'
  `)

  log.info('migration 068: embedding identity columns added to memory_records')
}

export const migration068MemoryEmbeddingIdentity: Migration = {
  id: '068_memory_embedding_identity',
  up,
}

export default migration068MemoryEmbeddingIdentity
```

Note: the `memory_records_au` trigger fires on the `UPDATE`, re-indexing FTS for every previously embedded row. That is correct but not free — it happens once, inside the migration transaction.

- [ ] **Step 5: Register the migration**

In `src/db/index.ts`, add the import immediately after the `migration067MultiLlmProviders` import (line 80):

```ts
import { migration068MemoryEmbeddingIdentity } from './migrations/068_memory_embedding_identity.js'
```

and add the entry immediately after `migration067MultiLlmProviders,` in the `MIGRATIONS` array (line 182):

```ts
  migration068MemoryEmbeddingIdentity,
```

- [ ] **Step 6: Run the migration test**

Run: `bun test tests/db/migrations/068-memory-embedding-identity.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 7: Add the fields to the domain type**

In `src/long-term-memory/types.ts`, inside the `MemoryRecord` type, replace `embedding?: Float32Array | null` with:

```ts
    embedding?: Float32Array | null
    embeddingModel?: string | null
    embeddingDimension?: number | null
    embeddingVersion?: string | null
    embeddedAt?: string | null
```

`MemoryRecordInput` already derives from `MemoryRecord`, so it picks these up.

- [ ] **Step 8: Map the columns in `rowToRecord`**

In `src/long-term-memory/serialization.ts`, replace `embedding: deserializeEmbedding(row.embedding),` with:

```ts
  embedding: deserializeEmbedding(row.embedding),
  embeddingModel: row.embeddingModel,
  embeddingDimension: row.embeddingDimension,
  embeddingVersion: row.embeddingVersion,
  embeddedAt: row.embeddedAt,
```

- [ ] **Step 9: Carry the columns through the insert mapper**

`saveMemoryRecord` builds its insert row from `inputToRecordValues`, which enumerates every column explicitly. Without this the new fields are silently dropped on write, and later tasks' tests that seed an `embeddingVersion` through `saveMemoryRecord` will not see it persisted.

In `src/long-term-memory/store.ts`, in `inputToRecordValues`, replace `embedding: serializeEmbedding(input.embedding),` with:

```ts
  embedding: serializeEmbedding(input.embedding),
  embeddingModel: input.embeddingModel ?? null,
  embeddingDimension: input.embeddingDimension ?? null,
  embeddingVersion: input.embeddingVersion ?? null,
  embeddedAt: input.embeddedAt ?? null,
```

`MemoryRecordInput` is `Omit<MemoryRecord, 'embedding'> & { embedding?: ... }`, so it picked up the four optional fields from Step 7 automatically.

- [ ] **Step 10: Run the memory suite and typecheck**

Run: `bun test tests/long-term-memory tests/db && bun typecheck`
Expected: PASS. `rowToRecord` gains four fields; existing tests that compare a whole record with `toEqual` will now see them. If any fails, add the four `null` fields to that test's expected object — do **not** relax the assertion to `toMatchObject`.

- [ ] **Step 11: Commit**

```bash
git add src/db/migrations/068_memory_embedding_identity.ts src/db/index.ts src/db/long-term-memory-schema.ts src/long-term-memory/types.ts src/long-term-memory/serialization.ts src/long-term-memory/store.ts tests/db/migrations/068-memory-embedding-identity.test.ts
git commit -m "feat(memory): add embedding identity columns (migration 068)"
```

---

### Task 2: Query-time validity and expiry

**Files:**
- Modify: `src/long-term-memory/record-conditions.ts`
- Modify: `src/long-term-memory/store.ts:14-31,135-183`
- Modify: `src/long-term-memory/provisional-store.ts:16-44`
- Test: `tests/long-term-memory/record-conditions.test.ts` (existing — extend)
- Test: `tests/long-term-memory/validity-filter.test.ts` (new)

**Interfaces:**
- Consumes: `memoryRecords` from Task 1.
- Produces:
  - `recordValidityCondition(now: string): SQL`
  - `threadScopeCondition(filter: Readonly<{ threadContextId?: string; excludeThreadContextId?: string }>): SQL | undefined`
  - `ListMemoryRecordsFilter`, `SearchMemoryRecordsFilter`, and `ListProvisionalFilter` each gain an optional `now?: string`, defaulting to `new Date().toISOString()`.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/validity-filter.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { listProvisionalRecords, listMemoryRecords, saveMemoryRecord, searchMemoryRecords } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-07-15T12:00:00.000Z'

const record = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'deployment window is Tuesday',
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

const ids = (records: readonly { id: string }[]): readonly string[] => records.map((r) => r.id)

describe('query-time validity', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('excludes an expired but still-active record from listing', () => {
    saveMemoryRecord(record({ id: 'expired', expiresAt: '2026-07-15T11:59:59.999Z' }))
    saveMemoryRecord(record({ id: 'live', expiresAt: '2026-07-15T12:00:00.001Z' }))

    expect(ids(listMemoryRecords({ scopeId: 'user-1', scopeType: 'personal', status: 'active', now: NOW }))).toEqual([
      'live',
    ])
  })

  test('treats expiresAt exactly equal to now as expired', () => {
    saveMemoryRecord(record({ id: 'boundary', expiresAt: NOW }))

    expect(listMemoryRecords({ scopeId: 'user-1', scopeType: 'personal', status: 'active', now: NOW })).toEqual([])
  })

  test('validity is half-open: validFrom equal to now is included, validUntil equal to now is not', () => {
    saveMemoryRecord(record({ id: 'from-now', validFrom: NOW }))
    saveMemoryRecord(record({ id: 'until-now', validUntil: NOW }))
    saveMemoryRecord(record({ id: 'not-yet', validFrom: '2026-07-15T12:00:00.001Z' }))

    expect(ids(listMemoryRecords({ scopeId: 'user-1', scopeType: 'personal', status: 'active', now: NOW }))).toEqual([
      'from-now',
    ])
  })

  test('excludes an expired record from FTS search', () => {
    saveMemoryRecord(record({ id: 'expired', content: 'deployment window', expiresAt: '2026-07-01T00:00:00.000Z' }))

    expect(searchMemoryRecords({ scopeId: 'user-1', scopeType: 'personal', query: 'deployment', now: NOW })).toEqual([])
  })

  test('excludes an expired provisional record from provisional listing', () => {
    saveMemoryRecord(
      record({ id: 'prov', status: 'provisional', threadContextId: 't1', expiresAt: '2026-07-01T00:00:00.000Z' }),
    )

    expect(listProvisionalRecords({ scopeId: 'user-1', scopeType: 'personal', now: NOW })).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/validity-filter.test.ts`
Expected: FAIL — TypeScript rejects `now` on the filter types, and the expiry assertions return the expired rows.

- [ ] **Step 3: Add the shared predicates**

Replace the body of `src/long-term-memory/record-conditions.ts` below the header with:

```ts
import { and, eq, isNull, ne, or, sql, type SQL } from 'drizzle-orm'

import { memoryRecords } from '../db/schema.js'
import type { MemoryScope } from './types.js'

/** Matches a single memory record by id within a given scope. Shared by the record store and provisional store. */
export const recordScopeCondition = (scope: MemoryScope, recordId: string): SQL | undefined =>
  and(
    eq(memoryRecords.scopeId, scope.scopeId),
    eq(memoryRecords.scopeType, scope.scopeType),
    eq(memoryRecords.id, recordId),
  )

/**
 * Half-open validity plus expiry, enforced at query time on every read path.
 * A NULL bound means "unbounded on that side".
 * @public -- consumed by the record store, provisional store, lexical search, and dense scan.
 */
export const recordValidityCondition = (now: string): SQL =>
  sql`(${memoryRecords.validFrom} IS NULL OR ${memoryRecords.validFrom} <= ${now})
   AND (${memoryRecords.validUntil} IS NULL OR ${memoryRecords.validUntil} > ${now})
   AND (${memoryRecords.expiresAt} IS NULL OR ${memoryRecords.expiresAt} > ${now})`

/** Include-one-thread / exclude-one-thread filtering, shared by the provisional store and the retrieval channels. */
export const threadScopeCondition = (
  filter: Readonly<{ threadContextId?: string; excludeThreadContextId?: string }>,
): SQL | undefined => {
  if (filter.threadContextId !== undefined) return eq(memoryRecords.threadContextId, filter.threadContextId)
  if (filter.excludeThreadContextId !== undefined) {
    return or(
      ne(memoryRecords.threadContextId, filter.excludeThreadContextId),
      isNull(memoryRecords.threadContextId),
    )
  }
  return undefined
}
```

- [ ] **Step 4: Apply the predicate in the record store**

In `src/long-term-memory/store.ts`:

Add `now?: string` to both filter types:

```ts
export type ListMemoryRecordsFilter = Readonly<{
  status?: MemoryStatus
  statuses?: readonly MemoryStatus[]
  kind?: MemoryKind
  limit?: number
  now?: string
}> &
  MemoryScope

export type SearchMemoryRecordsFilter = Readonly<{
  query: string
  includeStale?: boolean
  kind?: MemoryKind
  limit?: number
  now?: string
}> &
  MemoryScope
```

Change the import on line 10 to pull in the new predicate:

```ts
import { recordScopeCondition, recordValidityCondition } from './record-conditions.js'
```

In `listMemoryRecords`, add the predicate to the initial `conditions` array:

```ts
  const conditions: SQL[] = [
    eq(memoryRecords.scopeId, filter.scopeId),
    eq(memoryRecords.scopeType, filter.scopeType),
    recordValidityCondition(filter.now ?? new Date().toISOString()),
  ]
```

In `searchMemoryRecords`, add the same line to its `conditions` array, immediately after `statusFilter,`:

```ts
    recordValidityCondition(filter.now ?? new Date().toISOString()),
```

Leave `sanitizeFtsQuery` exactly as it is. `searchMemoryRecords` backs `forget_memory`; broadening its match set would silently archive more records than the same query archives today.

- [ ] **Step 5: Apply the predicate in the provisional store**

In `src/long-term-memory/provisional-store.ts`, replace the import block and `listProvisionalRecords` with:

```ts
import { and, desc, eq, type SQL } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import { recordScopeCondition, recordValidityCondition, threadScopeCondition } from './record-conditions.js'
import { parseEvidence, rowToRecord } from './serialization.js'
import type { MemoryEvidence, MemoryRecord, MemoryScope } from './types.js'

const DEFAULT_LIST_LIMIT = 50

export type ListProvisionalFilter = MemoryScope &
  Readonly<{ threadContextId?: string; excludeThreadContextId?: string; limit?: number; now?: string }>

/** @public -- consumed by the Plan 2 recall cascade + promotion engine (cross-thread memory bridge). */
export function listProvisionalRecords(filter: ListProvisionalFilter): readonly MemoryRecord[] {
  const conditions: SQL[] = [
    eq(memoryRecords.scopeId, filter.scopeId),
    eq(memoryRecords.scopeType, filter.scopeType),
    eq(memoryRecords.status, 'provisional'),
    recordValidityCondition(filter.now ?? new Date().toISOString()),
  ]
  const thread = threadScopeCondition(filter)
  if (thread !== undefined) conditions.push(thread)

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

The rest of the file (`promoteProvisionalToActive`, `markPromotionRejected`) is unchanged.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/long-term-memory tests/conversation.test.ts`
Expected: PASS. `conversation.ts` calls `listMemoryRecords` with no `now`, so it picks up the default and stops injecting expired records — that is the intended half of defect 2 that lands here.

- [ ] **Step 7: Commit**

```bash
git add src/long-term-memory/record-conditions.ts src/long-term-memory/store.ts src/long-term-memory/provisional-store.ts tests/long-term-memory/validity-filter.test.ts
git commit -m "fix(memory): enforce validity and expiry at query time"
```

---

### Task 3: Unicode tokenizer and FTS5 query builder

**Files:**
- Create: `src/long-term-memory/lexical-query.ts`
- Test: `tests/long-term-memory/lexical-query.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `tokenizeQuery(text: string): readonly string[]`
  - `buildFtsMatchQuery(query: string): string | null` — returns `null` when the query yields no tokens.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/lexical-query.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildFtsMatchQuery, tokenizeQuery } from '../../src/long-term-memory/lexical-query.js'

describe('tokenizeQuery', () => {
  test('tokenizes Cyrillic', () => {
    expect(tokenizeQuery('Маршруты доставки')).toEqual(['маршруты', 'доставки'])
  })

  test('tokenizes mixed scripts and digits', () => {
    expect(tokenizeQuery('deploy маршрут v2')).toEqual(['deploy', 'маршрут', 'v2'])
  })

  test('drops punctuation and whitespace', () => {
    expect(tokenizeQuery('  what?! is - the plan...  ')).toEqual(['what', 'is', 'the', 'plan'])
  })

  test('returns an empty array for punctuation-only and empty input', () => {
    expect(tokenizeQuery('?!.,  ')).toEqual([])
    expect(tokenizeQuery('')).toEqual([])
  })
})

describe('buildFtsMatchQuery', () => {
  test('emits quoted prefix terms joined by OR', () => {
    expect(buildFtsMatchQuery('маршрут доставка')).toBe('"маршрут"* OR "доставка"*')
  })

  test('deduplicates repeated tokens', () => {
    expect(buildFtsMatchQuery('plan plan PLAN')).toBe('"plan"*')
  })

  test('returns null when there are no tokens', () => {
    expect(buildFtsMatchQuery('?!.,')).toBeNull()
    expect(buildFtsMatchQuery('')).toBeNull()
  })

  test('produces no bare quote for adversarial input', () => {
    const built = buildFtsMatchQuery('drop" table OR "x')
    expect(built).toBe('"drop"* OR "table"* OR "or"* OR "x"*')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/lexical-query.test.ts`
Expected: FAIL — `Cannot find module '../../src/long-term-memory/lexical-query.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/long-term-memory/lexical-query.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Unicode letters and numbers only. Everything else — punctuation, whitespace,
// FTS5 operators — is a separator, so a token can never carry syntax into MATCH.
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu

/** @public -- consumed by the lexical retrieval channel. */
export const tokenizeQuery = (text: string): readonly string[] => text.toLowerCase().match(TOKEN_PATTERN) ?? []

// Defense in depth: the token pattern already excludes `"`, but quoting is what
// makes the term a literal to FTS5 rather than an operator.
const escapeTerm = (token: string): string => `"${token.replace(/"/gu, '""')}"`

/**
 * Builds an FTS5 MATCH expression of quoted prefix terms joined by OR.
 * Prefix form is required because FTS5 does not stem: `"маршрут"*` matches
 * `Маршруты` and `маршруту`, while bare `маршрут` matches neither.
 * Returns null when the query contains no tokens, so callers can skip the
 * lexical channel instead of issuing a degenerate MATCH.
 * @public -- consumed by the lexical retrieval channel.
 */
export const buildFtsMatchQuery = (query: string): string | null => {
  const tokens = [...new Set(tokenizeQuery(query))]
  if (tokens.length === 0) return null
  return tokens.map((token) => `${escapeTerm(token)}*`).join(' OR ')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/long-term-memory/lexical-query.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/lexical-query.ts tests/long-term-memory/lexical-query.test.ts
git commit -m "feat(memory): Unicode tokenizer and FTS5 prefix query builder"
```

---

### Task 4: FTS5 lexical search channel

**Files:**
- Create: `src/long-term-memory/lexical-search.ts`
- Test: `tests/long-term-memory/lexical-search.test.ts`

**Interfaces:**
- Consumes: `buildFtsMatchQuery` (Task 3); `recordValidityCondition`, `threadScopeCondition` (Task 2).
- Produces:
  ```ts
  export type LexicalSearchFilter = MemoryScope &
    Readonly<{
      query: string
      statuses: readonly MemoryStatus[]
      kind?: MemoryKind
      threadContextId?: string
      excludeThreadContextId?: string
      limit?: number
      now?: string
    }>
  export function searchLexical(filter: LexicalSearchFilter): readonly MemoryRecord[]
  ```
  Results are ordered best-first by `bm25()`.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/lexical-search.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { searchLexical } from '../../src/long-term-memory/lexical-search.js'
import { saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-07-15T12:00:00.000Z'
const SCOPE = { scopeId: 'user-1', scopeType: 'personal' } as const

const record = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'placeholder',
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

const ids = (records: readonly { id: string }[]): readonly string[] => records.map((r) => r.id)

describe('searchLexical', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('finds an inflected Cyrillic record from an uninflected query', () => {
    saveMemoryRecord(record({ id: 'ru', content: 'Маршруты доставки согласованы' }))

    const hits = searchLexical({ ...SCOPE, query: 'маршрут', statuses: ['active'], now: NOW })

    expect(ids(hits)).toEqual(['ru'])
  })

  test('returns nothing when the query has no tokens', () => {
    saveMemoryRecord(record({ id: 'any', content: 'anything at all' }))

    expect(searchLexical({ ...SCOPE, query: '?!.,', statuses: ['active'], now: NOW })).toEqual([])
  })

  test('excludes other scopes', () => {
    saveMemoryRecord(record({ id: 'mine', content: 'shared secret plan' }))
    saveMemoryRecord(record({ id: 'theirs', scopeId: 'user-2', content: 'shared secret plan' }))

    expect(ids(searchLexical({ ...SCOPE, query: 'secret', statuses: ['active'], now: NOW }))).toEqual(['mine'])
  })

  test('excludes an expired record', () => {
    saveMemoryRecord(record({ id: 'gone', content: 'expired plan', expiresAt: '2026-07-01T00:00:00.000Z' }))

    expect(searchLexical({ ...SCOPE, query: 'plan', statuses: ['active'], now: NOW })).toEqual([])
  })

  test('filters by status and kind', () => {
    saveMemoryRecord(record({ id: 'act', content: 'rollout plan', status: 'active', kind: 'fact' }))
    saveMemoryRecord(record({ id: 'prov', content: 'rollout plan', status: 'provisional', kind: 'fact' }))
    saveMemoryRecord(record({ id: 'pref', content: 'rollout plan', status: 'active', kind: 'preference' }))

    expect(ids(searchLexical({ ...SCOPE, query: 'rollout', statuses: ['active'], kind: 'fact', now: NOW }))).toEqual([
      'act',
    ])
    expect(ids(searchLexical({ ...SCOPE, query: 'rollout', statuses: ['provisional'], now: NOW }))).toEqual(['prov'])
  })

  test('excludes a named thread when excludeThreadContextId is set', () => {
    saveMemoryRecord(record({ id: 'here', content: 'thread note', status: 'provisional', threadContextId: 't1' }))
    saveMemoryRecord(record({ id: 'there', content: 'thread note', status: 'provisional', threadContextId: 't2' }))

    const hits = searchLexical({
      ...SCOPE,
      query: 'thread',
      statuses: ['provisional'],
      excludeThreadContextId: 't1',
      now: NOW,
    })

    expect(ids(hits)).toEqual(['there'])
  })

  test('ranks the denser match first', () => {
    saveMemoryRecord(record({ id: 'weak', content: 'a long note about many unrelated topics and one plan mention' }))
    saveMemoryRecord(record({ id: 'strong', content: 'plan' }))

    const hits = searchLexical({ ...SCOPE, query: 'plan', statuses: ['active'], now: NOW })

    expect(hits[0]?.id).toBe('strong')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/lexical-search.test.ts`
Expected: FAIL — `Cannot find module '../../src/long-term-memory/lexical-search.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/long-term-memory/lexical-search.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import { logger } from '../logger.js'
import { buildFtsMatchQuery } from './lexical-query.js'
import { recordValidityCondition, threadScopeCondition } from './record-conditions.js'
import { rowToRecord } from './serialization.js'
import type { MemoryKind, MemoryRecord, MemoryScope, MemoryStatus } from './types.js'

const log = logger.child({ scope: 'memory:lexical-search' })

const DEFAULT_LIMIT = 10
// Pull more FTS candidates than we return so the post-filters (status, kind,
// thread, validity) have something to work with before truncation.
const CANDIDATE_MULTIPLIER = 5

export type LexicalSearchFilter = MemoryScope &
  Readonly<{
    query: string
    statuses: readonly MemoryStatus[]
    kind?: MemoryKind
    threadContextId?: string
    excludeThreadContextId?: string
    limit?: number
    now?: string
  }>

const rankedIds = (filter: LexicalSearchFilter, match: string, candidateLimit: number): readonly string[] =>
  getDrizzleDb()
    .all<{ id: string }>(
      sql`SELECT m.id AS id
            FROM memory_records_fts f
            JOIN memory_records m ON m.rowid = f.rowid
           WHERE f.memory_records_fts MATCH ${match}
             AND m.scope_id = ${filter.scopeId}
             AND m.scope_type = ${filter.scopeType}
           ORDER BY bm25(memory_records_fts) ASC
           LIMIT ${candidateLimit}`,
    )
    .map((row) => row.id)

/**
 * Lexical retrieval channel: FTS5 with the unicode61 tokenizer, ranked by bm25().
 * Returns records best-first. Never throws on a degenerate query — an
 * untokenizable query yields no lexical hits and the caller falls back to the
 * dense channel alone.
 * @public -- consumed by the hybrid search orchestrator.
 */
export function searchLexical(filter: LexicalSearchFilter): readonly MemoryRecord[] {
  const match = buildFtsMatchQuery(filter.query)
  if (match === null) {
    log.debug({ scopeId: filter.scopeId }, 'Query produced no lexical tokens; skipping FTS channel')
    return []
  }

  const limit = filter.limit ?? DEFAULT_LIMIT
  const ordered = rankedIds(filter, match, limit * CANDIDATE_MULTIPLIER)
  if (ordered.length === 0) return []

  const conditions: SQL[] = [
    inArray(memoryRecords.id, [...ordered]),
    eq(memoryRecords.scopeId, filter.scopeId),
    eq(memoryRecords.scopeType, filter.scopeType),
    inArray(memoryRecords.status, [...filter.statuses]),
    recordValidityCondition(filter.now ?? new Date().toISOString()),
  ]
  if (filter.kind !== undefined) conditions.push(eq(memoryRecords.kind, filter.kind))
  const thread = threadScopeCondition(filter)
  if (thread !== undefined) conditions.push(thread)

  const byId = new Map(
    getDrizzleDb()
      .select()
      .from(memoryRecords)
      .where(and(...conditions))
      .all()
      .map((row) => [row.id, rowToRecord(row)] as const),
  )

  const out: MemoryRecord[] = []
  for (const id of ordered) {
    const record = byId.get(id)
    if (record === undefined) continue
    out.push(record)
    if (out.length >= limit) break
  }
  return out
}
```

Two notes on the raw query. `getDrizzleDb().all<T>(query)` is Drizzle's synchronous escape hatch for `bun:sqlite`; it returns `T[]` keyed by the column aliases in the SELECT, which is why the `id` column is aliased explicitly. And every interpolation in the `sql` template is a bound parameter, including `MATCH ${match}` — the same pattern `searchMemoryRecords` already uses in `store.ts`. Two round trips (ids, then rows) rather than one is deliberate: it keeps the record hydration on the type-checked Drizzle path instead of hand-mapping 20 columns.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/long-term-memory/lexical-search.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/lexical-search.ts tests/long-term-memory/lexical-search.test.ts
git commit -m "feat(memory): FTS5 bm25 lexical retrieval channel"
```

---

### Task 5: Weighted reciprocal rank fusion

**Files:**
- Create: `src/long-term-memory/fusion.ts`
- Test: `tests/long-term-memory/fusion.test.ts`

**Interfaces:**
- Consumes: `MemoryRecord` (Task 1).
- Produces:
  - `RANK_FUSION_OFFSET = 60`, `LEXICAL_FUSION_WEIGHT = 2`, `DENSE_FUSION_WEIGHT = 1`
  - `fuseByRank(lexical: readonly MemoryRecord[], dense: readonly MemoryRecord[], limit: number): readonly MemoryRecord[]`

The constants and the arithmetic are ported verbatim from the measured `corrected-hybrid` candidate (`scripts/memory-research/candidates/corrected-hybrid.ts:23-25,178-212`). Do not retune them.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/fusion.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { fuseByRank } from '../../src/long-term-memory/fusion.js'
import type { MemoryRecord } from '../../src/long-term-memory/types.js'

const rec = (id: string): MemoryRecord => ({
  id,
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: id,
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
})

const ids = (records: readonly MemoryRecord[]): readonly string[] => records.map((r) => r.id)

describe('fuseByRank', () => {
  test('ranks a record present in both channels above single-channel records', () => {
    // both:   2/61 + 1/61 = 0.04918
    // lexOnly: 2/62        = 0.03226
    // denseOnly:      1/62 = 0.01613
    const fused = fuseByRank([rec('both'), rec('lexOnly')], [rec('both'), rec('denseOnly')], 10)

    expect(ids(fused)).toEqual(['both', 'lexOnly', 'denseOnly'])
  })

  test('weights the lexical channel twice the dense channel at equal rank', () => {
    const fused = fuseByRank([rec('lex')], [rec('dense')], 10)

    expect(ids(fused)).toEqual(['lex', 'dense'])
  })

  test('returns the lexical list unchanged when the dense channel is empty', () => {
    const fused = fuseByRank([rec('a'), rec('b'), rec('c')], [], 10)

    expect(ids(fused)).toEqual(['a', 'b', 'c'])
  })

  test('returns the dense list unchanged when the lexical channel is empty', () => {
    const fused = fuseByRank([], [rec('a'), rec('b')], 10)

    expect(ids(fused)).toEqual(['a', 'b'])
  })

  test('breaks ties deterministically by record id', () => {
    const fused = fuseByRank([rec('zeta')], [rec('alpha')], 10)
    const swapped = fuseByRank([rec('alpha')], [rec('zeta')], 10)

    // 'zeta' wins on lexical weight; 'alpha' wins when it holds the lexical slot.
    expect(ids(fused)).toEqual(['zeta', 'alpha'])
    expect(ids(swapped)).toEqual(['alpha', 'zeta'])
  })

  test('tie-break by id applies when scores are exactly equal', () => {
    // Lexical rank 61 scores 2/(60+62) = 1/61; dense rank 0 scores 1/(60+1) = 1/61.
    // Construct that exact collision and check the lower id wins.
    const lexical = Array.from({ length: 62 }, (_, i) => rec(`lex-${String(i).padStart(2, '0')}`))
    lexical[61] = rec('zzz-tied')
    const fused = fuseByRank(lexical, [rec('aaa-tied')], 100)

    const tiedPositions = [fused.findIndex((r) => r.id === 'aaa-tied'), fused.findIndex((r) => r.id === 'zzz-tied')]
    expect(tiedPositions[0]).toBeLessThan(tiedPositions[1] as number)
  })

  test('truncates to the limit', () => {
    const fused = fuseByRank([rec('a'), rec('b'), rec('c')], [rec('d')], 2)

    expect(fused).toHaveLength(2)
  })

  test('deduplicates a record that appears in both channels', () => {
    const fused = fuseByRank([rec('same')], [rec('same')], 10)

    expect(ids(fused)).toEqual(['same'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/fusion.test.ts`
Expected: FAIL — `Cannot find module '../../src/long-term-memory/fusion.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/long-term-memory/fusion.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MemoryRecord } from './types.js'

// Ported verbatim from the measured `corrected-hybrid` benchmark candidate
// (scripts/memory-research/candidates/corrected-hybrid.ts). These are frozen
// experiment parameters, not tuning knobs.
export const RANK_FUSION_OFFSET = 60
export const LEXICAL_FUSION_WEIGHT = 2
export const DENSE_FUSION_WEIGHT = 1

type Accumulator = { record: MemoryRecord; score: number }

const accumulate = (
  into: Map<string, Accumulator>,
  ranked: readonly MemoryRecord[],
  weight: number,
): void => {
  ranked.forEach((record, index) => {
    const contribution = weight / (RANK_FUSION_OFFSET + index + 1)
    const existing = into.get(record.id)
    if (existing === undefined) {
      into.set(record.id, { record, score: contribution })
      return
    }
    existing.score += contribution
  })
}

/**
 * Weighted reciprocal rank fusion over two independently ranked channels.
 * A record present in only one channel still scores, which is what keeps an
 * unembedded record reachable when other records do produce semantic hits.
 * @public -- consumed by the hybrid search orchestrator.
 */
export function fuseByRank(
  lexical: readonly MemoryRecord[],
  dense: readonly MemoryRecord[],
  limit: number,
): readonly MemoryRecord[] {
  const scores = new Map<string, Accumulator>()
  accumulate(scores, lexical, LEXICAL_FUSION_WEIGHT)
  accumulate(scores, dense, DENSE_FUSION_WEIGHT)

  return [...scores.values()]
    .sort((left, right) =>
      right.score === left.score ? left.record.id.localeCompare(right.record.id) : right.score - left.score,
    )
    .slice(0, limit)
    .map((entry) => entry.record)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/long-term-memory/fusion.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/fusion.ts tests/long-term-memory/fusion.test.ts
git commit -m "feat(memory): weighted reciprocal rank fusion"
```

---

### Task 6: Version-compatible dense channel

**Files:**
- Create: `src/long-term-memory/embedding-identity.ts`
- Modify: `src/long-term-memory/semantic-search.ts:14-71`
- Test: `tests/long-term-memory/embedding-identity.test.ts`
- Test: `tests/long-term-memory/semantic-search.test.ts` (existing — extend)

**Interfaces:**
- Consumes: `recordValidityCondition`, `threadScopeCondition` (Task 2); the identity columns (Task 1).
- Produces:
  - `UNKNOWN_EMBEDDING_VERSION = 'unknown'`
  - `embeddingVersionOf(model: string, dimension: number): string` — returns `` `${model}:${dimension}` ``
  - `resolveEmbeddingModel(configContextId: string): string | null`
  - `rankRecordsBySimilarity(scope, queryEmbedding, options)` where `SimilarityOptions` gains `embeddingVersion?: string | null`, `kind?: MemoryKind`, `threadContextId?: string`, `excludeThreadContextId?: string`, `now?: string`. A missing or `null` `embeddingVersion` returns `[]`.

- [ ] **Step 1: Write the failing test for the identity helper**

Create `tests/long-term-memory/embedding-identity.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { embeddingVersionOf, UNKNOWN_EMBEDDING_VERSION } from '../../src/long-term-memory/embedding-identity.js'

describe('embeddingVersionOf', () => {
  test('joins model and dimension', () => {
    expect(embeddingVersionOf('text-embedding-3-small', 1536)).toBe('text-embedding-3-small:1536')
  })

  test('distinguishes the same model at different dimensions', () => {
    expect(embeddingVersionOf('m', 768)).not.toBe(embeddingVersionOf('m', 1536))
  })

  test('never collides with the pre-migration sentinel', () => {
    expect(embeddingVersionOf('unknown', 0)).not.toBe(UNKNOWN_EMBEDDING_VERSION)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/embedding-identity.test.ts`
Expected: FAIL — `Cannot find module '../../src/long-term-memory/embedding-identity.js'`.

- [ ] **Step 3: Write the identity module**

Create `src/long-term-memory/embedding-identity.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolveLlmConfig } from '../llm-providers/resolver.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'memory:embedding-identity' })

/** Stamped by migration 068 on vectors that predate identity tracking. Never dense-eligible. */
export const UNKNOWN_EMBEDDING_VERSION = 'unknown'

/**
 * The compatibility identity of a vector: the two properties that make two
 * vectors comparable at all. Cosine similarity across different models is
 * meaningless, which is what this identity exists to prevent.
 * @public -- consumed by the dense channel, the embedding writer, and the backfill.
 */
export const embeddingVersionOf = (model: string, dimension: number): string => `${model}:${dimension}`

/**
 * The embedding model configured for one config context. BYOK means two scopes
 * can legitimately sit on different models, so there is no global "current model".
 * @public -- consumed by the recall cascade, the embedding writer, and the backfill.
 */
export const resolveEmbeddingModel = (configContextId: string): string | null => {
  const resolved = resolveLlmConfig(configContextId)
  if (!resolved.ok) {
    log.warn({ configContextId, source: resolved.source, type: resolved.type }, 'No embedding model for config context')
    return null
  }
  return resolved.embedding.model
}
```

Do not log `resolved.embedding.apiKey` or `baseUrl`. `model` only.

- [ ] **Step 4: Run the identity test**

Run: `bun test tests/long-term-memory/embedding-identity.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing test for the dense channel**

Append to `tests/long-term-memory/semantic-search.test.ts` (inside the existing top-level `describe`; reuse whatever record factory that file already defines, or add the one below if it has none):

```ts
  test('excludes a record whose embedding version does not match the query identity', async () => {
    await setupTestDb()
    const vector = new Float32Array([1, 0, 0])

    saveMemoryRecord({
      ...memoryRecordInput({ id: 'compatible' }),
      embedding: vector,
      embeddingModel: 'model-a',
      embeddingDimension: 3,
      embeddingVersion: 'model-a:3',
    })
    saveMemoryRecord({
      ...memoryRecordInput({ id: 'other-model' }),
      embedding: vector,
      embeddingModel: 'model-b',
      embeddingDimension: 3,
      embeddingVersion: 'model-b:3',
    })
    saveMemoryRecord({
      ...memoryRecordInput({ id: 'legacy' }),
      embedding: vector,
      embeddingVersion: 'unknown',
    })

    const hits = rankRecordsBySimilarity({ scopeId: 'user-1', scopeType: 'personal' }, [1, 0, 0], {
      embeddingVersion: 'model-a:3',
      now: '2026-07-15T12:00:00.000Z',
    })

    expect(hits.map((h) => h.id)).toEqual(['compatible'])
  })

  test('returns nothing when the caller has no embedding version', async () => {
    await setupTestDb()

    saveMemoryRecord({
      ...memoryRecordInput({ id: 'compatible' }),
      embedding: new Float32Array([1, 0, 0]),
      embeddingVersion: 'model-a:3',
    })

    expect(
      rankRecordsBySimilarity({ scopeId: 'user-1', scopeType: 'personal' }, [1, 0, 0], { embeddingVersion: null }),
    ).toEqual([])
  })

  test('excludes an expired record from the dense channel', async () => {
    await setupTestDb()

    saveMemoryRecord({
      ...memoryRecordInput({ id: 'expired', expiresAt: '2026-07-01T00:00:00.000Z' }),
      embedding: new Float32Array([1, 0, 0]),
      embeddingVersion: 'model-a:3',
    })

    expect(
      rankRecordsBySimilarity({ scopeId: 'user-1', scopeType: 'personal' }, [1, 0, 0], {
        embeddingVersion: 'model-a:3',
        now: '2026-07-15T12:00:00.000Z',
      }),
    ).toEqual([])
  })
```

If `tests/long-term-memory/semantic-search.test.ts` has no `memoryRecordInput` factory, add this one above the `describe`:

```ts
const memoryRecordInput = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'placeholder',
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test tests/long-term-memory/semantic-search.test.ts`
Expected: FAIL — `embeddingVersion` is not a property of `SimilarityOptions`, and the version-mismatch assertion returns all three records.

- [ ] **Step 7: Rewrite the dense channel**

Replace `src/long-term-memory/semantic-search.ts` below the header with:

```ts
import { and, eq, inArray, type SQL } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import { recordValidityCondition, threadScopeCondition } from './record-conditions.js'
import { deserializeEmbedding, rowToRecord } from './serialization.js'
import type { MemoryKind, MemoryRecord, MemoryScope, MemoryStatus } from './types.js'

export type SimilarityOptions = Readonly<{
  threshold?: number
  limit?: number
  statuses?: readonly MemoryStatus[]
  kind?: MemoryKind
  threadContextId?: string
  excludeThreadContextId?: string
  /** Identity of the querying config context. A null or absent value yields no dense hits. */
  embeddingVersion?: string | null
  now?: string
}>

const DEFAULT_THRESHOLD = 0.65
const DEFAULT_LIMIT = 10

/** @public -- consumed by the Plan 2 recall cascade + promotion engine. */
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

const denseConditions = (scope: MemoryScope, options: SimilarityOptions, version: string): SQL[] => {
  const conditions: SQL[] = [
    eq(memoryRecords.scopeId, scope.scopeId),
    eq(memoryRecords.scopeType, scope.scopeType),
    inArray(memoryRecords.status, [...(options.statuses ?? ['active'])]),
    eq(memoryRecords.embeddingVersion, version),
    recordValidityCondition(options.now ?? new Date().toISOString()),
  ]
  if (options.kind !== undefined) conditions.push(eq(memoryRecords.kind, options.kind))
  const thread = threadScopeCondition(options)
  if (thread !== undefined) conditions.push(thread)
  return conditions
}

/**
 * Dense retrieval channel. Only records whose stored embedding identity matches
 * the querying config context's identity are eligible — comparing vectors across
 * models produces meaningless cosine scores. Ineligible records drop out of this
 * channel only; they stay reachable lexically.
 * @public -- consumed by the hybrid search orchestrator and the promotion engine.
 */
export function rankRecordsBySimilarity(
  scope: MemoryScope,
  queryEmbedding: readonly number[],
  options: SimilarityOptions,
): readonly MemoryRecord[] {
  const version = options.embeddingVersion
  if (version === undefined || version === null) return []

  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const limit = options.limit ?? DEFAULT_LIMIT

  const rows = getDrizzleDb()
    .select()
    .from(memoryRecords)
    .where(and(...denseConditions(scope, options, version)))
    .all()

  return rows
    .map((row) => ({ row, vec: deserializeEmbedding(row.embedding) }))
    .filter((entry): entry is { row: (typeof rows)[number]; vec: Float32Array } => entry.vec !== null)
    .map((entry) => ({ row: entry.row, score: cosineSimilarity(queryEmbedding, entry.vec) }))
    .filter((entry) => entry.score >= threshold)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => rowToRecord(entry.row))
}
```

Note the import of `rowToRecord` moved from `./store.js` to `./serialization.js` — same function, but importing it from `store.js` here would create an unnecessary cycle now that `store.js` is not otherwise needed.

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test tests/long-term-memory/semantic-search.test.ts tests/long-term-memory/promotion.test.ts`
Expected: PASS. Existing dense-channel tests that seed an embedding but no version will now return `[]`. Update them to seed `embeddingVersion` and to pass `embeddingVersion` in the options — the exclusion is the fix, not a regression. Do not weaken an assertion to accommodate it.

- [ ] **Step 9: Commit**

```bash
git add src/long-term-memory/embedding-identity.ts src/long-term-memory/semantic-search.ts tests/long-term-memory/embedding-identity.test.ts tests/long-term-memory/semantic-search.test.ts tests/long-term-memory/promotion.test.ts
git commit -m "feat(memory): gate the dense channel on embedding version compatibility"
```

---

### Task 7: Hybrid search and cascade rewiring

**Files:**
- Create: `src/long-term-memory/hybrid-search.ts`
- Modify: `src/long-term-memory/recall-cascade.ts`
- Delete: `src/long-term-memory/recall-ranking.ts`
- Delete: `tests/long-term-memory/recall-ranking.test.ts`
- Test: `tests/long-term-memory/hybrid-search.test.ts`
- Test: `tests/long-term-memory/recall-cascade.test.ts` (existing — update)

**Interfaces:**
- Consumes: `searchLexical` (Task 4), `fuseByRank` (Task 5), `rankRecordsBySimilarity` and `embeddingVersionOf`/`resolveEmbeddingModel` (Task 6).
- Produces:
  ```ts
  export type HybridSearchInput = MemoryScope &
    Readonly<{
      query: string
      queryEmbedding: readonly number[] | null
      embeddingVersion: string | null
      statuses: readonly MemoryStatus[]
      kind?: MemoryKind
      threadContextId?: string
      excludeThreadContextId?: string
      limit: number
      now?: string
    }>
  export function searchHybrid(input: HybridSearchInput): readonly MemoryRecord[]
  ```
  `RunRecallCascadeDeps` gains `resolveEmbeddingModel: (configContextId: string) => string | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/hybrid-search.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { searchHybrid } from '../../src/long-term-memory/hybrid-search.js'
import { saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-07-15T12:00:00.000Z'
const VERSION = 'model-a:3'
const SCOPE = { scopeId: 'user-1', scopeType: 'personal' } as const

const record = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'placeholder',
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

const ids = (records: readonly { id: string }[]): readonly string[] => records.map((r) => r.id)

describe('searchHybrid', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('surfaces an unembedded lexical match alongside a semantic match', () => {
    saveMemoryRecord(
      record({
        id: 'semantic',
        content: 'totally different words',
        embedding: new Float32Array([1, 0, 0]),
        embeddingVersion: VERSION,
      }),
    )
    saveMemoryRecord(record({ id: 'lexical-only', content: 'маршрут доставки' }))

    const hits = searchHybrid({
      ...SCOPE,
      query: 'маршрут',
      queryEmbedding: [1, 0, 0],
      embeddingVersion: VERSION,
      statuses: ['active'],
      limit: 8,
      now: NOW,
    })

    expect(ids(hits)).toContain('lexical-only')
    expect(ids(hits)).toContain('semantic')
    // Lexical weight is 2 against dense 1, so the exact-term match leads.
    expect(hits[0]?.id).toBe('lexical-only')
  })

  test('falls back to the lexical channel alone when there is no query embedding', () => {
    saveMemoryRecord(record({ id: 'lex', content: 'маршрут доставки' }))

    const hits = searchHybrid({
      ...SCOPE,
      query: 'маршрут',
      queryEmbedding: null,
      embeddingVersion: null,
      statuses: ['active'],
      limit: 8,
      now: NOW,
    })

    expect(ids(hits)).toEqual(['lex'])
  })

  test('returns dense hits when the query has no lexical tokens', () => {
    saveMemoryRecord(
      record({ id: 'dense', content: 'anything', embedding: new Float32Array([1, 0, 0]), embeddingVersion: VERSION }),
    )

    const hits = searchHybrid({
      ...SCOPE,
      query: '?!.,',
      queryEmbedding: [1, 0, 0],
      embeddingVersion: VERSION,
      statuses: ['active'],
      limit: 8,
      now: NOW,
    })

    expect(ids(hits)).toEqual(['dense'])
  })

  test('never returns an expired record from either channel', () => {
    saveMemoryRecord(
      record({
        id: 'expired',
        content: 'маршрут',
        embedding: new Float32Array([1, 0, 0]),
        embeddingVersion: VERSION,
        expiresAt: '2026-07-01T00:00:00.000Z',
      }),
    )

    const hits = searchHybrid({
      ...SCOPE,
      query: 'маршрут',
      queryEmbedding: [1, 0, 0],
      embeddingVersion: VERSION,
      statuses: ['active'],
      limit: 8,
      now: NOW,
    })

    expect(hits).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/hybrid-search.test.ts`
Expected: FAIL — `Cannot find module '../../src/long-term-memory/hybrid-search.js'`.

- [ ] **Step 3: Write the orchestrator**

Create `src/long-term-memory/hybrid-search.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { fuseByRank } from './fusion.js'
import { searchLexical } from './lexical-search.js'
import { rankRecordsBySimilarity } from './semantic-search.js'
import type { MemoryKind, MemoryRecord, MemoryScope, MemoryStatus } from './types.js'

export type HybridSearchInput = MemoryScope &
  Readonly<{
    query: string
    queryEmbedding: readonly number[] | null
    /** Identity of the querying config context; null disables the dense channel. */
    embeddingVersion: string | null
    statuses: readonly MemoryStatus[]
    kind?: MemoryKind
    threadContextId?: string
    excludeThreadContextId?: string
    limit: number
    now?: string
  }>

/**
 * Runs the lexical and dense channels independently and fuses them by rank.
 * Neither channel is a precondition for the other: a record with no compatible
 * embedding stays reachable lexically, and a query with no usable tokens still
 * returns dense hits.
 * @public -- consumed by all three recall-cascade layers.
 */
export function searchHybrid(input: HybridSearchInput): readonly MemoryRecord[] {
  const scope: MemoryScope = { scopeId: input.scopeId, scopeType: input.scopeType }

  const lexical = searchLexical({
    ...scope,
    query: input.query,
    statuses: input.statuses,
    kind: input.kind,
    threadContextId: input.threadContextId,
    excludeThreadContextId: input.excludeThreadContextId,
    limit: input.limit,
    now: input.now,
  })

  const dense =
    input.queryEmbedding === null
      ? []
      : rankRecordsBySimilarity(scope, input.queryEmbedding, {
          statuses: input.statuses,
          kind: input.kind,
          threadContextId: input.threadContextId,
          excludeThreadContextId: input.excludeThreadContextId,
          embeddingVersion: input.embeddingVersion,
          limit: input.limit,
          now: input.now,
        })

  return fuseByRank(lexical, dense, input.limit)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/long-term-memory/hybrid-search.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Rewire the recall cascade**

Replace `src/long-term-memory/recall-cascade.ts` below the header with:

```ts
import type { ContextType } from '../chat/types.js'
import { getEmbeddingForContext } from '../embeddings.js'
import { embeddingVersionOf, resolveEmbeddingModel } from './embedding-identity.js'
import { searchHybrid } from './hybrid-search.js'
import { evaluatePromotion } from './promotion.js'
import { resolveMemoryScope } from './scope.js'
import type { MemoryKind, MemoryRecord, MemoryScope, MemoryStatus } from './types.js'

export const RECALL_DEFAULT_LIMIT = 8

export type RecallProvenance = 'current' | 'group' | 'other-thread'
export type RecallHit = MemoryRecord & Readonly<{ provenance: RecallProvenance }>

export type RunRecallCascadeInput = Readonly<{
  storageContextId: string
  configContextId: string
  contextType: ContextType
  query: string
  limit?: number
  kind?: MemoryKind
  includeStale?: boolean
}>

export type RunRecallCascadeDeps = Readonly<{
  getEmbedding: (query: string, configContextId: string) => Promise<readonly number[] | null>
  resolveEmbeddingModel: (configContextId: string) => string | null
  schedulePromotion: (record: MemoryRecord, scope: MemoryScope) => void
}>

const defaultDeps: RunRecallCascadeDeps = {
  getEmbedding: (query, configContextId) =>
    getEmbeddingForContext(query, configContextId, {
      storageContextId: configContextId,
      contextType: 'group',
      chatUserId: configContextId,
    }),
  resolveEmbeddingModel,
  schedulePromotion: (record, scope) => {
    void evaluatePromotion(scope, record)
  },
}

const dedupe = (hits: readonly RecallHit[], limit: number): readonly RecallHit[] => {
  const seen = new Set<string>()
  const out: RecallHit[] = []
  for (const hit of hits) {
    if (seen.has(hit.id)) continue
    seen.add(hit.id)
    out.push(hit)
    if (out.length >= limit) break
  }
  return out
}

const tag = (records: readonly MemoryRecord[], provenance: RecallProvenance): RecallHit[] =>
  records.map((record) => ({ ...record, provenance }))

type ChannelContext = Readonly<{
  scope: MemoryScope
  query: string
  queryEmbedding: readonly number[] | null
  embeddingVersion: string | null
  kind: MemoryKind | undefined
  limit: number
}>

const search = (
  context: ChannelContext,
  statuses: readonly MemoryStatus[],
  threads: Readonly<{ threadContextId?: string; excludeThreadContextId?: string }> = {},
): readonly MemoryRecord[] =>
  searchHybrid({
    ...context.scope,
    query: context.query,
    queryEmbedding: context.queryEmbedding,
    embeddingVersion: context.embeddingVersion,
    statuses,
    kind: context.kind,
    limit: context.limit,
    ...threads,
  })

/** The version identity of the config context issuing this query, or null when it cannot embed. */
const queryEmbeddingVersion = (
  queryEmbedding: readonly number[] | null,
  configContextId: string,
  deps: RunRecallCascadeDeps,
): string | null => {
  if (queryEmbedding === null) return null
  const model = deps.resolveEmbeddingModel(configContextId)
  return model === null ? null : embeddingVersionOf(model, queryEmbedding.length)
}

/** @public -- consumed by the recall tool (Plan 2 T5). */
export async function runRecallCascade(
  input: RunRecallCascadeInput,
  deps: RunRecallCascadeDeps = defaultDeps,
): Promise<{ records: readonly RecallHit[] }> {
  const limit = input.limit ?? RECALL_DEFAULT_LIMIT
  const scope = resolveMemoryScope({ storageContextId: input.storageContextId, contextType: input.contextType })
  const queryEmbedding = await deps.getEmbedding(input.query, input.configContextId)
  const statuses: readonly MemoryStatus[] = input.includeStale === true ? ['active', 'stale'] : ['active']
  const context: ChannelContext = {
    scope,
    query: input.query,
    queryEmbedding,
    embeddingVersion: queryEmbeddingVersion(queryEmbedding, input.configContextId, deps),
    kind: input.kind,
    limit,
  }

  if (input.contextType === 'dm') {
    return { records: dedupe(tag(search(context, statuses), 'group'), limit) }
  }

  const layer1 = search(context, ['provisional'], { threadContextId: input.storageContextId })
  const layer2 = search(context, statuses)
  const combined: RecallHit[] = [...tag(layer1, 'current'), ...tag(layer2, 'group')]

  if (dedupe(combined, limit).length < limit) {
    const siblings = search(context, ['provisional'], { excludeThreadContextId: input.storageContextId })
    for (const record of siblings) deps.schedulePromotion(record, scope)
    combined.push(...tag(siblings, 'other-thread'))
  }

  return { records: dedupe(combined, limit) }
}
```

- [ ] **Step 6: Delete the dead scorer**

```bash
git rm src/long-term-memory/recall-ranking.ts tests/long-term-memory/recall-ranking.test.ts
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `bun test tests/long-term-memory tests/tools/memory.test.ts && bun typecheck`
Expected: PASS. `tests/long-term-memory/recall-cascade.test.ts` will need updating: its deps object now needs `resolveEmbeddingModel`, and any record it expects a semantic hit for now needs an `embeddingVersion` matching what `resolveEmbeddingModel` returns. Add `resolveEmbeddingModel: () => 'model-a'` to the test deps and seed records with `embeddingVersion: 'model-a:<vector length>'`.

- [ ] **Step 8: Commit**

```bash
git add -A src/long-term-memory tests/long-term-memory
git commit -m "feat(memory): fuse lexical and dense channels in the recall cascade"
```

---

### Task 8: Stamp embedding identity on write

**Files:**
- Modify: `src/long-term-memory/embedding-writer.ts`
- Modify: `src/long-term-memory/capture.ts:130`
- Test: `tests/long-term-memory/embedding-writer.test.ts` (existing — extend)

**Interfaces:**
- Consumes: `embeddingVersionOf`, `resolveEmbeddingModel` (Task 6).
- Produces: `EmbeddingWriterDeps` gains `resolveEmbeddingModel: (configContextId: string) => string | null` and `now: () => string`; `saveMemoryRecordWithEmbedding`'s third parameter becomes `Partial<EmbeddingWriterDeps>` so partial overrides compile.

- [ ] **Step 1: Write the failing test**

Append to `tests/long-term-memory/embedding-writer.test.ts`, inside the existing `describe`:

```ts
  test('stamps model, dimension, version and timestamp alongside the vector', async () => {
    await setupTestDb()

    await saveMemoryRecordWithEmbedding(memoryRecordInput({ id: 'rec-1' }), 'cfg-1', {
      getEmbedding: async () => [0.1, 0.2, 0.3],
      resolveEmbeddingModel: () => 'model-a',
      now: () => '2026-07-15T12:00:00.000Z',
    })

    const row = getDrizzleDb().select().from(memoryRecords).where(eq(memoryRecords.id, 'rec-1')).get()
    expect(row?.embeddingModel).toBe('model-a')
    expect(row?.embeddingDimension).toBe(3)
    expect(row?.embeddingVersion).toBe('model-a:3')
    expect(row?.embeddedAt).toBe('2026-07-15T12:00:00.000Z')
  })

  test('leaves identity null when the model cannot be resolved', async () => {
    await setupTestDb()

    await saveMemoryRecordWithEmbedding(memoryRecordInput({ id: 'rec-2' }), 'cfg-1', {
      getEmbedding: async () => [0.1, 0.2, 0.3],
      resolveEmbeddingModel: () => null,
    })

    const row = getDrizzleDb().select().from(memoryRecords).where(eq(memoryRecords.id, 'rec-2')).get()
    expect(row?.embedding).toBeNull()
    expect(row?.embeddingVersion).toBeNull()
  })
```

Add whatever imports the file is missing (`getDrizzleDb`, `memoryRecords`, `eq`).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/embedding-writer.test.ts`
Expected: FAIL — `resolveEmbeddingModel` is not a property of `EmbeddingWriterDeps`.

- [ ] **Step 3: Rewrite the writer**

Replace `src/long-term-memory/embedding-writer.ts` below the header with:

```ts
import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import { getEmbeddingForContext } from '../embeddings.js'
import { logger } from '../logger.js'
import { embeddingVersionOf, resolveEmbeddingModel } from './embedding-identity.js'
import { saveMemoryRecord } from './store.js'
import type { MemoryRecord, MemoryRecordInput } from './types.js'

const log = logger.child({ scope: 'memory:embedding-writer' })

export type EmbeddingWriterDeps = Readonly<{
  getEmbedding: (text: string, configContextId: string) => Promise<number[] | null>
  resolveEmbeddingModel: (configContextId: string) => string | null
  now: () => string
}>

const defaultDeps: EmbeddingWriterDeps = {
  getEmbedding: (text, configContextId) =>
    getEmbeddingForContext(text, configContextId, {
      storageContextId: configContextId,
      contextType: 'group',
      chatUserId: configContextId,
    }),
  resolveEmbeddingModel,
  now: () => new Date().toISOString(),
}

const persistEmbedding = (recordId: string, embedding: number[], model: string, now: string): void => {
  getDrizzleDb()
    .update(memoryRecords)
    .set({
      embedding: Buffer.from(new Float32Array(embedding).buffer),
      embeddingModel: model,
      embeddingDimension: embedding.length,
      embeddingVersion: embeddingVersionOf(model, embedding.length),
      embeddedAt: now,
    })
    .where(eq(memoryRecords.id, recordId))
    .run()
}

/**
 * Save a record, then compute + persist its embedding with its identity metadata.
 * Awaits embedding completion (so the promotion clustering in Plan 2 can rely on it)
 * but never throws on embed failure — an unembedded record stays lexically retrievable.
 * @public -- consumed by the memory capture executor (Plan 1 T7).
 */
export async function saveMemoryRecordWithEmbedding(
  input: MemoryRecordInput,
  configContextId: string,
  overrides: Partial<EmbeddingWriterDeps> = {},
): Promise<MemoryRecord> {
  const deps: EmbeddingWriterDeps = { ...defaultDeps, ...overrides }
  const saved = saveMemoryRecord(input)
  try {
    const model = deps.resolveEmbeddingModel(configContextId)
    if (model === null) {
      log.warn({ recordId: saved.id }, 'No embedding model for context; record stays lexical-only')
      return saved
    }
    const embedding = await deps.getEmbedding(input.content, configContextId)
    if (embedding !== null) persistEmbedding(saved.id, embedding, model, deps.now())
  } catch (error) {
    log.warn(
      { recordId: saved.id, error: error instanceof Error ? error.message : String(error) },
      'Embedding failed; FTS fallback',
    )
  }
  return saved
}
```

`capture.ts:130` already passes `{ getEmbedding: deps.getEmbedding }`, which now type-checks against `Partial<EmbeddingWriterDeps>` unchanged. Verify it compiles; no edit should be needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/long-term-memory/embedding-writer.test.ts tests/long-term-memory/capture.test.ts && bun typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/embedding-writer.ts tests/long-term-memory/embedding-writer.test.ts
git commit -m "feat(memory): record embedding identity on every write"
```

---

### Task 9: Post-boot embedding backfill

**Files:**
- Create: `src/long-term-memory/embedding-backfill.ts`
- Modify: `src/long-term-memory/extraction-state.ts`
- Modify: `src/scheduler-instance.ts`
- Test: `tests/long-term-memory/embedding-backfill.test.ts`

**Interfaces:**
- Consumes: `embeddingVersionOf`, `resolveEmbeddingModel`, `UNKNOWN_EMBEDDING_VERSION` (Task 6); `resolveMemoryScope` (`src/long-term-memory/scope.ts`).
- Produces:
  - `listContextConfigBindings(): readonly MemoryExtractionStateRow[]` in `extraction-state.ts`
  - `runEmbeddingBackfill(overrides?: Partial<BackfillDeps>): Promise<BackfillResult>` where `BackfillResult = { embedded: number; skipped: number }`
  - Scheduler task name `'memory-embedding-backfill'`

**Why the extraction-state table:** `memory_records` stores a *memory scope*, not a config context. `memory_extraction_state` is the only table that maps a chat context to its `configContextId`, and `resolveMemoryScope` converts a chat context into the same scope key `memory_records` uses. Records in a scope with no binding cannot have their credentials resolved and are counted as skipped — they stay lexically retrievable.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/embedding-backfill.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryExtractionState, memoryRecords } from '../../src/db/schema.js'
import { runEmbeddingBackfill } from '../../src/long-term-memory/embedding-backfill.js'
import { saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const record = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'dm-ctx-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'needs an embedding',
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

const bindContext = (): void => {
  getDrizzleDb()
    .insert(memoryExtractionState)
    .values({
      contextId: 'dm-ctx-1',
      contextType: 'dm',
      configContextId: 'cfg-1',
      lastActivityAt: '2026-07-01T00:00:00.000Z',
      lastHistoryLen: 1,
    })
    .run()
}

const rowById = (id: string) => getDrizzleDb().select().from(memoryRecords).where(eq(memoryRecords.id, id)).get()

const workingDeps = {
  getEmbedding: async () => [0.1, 0.2, 0.3],
  resolveEmbeddingModel: () => 'model-a',
  now: () => '2026-07-15T12:00:00.000Z',
}

describe('runEmbeddingBackfill', () => {
  beforeEach(async () => {
    await setupTestDb()
    bindContext()
  })

  test('embeds and stamps a record that has no vector', async () => {
    saveMemoryRecord(record({ id: 'rec-1' }))

    const result = await runEmbeddingBackfill(workingDeps)

    expect(result.embedded).toBe(1)
    expect(rowById('rec-1')?.embeddingVersion).toBe('model-a:3')
    expect(rowById('rec-1')?.embeddedAt).toBe('2026-07-15T12:00:00.000Z')
  })

  test('re-embeds a record stamped unknown by the migration', async () => {
    saveMemoryRecord(record({ id: 'rec-legacy', embedding: new Float32Array([9, 9]) }))
    getDrizzleDb()
      .update(memoryRecords)
      .set({ embeddingVersion: 'unknown' })
      .where(eq(memoryRecords.id, 'rec-legacy'))
      .run()

    const result = await runEmbeddingBackfill(workingDeps)

    expect(result.embedded).toBe(1)
    expect(rowById('rec-legacy')?.embeddingVersion).toBe('model-a:3')
  })

  test('leaves an already-compatible record alone', async () => {
    saveMemoryRecord(record({ id: 'rec-ok', embedding: new Float32Array([1, 2, 3]) }))
    getDrizzleDb()
      .update(memoryRecords)
      .set({ embeddingVersion: 'model-a:3' })
      .where(eq(memoryRecords.id, 'rec-ok'))
      .run()

    const result = await runEmbeddingBackfill(workingDeps)

    expect(result.embedded).toBe(0)
  })

  test('skips a scope with no config-context binding', async () => {
    saveMemoryRecord(record({ id: 'orphan', scopeId: 'unbound-scope' }))

    const result = await runEmbeddingBackfill(workingDeps)

    expect(result.embedded).toBe(0)
    expect(result.skipped).toBe(1)
    expect(rowById('orphan')?.embeddingVersion).toBeNull()
  })

  test('skips a context whose credentials do not resolve, without throwing', async () => {
    saveMemoryRecord(record({ id: 'rec-1' }))

    const result = await runEmbeddingBackfill({ ...workingDeps, resolveEmbeddingModel: () => null })

    expect(result.embedded).toBe(0)
    expect(result.skipped).toBe(1)
  })

  test('checkpoints per row: a mid-sweep failure leaves earlier rows embedded', async () => {
    saveMemoryRecord(record({ id: 'rec-a' }))
    saveMemoryRecord(record({ id: 'rec-b' }))

    const result = await runEmbeddingBackfill({
      ...workingDeps,
      concurrency: 1,
      getEmbedding: async (text: string, _configContextId: string) =>
        text === 'boom' ? Promise.reject(new Error('provider down')) : [0.1, 0.2, 0.3],
    })

    expect(result.embedded).toBe(2)
  })

  test('is resumable: a second run finds nothing left to do', async () => {
    saveMemoryRecord(record({ id: 'rec-1' }))

    await runEmbeddingBackfill(workingDeps)
    const second = await runEmbeddingBackfill(workingDeps)

    expect(second.embedded).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/embedding-backfill.test.ts`
Expected: FAIL — `Cannot find module '../../src/long-term-memory/embedding-backfill.js'`.

- [ ] **Step 3: Expose the context bindings**

Append to `src/long-term-memory/extraction-state.ts`:

```ts
/**
 * Every known chat-context to config-context binding. The backfill needs it
 * because memory records store a memory scope, not a config context.
 * @public -- consumed by the embedding backfill.
 */
export function listContextConfigBindings(): readonly MemoryExtractionStateRow[] {
  return getDrizzleDb().select().from(memoryExtractionState).all()
}
```

- [ ] **Step 4: Write the backfill job**

Create `src/long-term-memory/embedding-backfill.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, isNull, or, type SQL } from 'drizzle-orm'
import pLimit from 'p-limit'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import { getEmbeddingForContext } from '../embeddings.js'
import { logger } from '../logger.js'
import { embeddingVersionOf, resolveEmbeddingModel, UNKNOWN_EMBEDDING_VERSION } from './embedding-identity.js'
import { listContextConfigBindings } from './extraction-state.js'
import { resolveMemoryScope } from './scope.js'
import type { MemoryScopeType } from './types.js'

const log = logger.child({ scope: 'memory:embedding-backfill' })

export type BackfillDeps = Readonly<{
  getEmbedding: (text: string, configContextId: string) => Promise<number[] | null>
  resolveEmbeddingModel: (configContextId: string) => string | null
  now: () => string
  concurrency: number
  batchSize: number
}>

export type BackfillResult = Readonly<{ embedded: number; skipped: number }>

const defaultDeps: BackfillDeps = {
  getEmbedding: (text, configContextId) =>
    getEmbeddingForContext(text, configContextId, {
      storageContextId: configContextId,
      contextType: 'group',
      chatUserId: configContextId,
    }),
  resolveEmbeddingModel,
  now: () => new Date().toISOString(),
  concurrency: 4,
  batchSize: 500,
}

type PendingRow = { id: string; scopeId: string; scopeType: MemoryScopeType; content: string }

const scopeKey = (scopeType: string, scopeId: string): string => `${scopeType}:${scopeId}`

/** scope key -> config context id, derived from the chat contexts bound to each scope. */
const buildScopeConfigMap = (): ReadonlyMap<string, string> => {
  const map = new Map<string, string>()
  for (const binding of listContextConfigBindings()) {
    const scope = resolveMemoryScope({ storageContextId: binding.contextId, contextType: binding.contextType })
    if (!map.has(scopeKey(scope.scopeType, scope.scopeId))) {
      map.set(scopeKey(scope.scopeType, scope.scopeId), binding.configContextId)
    }
  }
  return map
}

const pendingCondition = (): SQL => {
  const condition = or(isNull(memoryRecords.embedding), eq(memoryRecords.embeddingVersion, UNKNOWN_EMBEDDING_VERSION))
  if (condition === undefined) throw new Error('embedding backfill produced an empty predicate')
  return condition
}

const loadPending = (batchSize: number): readonly PendingRow[] =>
  getDrizzleDb()
    .select({
      id: memoryRecords.id,
      scopeId: memoryRecords.scopeId,
      scopeType: memoryRecords.scopeType,
      content: memoryRecords.content,
    })
    .from(memoryRecords)
    .where(pendingCondition())
    .limit(batchSize)
    .all()

const groupByConfigContext = (
  rows: readonly PendingRow[],
  scopeConfig: ReadonlyMap<string, string>,
): { readonly groups: ReadonlyMap<string, readonly PendingRow[]>; readonly unbound: number } => {
  const groups = new Map<string, PendingRow[]>()
  let unbound = 0
  for (const row of rows) {
    const configContextId = scopeConfig.get(scopeKey(row.scopeType, row.scopeId))
    if (configContextId === undefined) {
      unbound += 1
      continue
    }
    const bucket = groups.get(configContextId)
    if (bucket === undefined) groups.set(configContextId, [row])
    else bucket.push(row)
  }
  return { groups, unbound }
}

// One row, one transaction: a crash mid-sweep leaves every earlier row done.
const checkpoint = (row: PendingRow, embedding: number[], model: string, now: string): void => {
  getDrizzleDb()
    .update(memoryRecords)
    .set({
      embedding: Buffer.from(new Float32Array(embedding).buffer),
      embeddingModel: model,
      embeddingDimension: embedding.length,
      embeddingVersion: embeddingVersionOf(model, embedding.length),
      embeddedAt: now,
    })
    .where(eq(memoryRecords.id, row.id))
    .run()
}

const backfillGroup = async (
  configContextId: string,
  rows: readonly PendingRow[],
  deps: BackfillDeps,
): Promise<BackfillResult> => {
  const model = deps.resolveEmbeddingModel(configContextId)
  if (model === null) {
    log.warn({ configContextId, pending: rows.length }, 'No embedding model; skipping context this sweep')
    return { embedded: 0, skipped: rows.length }
  }

  const limit = pLimit(deps.concurrency)
  const outcomes = await Promise.all(
    rows.map((row) =>
      limit(async (): Promise<boolean> => {
        try {
          const embedding = await deps.getEmbedding(row.content, configContextId)
          if (embedding === null) return false
          checkpoint(row, embedding, model, deps.now())
          return true
        } catch (error) {
          log.warn(
            { recordId: row.id, error: error instanceof Error ? error.message : String(error) },
            'Backfill embedding failed; record stays lexical-only',
          )
          return false
        }
      }),
    ),
  )

  const embedded = outcomes.filter(Boolean).length
  return { embedded, skipped: rows.length - embedded }
}

/**
 * Embeds and stamps records that have no vector or a pre-identity vector.
 * Grouped by config context so BYOK credentials resolve correctly, bounded by
 * p-limit, and checkpointed per row so a restart resumes rather than restarts.
 * Rows awaiting backfill stay fully retrievable through the lexical channel.
 * @public -- registered as a scheduler task.
 */
export async function runEmbeddingBackfill(overrides: Partial<BackfillDeps> = {}): Promise<BackfillResult> {
  const deps: BackfillDeps = { ...defaultDeps, ...overrides }
  const pending = loadPending(deps.batchSize)
  if (pending.length === 0) return { embedded: 0, skipped: 0 }

  const { groups, unbound } = groupByConfigContext(pending, buildScopeConfigMap())
  if (unbound > 0) log.warn({ unbound }, 'Records in scopes with no config-context binding; skipped')

  let embedded = 0
  let skipped = unbound
  for (const [configContextId, rows] of groups) {
    const result = await backfillGroup(configContextId, rows, deps)
    embedded += result.embedded
    skipped += result.skipped
  }

  log.info({ embedded, skipped, pending: pending.length }, 'Embedding backfill sweep complete')
  return { embedded, skipped }
}
```

Groups run sequentially so the sweep never fans out across every context at once; rows within a group run under `p-limit`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/long-term-memory/embedding-backfill.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Register the scheduler task**

In `src/scheduler-instance.ts`:

Add the import next to the other long-term-memory imports:

```ts
import { runEmbeddingBackfill } from './long-term-memory/embedding-backfill.js'
```

Add the task name to `DEFAULT_SCHEDULER_TASK_NAMES`, after `'memory-promotion-sweep',`:

```ts
  'memory-embedding-backfill',
```

Register it at the end of `registerImmediateDefaultTasks()`:

```ts
  scheduler.register('memory-embedding-backfill', {
    interval: 60 * 60 * 1000,
    handler: () => {
      void runEmbeddingBackfill()
    },
    options: { immediate: true },
  })
```

`immediate: true` is what makes the backfill eager after boot; the hourly repeat drains any remaining batches and is the resume path across restarts.

- [ ] **Step 7: Run the scheduler tests**

Run: `bun test tests/runtime tests/long-term-memory && bun typecheck`
Expected: PASS. If a test asserts the exact contents of `DEFAULT_SCHEDULER_TASK_NAMES`, add the new name to its expectation.

- [ ] **Step 8: Commit**

```bash
git add src/long-term-memory/embedding-backfill.ts src/long-term-memory/extraction-state.ts src/scheduler-instance.ts tests/long-term-memory/embedding-backfill.test.ts
git commit -m "feat(memory): post-boot embedding backfill grouped by config context"
```

---

### Task 10: Bilingual golden set and full gate run

**Files:**
- Test: `tests/long-term-memory/hybrid-retrieval.golden.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-9. Produces no new source.

One assertion per audited defect, so each stays fixed. This is the regression net named in the spec.

- [ ] **Step 1: Write the golden-set test**

Create `tests/long-term-memory/hybrid-retrieval.golden.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { runRecallCascade } from '../../src/long-term-memory/recall-cascade.js'
import { listMemoryRecords, saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-07-15T12:00:00.000Z'
const MODEL = 'model-a'
const QUERY_VECTOR = [1, 0, 0]
const VERSION = `${MODEL}:${QUERY_VECTOR.length}`

const deps = {
  getEmbedding: async () => QUERY_VECTOR,
  resolveEmbeddingModel: () => MODEL,
  schedulePromotion: () => {},
}

const record = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'dm-ctx-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'placeholder',
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

const recall = async (query: string): Promise<readonly string[]> => {
  const { records } = await runRecallCascade(
    { storageContextId: 'dm-ctx-1', configContextId: 'cfg-1', contextType: 'dm', query, limit: 8 },
    deps,
  )
  return records.map((r) => r.id)
}

describe('hybrid retrieval golden set', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  // Defect 1: the lexical tokenizer was [a-z0-9]+, so Cyrillic produced zero tokens.
  test('a Cyrillic query returns Cyrillic content', async () => {
    saveMemoryRecord(record({ id: 'ru', content: 'Маршруты доставки согласованы на вторник' }))
    saveMemoryRecord(record({ id: 'en', content: 'delivery routes agreed for Tuesday' }))

    expect(await recall('маршрут')).toContain('ru')
  })

  // Defect 2: expiresAt was never checked at query time.
  test('an expired but still-active record is neither recalled nor injected', async () => {
    saveMemoryRecord(record({ id: 'expired', content: 'маршрут отменён', expiresAt: '2026-07-01T00:00:00.000Z' }))

    expect(await recall('маршрут')).not.toContain('expired')
    expect(
      listMemoryRecords({ scopeId: 'dm-ctx-1', scopeType: 'personal', status: 'active', limit: 3, now: NOW }).map(
        (r) => r.id,
      ),
    ).not.toContain('expired')
  })

  // Defect 3: retrieval returned semantic hits OR lexical hits, never both, so an
  // unembedded record was invisible whenever any record cleared the 0.65 threshold.
  test('an unembedded record still surfaces when a semantic hit also exists', async () => {
    saveMemoryRecord(
      record({
        id: 'semantic',
        content: 'unrelated wording entirely',
        embedding: new Float32Array(QUERY_VECTOR),
        embeddingModel: MODEL,
        embeddingDimension: QUERY_VECTOR.length,
        embeddingVersion: VERSION,
      }),
    )
    saveMemoryRecord(record({ id: 'unembedded', content: 'маршрут доставки' }))

    const hits = await recall('маршрут')

    expect(hits).toContain('unembedded')
    expect(hits).toContain('semantic')
  })

  // Defect 4: no embedding version column, so an incompatible vector was
  // indistinguishable from a compatible one.
  test('an unknown-version record is excluded from dense but still found lexically', async () => {
    saveMemoryRecord(
      record({
        id: 'legacy',
        content: 'маршрут из старой базы',
        embedding: new Float32Array([1, 0, 0]),
        embeddingVersion: 'unknown',
      }),
    )

    // Reachable by its words...
    expect(await recall('маршрут')).toContain('legacy')
    // ...but not by vector alone: a query sharing no tokens finds nothing.
    expect(await recall('zzz')).not.toContain('legacy')
  })
})
```

- [ ] **Step 2: Run the golden set**

Run: `bun test tests/long-term-memory/hybrid-retrieval.golden.test.ts`
Expected: PASS, 4 tests. Every one of these fails on `master`; they pass because Tasks 1-9 landed.

- [ ] **Step 3: Run the full test suite**

Run: `bun test`
Expected: PASS. Any failure here is a real regression in a caller of the changed modules — fix the caller, do not weaken the test.

- [ ] **Step 4: Run every repo gate**

Run: `bun typecheck && bun lint && bun format:check && bun security`
Expected: all clean. `bun security` matters here specifically because the FTS `MATCH` builder is an injection-adjacent surface — the tokenizer's `[\p{L}\p{N}]+` class is what makes it safe.

- [ ] **Step 5: Commit**

```bash
git add tests/long-term-memory/hybrid-retrieval.golden.test.ts
git commit -m "test(memory): bilingual golden set guarding audit defects 1-4"
```

---

## Verification against the spec's success criteria

| Criterion | Where it is proven |
| --- | --- |
| A Cyrillic query against Cyrillic content returns relevant records | Task 10 assertion 1; Task 3 and Task 4 unit tests |
| No expired or out-of-validity record is returned or injected | Task 2 suite (five cases including both half-open boundaries); Task 10 assertion 2 |
| A record without a compatible embedding is retrievable lexically | Task 7 hybrid test; Task 10 assertions 3 and 4 |
| Model, dimension, and version recorded for every embedded record | Task 1 round-trip test; Task 8 writer test |
| Backfill completes per context and is resumable | Task 9 resumability and per-row-checkpoint tests |
| All repo gates pass, no existing test weakened | Task 10 Steps 3-4; every task that breaks an existing test says to update it deliberately |

## Known limitations carried forward

- **No stemming.** `"бежать"*` will not match `побежал`. Prefix matching covers suffix inflection only. Recorded, not fixed.
- **Ranking shifts on deploy.** There is no shadow mode in this slice. The golden set proves the defects are fixed; it is synthetic and does not prove real-world recall improved.
- **Dense-coverage gap during backfill.** Every pre-existing vector is `unknown` and therefore dense-ineligible until the sweep reaches it. This is deliberate — it is what prevents the invisible-record bug from recurring during migration.
- **Defects 5 (erasure) and 6 (query-aware injection) are out of scope** and belong to their own specs.
