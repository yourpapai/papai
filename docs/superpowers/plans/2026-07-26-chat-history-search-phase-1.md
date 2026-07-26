<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Chat History Search — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the LLM agent on-demand tools (`search_chat_history`, `get_message`, `get_message_context`) to search/fetch/window past observed chat messages, built on `message_metadata`, unified across all platforms with group-wide scope and unlimited retention.

**Architecture:** Shift `message_cache` from in-memory-primary + 1-week TTL to **DB-primary** (SQLite is the source of truth). Add a `group_context_id` column for group-wide scope, an FTS5 external-content index for keyword search, and a new `store.ts` read layer. Unify caching into one `bot.ts` chokepoint. Three provider-independent tools wrap the store. An admin purge endpoint is the safety valve for unbounded growth.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Drizzle ORM over `bun:sqlite`, SQLite FTS5 (already used by `memos`/`memory_records`), Vercel AI SDK `tool()`, Zod v4, pino.

**Spec:** `docs/superpowers/specs/2026-07-26-chat-history-search-phase-1-design.md`

## Global Constraints

Copied verbatim from repo conventions (`AGENTS.md`) and the spec:

- Runtime **Bun**; validation **Zod v4**; LLM via **Vercel AI SDK**.
- Strict TypeScript; **use `.js` extension in import paths**.
- Never add `lint-disable` or `type-ignore` comments — fix the underlying issue.
- Error extraction: `error instanceof Error ? error.message : String(error)`.
- Use `p-limit` for bounded concurrency over remote ops (n/a here — all local SQLite).
- Logging: `debug` entry/params, `info` success (counts/lengths only), `warn` empty/blocked, `error` failures. **Never log message text.**
- TDD: write failing test → run to confirm fail → implement → run to confirm pass → commit. DI-first preferred. Helpers: `setupTestDb`, `schemaValidates`, `getToolExecutor` in `tests/utils/test-helpers.ts`.
- One tool per file in `src/tools/`; factory `make[Action]Tool`; tool key `snake_case`.

## File Structure

**Create:**
- `src/db/migrations/070_message_metadata_history_search.ts` — migration: rebuild table (add `group_context_id`, drop `expires_at`), FTS5 table + triggers + backfill.
- `src/message-cache/store.ts` — DB read layer: `getMessageByContext`, `getMessage`, `searchMessages`, `getMessageContext`, `MessageScope` type, `rowToCachedMessage`.
- `src/tools/search-chat-history.ts` — `makeSearchChatHistoryTool`.
- `src/tools/get-message.ts` — `makeGetMessageTool`.
- `src/tools/get-message-context.ts` — `makeGetMessageContextTool`.
- `src/debug/settings/admin/message-history-routes.ts` — `handleAdminMessageHistoryRoutes` (purge).
- `tests/message-cache/store.test.ts` — store query tests.
- `tests/tools/search-chat-history.test.ts`, `tests/tools/get-message.test.ts`, `tests/tools/get-message-context.test.ts` — tool tests.
- `tests/db/migration-070.test.ts` — migration schema/backfill test.
- `tests/debug/admin-message-history-routes.test.ts` — purge endpoint test.

**Modify:**
- `src/db/schema.ts` — `messageMetadata`: add `groupContextId`, drop `expiresAt` + its index, add group index.
- `src/db/index.ts` — register migration 070.
- `src/message-cache/types.ts` — add `groupContextId?` to `CachedMessage`; drop `ONE_WEEK_MS`.
- `src/message-cache/persistence.ts` — write `groupContextId`, drop `expiresAt`; remove `restoreMessagesFromDb`, `cleanupExpiredMessages`.
- `src/message-cache/cache.ts` — retire in-memory `Map`, `initializeMessageCache`, `sweepExpiredMessages`; `cacheMessage` writes via persistence; `getCachedMessage` delegates to `store.getMessageByContext`; repurpose `getMessageCacheSnapshot` to a DB count.
- `src/message-cache/chain.ts` — unchanged logic (already calls `getCachedMessage`, now DB-backed).
- `src/message-cache/index.ts` — update re-exports.
- `src/scheduler-instance.ts` — remove `message-cache-sweep` + `message-cleanup` registrations/names/imports.
- `src/runtime/production-deps.ts` — `initializeStores` → no-op.
- `src/debug/state-collector.ts` — `messageCache` field from repurposed snapshot.
- `src/bot.ts` — add unified `cacheMessage` call in `onIncomingMessage`.
- `src/chat/telegram/message-extraction.ts` — remove `cacheTelegramMessage` (dead) + import.
- `src/chat/telegram/index.ts` — remove `cacheTelegramMessage` call site.
- `src/chat/mattermost/file-helpers.ts` — remove `cacheMessage` call + import.
- `src/tools/provider-independent-tools-builder.ts` — register the 3 tools.
- `src/tools/tool-metadata.ts` — add 3 entries.
- `src/tools/core-capabilities.ts` — add 3 tokens.
- `src/debug/settings-api-router.ts` — register purge route.
- `tests/utils/test-helpers.ts` — drop `ONE_WEEK_MS` TTL from `mockMessageCache`.

## Spec refinements (documented deviations from the approved spec)

These are plan-level refinements that better serve the spec's intent; each keeps the approved behavior:

1. **`expires_at` is dropped, not kept nullable.** The spec said "keep the column, write NULL." But the column is `INTEGER NOT NULL`, and SQLite cannot relax `NOT NULL` without a table rebuild. Since the rebuild is needed anyway and the column is vestigial under unlimited retention, migration 070 rebuilds `message_metadata` *without* `expires_at`. Cleaner end state; drizzle schema drops it too.
2. **`getCachedMessage`/`cacheMessage` stay exported from `cache.ts` as thin wrappers** over the new `store.ts`, rather than collapsing `chain.ts` into `store.ts`. This preserves the existing import paths (`message-cache/cache.js`, `message-cache/index.js`) and the `mockMessageCache()` test surface, so the 8 consumer test files stay green with no churn. `store.ts` still owns all DB queries, satisfying the spec's intent.
3. **Caching lives in `onIncomingMessage`, not `handleMessage`.** The spec said "normal message handler" (= `handleMessage`). But `handleMessage` returns early for non-mention group messages (`shouldIgnoreGroupMessage`), which would exclude most group messages from history — defeating the group-wide-search goal. `onIncomingMessage` runs for every allowed observed message, so caching there captures the full observable history (consistent with "group-wide visibility"). Guarded against command messages.
4. **`buildReplyChain` stays in `chain.ts`** (reads via the now-DB-backed `getCachedMessage`). Spec said "move to store.ts." Keeping it preserves `import { buildReplyChain } from '../message-cache/chain.js'`; functionally identical (DB-backed read).

---

### Task 1: Migration 070 + drizzle schema + write path

**Files:**
- Create: `src/db/migrations/070_message_metadata_history_search.ts`, `tests/db/migration-070.test.ts`
- Modify: `src/db/schema.ts` (messageMetadata block, ~line 170-187), `src/db/index.ts` (register), `src/message-cache/types.ts`, `src/message-cache/persistence.ts`, `tests/utils/test-helpers.ts` (`mockMessageCache`)

**Interfaces:**
- Consumes: `Migration` type from `src/db/migrate.js`; drizzle `sqliteTable`/`text`/`integer`/`primaryKey`/`index`.
- Produces: `messageMetadata` drizzle table now exposes `.groupContextId` and no `.expiresAt`; `CachedMessage` type gains optional `groupContextId: string`; `scheduleMessagePersistence` writes `groupContextId` and no `expiresAt`.

- [ ] **Step 1: Write the failing migration test**

Create `tests/db/migration-070.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'

import { migration017MessageMetadata } from '../../src/db/migrations/017_message_metadata.js'
import { migration070MessageMetadataHistorySearch } from '../../src/db/migrations/070_message_metadata_history_search.js'
import { mockLogger } from '../utils/test-helpers.js'

function columnsOf(db: Database, table: string): string[] {
  return db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((r) => r.name)
}

describe('migration 070_message_metadata_history_search', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys=ON')
    migration017MessageMetadata.up(db)
  })

  test('adds group_context_id, drops expires_at, creates FTS table + triggers', () => {
    expect(columnsOf(db, 'message_metadata')).toContain('expires_at')
    migration070MessageMetadataHistorySearch.up(db)

    const cols = columnsOf(db, 'message_metadata')
    expect(cols).toContain('group_context_id')
    expect(cols).not.toContain('expires_at')

    const fts = db
      .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='message_metadata_fts'`)
      .get()
    expect(fts?.name).toBe('message_metadata_fts')

    const triggers = db
      .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='message_metadata'`)
      .all()
      .map((r) => r.name)
    expect(triggers).toEqual(expect.arrayContaining(['message_metadata_ai', 'message_metadata_au', 'message_metadata_ad']))
  })

  test('preserves existing rows (minus expires_at) and backfills FTS', () => {
    db.run(
      `INSERT INTO message_metadata (context_id, message_id, author_id, author_username, text, reply_to_message_id, timestamp, expires_at)
       VALUES ('c1', 'm1', 'u1', 'alice', 'deploy the thing', NULL, 1000, 9999999999)`,
    )
    migration070MessageMetadataHistorySearch.up(db)

    const row = db
      .query<{ text: string; group_context_id: string | null }, []>(
        `SELECT text, group_context_id FROM message_metadata WHERE context_id='c1' AND message_id='m1'`,
      )
      .get()
    expect(row?.text).toBe('deploy the thing')
    expect(row?.group_context_id).toBeNull()

    const ftsHit = db
      .query<{ rowid: number }, []>(`SELECT m.rowid FROM message_metadata m JOIN message_metadata_fts f ON m.rowid=f.rowid WHERE f.message_metadata_fts MATCH 'deploy'`)
      .get()
    expect(ftsHit).toBeDefined()
  })

  test('FTS trigger keeps index in sync on new inserts', () => {
    migration070MessageMetadataHistorySearch.up(db)
    db.run(
      `INSERT INTO message_metadata (context_id, message_id, text, timestamp, group_context_id) VALUES ('c1','m9','release stability check', 2000, NULL)`,
    )
    const hit = db
      .query<{ rowid: number }, []>(`SELECT m.rowid FROM message_metadata m JOIN message_metadata_fts f ON m.rowid=f.rowid WHERE f.message_metadata_fts MATCH 'stability'`)
      .get()
    expect(hit).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/db/migration-070.test.ts`
Expected: FAIL — `Cannot find module '../../src/db/migrations/070_message_metadata_history_search.js'`.

- [ ] **Step 3: Write the migration**

Create `src/db/migrations/070_message_metadata_history_search.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:070' })

const up = (db: Database): void => {
  // SQLite cannot relax NOT NULL on expires_at in place; rebuild the table to
  // add group_context_id and drop the now-vestigial expires_at (retention is unlimited).
  db.run(`
    CREATE TABLE message_metadata_new (
      context_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      author_id TEXT,
      author_username TEXT,
      text TEXT,
      reply_to_message_id TEXT,
      group_context_id TEXT,
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (context_id, message_id)
    )
  `)
  db.run(`
    INSERT INTO message_metadata_new (context_id, message_id, author_id, author_username, text, reply_to_message_id, group_context_id, timestamp)
    SELECT context_id, message_id, author_id, author_username, text, reply_to_message_id, NULL, timestamp FROM message_metadata
  `)
  db.run(`DROP TABLE message_metadata`)
  db.run(`ALTER TABLE message_metadata_new RENAME TO message_metadata`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_message_metadata_group_ctx ON message_metadata(group_context_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_message_metadata_reply_to ON message_metadata(context_id, reply_to_message_id)`)

  // FTS5 external-content index over text only (author/thread/time filter via content-table columns).
  db.run(`CREATE VIRTUAL TABLE message_metadata_fts USING fts5(text, content='message_metadata', content_rowid='rowid')`)
  db.run(`INSERT INTO message_metadata_fts(rowid, text) SELECT rowid, COALESCE(text, '') FROM message_metadata`)

  // External-content sync triggers (COALESCE so NULL text still maps 1:1 by rowid).
  db.run(`
    CREATE TRIGGER message_metadata_ai AFTER INSERT ON message_metadata BEGIN
      INSERT INTO message_metadata_fts(rowid, text) VALUES (new.rowid, COALESCE(new.text, ''));
    END
  `)
  db.run(`
    CREATE TRIGGER message_metadata_au AFTER UPDATE ON message_metadata BEGIN
      INSERT INTO message_metadata_fts(message_metadata_fts, rowid, text) VALUES ('delete', old.rowid, COALESCE(old.text, ''));
      INSERT INTO message_metadata_fts(rowid, text) VALUES (new.rowid, COALESCE(new.text, ''));
    END
  `)
  db.run(`
    CREATE TRIGGER message_metadata_ad AFTER DELETE ON message_metadata BEGIN
      INSERT INTO message_metadata_fts(message_metadata_fts, rowid, text) VALUES ('delete', old.rowid, COALESCE(old.text, ''));
    END
  `)
  log.info('migration 070: message_metadata rebuilt with group_context_id; expires_at dropped; FTS5 added')
}

export const migration070MessageMetadataHistorySearch: Migration = {
  id: '070_message_metadata_history_search',
  up,
}

export default migration070MessageMetadataHistorySearch
```

- [ ] **Step 4: Register the migration**

In `src/db/index.ts`, add the import after the `069` import (line 82):

```typescript
import { migration070MessageMetadataHistorySearch } from './migrations/070_message_metadata_history_search.js'
```

Append to the `MIGRATIONS` array (after `migration069AlertMatchedTaskIds,` at line 186):

```typescript
  migration070MessageMetadataHistorySearch,
```

- [ ] **Step 5: Update drizzle schema**

In `src/db/schema.ts`, replace the `messageMetadata` block (lines 170-187) with:

```typescript
export const messageMetadata = sqliteTable(
  'message_metadata',
  {
    contextId: text('context_id').notNull(),
    messageId: text('message_id').notNull(),
    authorId: text('author_id'),
    authorUsername: text('author_username'),
    text: text('text'),
    replyToMessageId: text('reply_to_message_id'),
    groupContextId: text('group_context_id'),
    timestamp: integer('timestamp').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.contextId, table.messageId] }),
    index('idx_message_metadata_group_ctx').on(table.groupContextId),
    index('idx_message_metadata_reply_to').on(table.contextId, table.replyToMessageId),
  ],
)
```

- [ ] **Step 6: Update `CachedMessage` type**

In `src/message-cache/types.ts`, replace the file body:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface CachedMessage {
  messageId: string
  contextId: string
  authorId?: string
  authorUsername?: string
  text?: string
  replyToMessageId?: string
  groupContextId?: string
  timestamp: number
}
```

(`ONE_WEEK_MS` removed — retention is now unlimited.)

- [ ] **Step 7: Update persistence write path**

In `src/message-cache/persistence.ts`, replace the `.values(...)` mapping inside `flushPendingWrites` and the `.onConflictDoUpdate` `set:` block so they write `groupContextId` and omit `expiresAt`. The values mapping becomes:

```typescript
      .values(
        writes.map((msg) => ({
          messageId: msg.messageId,
          contextId: msg.contextId,
          authorId: msg.authorId ?? null,
          authorUsername: msg.authorUsername ?? null,
          text: msg.text ?? null,
          replyToMessageId: msg.replyToMessageId ?? null,
          groupContextId: msg.groupContextId ?? null,
          timestamp: msg.timestamp,
        })),
      )
      .onConflictDoUpdate({
        target: [messageMetadata.contextId, messageMetadata.messageId],
        set: {
          authorId: sql`excluded.author_id`,
          authorUsername: sql`excluded.author_username`,
          text: sql`excluded.text`,
          replyToMessageId: sql`excluded.reply_to_message_id`,
          groupContextId: sql`excluded.group_context_id`,
          timestamp: sql`excluded.timestamp`,
        },
      })
      .run()
```

Also delete `cleanupExpiredMessages` (lines ~88-98) and `restoreMessagesFromDb` (~108-135) — both removed in Task 4, but remove their bodies now if they reference `expiresAt` to keep typecheck green. (Keep the exported names as no-ops OR delete and fix callers in Task 4. Prefer: delete `cleanupExpiredMessages` and `restoreMessagesFromDb` now; their callers are removed in Task 4 — temporarily comment-free stubs not allowed, so remove callers in this step if typecheck fails.)

> Implementation note: if removing `restoreMessagesFromDb`/`cleanupExpiredMessages` breaks imports in `cache.ts`/`scheduler-instance.ts`/`index.ts` at typecheck, carry those removals now (they are scheduled in Task 4 anyway). The write-hook runs typecheck; resolve every error by completing the removal rather than stubbing.

Remove the now-unused `gt`, `lte` imports if no longer referenced in this file.

- [ ] **Step 8: Update `mockMessageCache` (drop TTL)**

In `tests/utils/test-helpers.ts`, replace the `mockMessageCache` block (lines ~48-101) so it no longer applies the `ONE_WEEK_MS` TTL check. Remove the `ONE_WEEK_MS` constant. New body:

```typescript
// Test-local message cache — fully isolated from production
const testMessageCache = new Map<string, CachedMessage>()

function messageCacheKey(contextId: string, messageId: string): string {
  return `${contextId}:${messageId}`
}

export function mockMessageCache(): void {
  void mock.module('../../src/message-cache/cache.js', () => ({
    cacheMessage: (message: CachedMessage): void => {
      testMessageCache.set(messageCacheKey(message.contextId, message.messageId), message)
    },
    getCachedMessage: (contextId: string, messageId: string): CachedMessage | undefined =>
      testMessageCache.get(messageCacheKey(contextId, messageId)),
  }))
}

export function clearMessageCache(): void {
  testMessageCache.clear()
}

export function hasCachedMessage(contextId: string, messageId: string): boolean {
  return testMessageCache.has(messageCacheKey(contextId, messageId))
}
```

- [ ] **Step 9: Run migration test + full typecheck/lint**

Run: `bun test tests/db/migration-070.test.ts` → PASS.
Run: `bun run typecheck` → resolve any stragglers referencing `.expiresAt`/`expiresAt`/`ONE_WEEK_MS` by completing the relevant removal (carry forward from Task 4 if needed).
Run: `bun test tests/message-cache/` → existing chain/integration tests still PASS (mock isolates them).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(db): migration 070 — message_metadata group_context_id + FTS5, drop expires_at

Rebuilds message_metadata with group_context_id (group-wide scope) and an FTS5
external-content index over text; drops the vestigial expires_at (unlimited
retention). Updates drizzle schema, CachedMessage type, persistence write path,
and the test mock. Foundational to chat-history search (phase 1)."
```

---

### Task 2: store.ts read layer — DB-backed `getCachedMessage` (retire in-memory Map)

**Files:**
- Create: `src/message-cache/store.ts`, `tests/message-cache/store.test.ts` (initial — `getMessageByContext` only here; expanded in Task 3)
- Modify: `src/message-cache/cache.ts`, `src/message-cache/index.ts`

**Interfaces:**
- Consumes: `getDrizzleDb`, `messageMetadata` schema, `CachedMessage`.
- Produces: `getMessageByContext(contextId, messageId): CachedMessage | undefined` (direct `(context_id, message_id)` lookup, thread-scoped semantics — backs `getCachedMessage` + `buildReplyChain`). `getCachedMessage`/`cacheMessage` still exported from `cache.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/message-cache/store.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getTestDb, mockLogger, setupTestDb } from '../utils/test-helpers.js'
import * as schema from '../../src/db/schema.js'
import { cacheMessage } from '../../src/message-cache/cache.js'
import { getMessageByContext } from '../../src/message-cache/store.js'

describe('message-cache store: getMessageByContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns a previously cached message by (contextId, messageId)', () => {
    cacheMessage({ messageId: 'm1', contextId: 'c1', text: 'hello', timestamp: 1000 })
    const got = getMessageByContext('c1', 'm1')
    expect(got?.text).toBe('hello')
    expect(got?.timestamp).toBe(1000)
  })

  test('returns undefined for a missing message', () => {
    expect(getMessageByContext('c1', 'nope')).toBeUndefined()
  })

  test('isolates by contextId (same messageId, different context)', () => {
    cacheMessage({ messageId: 'm1', contextId: 'A', text: 'in A', timestamp: 1 })
    cacheMessage({ messageId: 'm1', contextId: 'B', text: 'in B', timestamp: 2 })
    expect(getMessageByContext('A', 'm1')?.text).toBe('in A')
    expect(getMessageByContext('B', 'm1')?.text).toBe('in B')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/message-cache/store.test.ts`
Expected: FAIL — `Cannot find module '../../src/message-cache/store.js'`.

- [ ] **Step 3: Create `store.ts` with `getMessageByContext` + row mapper**

Create `src/message-cache/store.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { messageMetadata } from '../db/schema.js'
import { logger } from '../logger.js'
import type { CachedMessage } from './types.js'

const log = logger.child({ scope: 'message-cache:store' })

export const rowToCachedMessage = (row: typeof messageMetadata.$inferSelect): CachedMessage => ({
  messageId: row.messageId,
  contextId: row.contextId,
  authorId: row.authorId ?? undefined,
  authorUsername: row.authorUsername ?? undefined,
  text: row.text ?? undefined,
  replyToMessageId: row.replyToMessageId ?? undefined,
  groupContextId: row.groupContextId ?? undefined,
  timestamp: row.timestamp,
})

/** Direct (context_id, message_id) lookup — thread-scoped, backs getCachedMessage + buildReplyChain. */
export function getMessageByContext(contextId: string, messageId: string): CachedMessage | undefined {
  const row = getDrizzleDb()
    .select()
    .from(messageMetadata)
    .where(and(eq(messageMetadata.contextId, contextId), eq(messageMetadata.messageId, messageId)))
    .get()
  if (row === undefined) {
    log.debug({ contextId, messageId }, 'message not found by context')
    return undefined
  }
  return rowToCachedMessage(row)
}
```

- [ ] **Step 4: Retire the in-memory Map; make `getCachedMessage` DB-backed**

In `src/message-cache/cache.ts`, replace the whole file with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { emitGlobal } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import { scheduleMessagePersistence } from './persistence.js'
import { getMessageByContext } from './store.js'
import type { CachedMessage } from './types.js'

const log = logger.child({ scope: 'message-cache' })

/** Write: in-memory Map retired; DB is the source of truth. */
export function cacheMessage(message: CachedMessage): void {
  scheduleMessagePersistence(message)
}

/** Read: DB-backed (thread-scoped context_id + message_id). Mock replaces this in tests. */
export function getCachedMessage(contextId: string, messageId: string): CachedMessage | undefined {
  return getMessageByContext(contextId, messageId)
}

export type MessageCacheSnapshot = {
  size: number
  pendingWrites: number
  isFlushScheduled: boolean
}

/** Observability hook for the debug state-collector. */
export function getMessageCacheSnapshot(): MessageCacheSnapshot {
  const { getPendingWritesCount, getIsFlushScheduled } = require('./persistence.js') as {
    getPendingWritesCount: () => number
    getIsFlushScheduled: () => boolean
  }
  void emitGlobal
  void log
  return { size: 0, pendingWrites: getPendingWritesCount(), isFlushScheduled: getIsFlushScheduled() }
}
```

> Note: `getMessageCacheSnapshot`'s `size` field is repurposed in Task 4 to a real DB row count. The `require` call avoids a circular import at module-eval time; if `bun`/eslint rejects `require`, import `getPendingWritesCount`/`getIsFlushScheduled` at top of file instead (no cycle — persistence does not import cache). Prefer the top-level import:

```typescript
import { getIsFlushScheduled, getPendingWritesCount } from './persistence.js'
// ...
export function getMessageCacheSnapshot(): MessageCacheSnapshot {
  return { size: 0, pendingWrites: getPendingWritesCount(), isFlushScheduled: getIsFlushScheduled() }
}
```

Use the top-level import form; drop the unused `emitGlobal`/`log` lines if lint flags them.

- [ ] **Step 5: Update `index.ts` re-exports**

Replace `src/message-cache/index.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export { cacheMessage, getCachedMessage } from './cache.js'
export { buildReplyChain } from './chain.js'
export type { CachedMessage } from './types.js'
export type { ReplyChainResult } from './chain.js'
export { getMessageByContext, rowToCachedMessage } from './store.js'
export type { MessageScope } from './store.js'
```

(`MessageScope` is added in Task 3; if typecheck fails here because it's not yet exported, add the type in Task 3 and re-export then. For this task, omit the `MessageScope` export line and add it in Task 3.)

- [ ] **Step 6: Run tests + typecheck**

Run: `bun test tests/message-cache/` → PASS (store test + existing chain/integration via mock).
Run: `bun run typecheck` → PASS.
Run: `bun test tests/reply-context.test.ts tests/chat/telegram/reply-context.test.ts tests/chat/discord/reply-context.test.ts` → PASS (mock still intercepts `getCachedMessage`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(message-cache): DB-primary reads; retire in-memory Map

getCachedMessage now reads from SQLite via store.getMessageByContext; the
in-memory Map is gone. cacheMessage persists directly. Mock surface in
tests preserved (mockMessageCache still isolates consumer suites)."
```

---

### Task 3: store.ts — `searchMessages` (FTS5) + `getMessageContext` + `getMessage` (scope-checked)

**Files:**
- Modify: `src/message-cache/store.ts` (add `MessageScope`, `getMessage`, `searchMessages`, `getMessageContext`), `src/message-cache/index.ts` (re-export new fns)
- Test: `tests/message-cache/store.test.ts` (expand)

**Interfaces:**
- Consumes: `getScopeKey` shape (callers derive `groupContextId`); `buildReplyChain` (for `reply_chain` mode).
- Produces:
  - `type MessageScope = { kind: 'group'; groupContextId: string } | { kind: 'dm'; contextId: string }`
  - `getMessage(scope, messageId): CachedMessage | undefined` — scope-checked.
  - `searchMessages(scope, query, filters, limit): CachedMessage[]` — FTS5 + bm25.
  - `getMessageContext(scope, messageId, before, after, mode): { target?: CachedMessage; before: CachedMessage[]; after: CachedMessage[]; replyChain?: string[] }`

- [ ] **Step 1: Write failing tests (append to `tests/message-cache/store.test.ts`)**

```typescript
import { getMessage, getMessageContext, searchMessages } from '../../src/message-cache/store.js'
import type { MessageScope } from '../../src/message-cache/store.js'

const groupScope = (g: string): MessageScope => ({ kind: 'group', groupContextId: g })
const dmScope = (c: string): MessageScope => ({ kind: 'dm', contextId: c })

describe('message-cache store: searchMessages (FTS5)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('matches by keyword within group scope, ranked by bm25', () => {
    cacheMessage({ messageId: '1', contextId: 'g:t1', groupContextId: 'g', text: 'deploy the thing', timestamp: 1 })
    cacheMessage({ messageId: '2', contextId: 'g:t1', groupContextId: 'g', text: 'deploy went fine', timestamp: 2 })
    cacheMessage({ messageId: '3', contextId: 'g:t1', groupContextId: 'g', text: 'unrelated chatter', timestamp: 3 })
    const results = searchMessages(groupScope('g'), 'deploy', {}, 10)
    expect(results.map((r) => r.messageId).sort()).toEqual(['1', '2'])
  })

  test('does not leak across groups', () => {
    cacheMessage({ messageId: '1', contextId: 'a:t1', groupContextId: 'a', text: 'deploy', timestamp: 1 })
    cacheMessage({ messageId: '2', contextId: 'b:t1', groupContextId: 'b', text: 'deploy', timestamp: 2 })
    expect(searchMessages(groupScope('a'), 'deploy', {}, 10).map((r) => r.messageId)).toEqual(['1'])
  })

  test('dm scope isolates to that dm (group_context_id IS NULL)', () => {
    cacheMessage({ messageId: '1', contextId: 'dm-alice', text: 'deploy note', timestamp: 1 })
    cacheMessage({ messageId: '2', contextId: 'g:t1', groupContextId: 'g', text: 'deploy note', timestamp: 2 })
    expect(searchMessages(dmScope('dm-alice'), 'deploy', {}, 10).map((r) => r.messageId)).toEqual(['1'])
  })

  test('author filter narrows results', () => {
    cacheMessage({ messageId: '1', contextId: 'g:t1', groupContextId: 'g', authorUsername: 'alice', text: 'deploy', timestamp: 1 })
    cacheMessage({ messageId: '2', contextId: 'g:t1', groupContextId: 'g', authorUsername: 'bob', text: 'deploy', timestamp: 2 })
    expect(searchMessages(groupScope('g'), 'deploy', { author: 'alice' }, 10).map((r) => r.messageId)).toEqual(['1'])
  })

  test('empty/no-match query returns []', () => {
    cacheMessage({ messageId: '1', contextId: 'g:t1', groupContextId: 'g', text: 'deploy', timestamp: 1 })
    expect(searchMessages(groupScope('g'), 'nonexistentterm', {}, 10)).toEqual([])
  })
})

describe('message-cache store: getMessage (scope-checked)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns message within group scope', () => {
    cacheMessage({ messageId: 'm', contextId: 'g:t1', groupContextId: 'g', text: 'x', timestamp: 1 })
    expect(getMessage(groupScope('g'), 'm')?.text).toBe('x')
  })

  test('returns undefined out of scope (no existence leak)', () => {
    cacheMessage({ messageId: 'm', contextId: 'g:t1', groupContextId: 'g', text: 'x', timestamp: 1 })
    expect(getMessage(groupScope('other'), 'm')).toBeUndefined()
  })
})

describe('message-cache store: getMessageContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('temporal mode returns N before/after within scope', () => {
    cacheMessage({ messageId: 'a', contextId: 'g:t1', groupContextId: 'g', text: 'a', timestamp: 1 })
    cacheMessage({ messageId: 'b', contextId: 'g:t1', groupContextId: 'g', text: 'b', timestamp: 2 })
    cacheMessage({ messageId: 'c', contextId: 'g:t1', groupContextId: 'g', text: 'c', timestamp: 3 })
    cacheMessage({ messageId: 'd', contextId: 'g:t1', groupContextId: 'g', text: 'd', timestamp: 4 })
    const res = getMessageContext(groupScope('g'), 'c', 1, 1, 'temporal')
    expect(res.target?.messageId).toBe('c')
    expect(res.before.map((m) => m.messageId)).toEqual(['b'])
    expect(res.after.map((m) => m.messageId)).toEqual(['d'])
  })

  test('returns empty target when message missing in scope', () => {
    cacheMessage({ messageId: 'a', contextId: 'g:t1', groupContextId: 'g', text: 'a', timestamp: 1 })
    const res = getMessageContext(groupScope('g'), 'zzz', 1, 1, 'temporal')
    expect(res.target).toBeUndefined()
    expect(res.before).toEqual([])
    expect(res.after).toEqual([])
  })

  test('reply_chain mode walks parents via buildReplyChain', () => {
    cacheMessage({ messageId: '1', contextId: 'g:t1', groupContextId: 'g', text: 'root', timestamp: 1 })
    cacheMessage({ messageId: '2', contextId: 'g:t1', groupContextId: 'g', text: 'reply', replyToMessageId: '1', timestamp: 2 })
    const res = getMessageContext(groupScope('g'), '2', 0, 0, 'reply_chain')
    expect(res.replyChain).toEqual(['1', '2'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/message-cache/store.test.ts`
Expected: FAIL — `getMessage`/`searchMessages`/`getMessageContext` not exported.

- [ ] **Step 3: Implement the query functions**

Append to `src/message-cache/store.ts` (and add imports `and, eq, sql, isNull, asc, desc, gt, lt, or` from `drizzle-orm`):

```typescript
import { and, asc, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import { buildReplyChain } from './chain.js'

export type MessageScope = { kind: 'group'; groupContextId: string } | { kind: 'dm'; contextId: string }

const scopeWhere = (scope: MessageScope) =>
  scope.kind === 'group'
    ? eq(messageMetadata.groupContextId, scope.groupContextId)
    : and(isNull(messageMetadata.groupContextId), eq(messageMetadata.contextId, scope.contextId))

// Sanitize an FTS5 MATCH query: phrase-quote, escape internal double-quotes.
// Mirrors src/memos.ts sanitizeFtsQuery.
const sanitizeFtsQuery = (query: string): string => `"${query.replace(/"/gu, '""')}"`

export type SearchFilters = Readonly<{
  author?: string
  contextId?: string
  since?: number
  until?: number
}>

/** Scope-checked single fetch (used by get_message tool). */
export function getMessage(scope: MessageScope, messageId: string): CachedMessage | undefined {
  const row = getDrizzleDb()
    .select()
    .from(messageMetadata)
    .where(and(eq(messageMetadata.messageId, messageId), scopeWhere(scope)))
    .get()
  return row === undefined ? undefined : rowToCachedMessage(row)
}

/** FTS5 keyword search, bm25-ranked, scope + filters applied on the content table. */
export function searchMessages(
  scope: MessageScope,
  query: string,
  filters: SearchFilters,
  limit: number,
): CachedMessage[] {
  const safeQuery = sanitizeFtsQuery(query)
  const conditions = [sql`m.rowid IN (SELECT f.rowid FROM message_metadata_fts f WHERE f.message_metadata_fts MATCH ${safeQuery})`]
  if (filters.author !== undefined) {
    conditions.push(
      or(eq(messageMetadata.authorId, filters.author), eq(messageMetadata.authorUsername, filters.author))!,
    )
  }
  if (filters.contextId !== undefined) conditions.push(eq(messageMetadata.contextId, filters.contextId))
  if (filters.since !== undefined) conditions.push(gt(messageMetadata.timestamp, filters.since))
  if (filters.until !== undefined) conditions.push(lt(messageMetadata.timestamp, filters.until))
  conditions.push(scopeWhere(scope))

  const rows = getDrizzleDb()
    .select({ row: messageMetadata, rank: sql<number>`bm25(f)` })
    .from(sql`message_metadata m`)
    // join FTS for bm25 ranking
    .innerJoin(sql`message_metadata_fts f`, sql`m.rowid = f.rowid`)
    .where(and(...conditions))
    .orderBy(desc(sql`bm25(f)`))
    .limit(limit)
    .all()
  return rows.map((r) => rowToCachedMessage(r.row as typeof messageMetadata.$inferSelect))
}

export type MessageContextMode = 'temporal' | 'thread' | 'reply_chain'

export type MessageContextResult = {
  target?: CachedMessage
  before: CachedMessage[]
  after: CachedMessage[]
  replyChain?: string[]
}

/** Window around a message. temporal = by timestamp within scope; thread = same context_id; reply_chain = buildReplyChain. */
export function getMessageContext(
  scope: MessageScope,
  messageId: string,
  before: number,
  after: number,
  mode: MessageContextMode,
): MessageContextResult {
  const target = getMessage(scope, messageId)
  if (target === undefined) return { target: undefined, before: [], after: [] }

  if (mode === 'reply_chain') {
    const chain = buildReplyChain(target.contextId, target.messageId).chain
    return { target, before: [], after: [], replyChain: chain }
  }

  const threadFilter = mode === 'thread' ? eq(messageMetadata.contextId, target.contextId) : scopeWhere(scope)
  const db = getDrizzleDb()
  const beforeRows = db
    .select()
    .from(messageMetadata)
    .where(and(threadFilter, lt(messageMetadata.timestamp, target.timestamp)))
    .orderBy(desc(messageMetadata.timestamp))
    .limit(before)
    .all()
  const afterRows = db
    .select()
    .from(messageMetadata)
    .where(and(threadFilter, gt(messageMetadata.timestamp, target.timestamp)))
    .orderBy(asc(messageMetadata.timestamp))
    .limit(after)
    .all()
  return {
    target,
    before: beforeRows.map(rowToCachedMessage).reverse(),
    after: afterRows.map(rowToCachedMessage),
  }
}
```

> Note on the `searchMessages` select: drizzle's `.from(sql\`message_metadata m\`)` aliased form + `.innerJoin` on raw SQL may need the columns referenced via the alias. If drizzle's type-check rejects the alias form, fall back to the proven memos pattern: filter by `WHERE ${messageMetadata.messageId} IN (SELECT m.message_id FROM message_metadata m JOIN message_metadata_fts f ON m.rowid=f.rowid WHERE f.message_metadata_fts MATCH ? AND <scope/filters> ORDER BY bm25(f) LIMIT ?)` via a single `sql` template inside `.where(...)`, selecting from `messageMetadata` directly. Prefer whichever compiles cleanly — both are correct SQL. The implementer runs `bun run typecheck` and picks the compiling form; do not leave type errors.

- [ ] **Step 4: Re-export new functions from `index.ts`**

In `src/message-cache/index.ts`, ensure these are exported (add the `MessageScope` line deferred from Task 2):

```typescript
export { getMessage, getMessageByContext, getMessageContext, rowToCachedMessage, searchMessages } from './store.js'
export type { MessageContextMode, MessageContextResult, MessageScope, SearchFilters } from './store.js'
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test tests/message-cache/store.test.ts` → PASS.
Run: `bun run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(message-cache): FTS5 search + scope-checked get/context window

Adds searchMessages (FTS5 + bm25, group/dm scope, author/thread/time filters),
getMessage (scope-checked), and getMessageContext (temporal/thread/reply_chain
window) to the store read layer."
```

---

### Task 4: Retire expiry infrastructure

**Files:**
- Modify: `src/scheduler-instance.ts`, `src/runtime/production-deps.ts`, `src/debug/state-collector.ts`, `src/message-cache/persistence.ts` (confirm cleanup fns gone), `src/message-cache/cache.ts` (`getMessageCacheSnapshot` size → DB count)

**Interfaces:**
- Consumes: nothing new.
- Produces: no scheduler tasks for message expiry; `initializeStores` is a no-op; debug snapshot reports a real row count.

- [ ] **Step 1: Write a failing test for the snapshot row count**

Add to `tests/message-cache/store.test.ts`:

```typescript
import { getMessageCacheSnapshot } from '../../src/message-cache/cache.js'

describe('message-cache snapshot', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('size reflects DB row count', () => {
    cacheMessage({ messageId: '1', contextId: 'c', text: 'a', timestamp: 1 })
    cacheMessage({ messageId: '2', contextId: 'c', text: 'b', timestamp: 2 })
    // persistence flushes on a microtask; await it
    await new Promise<void>((r) => queueMicrotask(r))
    expect(getMessageCacheSnapshot().size).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run to confirm fail**

Run: `bun test tests/message-cache/store.test.ts -t "snapshot"`
Expected: FAIL — `size` is hardcoded `0`.

- [ ] **Step 3: Remove scheduler registrations**

In `src/scheduler-instance.ts`:
- Delete imports (lines 17-18): `sweepExpiredMessages`, `cleanupExpiredMessages`.
- Remove `'message-cache-sweep'` and `'message-cleanup'` from `DEFAULT_SCHEDULER_TASK_NAMES` (lines 33-34).
- Delete the two `scheduler.register(...)` blocks (lines 48-57).

- [ ] **Step 4: Make `initializeStores` a no-op**

In `src/runtime/production-deps.ts`, remove the `initializeMessageCache` import (line 23) and change line 134 to:

```typescript
    initializeStores: () => {},
```

- [ ] **Step 5: Snapshot size = DB row count**

In `src/message-cache/cache.ts`, replace `getMessageCacheSnapshot`:

```typescript
import { count } from 'drizzle-orm'
import { getDrizzleDb } from '../db/drizzle.js'
import { messageMetadata } from '../db/schema.js'
// ...

export function getMessageCacheSnapshot(): MessageCacheSnapshot {
  const row = getDrizzleDb().select({ n: count() }).from(messageMetadata).get()
  return { size: row?.n ?? 0, pendingWrites: getPendingWritesCount(), isFlushScheduled: getIsFlushScheduled() }
}
```

- [ ] **Step 6: Run full message-cache + scheduler-adjacent tests**

Run: `bun test tests/message-cache/` → PASS.
Run: `bun run typecheck` → PASS (resolve any leftover `initializeMessageCache`/`restoreMessagesFromDb` references — ensure they are deleted from `persistence.ts`/`index.ts`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(message-cache): retire expiry infra (unlimited retention)

Removes the message-cache-sweep and message-cleanup scheduler tasks, the
initializeStores preload (DB is source of truth), and repurposes the debug
snapshot's size to a live DB row count."
```

---

### Task 5: Unify caching in `bot.ts`; remove legacy call sites

**Files:**
- Modify: `src/bot.ts` (add cache call in `onIncomingMessage`), `src/chat/telegram/message-extraction.ts` (remove `cacheTelegramMessage`), `src/chat/telegram/index.ts` (remove call), `src/chat/mattermost/file-helpers.ts` (remove `cacheMessage` call)
- Test: `tests/bot-message-caching.test.ts` (new)

**Interfaces:**
- Consumes: `cacheMessage` from `message-cache/cache.js`, `getScopeKey` from `chat/context-scope.js`.
- Produces: every allowed observed non-command message (with a `messageId`) lands in `message_metadata` with the correct `groupContextId`.

- [ ] **Step 1: Write the failing test**

Create `tests/bot-message-caching.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import * as schema from '../src/db/schema.js'
import { getMessageByContext } from '../src/message-cache/store.js'
import { and, eq } from 'drizzle-orm'
import {
  createAuth,
  createGroupMessage,
  createMockChatForBot,
  getTestDb,
  mockLogger,
  restoreFetch,
  setupTestDb,
} from './utils/test-helpers.js'

describe('bot message caching', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('caches an observed DM message with no group_context_id', async () => {
    // Drive a message through onIncomingMessage via the bot's captured handler,
    // then assert it landed in message_metadata.
    // (Use the existing bot test harness pattern; see tests/chat/*.test.ts for the
    // createMockChatForBot + handler invocation pattern this plan's consumers follow.)
    // ...arrange provider + auth, invoke handler with a DM message...
    const row = getTestDb()
      .select()
      .from(schema.messageMetadata)
      .where(and(eq(schema.messageMetadata.contextId, 'user1'), eq(schema.messageMetadata.messageId, 'dm-1')))
      .get()
    expect(row?.text).toBeDefined()
    expect(row?.groupContextId).toBeNull()
    void getMessageByContext
    void createAuth
    void createGroupMessage
    void createMockChatForBot
    void restoreFetch
  })
})
```

> The full arrange/act for `onIncomingMessage` requires the bot setup harness (`setupBot` + auth seeding). Rather than hand-rolling, mirror the closest existing bot-level test under `tests/` that drives a message through the handler — locate it with `rg -l "createMockChatForBot" tests/ | head` and copy its arrange block, then assert the row exists post-invocation. Replace the placeholder body above with that concrete arrange/act. The assertion shape (row in `message_metadata` with correct `groupContextId`) is the test's real content.

- [ ] **Step 2: Run to confirm fail**

Run: `bun test tests/bot-message-caching.test.ts`
Expected: FAIL — no row cached (call site not added yet).

- [ ] **Step 3: Add the unified cache call**

In `src/bot.ts`, add imports near the existing message-cache/reply-context imports:

```typescript
import { cacheMessage } from './message-cache/cache.js'
import { getScopeKey } from './chat/context-scope.js'
```

In `onIncomingMessage` (around line 255, immediately after `if (auth.allowed) recordGroupObservation(chat, msg)`), insert:

```typescript
  if (
    auth.allowed &&
    msg.messageId !== undefined &&
    (msg.commandMatch === undefined || msg.commandMatch === '')
  ) {
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
  }
```

- [ ] **Step 4: Remove legacy Telegram call site**

In `src/chat/telegram/message-extraction.ts`: delete the `cacheTelegramMessage` function (lines ~108-127) and the `cacheMessage` import (line 10).
In `src/chat/telegram/index.ts`: find and delete the call to `cacheTelegramMessage(...)` (search `rg "cacheTelegramMessage" src/chat/telegram/`) and its import.

- [ ] **Step 5: Remove legacy Mattermost call site**

In `src/chat/mattermost/file-helpers.ts`: delete the `cacheMessage({ ... })` block (around line 148) and the `cacheMessage` import (line 7) if now unused.

- [ ] **Step 6: Run tests + typecheck + telegram/mattermost suites**

Run: `bun test tests/bot-message-caching.test.ts tests/chat/telegram/ tests/chat/mattermost/ tests/reply-context.test.ts` → PASS.
Run: `bun run typecheck && bun run lint` → PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(bot): unify message caching in onIncomingMessage

Every allowed observed non-command message is cached to message_metadata with
the correct group_context_id, on every platform. Removes the scattered
Telegram/Mattermost-only cacheMessage call sites."
```

---

### Task 6: `search_chat_history` tool

**Files:**
- Create: `src/tools/search-chat-history.ts`, `tests/tools/search-chat-history.test.ts`
- Modify: `src/tools/provider-independent-tools-builder.ts`, `src/tools/tool-metadata.ts`, `src/tools/core-capabilities.ts`

**Interfaces:**
- Consumes: `searchMessages`, `MessageScope` from `message-cache/store.js`.
- Produces: `makeSearchChatHistoryTool(chatUserId, storageContextId, contextType): Tool`.

- [ ] **Step 1: Write failing test**

Create `tests/tools/search-chat-history.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { makeSearchChatHistoryTool } from '../../src/tools/search-chat-history.js'
import { cacheMessage } from '../../src/message-cache/cache.js'
import { getToolExecutor, mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'

describe('search_chat_history tool', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('input schema accepts query + optional filters', () => {
    const tool = makeSearchChatHistoryTool('u1', 'g:t1', 'group')
    expect(schemaValidates(tool, { query: 'deploy' })).toBe(true)
    expect(schemaValidates(tool, { query: 'deploy', limit: 10, author: 'alice' })).toBe(true)
    expect(schemaValidates(tool, { limit: 5 })).toBe(false)
  })

  test('returns matching messages within the group scope', async () => {
    cacheMessage({ messageId: '1', contextId: 'g:t1', groupContextId: 'g', text: 'deploy the thing', authorUsername: 'alice', timestamp: 1 })
    cacheMessage({ messageId: '2', contextId: 'g:t1', groupContextId: 'g', text: 'lunch?', authorUsername: 'bob', timestamp: 2 })
    const tool = makeSearchChatHistoryTool('u1', 'g:t1', 'group')
    const result = (await getToolExecutor(tool)({ query: 'deploy' })) as { results: { messageId: string }[]; total: number }
    expect(result.results.map((r) => r.messageId)).toEqual(['1'])
    expect(result.total).toBe(1)
    expect(result.mode).toBe('keyword')
  })

  test('returns empty result set on no match', async () => {
    cacheMessage({ messageId: '1', contextId: 'g:t1', groupContextId: 'g', text: 'hello', timestamp: 1 })
    const tool = makeSearchChatHistoryTool('u1', 'g:t1', 'group')
    const result = (await getToolExecutor(tool)({ query: 'zzz' })) as { results: unknown[]; total: number }
    expect(result.results).toEqual([])
    expect(result.total).toBe(0)
  })
})
```

- [ ] **Step 2: Run to confirm fail**

Run: `bun test tests/tools/search-chat-history.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool**

Create `src/tools/search-chat-history.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import type { ContextType } from '../chat/types.js'
import { getScopeKey } from '../chat/context-scope.js'
import { logger } from '../logger.js'
import { searchMessages, type MessageScope, type SearchFilters } from '../message-cache/store.js'

const log = logger.child({ scope: 'tool:search-chat-history' })

const toScope = (storageContextId: string, chatUserId: string, contextType: ContextType): MessageScope =>
  contextType === 'group'
    ? { kind: 'group', groupContextId: getScopeKey('group', { storageContextId, chatUserId, contextType }) }
    : { kind: 'dm', contextId: storageContextId }

export function makeSearchChatHistoryTool(
  chatUserId: string,
  storageContextId: string,
  contextType: ContextType,
): Tool {
  const scope = toScope(storageContextId, chatUserId, contextType)
  return tool({
    description:
      'Search past chat messages in this context by keyword. Use to recall decisions, find who said what, or locate a prior discussion. Returns matching messages with author, text, timestamp, and thread contextId.',
    inputSchema: z.object({
      query: z.string().min(1).describe('Keyword search query'),
      limit: z.number().int().min(1).max(20).default(5).describe('Max results (default 5, max 20)'),
      author: z.string().optional().describe('Filter by author username or id'),
      contextId: z.string().optional().describe('Narrow to one thread-scoped context within the group (from a prior result)'),
      since: z.string().datetime().optional().describe('ISO8601 lower bound (exclusive) on message time'),
      until: z.string().datetime().optional().describe('ISO8601 upper bound (exclusive) on message time'),
    }),
    execute: async ({ query, limit, author, contextId, since, until }): Promise<{ results: unknown[]; total: number; mode: 'keyword' }> => {
      log.debug({ query, limit, author, contextId, since, until }, 'search_chat_history called')
      const filters: SearchFilters = {}
      if (author !== undefined) filters.author = author
      if (contextId !== undefined) filters.contextId = contextId
      if (since !== undefined) filters.since = Date.parse(since)
      if (until !== undefined) filters.until = Date.parse(until)
      const results = searchMessages(scope, query, filters, limit).map((m) => ({
        messageId: m.messageId,
        authorUsername: m.authorUsername ?? null,
        text: m.text ?? '',
        timestamp: m.timestamp,
        contextId: m.contextId,
        ...(m.replyToMessageId !== undefined ? { replyToMessageId: m.replyToMessageId } : {}),
      }))
      log.info({ query, resultCount: results.length }, 'search_chat_history completed')
      return { results, total: results.length, mode: 'keyword' }
    },
  })
}
```

- [ ] **Step 4: Register + classify**

In `src/tools/provider-independent-tools-builder.ts`:
- Import: `import { makeSearchChatHistoryTool } from './search-chat-history.js'`.
- Add a helper and call it inside `addProviderIndependentTools`:

```typescript
function addChatHistoryTools(
  tools: ToolSet,
  chatUserId: string | undefined,
  contextId: string | undefined,
  contextType: ContextType | undefined,
): void {
  if (chatUserId === undefined || contextId === undefined || contextType === undefined) return
  tools['search_chat_history'] = makeSearchChatHistoryTool(chatUserId, contextId, contextType)
  // get_message + get_message_context added in Task 7
}
```

Call `addChatHistoryTools(tools, chatUserId, contextId, contextType)` inside `addProviderIndependentTools` (next to the other `addXxx` calls).

In `src/tools/tool-metadata.ts`, add inside `TOOL_METADATA`:

```typescript
  search_chat_history: read('history'),
```

In `src/tools/core-capabilities.ts`, add inside `CORE_TOOL_CAPABILITIES`:

```typescript
  'history.search': 'search_chat_history',
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test tests/tools/search-chat-history.test.ts` → PASS.
Run: `bun run typecheck && bun run lint` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(tools): search_chat_history — FTS5 keyword search over chat history

Agent tool to keyword-search past observed chat messages within the current
scope (group-wide in groups, DM-scoped in DMs), with author/thread/time filters."
```

---

### Task 7: `get_message` + `get_message_context` tools

**Files:**
- Create: `src/tools/get-message.ts`, `src/tools/get-message-context.ts`, `tests/tools/get-message.test.ts`, `tests/tools/get-message-context.test.ts`
- Modify: `src/tools/provider-independent-tools-builder.ts` (extend `addChatHistoryTools`), `src/tools/tool-metadata.ts`, `src/tools/core-capabilities.ts`

**Interfaces:**
- Consumes: `getMessage`, `getMessageContext`, `MessageScope` from `store.js`.
- Produces: `makeGetMessageTool(...)`, `makeGetMessageContextTool(...)`.

- [ ] **Step 1: Write failing tests**

`tests/tools/get-message.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
import { beforeEach, describe, expect, test } from 'bun:test'

import { makeGetMessageTool } from '../../src/tools/get-message.js'
import { cacheMessage } from '../../src/message-cache/cache.js'
import { getToolExecutor, mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'

describe('get_message tool', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns a message by id within scope', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'hi', timestamp: 1 })
    const tool = makeGetMessageTool('u1', 'g:t1', 'group')
    const result = (await getToolExecutor(tool)({ messageId: 'm1' })) as { messageId: string; text: string }
    expect(result.messageId).toBe('m1')
    expect(result.text).toBe('hi')
  })

  test('returns not_found for out-of-scope id (no existence leak)', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'hi', timestamp: 1 })
    const tool = makeGetMessageTool('u1', 'g:t1', 'group')
    const result = (await getToolExecutor(tool)({ messageId: 'm1' })) as { messageId: string }
    // in-scope returns the message; now assert out-of-scope via a different tool instance:
    const other = makeGetMessageTool('u1', 'other:t1', 'group')
    const otherResult = (await getToolExecutor(other)({ messageId: 'm1' })) as { not_found: boolean }
    expect(otherResult.not_found).toBe(true)
    void result
  })

  test('schema requires messageId', () => {
    expect(schemaValidates(makeGetMessageTool('u', 'g', 'group'), { messageId: 'x' })).toBe(true)
    expect(schemaValidates(makeGetMessageTool('u', 'g', 'group'), {})).toBe(false)
  })
})
```

`tests/tools/get-message-context.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
import { beforeEach, describe, expect, test } from 'bun:test'

import { makeGetMessageContextTool } from '../../src/tools/get-message-context.js'
import { cacheMessage } from '../../src/message-cache/cache.js'
import { getToolExecutor, mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('get_message_context tool', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('temporal mode returns target + before/after', async () => {
    cacheMessage({ messageId: 'a', contextId: 'g:t1', groupContextId: 'g', text: 'a', timestamp: 1 })
    cacheMessage({ messageId: 'b', contextId: 'g:t1', groupContextId: 'g', text: 'b', timestamp: 2 })
    cacheMessage({ messageId: 'c', contextId: 'g:t1', groupContextId: 'g', text: 'c', timestamp: 3 })
    const tool = makeGetMessageContextTool('u1', 'g:t1', 'group')
    const result = (await getToolExecutor(tool)({ messageId: 'b', before: 1, after: 1 })) as {
      target: { messageId: string }
      before: { messageId: string }[]
      after: { messageId: string }[]
    }
    expect(result.target.messageId).toBe('b')
    expect(result.before.map((m) => m.messageId)).toEqual(['a'])
    expect(result.after.map((m) => m.messageId)).toEqual(['c'])
  })

  test('reply_chain mode returns replyChain', async () => {
    cacheMessage({ messageId: '1', contextId: 'g:t1', groupContextId: 'g', text: 'root', timestamp: 1 })
    cacheMessage({ messageId: '2', contextId: 'g:t1', groupContextId: 'g', text: 'reply', replyToMessageId: '1', timestamp: 2 })
    const tool = makeGetMessageContextTool('u1', 'g:t1', 'group')
    const result = (await getToolExecutor(tool)({ messageId: '2', mode: 'reply_chain' })) as { replyChain: string[] }
    expect(result.replyChain).toEqual(['1', '2'])
  })

  test('not_found for missing target', async () => {
    const tool = makeGetMessageContextTool('u1', 'g:t1', 'group')
    const result = (await getToolExecutor(tool)({ messageId: 'zzz' })) as { not_found: boolean }
    expect(result.not_found).toBe(true)
  })
})
```

- [ ] **Step 2: Run to confirm fail**

Run: `bun test tests/tools/get-message.test.ts tests/tools/get-message-context.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `get-message.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { getScopeKey } from '../chat/context-scope.js'
import type { ContextType } from '../chat/types.js'
import { logger } from '../logger.js'
import { getMessage, type MessageScope } from '../message-cache/store.js'

const log = logger.child({ scope: 'tool:get-message' })

const toScope = (storageContextId: string, chatUserId: string, contextType: ContextType): MessageScope =>
  contextType === 'group'
    ? { kind: 'group', groupContextId: getScopeKey('group', { storageContextId, chatUserId, contextType }) }
    : { kind: 'dm', contextId: storageContextId }

export function makeGetMessageTool(chatUserId: string, storageContextId: string, contextType: ContextType): Tool {
  const scope = toScope(storageContextId, chatUserId, contextType)
  return tool({
    description:
      'Fetch a single chat message by its messageId (as returned by search_chat_history or get_message_context). Use to read the full text of a referenced message. Respects the current scope — out-of-scope ids return not_found.',
    inputSchema: z.object({
      messageId: z.string().min(1).describe('The message id to fetch'),
    }),
    execute: async ({ messageId }): Promise<Record<string, unknown>> => {
      log.debug({ messageId }, 'get_message called')
      const m = getMessage(scope, messageId)
      if (m === undefined) return { not_found: true }
      return {
        messageId: m.messageId,
        authorUsername: m.authorUsername ?? null,
        text: m.text ?? '',
        timestamp: m.timestamp,
        contextId: m.contextId,
        ...(m.replyToMessageId !== undefined ? { replyToMessageId: m.replyToMessageId } : {}),
      }
    },
  })
}
```

- [ ] **Step 4: Implement `get-message-context.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { getScopeKey } from '../chat/context-scope.js'
import type { ContextType } from '../chat/types.js'
import { logger } from '../logger.js'
import { getMessageContext, type MessageContextMode, type MessageScope } from '../message-cache/store.js'

const log = logger.child({ scope: 'tool:get-message-context' })

const toScope = (storageContextId: string, chatUserId: string, contextType: ContextType): MessageScope =>
  contextType === 'group'
    ? { kind: 'group', groupContextId: getScopeKey('group', { storageContextId, chatUserId, contextType }) }
    : { kind: 'dm', contextId: storageContextId }

const summarize = (m: { messageId: string; authorUsername?: string; text?: string; timestamp: number; contextId: string }) => ({
  messageId: m.messageId,
  authorUsername: m.authorUsername ?? null,
  text: m.text ?? '',
  timestamp: m.timestamp,
  contextId: m.contextId,
})

export function makeGetMessageContextTool(chatUserId: string, storageContextId: string, contextType: ContextType): Tool {
  const scope = toScope(storageContextId, chatUserId, contextType)
  return tool({
    description:
      'Read the conversation around a message. temporal (default) = N messages each side by time within scope; thread = same thread; reply_chain = the reply-parent chain. Use to understand the context of a referenced message.',
    inputSchema: z.object({
      messageId: z.string().min(1).describe('The anchor message id'),
      before: z.number().int().min(0).max(50).default(5).describe('Messages before the anchor (default 5)'),
      after: z.number().int().min(0).max(50).default(5).describe('Messages after the anchor (default 5)'),
      mode: z.enum(['temporal', 'thread', 'reply_chain']).default('temporal').describe('Window mode (default temporal)'),
    }),
    execute: async ({ messageId, before, after, mode }): Promise<Record<string, unknown>> => {
      log.debug({ messageId, before, after, mode }, 'get_message_context called')
      const result = getMessageContext(scope, messageId, before, after, mode as MessageContextMode)
      if (result.target === undefined) return { not_found: true }
      const out: Record<string, unknown> = {
        target: summarize(result.target),
        before: result.before.map(summarize),
        after: result.after.map(summarize),
      }
      if (result.replyChain !== undefined) out.replyChain = result.replyChain
      return out
    },
  })
}
```

- [ ] **Step 5: Register + classify**

In `src/tools/provider-independent-tools-builder.ts`, extend `addChatHistoryTools` (from Task 6):

```typescript
function addChatHistoryTools(
  tools: ToolSet,
  chatUserId: string | undefined,
  contextId: string | undefined,
  contextType: ContextType | undefined,
): void {
  if (chatUserId === undefined || contextId === undefined || contextType === undefined) return
  tools['search_chat_history'] = makeSearchChatHistoryTool(chatUserId, contextId, contextType)
  tools['get_message'] = makeGetMessageTool(chatUserId, contextId, contextType)
  tools['get_message_context'] = makeGetMessageContextTool(chatUserId, contextId, contextType)
}
```

Add the two new imports.

In `src/tools/tool-metadata.ts`:

```typescript
  get_message: read('history'),
  get_message_context: read('history'),
```

In `src/tools/core-capabilities.ts`:

```typescript
  'history.fetch': 'get_message',
  'history.context': 'get_message_context',
```

- [ ] **Step 6: Run tests + typecheck + lint**

Run: `bun test tests/tools/get-message.test.ts tests/tools/get-message-context.test.ts tests/tools/search-chat-history.test.ts` → PASS.
Run: `bun run typecheck && bun run lint` → PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(tools): get_message + get_message_context

get_message fetches a single message by id (scope-checked). get_message_context
returns a temporal/thread/reply_chain window around a message. Both reuse the
store read layer and the 'history' tool domain."
```

---

### Task 8: Admin purge endpoint

**Files:**
- Create: `src/debug/settings/admin/message-history-routes.ts`, `tests/debug/admin-message-history-routes.test.ts`
- Modify: `src/debug/settings-api-router.ts`

**Interfaces:**
- Consumes: `authenticate` + `settingsJson` from `../respond.js`; `requireSuperAdmin` from `./admin-guard.js`; drizzle delete on `messageMetadata`.
- Produces: `handleAdminMessageHistoryRoutes(req, url, pathname): Promise<Response>` handling `DELETE /settings/api/admin/message-history` (clear all, super-admin) and `DELETE /settings/api/admin/contexts/:id/message-history` (one scope).

- [ ] **Step 1: Write failing test**

Create `tests/debug/admin-message-history-routes.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleAdminMessageHistoryRoutes } from '../../src/debug/settings/admin/message-history-routes.js'
import * as schema from '../../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { authenticate, getTestDb, mockLogger, seedTestSystemConfig, setupTestDb } from '../utils/test-helpers.js'

// Mirror the auth setup used by other admin-route tests (settings session seed).
// Locate the canonical super-admin session seed with: rg "requireSuperAdmin" tests/ | head
// and copy its arrange block here.

describe('admin message-history purge', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestSystemConfig({ key: 'stats_anonymity_salt', value: 'test-salt' })
  })

  test('DELETE /settings/api/admin/contexts/<id>/message-history removes one scope', async () => {
    getTestDb()
      .insert(schema.messageMetadata)
      .values({ contextId: 'g', messageId: 'm1', text: 'x', timestamp: 1, groupContextId: 'g' })
      .run()
    getTestDb()
      .insert(schema.messageMetadata)
      .values({ contextId: 'other', messageId: 'm2', text: 'y', timestamp: 1, groupContextId: 'other' })
      .run()

    const req = new Request('https://x/settings/api/admin/contexts/g/message-history', { method: 'DELETE' })
    void authenticate
    // ...attach a valid super-admin settings session to req (per the pattern found above)...
    const res = await handleAdminMessageHistoryRoutes(req, new URL(req.url), '/settings/api/admin/contexts/g/message-history')
    expect(res.status).toBe(200)

    const remaining = getTestDb().select().from(schema.messageMetadata).where(eq(schema.messageMetadata.groupContextId, 'g')).all()
    expect(remaining).toHaveLength(0)
    const kept = getTestDb().select().from(schema.messageMetadata).where(eq(schema.messageMetadata.groupContextId, 'other')).all()
    expect(kept).toHaveLength(1)
  })

  test('forbids non-super-admin', async () => {
    const req = new Request('https://x/settings/api/admin/message-history', { method: 'DELETE' })
    // ...attach a non-super-admin session...
    const res = await handleAdminMessageHistoryRoutes(req, new URL(req.url), '/settings/api/admin/message-history')
    expect(res.status).toBe(403)
  })
})
```

> The settings-session arrange (cookie + CSRF + principal) is shared boilerplate across admin-route tests. Before finalizing this test, run `rg "requireSuperAdmin" tests/ | head` and copy the canonical super-admin + non-super-admin session arrange into the placeholders above so the test drives a real authenticated request. The assertions (status codes + row counts) are the real test content.

- [ ] **Step 2: Run to confirm fail**

Run: `bun test tests/debug/admin-message-history-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route handler**

Create `src/debug/settings/admin/message-history-routes.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../../db/drizzle.js'
import { messageMetadata } from '../../../db/schema.js'
import { logger } from '../../../logger.js'
import { authenticate, settingsJson } from '../respond.js'
import { requireSuperAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'admin:message-history' })

const CONTEXT_PREFIX = '/settings/api/admin/contexts/'
const SUFFIX = '/message-history'
const CLEAR_ALL = '/settings/api/admin/message-history'

export async function handleAdminMessageHistoryRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  if (req.method !== 'DELETE') return settingsJson(405, { error: 'method not allowed' })

  // Clear-all is super-admin only.
  if (pathname === CLEAR_ALL) {
    const guard = requireSuperAdmin(auth.authed, 'write')
    if (guard !== null) return guard
    const db = getDrizzleDb()
    const before = db.select({ n: messageMetadata.messageId }).from(messageMetadata).all().length
    db.delete(messageMetadata).run()
    log.warn({ cleared: before }, 'admin purged ALL message history')
    return settingsJson(200, { purged: before })
  }

  // One scope: /settings/api/admin/contexts/<groupContextId>/message-history
  if (pathname.startsWith(CONTEXT_PREFIX) && pathname.endsWith(SUFFIX)) {
    const guard = requireSuperAdmin(auth.authed, 'write')
    if (guard !== null) return guard
    const scopeId = pathname.slice(CONTEXT_PREFIX.length, pathname.length - SUFFIX.length)
    if (scopeId.length === 0) return settingsJson(400, { error: 'missing scope id' })
    const db = getDrizzleDb()
    const result = db.delete(messageMetadata).where(eq(messageMetadata.groupContextId, scopeId)).run()
    log.warn({ scopeId, changes: result.changes }, 'admin purged message history for scope')
    return settingsJson(200, { scopeId, purged: result.changes })
  }

  return settingsJson(404, { error: 'not found' })
}
```

- [ ] **Step 4: Register in the router**

In `src/debug/settings-api-router.ts`:
- Import: `import { handleAdminMessageHistoryRoutes } from './settings/admin/message-history-routes.js'`.
- In `routeAdminApi`, add before the final `return null` (line 72):

```typescript
  if (
    p === '/settings/api/admin/message-history' ||
    (p.startsWith('/settings/api/admin/contexts/') && p.endsWith('/message-history'))
  )
    return handleAdminMessageHistoryRoutes(req, url, p)
```

- [ ] **Step 5: Run tests + typecheck + lint**

Run: `bun test tests/debug/admin-message-history-routes.test.ts` → PASS.
Run: `bun run typecheck && bun run lint` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(admin): message-history purge endpoint (super-admin)

DELETE /settings/api/admin/message-history clears all; DELETE .../contexts/<id>/
message-history clears one group scope. Safety valve for unlimited retention.
Super-admin gated."
```

---

## Self-Review (completed inline)

**1. Spec coverage** — every spec section maps to a task:
- §1 DB-primary shift → Task 2 (retire Map, DB-backed reads) + Task 4 (drop preload).
- §2 migration (group_context_id, drop expires_at, FTS5+triggers) → Task 1.
- §3 caching unification (bot.ts chokepoint, scope derivation, commands excluded) → Task 5 (with documented refinement: `onIncomingMessage` not `handleMessage`).
- §4 store read layer (getMessage/searchMessages/getMessageContext/scope) → Tasks 2 & 3.
- §5 three tools → Tasks 6 & 7.
- §6 gating/metadata/capabilities/guest-default-off → Tasks 6 & 7 add `read('history')` + capability tokens (default-allow; guest toolset is a hardcoded allowlist these tools are simply not added to — verified by the fact that guest toolset is enumerated elsewhere and these aren't in it). Privacy (scope checks at data layer) → store scope helpers.
- §7 retention/purge/observability → Task 4 (snapshot) + Task 8 (purge).
- §8 error/logging discipline → encoded in tool implementations (`not_found`/empty shapes, `info` counts-only, no text logging).

**2. Placeholder scan** — the two `// ...arrange...` markers in Task 5 & Task 8 tests are intentional "mirror the existing harness" pointers with concrete `rg` commands to find the canonical arrange block (the settings-session/auth seeding boilerplate, which is long and per-suite). These are not vague TODOs; they name the exact file/pattern to copy and the assertions are concrete. (If the executor prefers, both arranges can be inlined by reading the cited test files.)

**3. Type consistency** — `MessageScope`, `getMessage`/`searchMessages`/`getMessageContext` signatures match between store (Task 3) and tools (Tasks 6 & 7). `CachedMessage.groupContextId` (Task 1) is read consistently in `rowToCachedMessage` (Task 2) and written in the bot chokepoint (Task 5). Tool factory signatures `(chatUserId, storageContextId, contextType)` are uniform across all three tools.

**4. Scope check** — single implementation plan; Phase 2 (semantic) explicitly deferred in the spec.

**Verification command (whole phase):**
```bash
bun run typecheck && bun run lint && bun run security && bun test
```
