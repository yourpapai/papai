<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Durable Memory Erasure (Audit Defect 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make memory forget and scope-clear durable — a forgotten record is unreachable by every channel, physically zeroed, and not silently re-learned; a scope clear wipes long-term memory, working memory, watermark, tombstones, and caches.

**Architecture:** `forget_memory` switches from soft-archive to a transactional purge that deletes the canonical row (FTS + embedding drop via existing triggers) and writes a content-hash **tombstone**. Background capture and extraction consult the tombstone to suppress recapture; explicit `remember` overrides and clears it. `clearMemoryScope` is extended to span the two scope-keying schemes and evict caches. `PRAGMA secure_delete=ON` removes freelist/WAL byte residue.

**Tech Stack:** Bun + `bun:sqlite`, Drizzle ORM, Zod v4, Vercel AI SDK `tool()`, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-07-24-memory-durable-erasure-design.md`

## Global Constraints

- Runtime **Bun**; strict TypeScript; **use `.js` extension in all import paths**.
- Every new file starts with the BUSL-1.1 license header (`.ts` uses the `//` comment style; `.md` uses the HTML-comment style). The pre-commit hook (`lint`, `typecheck`, `format:check`, `license-headers`) must pass on every commit.
- **Never add lint-disable or type-ignore comments.** Fix the underlying issue.
- Error extraction idiom: `error instanceof Error ? error.message : String(error)`.
- Logging is pino, metadata-first. **Never log memory content** — ids, scope ids, counts, booleans only. Do not log content hashes either; log counts.
- Do **not** modify `tests/utils/test-helpers.ts` — it is frozen byte-for-byte for story refactor qualification (`tests/CLAUDE.md`).
- `db.transaction((tx) => { ... })` is synchronous and idiomatic here (see `src/cache-db.ts:64`). Query builders used inside a transaction must use `tx`, not `getDrizzleDb()`.
- After edits under `src/`, an auto-reindex plugin keeps the code index fresh; no manual step needed.
- Run tests with `bun test <path>`. Run a single test with `bun test <path> -t "<name>"`.

---

## File Structure

**New files:**
- `src/db/migrations/069_memory_tombstones.ts` — additive migration: `memory_tombstones` table.
- `src/long-term-memory/tombstone.ts` — content normalization + hash, tombstone value builder, and non-transactional tombstone reads/writes used off the purge path.
- `tests/long-term-memory/tombstone.test.ts` — unit tests for hashing + tombstone store.
- `tests/long-term-memory/durable-erasure.golden.test.ts` — bilingual (EN+RU) end-to-end erasure golden set.
- `tests/db/secure-delete.test.ts` — asserts the production connection enables `secure_delete`.

**Modified files:**
- `src/db/index.ts` — import + register migration 069.
- `src/db/long-term-memory-schema.ts` — `memoryTombstones` table + row type.
- `src/db/schema.ts` — re-export `memoryTombstones` + type.
- `src/db/drizzle.ts` — `PRAGMA secure_delete=ON` on connection init.
- `src/long-term-memory/store.ts` — `purgeMemoryRecord`, extended `clearMemoryScope`, working-memory scope-key predicate.
- `src/long-term-memory/capture.ts` — drop tombstoned records before persisting.
- `src/long-term-memory/runner.ts` — drop tombstoned records before persisting.
- `src/tools/memory.ts` — `forget_memory` → purge; `remember_memory` clears matching tombstone.
- `src/debug/settings/memory-routes.ts` — forget route → purge; surface expanded clear counts.
- `tests/long-term-memory/store.test.ts` — purge + extended-clear unit tests.
- `tests/long-term-memory/capture.test.ts` — recapture-suppression test.
- `tests/long-term-memory/runner.test.ts` — recapture-suppression test.

---

## Task 1: Tombstone table (migration 069) + schema + secure_delete pragma

**Files:**
- Create: `src/db/migrations/069_memory_tombstones.ts`
- Modify: `src/db/index.ts` (import near line 81, register in array near line 184)
- Modify: `src/db/long-term-memory-schema.ts`
- Modify: `src/db/schema.ts:81-82`
- Modify: `src/db/drizzle.ts:22`
- Test: `tests/db/secure-delete.test.ts`

**Interfaces:**
- Produces: `memoryTombstones` Drizzle table (columns `scopeId`, `scopeType`, `contentHash`, `forgottenAt`; PK `(scopeType, scopeId, contentHash)`), `MemoryTombstoneRow` type, and `migration069MemoryTombstones`. Production `getDrizzleDb()` connections have `secure_delete=ON`.

- [ ] **Step 1: Write the failing test for the pragma**

Create `tests/db/secure-delete.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb, resetDrizzleDbForTesting } from '../../src/db/drizzle.js'

describe('drizzle connection pragmas', () => {
  const originalDbPath = process.env['DB_PATH']

  beforeEach(() => {
    resetDrizzleDbForTesting()
    process.env['DB_PATH'] = ':memory:'
  })

  afterEach(() => {
    resetDrizzleDbForTesting()
    if (originalDbPath === undefined) delete process.env['DB_PATH']
    else process.env['DB_PATH'] = originalDbPath
  })

  test('secure_delete is enabled on the connection', () => {
    const db = getDrizzleDb()
    const row = db.$client.query('PRAGMA secure_delete').get() as { secure_delete: number } | null
    expect(row?.secure_delete).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test tests/db/secure-delete.test.ts`
Expected: FAIL — `secure_delete` reads back `0`.

- [ ] **Step 3: Enable the pragma**

In `src/db/drizzle.ts`, add the pragma next to the existing ones (after line 22):

```typescript
    sqlite.run('PRAGMA journal_mode=WAL')
    sqlite.run('PRAGMA foreign_keys=ON')
    sqlite.run('PRAGMA secure_delete=ON')
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `bun test tests/db/secure-delete.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the migration**

Create `src/db/migrations/069_memory_tombstones.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:069' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS memory_tombstones (
      scope_id     TEXT NOT NULL,
      scope_type   TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      forgotten_at TEXT NOT NULL,
      PRIMARY KEY (scope_type, scope_id, content_hash)
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memory_tombstones_scope
      ON memory_tombstones(scope_type, scope_id)
  `)
  log.info('migration 069: memory_tombstones table created')
}

export const migration069MemoryTombstones: Migration = {
  id: '069_memory_tombstones',
  up,
}

export default migration069MemoryTombstones
```

- [ ] **Step 6: Register the migration**

In `src/db/index.ts`, add the import after line 81:

```typescript
import { migration069MemoryTombstones } from './migrations/069_memory_tombstones.js'
```

And add to the migrations array after `migration068MemoryEmbeddingIdentity,` (line 184):

```typescript
  migration068MemoryEmbeddingIdentity,
  migration069MemoryTombstones,
```

- [ ] **Step 7: Add the Drizzle table**

In `src/db/long-term-memory-schema.ts`, after the `memoryRecords` block (before line 69's type exports), add:

```typescript
export const memoryTombstones = sqliteTable(
  'memory_tombstones',
  {
    scopeId: text('scope_id').notNull(),
    scopeType: text('scope_type', { enum: ['personal', 'group'] }).notNull(),
    contentHash: text('content_hash').notNull(),
    forgottenAt: text('forgotten_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeType, table.scopeId, table.contentHash] }),
    index('idx_memory_tombstones_scope').on(table.scopeType, table.scopeId),
  ],
)
```

Then extend the type exports near line 69-70:

```typescript
export type MemoryProfileRow = typeof memoryProfiles.$inferSelect
export type MemoryRecordRow = typeof memoryRecords.$inferSelect
export type MemoryTombstoneRow = typeof memoryTombstones.$inferSelect
```

- [ ] **Step 8: Re-export from schema.ts**

In `src/db/schema.ts`, extend lines 81-82:

```typescript
export { memoryProfiles, memoryRecords, memoryExtractionState, memoryTombstones } from './long-term-memory-schema.js'
export type {
  MemoryProfileRow,
  MemoryRecordRow,
  MemoryExtractionStateRow,
  MemoryTombstoneRow,
} from './long-term-memory-schema.js'
```

- [ ] **Step 9: Verify the table migrates in tests**

Add to `tests/db/secure-delete.test.ts` a second describe (still no dependency on `setupTestDb` internals — use it to confirm the table exists):

```typescript
import { setupTestDb } from '../utils/test-helpers.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'

describe('memory_tombstones migration', () => {
  test('table exists after migrations', async () => {
    await setupTestDb()
    const cols = getDrizzleDb()
      .$client.query('PRAGMA table_info(memory_tombstones)')
      .all() as ReadonlyArray<{ name: string }>
    expect(cols.map((c) => c.name).sort()).toEqual(['content_hash', 'forgotten_at', 'scope_id', 'scope_type'])
  })
})
```

Run: `bun test tests/db/secure-delete.test.ts`
Expected: PASS (both describes).

> Note: `setupTestDb` connections do not carry `secure_delete` (it is a per-connection pragma and `test-helpers.ts` is frozen). That is acceptable — `secure_delete` governs physical byte residue, which is verified in isolation above; the logical-reachability tests below do not depend on it.

- [ ] **Step 10: Commit**

```bash
git add src/db/migrations/069_memory_tombstones.ts src/db/index.ts src/db/long-term-memory-schema.ts src/db/schema.ts src/db/drizzle.ts tests/db/secure-delete.test.ts
git commit -m "feat(memory): tombstone table + secure_delete pragma"
```

---

## Task 2: Content hash + tombstone store module

**Files:**
- Create: `src/long-term-memory/tombstone.ts`
- Test: `tests/long-term-memory/tombstone.test.ts`

**Interfaces:**
- Consumes: `memoryTombstones` (Task 1); `MemoryScope` from `./types.js`; `getDrizzleDb` from `../db/drizzle.js`.
- Produces:
  - `normalizeForHash(content: string): string`
  - `contentHash(content: string): string` (SHA-256 hex of normalized content)
  - `tombstoneValues(scope: MemoryScope, content: string, now: string): { scopeId: string; scopeType: MemoryScope['scopeType']; contentHash: string; forgottenAt: string }`
  - `insertTombstone(scope: MemoryScope, content: string, now: string): void`
  - `isContentTombstoned(scope: MemoryScope, content: string): boolean`
  - `deleteMatchingTombstone(scope: MemoryScope, content: string): void`

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/tombstone.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  contentHash,
  deleteMatchingTombstone,
  insertTombstone,
  isContentTombstoned,
  normalizeForHash,
} from '../../src/long-term-memory/tombstone.js'
import type { MemoryScope } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const scope: MemoryScope = { scopeId: 'user-1', scopeType: 'personal' }
const NOW = '2026-07-24T00:00:00.000Z'

describe('tombstone hashing', () => {
  test('normalization folds case and collapses whitespace', () => {
    expect(normalizeForHash('  Hello   World  ')).toBe('hello world')
  })

  test('case and whitespace variants hash equal (EN)', () => {
    expect(contentHash('User likes DARK  mode')).toBe(contentHash('user likes dark mode'))
  })

  test('case variants hash equal (RU)', () => {
    expect(contentHash('Пользователь любит ТЁМНУЮ тему')).toBe(contentHash('пользователь любит тёмную тему'))
  })

  test('different content hashes differ', () => {
    expect(contentHash('likes dark mode')).not.toBe(contentHash('likes light mode'))
  })
})

describe('tombstone store', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('insert then isContentTombstoned matches normalized variants', () => {
    insertTombstone(scope, 'User likes dark mode', NOW)
    expect(isContentTombstoned(scope, '  user LIKES dark mode ')).toBe(true)
    expect(isContentTombstoned(scope, 'user likes light mode')).toBe(false)
  })

  test('tombstones are scope-isolated', () => {
    insertTombstone(scope, 'secret', NOW)
    expect(isContentTombstoned({ scopeId: 'user-2', scopeType: 'personal' }, 'secret')).toBe(false)
    expect(isContentTombstoned({ scopeId: 'user-1', scopeType: 'group' }, 'secret')).toBe(false)
  })

  test('deleteMatchingTombstone removes it', () => {
    insertTombstone(scope, 'gone soon', NOW)
    deleteMatchingTombstone(scope, 'GONE  soon')
    expect(isContentTombstoned(scope, 'gone soon')).toBe(false)
  })

  test('duplicate insert does not throw', () => {
    insertTombstone(scope, 'dup', NOW)
    expect(() => insertTombstone(scope, 'dup', '2026-07-25T00:00:00.000Z')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test tests/long-term-memory/tombstone.test.ts`
Expected: FAIL — module `tombstone.js` not found.

- [ ] **Step 3: Implement the module**

Create `src/long-term-memory/tombstone.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryTombstones } from '../db/schema.js'
import type { MemoryScope } from './types.js'

/** Fold case and collapse internal whitespace so trivially-reworded content hashes identically. */
export const normalizeForHash = (content: string): string => content.trim().toLocaleLowerCase().replace(/\s+/gu, ' ')

/** SHA-256 (hex) of the normalized content. The tombstone stores only this — never the content itself. */
export const contentHash = (content: string): string =>
  createHash('sha256').update(normalizeForHash(content), 'utf8').digest('hex')

export const tombstoneValues = (
  scope: MemoryScope,
  content: string,
  now: string,
): { scopeId: string; scopeType: MemoryScope['scopeType']; contentHash: string; forgottenAt: string } => ({
  scopeId: scope.scopeId,
  scopeType: scope.scopeType,
  contentHash: contentHash(content),
  forgottenAt: now,
})

const scopeHashCondition = (scope: MemoryScope, hash: string) =>
  and(
    eq(memoryTombstones.scopeType, scope.scopeType),
    eq(memoryTombstones.scopeId, scope.scopeId),
    eq(memoryTombstones.contentHash, hash),
  )

export function insertTombstone(scope: MemoryScope, content: string, now: string): void {
  getDrizzleDb().insert(memoryTombstones).values(tombstoneValues(scope, content, now)).onConflictDoNothing().run()
}

export function isContentTombstoned(scope: MemoryScope, content: string): boolean {
  const row = getDrizzleDb()
    .select({ hash: memoryTombstones.contentHash })
    .from(memoryTombstones)
    .where(scopeHashCondition(scope, contentHash(content)))
    .get()
  return row !== undefined
}

export function deleteMatchingTombstone(scope: MemoryScope, content: string): void {
  getDrizzleDb().delete(memoryTombstones).where(scopeHashCondition(scope, contentHash(content))).run()
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `bun test tests/long-term-memory/tombstone.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/tombstone.ts tests/long-term-memory/tombstone.test.ts
git commit -m "feat(memory): content-hash tombstone store"
```

---

## Task 3: purgeMemoryRecord + wire forget_memory to purge

**Files:**
- Modify: `src/long-term-memory/store.ts`
- Modify: `src/tools/memory.ts:17-19` (imports), `:190`, `:206`
- Modify: `src/debug/settings/memory-routes.ts:10-11` (imports), `:186`
- Test: `tests/long-term-memory/store.test.ts`

**Interfaces:**
- Consumes: `tombstoneValues` (Task 2); `memoryTombstones` (Task 1); existing `recordScopeCondition`, `memoryRecords`.
- Produces: `purgeMemoryRecord(scope: MemoryScope, recordId: string, now: string): boolean` in `store.ts` — deletes the scoped row (FTS + embedding drop via triggers) and writes a tombstone, in one transaction; returns `false` if no row matched. `archiveMemoryRecord` is unchanged and stays (used by `promotion.ts`).

- [ ] **Step 1: Write the failing test**

Add to `tests/long-term-memory/store.test.ts` (import `purgeMemoryRecord` in the existing `store.js` import block, and add `memoryTombstones` to the `schema.js` import; add `sql` to the `drizzle-orm` import):

```typescript
describe('purgeMemoryRecord', () => {
  test('deletes the row, its FTS entry, and writes a tombstone', () => {
    saveMemoryRecord(memoryRecordInput({ id: 'mem-p1', content: 'User lives in Berlin' }))

    const purged = purgeMemoryRecord({ scopeId: 'user-1', scopeType: 'personal' }, 'mem-p1', '2026-07-24T00:00:00.000Z')
    expect(purged).toBe(true)

    const db = getDrizzleDb()
    // canonical row gone
    expect(db.select().from(memoryRecords).where(eq(memoryRecords.id, 'mem-p1')).get()).toBeUndefined()
    // FTS entry gone (raw MATCH probe)
    const ftsHits = db.$client
      .query("SELECT rowid FROM memory_records_fts WHERE memory_records_fts MATCH 'Berlin'")
      .all()
    expect(ftsHits.length).toBe(0)
    // tombstone written
    const tomb = db.select().from(memoryTombstones).where(eq(memoryTombstones.scopeId, 'user-1')).all()
    expect(tomb.length).toBe(1)
  })

  test('scope-guarded: wrong scope does not purge', () => {
    saveMemoryRecord(memoryRecordInput({ id: 'mem-p2', content: 'scoped' }))
    const purged = purgeMemoryRecord({ scopeId: 'other', scopeType: 'personal' }, 'mem-p2', '2026-07-24T00:00:00.000Z')
    expect(purged).toBe(false)
    expect(getDrizzleDb().select().from(memoryRecords).where(eq(memoryRecords.id, 'mem-p2')).get()).toBeDefined()
  })

  test('unknown id returns false and writes no tombstone', () => {
    const purged = purgeMemoryRecord({ scopeId: 'user-1', scopeType: 'personal' }, 'nope', '2026-07-24T00:00:00.000Z')
    expect(purged).toBe(false)
    expect(getDrizzleDb().select().from(memoryTombstones).all().length).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test tests/long-term-memory/store.test.ts -t purgeMemoryRecord`
Expected: FAIL — `purgeMemoryRecord` is not exported.

- [ ] **Step 3: Implement purgeMemoryRecord**

In `src/long-term-memory/store.ts`, add imports at the top:

```typescript
import { memoryProfiles, memoryRecords, memoryTombstones } from '../db/schema.js'
import { tombstoneValues } from './tombstone.js'
```

(The `memoryProfiles, memoryRecords` import already exists on line 9 — extend it to include `memoryTombstones`; add the `tombstoneValues` import next to the other `./` imports.)

Add the function after `archiveMemoryRecord` (after line 204):

```typescript
export function purgeMemoryRecord(scope: MemoryScope, recordId: string, now: string): boolean {
  const db = getDrizzleDb()
  return db.transaction((tx) => {
    const deleted = tx
      .delete(memoryRecords)
      .where(recordScopeCondition(scope, recordId))
      .returning({ content: memoryRecords.content })
      .all()
    const row = deleted[0]
    if (row === undefined) return false
    tx.insert(memoryTombstones).values(tombstoneValues(scope, row.content, now)).onConflictDoNothing().run()
    return true
  })
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `bun test tests/long-term-memory/store.test.ts -t purgeMemoryRecord`
Expected: PASS.

- [ ] **Step 5: Wire forget_memory (tool) to purge**

In `src/tools/memory.ts`, in the import block from `../long-term-memory/store.js` (lines 17-19 area) replace `archiveMemoryRecord` with `purgeMemoryRecord`. Then in `makeForgetMemoryTool`:

Replace line 190:

```typescript
        const purged = purgeMemoryRecord(scope, memoryId, now)
        log.info(
          { scopeId: scope.scopeId, scopeType: scope.scopeType, memoryId, purged },
          'Memory purge by ID requested via tool',
        )
        return purged ? { status: 'forgotten', id: memoryId } : { status: 'not_found' }
```

Replace line 206:

```typescript
      const purged = purgeMemoryRecord(scope, match.id, now)
      log.info(
        { scopeId: scope.scopeId, scopeType: scope.scopeType, memoryId: match.id, purged },
        'Memory purge by query requested via tool',
      )
      return purged ? { status: 'forgotten', id: match.id } : { status: 'not_found' }
```

- [ ] **Step 6: Wire forget route (settings) to purge**

In `src/debug/settings/memory-routes.ts`, replace `archiveMemoryRecord` with `purgeMemoryRecord` in the import block (lines 10-11), and update `handleRecordDelete` (line 186):

```typescript
  const purged = purgeMemoryRecord(memoryScope, decodedRecordId, new Date().toISOString())
  const status = purged ? 'forgotten' : 'not_found'
  log.info(
    { scopeId: memoryScope.scopeId, scopeType: memoryScope.scopeType, action: 'record.purge', status },
    'Settings memory record purge requested',
  )
  return settingsJson(200, { ok: true, status })
```

- [ ] **Step 7: Run the affected suites**

Run: `bun test tests/long-term-memory/store.test.ts tests/tools/memory.test.ts tests/debug/settings`
Expected: PASS. If a memory-routes or memory-tool test asserts the old `'archived'` status string, update that assertion to `'forgotten'` and re-run.

- [ ] **Step 8: Commit**

```bash
git add src/long-term-memory/store.ts src/tools/memory.ts src/debug/settings/memory-routes.ts tests/long-term-memory/store.test.ts
git commit -m "feat(memory): forget_memory purges and tombstones instead of archiving"
```

---

## Task 4: Recapture suppression (capture + runner) and explicit-remember override

**Files:**
- Modify: `src/long-term-memory/capture.ts:124-132`
- Modify: `src/long-term-memory/runner.ts:114-137`
- Modify: `src/tools/memory.ts` (`makeRememberMemoryTool`, after line 111)
- Test: `tests/long-term-memory/capture.test.ts`, `tests/long-term-memory/runner.test.ts`

**Interfaces:**
- Consumes: `isContentTombstoned`, `deleteMatchingTombstone` (Task 2).
- Produces: both background write paths drop records whose content is tombstoned in scope; explicit `remember_memory` deletes any matching tombstone after a successful save.

- [ ] **Step 1: Write the failing capture test**

Add to `tests/long-term-memory/capture.test.ts` (adapt to the file's existing `runMemoryCapture` invocation/deps helpers; import `insertTombstone` from `../../src/long-term-memory/tombstone.js`, `listMemoryRecords` from the store, and `resolveMemoryScope` from `../../src/long-term-memory/scope.js`):

```typescript
test('does not re-capture a tombstoned fact', async () => {
  const storageContextId = 'pi:inst:ctx:grp:thread:t1'
  const scope = resolveMemoryScope({ storageContextId, contextType: 'group' })
  insertTombstone(scope, 'The team ships on Fridays', '2026-07-24T00:00:00.000Z')

  await runMemoryCapture(
    { storageContextId, configContextId: 'pi:inst:ctx:grp', contextType: 'group', history: [] },
    {
      extractMemoryPatch: () =>
        Promise.resolve({
          records: [
            {
              kind: 'fact',
              content: 'the team  SHIPS on fridays',
              summary: null,
              tags: [],
              confidence: 1,
              evidence: {},
            },
          ],
        }),
      getEmbedding: () => Promise.resolve([1, 0, 0]),
      now: () => '2026-07-24T01:00:00.000Z',
      randomUUID: () => 'mem-recap',
    },
  )

  const records = listMemoryRecords({ ...scope, statuses: ['active', 'provisional'] })
  expect(records.find((r) => r.id === 'mem-recap')).toBeUndefined()
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test tests/long-term-memory/capture.test.ts -t "tombstoned"`
Expected: FAIL — the record is captured despite the tombstone.

- [ ] **Step 3: Filter tombstoned records in capture**

In `src/long-term-memory/capture.ts`, add the import:

```typescript
import { isContentTombstoned } from './tombstone.js'
```

Replace the record build/save block (lines 124-132) with a filter before persistence:

```typescript
  const now = deps.now()
  const candidates = patch.records.filter((candidate) => !isContentTombstoned(scope, candidate.content))
  const suppressed = patch.records.length - candidates.length
  const records = candidates.map((candidate) =>
    buildRecord({ candidate, scope, storageContextId: input.storageContextId, now, id: deps.randomUUID() }),
  )
  await Promise.all(
    records.map((record) =>
      saveMemoryRecordWithEmbedding(record, input.configContextId, { getEmbedding: deps.getEmbedding }),
    ),
  )

  markExtracted(input.storageContextId, input.history.length, now)
  log.debug(
    { contextId: input.storageContextId, captured: records.length, suppressed },
    'Memory capture complete',
  )
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `bun test tests/long-term-memory/capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing runner test**

Add to `tests/long-term-memory/runner.test.ts` a case that seeds a tombstone for the scope and asserts a matching extracted record is not inserted. Mirror the file's existing `runMemoryExtraction` setup and deps; import `insertTombstone` from `../../src/long-term-memory/tombstone.js` and `listMemoryRecords` from the store. The extraction patch must yield a record whose content matches the tombstone (case/whitespace variant); after the run, assert `listMemoryRecords` for the scope contains no record with that content.

```typescript
test('background extraction skips tombstoned content', async () => {
  const scope = { scopeId: 'pi:inst:ctx:grp', scopeType: 'group' as const }
  insertTombstone(scope, 'Budget approved for Q3', '2026-07-24T00:00:00.000Z')

  await runMemoryExtraction(
    /* input for storageContextId 'pi:inst:ctx:grp:thread:t1', configContextId 'pi:inst:ctx:grp', group */,
    {
      /* deps: extractMemoryPatch resolves { records: [{ kind:'fact', content:'budget  APPROVED for q3', summary:null, tags:[], confidence:1, evidence:{} }], updates: [] },
         now/randomUUID/getEmbedding/resolveLlmConfig as the existing runner tests provide */
    },
  )

  const records = listMemoryRecords({ ...scope, statuses: ['active'] })
  expect(records.some((r) => r.content.toLowerCase().includes('budget approved'))).toBe(false)
})
```

> Fill the `input`/`deps` comment placeholders using the concrete shapes already used by the other tests in `runner.test.ts` (do not invent new signatures — copy the existing test's construction).

- [ ] **Step 6: Run it to confirm it fails**

Run: `bun test tests/long-term-memory/runner.test.ts -t "tombstoned"`
Expected: FAIL — the extracted record is inserted.

- [ ] **Step 7: Filter tombstoned records in the runner**

In `src/long-term-memory/runner.ts`, add the import:

```typescript
import { isContentTombstoned } from './tombstone.js'
```

Update `insertRecords` (line 114) to skip tombstoned content:

```typescript
const insertRecords = (scope: MemoryScope, patch: MemoryPatch, deps: RunMemoryExtractionDeps): number => {
  const now = deps.now()
  return patch.records.reduce((count, record) => {
    if (isContentTombstoned(scope, record.content)) return count
    saveMemoryRecord({
      id: deps.randomUUID(),
      ...scope,
      kind: record.kind,
      content: record.content,
      summary: record.summary,
      tags: record.tags,
      confidence: record.confidence,
      status: 'active',
      source: 'background',
      evidence: record.evidence,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      validFrom: canonicalIsoOrNull(record.validFrom),
      validUntil: canonicalIsoOrNull(record.validUntil),
      expiresAt: canonicalIsoOrNull(record.expiresAt),
    })
    return count + 1
  }, 0)
}
```

- [ ] **Step 8: Run it to confirm it passes**

Run: `bun test tests/long-term-memory/runner.test.ts`
Expected: PASS.

- [ ] **Step 9: Make explicit remember clear the tombstone**

In `src/tools/memory.ts`, import `deleteMatchingTombstone` from `../long-term-memory/tombstone.js`. In `makeRememberMemoryTool.execute`, after `saveMemoryRecord(...)` returns `record` (after line 111, before the `log.info`):

```typescript
      deleteMatchingTombstone(scope, content)
```

- [ ] **Step 10: Write the failing remember-override test**

Add to `tests/tools/memory.test.ts` (using `getToolExecutor` as the file already does):

```typescript
test('explicit remember clears a matching tombstone', async () => {
  // context wiring identical to the other remember tests in this file
  const scope = { scopeId: /* the tool's resolved scopeId */ '', scopeType: 'personal' as const }
  insertTombstone(scope, 'Call me Alex', '2026-07-24T00:00:00.000Z')
  const exec = getToolExecutor(makeRememberMemoryTool(context))
  await exec({ content: 'Call me Alex', kind: 'preference' })
  expect(isContentTombstoned(scope, 'Call me Alex')).toBe(false)
})
```

> Use the same `context` construction and resolved scope the other remember tests in `tests/tools/memory.test.ts` already use; import `insertTombstone`/`isContentTombstoned` from `../../src/long-term-memory/tombstone.js`.

- [ ] **Step 11: Run it to confirm it passes**

Run: `bun test tests/tools/memory.test.ts -t "clears a matching tombstone"`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/long-term-memory/capture.ts src/long-term-memory/runner.ts src/tools/memory.ts tests/long-term-memory/capture.test.ts tests/long-term-memory/runner.test.ts tests/tools/memory.test.ts
git commit -m "feat(memory): suppress recapture of forgotten content; explicit remember overrides"
```

---

## Task 5: Extended clearMemoryScope (working memory + watermark + tombstones + caches)

**Files:**
- Modify: `src/long-term-memory/store.ts` (`clearMemoryScope`, line 227; add imports)
- Modify: `src/debug/settings/memory-routes.ts:210-227` (surface new counts)
- Test: `tests/long-term-memory/store.test.ts`

**Interfaces:**
- Consumes: `getConfigContextIdFromStorageContextId` from `../chat/scoped-context.js`; `evictUser` from `../cache.js`; tables `conversationHistory`, `memorySummary`, `memoryFacts`, `memoryExtractionState`, `memoryTombstones`.
- Produces: `clearMemoryScope(scope: MemoryScope)` returning `{ profileDeleted: number; recordsDeleted: number; workingMemoryKeysCleared: number; extractionStateDeleted: number; tombstonesDeleted: number }`. Working memory is matched by scope-key predicate (personal: exact `scopeId`; group: `scopeId` + `scopeId:thread:*`). Caches for cleared keys are evicted after commit.

**Design notes for the implementer:**
- Long-term memory keys by `(scopeId, scopeType)`; working memory keys by storage-context id (`user_id` / `context_id`). A working-memory key belongs to the scope iff `getConfigContextIdFromStorageContextId(key) === scope.scopeId` — this holds for both personal DMs (key === scopeId, helper returns it unchanged) and group threads (helper maps each thread key to the main context id == scopeId).
- Efficient, precise predicate on a key column: `col = scopeId OR col LIKE <escaped scopeId>:thread:% ESCAPE '\'`. Escape LIKE metacharacters (`\`, `%`, `_`) in `scopeId` because scoped ids may contain `_`.
- Use `RETURNING` on each working-memory delete to learn exactly which keys were removed, then `evictUser(key)` for each **after** the transaction commits.

- [ ] **Step 1: Write the failing test**

Add to `tests/long-term-memory/store.test.ts` (import the working-memory tables from `schema.js`: `conversationHistory`, `memorySummary`, `memoryFacts`, `memoryExtractionState`, `memoryTombstones`; import `insertTombstone` from the tombstone module):

```typescript
describe('clearMemoryScope completeness', () => {
  test('group clear wipes long-term, working memory (incl. thread keys), watermark, tombstones', () => {
    const db = getDrizzleDb()
    const scopeId = 'pi:inst:ctx:grp'
    const threadKey = 'pi:inst:ctx:grp:thread:t1'

    saveMemoryRecord(memoryRecordInput({ id: 'g1', scopeId, scopeType: 'group', content: 'group fact' }))
    insertTombstone({ scopeId, scopeType: 'group' }, 'old forgotten', '2026-07-24T00:00:00.000Z')
    db.insert(conversationHistory).values({ userId: threadKey, messages: '[]' }).run()
    db.insert(memorySummary).values({ userId: threadKey, summary: 's', updatedAt: '2026-07-24T00:00:00.000Z' }).run()
    db.insert(memoryFacts)
      .values({ userId: threadKey, identifier: 'f1', title: 't', url: '', lastSeen: '2026-07-24T00:00:00.000Z' })
      .run()
    db.insert(memoryExtractionState)
      .values({
        contextId: threadKey,
        contextType: 'group',
        configContextId: scopeId,
        lastActivityAt: '2026-07-24T00:00:00.000Z',
        lastHistoryLen: 0,
      })
      .run()

    const counts = clearMemoryScope({ scopeId, scopeType: 'group' })

    expect(counts.recordsDeleted).toBe(1)
    expect(counts.tombstonesDeleted).toBe(1)
    expect(counts.extractionStateDeleted).toBe(1)
    expect(counts.workingMemoryKeysCleared).toBeGreaterThanOrEqual(1)
    expect(db.select().from(conversationHistory).where(eq(conversationHistory.userId, threadKey)).get()).toBeUndefined()
    expect(db.select().from(memorySummary).where(eq(memorySummary.userId, threadKey)).get()).toBeUndefined()
    expect(db.select().from(memoryFacts).where(eq(memoryFacts.userId, threadKey)).all().length).toBe(0)
    expect(db.select().from(memoryExtractionState).all().length).toBe(0)
    expect(db.select().from(memoryTombstones).all().length).toBe(0)
  })

  test('does not touch another scope sharing a key prefix', () => {
    const db = getDrizzleDb()
    db.insert(conversationHistory).values({ userId: 'pi:inst:ctx:grpX', messages: '[]' }).run()
    clearMemoryScope({ scopeId: 'pi:inst:ctx:grp', scopeType: 'group' })
    expect(
      db.select().from(conversationHistory).where(eq(conversationHistory.userId, 'pi:inst:ctx:grpX')).get(),
    ).toBeDefined()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun test tests/long-term-memory/store.test.ts -t "clearMemoryScope completeness"`
Expected: FAIL — new count fields undefined; working-memory rows survive.

- [ ] **Step 3: Implement the extended clear**

In `src/long-term-memory/store.ts`, add imports:

```typescript
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { evictUser } from '../cache.js'
import {
  conversationHistory,
  memoryFacts,
  memoryProfiles,
  memoryRecords,
  memorySummary,
  memoryExtractionState,
  memoryTombstones,
} from '../db/schema.js'
import { like, or } from 'drizzle-orm'
```

(Merge these into the existing `drizzle-orm` and `../db/schema.js` import lines rather than duplicating them; `and, desc, eq, inArray, sql, type SQL` are already imported.)

Add a scope-key predicate helper and rewrite `clearMemoryScope`:

```typescript
const escapeLike = (value: string): string => value.replace(/[\\%_]/gu, (ch) => `\\${ch}`)

const workingMemoryKeyMatch = (column: SQLiteColumn, scope: MemoryScope): SQL => {
  const condition = or(eq(column, scope.scopeId), like(column, `${escapeLike(scope.scopeId)}:thread:%`))
  if (condition === undefined) throw new Error('workingMemoryKeyMatch: or() produced no condition')
  return condition
}

export function clearMemoryScope(scope: MemoryScope): {
  profileDeleted: number
  recordsDeleted: number
  workingMemoryKeysCleared: number
  extractionStateDeleted: number
  tombstonesDeleted: number
} {
  const db = getDrizzleDb()
  const result = db.transaction((tx) => {
    const deletedRecords = tx
      .delete(memoryRecords)
      .where(and(eq(memoryRecords.scopeId, scope.scopeId), eq(memoryRecords.scopeType, scope.scopeType)))
      .returning({ id: memoryRecords.id })
      .all()
    const deletedProfiles = tx
      .delete(memoryProfiles)
      .where(profileScopeCondition(scope))
      .returning({ scopeId: memoryProfiles.scopeId })
      .all()
    const deletedTombstones = tx
      .delete(memoryTombstones)
      .where(and(eq(memoryTombstones.scopeId, scope.scopeId), eq(memoryTombstones.scopeType, scope.scopeType)))
      .returning({ scopeId: memoryTombstones.scopeId })
      .all()

    const clearedKeys = new Set<string>()
    for (const row of tx
      .delete(conversationHistory)
      .where(workingMemoryKeyMatch(conversationHistory.userId, scope))
      .returning({ key: conversationHistory.userId })
      .all())
      clearedKeys.add(row.key)
    for (const row of tx
      .delete(memorySummary)
      .where(workingMemoryKeyMatch(memorySummary.userId, scope))
      .returning({ key: memorySummary.userId })
      .all())
      clearedKeys.add(row.key)
    for (const row of tx
      .delete(memoryFacts)
      .where(workingMemoryKeyMatch(memoryFacts.userId, scope))
      .returning({ key: memoryFacts.userId })
      .all())
      clearedKeys.add(row.key)
    const deletedExtraction = tx
      .delete(memoryExtractionState)
      .where(workingMemoryKeyMatch(memoryExtractionState.contextId, scope))
      .returning({ key: memoryExtractionState.contextId })
      .all()

    return {
      profileDeleted: deletedProfiles.length,
      recordsDeleted: deletedRecords.length,
      tombstonesDeleted: deletedTombstones.length,
      extractionStateDeleted: deletedExtraction.length,
      clearedKeys: [...clearedKeys],
    }
  })

  for (const key of result.clearedKeys) evictUser(key)

  return {
    profileDeleted: result.profileDeleted,
    recordsDeleted: result.recordsDeleted,
    workingMemoryKeysCleared: result.clearedKeys.length,
    extractionStateDeleted: result.extractionStateDeleted,
    tombstonesDeleted: result.tombstonesDeleted,
  }
}
```

Add the `SQLiteColumn` type import at the top:

```typescript
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
```

> `workingMemoryKeyMatch` returns via an explicit `undefined` guard rather than a non-null assertion (`!`), because lint-disable comments are hook-blocked in this repo and a bare `!` trips `no-non-null-assertion`. Do not reintroduce either.

- [ ] **Step 4: Run it to confirm it passes**

Run: `bun test tests/long-term-memory/store.test.ts -t "clearMemoryScope"`
Expected: PASS. Also re-run the file's existing clear tests: `bun test tests/long-term-memory/store.test.ts` — the original `clearMemoryScope` tests still asserting `profileDeleted`/`recordsDeleted` remain valid (same field names).

- [ ] **Step 5: Surface new counts in the settings route**

In `src/debug/settings/memory-routes.ts`, update `handleClear` (lines 211-227) to log and return the expanded counts:

```typescript
  const counts = clearMemoryScope(memoryScope)
  log.info(
    {
      scopeId: memoryScope.scopeId,
      scopeType: memoryScope.scopeType,
      action: 'scope.clear',
      profileDeleted: counts.profileDeleted,
      recordsDeleted: counts.recordsDeleted,
      workingMemoryKeysCleared: counts.workingMemoryKeysCleared,
      extractionStateDeleted: counts.extractionStateDeleted,
      tombstonesDeleted: counts.tombstonesDeleted,
    },
    'Settings memory scope cleared',
  )
  return settingsJson(200, {
    ok: true,
    contextId: memoryScope.scopeId,
    scopeType: memoryScope.scopeType,
    profileDeleted: counts.profileDeleted,
    recordsDeleted: counts.recordsDeleted,
    workingMemoryKeysCleared: counts.workingMemoryKeysCleared,
    extractionStateDeleted: counts.extractionStateDeleted,
    tombstonesDeleted: counts.tombstonesDeleted,
  })
```

- [ ] **Step 6: Run the settings suite**

Run: `bun test tests/debug/settings`
Expected: PASS. If a clear-route test asserts the exact response body shape, extend it to include the new count fields.

- [ ] **Step 7: Commit**

```bash
git add src/long-term-memory/store.ts src/debug/settings/memory-routes.ts tests/long-term-memory/store.test.ts tests/debug/settings
git commit -m "feat(memory): scope clear wipes working memory, watermark, tombstones, caches"
```

---

## Task 6: Bilingual (EN+RU) durable-erasure golden set

**Files:**
- Create: `tests/long-term-memory/durable-erasure.golden.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-5. Mirrors the structure of `tests/long-term-memory/hybrid-retrieval.golden.test.ts` (deterministic embedding deps, `runRecallCascade`, `saveMemoryRecord`).

This task is the headline artifact: one end-to-end scenario per language proving a forgotten record is unreachable by **every** channel and not recaptured, matching how defects 1-4 shipped their golden set.

- [ ] **Step 1: Write the golden test**

Create `tests/long-term-memory/durable-erasure.golden.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryRecords } from '../../src/db/schema.js'
import { runRecallCascade, type RunRecallCascadeDeps } from '../../src/long-term-memory/recall-cascade.js'
import { lexicalSearch } from '../../src/long-term-memory/lexical-search.js'
import {
  listMemoryRecords,
  purgeMemoryRecord,
  saveMemoryRecord,
  searchMemoryRecords,
} from '../../src/long-term-memory/store.js'
import { isContentTombstoned } from '../../src/long-term-memory/tombstone.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const MODEL = 'model-a'
const VEC = [1, 0, 0]
const VERSION = `${MODEL}:${VEC.length}`
const scope = { scopeId: 'dm-ctx-1', scopeType: 'personal' as const }

const deps: RunRecallCascadeDeps = {
  getEmbedding: () => Promise.resolve(VEC),
  resolveEmbeddingModel: () => MODEL,
  schedulePromotion: () => undefined,
}

const record = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'seed',
  scopeId: scope.scopeId,
  scopeType: scope.scopeType,
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
  embedding: new Float32Array(VEC),
  embeddingModel: MODEL,
  embeddingDimension: VEC.length,
  embeddingVersion: VERSION,
  embeddedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

const recallIds = async (query: string): Promise<readonly string[]> => {
  const { records } = await runRecallCascade(
    { storageContextId: scope.scopeId, configContextId: 'cfg-1', contextType: 'dm', query, limit: 8 },
    deps,
  )
  return records.map((r) => r.id)
}

describe('durable erasure golden set', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  for (const lang of [
    { name: 'EN', id: 'en-1', content: 'User lives in Berlin', term: 'Berlin' },
    { name: 'RU', id: 'ru-1', content: 'Пользователь живёт в Берлине', term: 'Берлине' },
  ] as const) {
    test(`${lang.name}: purged record is unreachable by every channel`, async () => {
      saveMemoryRecord(record({ id: lang.id, content: lang.content }))

      // sanity: reachable before forget
      expect(await recallIds(lang.term)).toContain(lang.id)

      const purged = purgeMemoryRecord(scope, lang.id, '2026-07-24T00:00:00.000Z')
      expect(purged).toBe(true)

      // recall cascade (fusion of lexical + dense)
      expect(await recallIds(lang.term)).not.toContain(lang.id)
      // lexical channel
      expect((await lexicalSearch({ ...scope, query: lang.term, limit: 8 })).map((r) => r.id)).not.toContain(lang.id)
      // forget-by-query search
      expect(searchMemoryRecords({ ...scope, query: lang.term, includeStale: true }).map((r) => r.id)).not.toContain(
        lang.id,
      )
      // list under every status
      for (const status of ['active', 'stale', 'archived', 'contradicted', 'provisional'] as const) {
        expect(listMemoryRecords({ ...scope, status }).map((r) => r.id)).not.toContain(lang.id)
      }
      // canonical row + FTS gone
      expect(getDrizzleDb().select().from(memoryRecords).where(eq(memoryRecords.id, lang.id)).get()).toBeUndefined()
      // tombstone present -> recapture suppressed
      expect(isContentTombstoned(scope, lang.content)).toBe(true)
    })
  }
})
```

> Verify the exact export names/signatures of `lexicalSearch` (`src/long-term-memory/lexical-search.ts`) and `RunRecallCascadeDeps` against the source before running; if `lexicalSearch`'s filter shape differs, adapt the call to its real signature (do not change the source). Add the missing `eq` import from `drizzle-orm`.

- [ ] **Step 2: Run it to confirm it passes**

Run: `bun test tests/long-term-memory/durable-erasure.golden.test.ts`
Expected: PASS (EN + RU).

- [ ] **Step 3: Full memory suite regression**

Run: `bun test tests/long-term-memory tests/tools/memory.test.ts tests/db/secure-delete.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/long-term-memory/durable-erasure.golden.test.ts
git commit -m "test(memory): bilingual durable-erasure golden set"
```

---

## Task 7: Documentation + final verification

**Files:**
- Modify: `docs/architecture/tools.md` (memory bridge / erasure note) and/or the relevant behaviors doc, if either documents forget/clear semantics.

- [ ] **Step 1: Update docs**

Search for existing descriptions of forget/clear semantics:

Run: `grep -rn "forget_memory\|archives\|clearMemoryScope\|scope clear" docs/`

For each hit that describes the *old* archive semantics, update it to state that `forget_memory` now purges and tombstones, and scope-clear wipes working memory + watermark + tombstones + caches. If no doc currently describes it, add a short paragraph to `docs/architecture/tools.md` under the memory bridge section. Keep it factual and metadata-only.

- [ ] **Step 2: Run the full check gate**

Run: `bun run check` (lint + typecheck + format + license + tests as configured), or at minimum `bun test tests/long-term-memory tests/tools tests/db/secure-delete.test.ts tests/debug/settings`.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs(memory): document durable erasure semantics"
```

---

## Self-Review (completed during authoring)

**Spec coverage:**
- Tombstone table + no-content hash → Task 1, 2. ✓
- `secure_delete` pragma + isolated test → Task 1. ✓
- `forget_memory` → purge + tombstone (tool + settings route); `archiveMemoryRecord` retained for `promotion.ts` → Task 3. ✓
- Recapture suppression on **both** background paths (`capture.ts` + `runner.ts`); explicit remember overrides/clears → Task 4. ✓
- `clearMemoryScope` spans long-term + working memory + watermark + tombstones + caches; scope-key reconciliation for personal & group (incl. thread keys) with LIKE-escape → Task 5. ✓
- Transactional atomicity for purge and clear → Tasks 3, 5. ✓
- Bilingual golden set proving unreachability across every channel → Task 6. ✓
- Non-goals (backups, semantic recapture, crash/race testing) left out by design; documented → Task 7 + spec. ✓

**Placeholder scan:** The two `runner.test.ts` / `memory.test.ts` steps that reference "the existing test's construction" are intentional — they point at concrete, already-present setups in those files rather than inventing signatures; every source-code step contains complete code.

**Type consistency:** `purgeMemoryRecord(scope, recordId, now): boolean`, `clearMemoryScope` return shape, and `tombstoneValues`/`isContentTombstoned`/`deleteMatchingTombstone`/`insertTombstone` signatures are used identically across tasks.
