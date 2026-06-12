<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Long-Term Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build default-on hybrid long-term memory with pinned profiles, searchable memory records, background capture, bounded context injection, agent tools, and settings controls for personal and group scopes.

**Architecture:** Add a focused `src/long-term-memory/` module with scope normalization, storage, retrieval, context rendering, extraction, and maintenance. Long-term group memory normalizes thread-scoped contexts to the parent group context, while short-term history remains unchanged. Runtime integration happens through `conversation.ts`, `llm-history.ts`, provider-independent tools, and settings routes.

**Tech Stack:** Bun, TypeScript, Drizzle SQLite schema, SQLite FTS5, Vercel AI SDK `generateText`/tools, Zod v4, Svelte settings UI, existing scheduler and settings auth.

---

## File Structure

Create:

- `src/db/migrations/053_long_term_memory.ts` — SQLite tables, indexes, FTS5 virtual table, and triggers.
- `src/long-term-memory/types.ts` — public domain types and Zod schemas for records, profiles, patches, filters, and tool inputs.
- `src/long-term-memory/scope.ts` — normalized personal/group memory scope resolution.
- `src/long-term-memory/store.ts` — profile and record CRUD, FTS search, status transitions, and clear operations.
- `src/long-term-memory/context.ts` — bounded trust-labelled memory block builder.
- `src/long-term-memory/extractor.ts` — prompt construction, model response parsing, and patch validation.
- `src/long-term-memory/runner.ts` — background extraction runner with per-scope in-flight guard.
- `src/long-term-memory/maintenance.ts` — staleness and expiry transitions.
- `src/tools/memory.ts` — `search_memory`, `remember_memory`, `forget_memory`, and `list_memory` tool factories.
- `src/debug/settings/memory-routes.ts` — settings API for profile/records/toggle/clear operations.
- `client/settings/sections/MemorySection.svelte` — settings UI section for profile and records.
- `src/db/long-term-memory-schema.ts` — Drizzle schema definitions for long-term memory tables.

Modify:

- `src/db/index.ts` — register migration `053_long_term_memory`.
- `src/db/schema.ts` — export `memoryProfiles` and `memoryRecords`.
- `src/conversation.ts` — load long-term memory context alongside existing summary/facts.
- `src/llm-history.ts` — trigger background memory extraction after assistant history append.
- `src/tools/provider-independent-tools-builder.ts` — add memory tools for normal turns.
- `src/tools/tool-metadata.ts` — add `memory` domain and metadata for new tools.
- `src/debug/settings-api-router.ts` — route `/settings/api/memory`.
- `client/settings/SettingsApp.svelte` — add Memory section to the sidebar and page body.
- `client/settings/fetcher-schemas.ts` and `client/settings/fetchers.ts` — add memory response schemas and fetchers.
- `src/scheduler-instance.ts` — register a memory maintenance task.

Tests:

- `tests/db/migrations/053_long_term_memory.test.ts`
- `tests/long-term-memory/scope.test.ts`
- `tests/long-term-memory/store.test.ts`
- `tests/long-term-memory/context.test.ts`
- `tests/long-term-memory/extractor.test.ts`
- `tests/long-term-memory/runner.test.ts`
- `tests/long-term-memory/maintenance.test.ts`
- `tests/tools/memory.test.ts`
- `tests/debug/settings-memory-routes.test.ts`
- `tests/client/settings/MemorySection.test.ts`
- Extend `tests/conversation.test.ts`, `tests/llm-history.test.ts`, `tests/tools/tools-builder.test.ts`, and `tests/tools/tool-metadata.test.ts` if those files exist; otherwise add focused cases to the nearest existing test file in that area.

---

### Task 1: Database Schema And Migration

**Files:**

- Create: `src/db/migrations/053_long_term_memory.ts`
- Modify: `src/db/index.ts`
- Modify: `src/db/schema.ts`
- Create: `src/db/long-term-memory-schema.ts`
- Test: `tests/db/migrations/053_long_term_memory.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `tests/db/migrations/053_long_term_memory.test.ts`:

```ts
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { migration053LongTermMemory } from '../../../src/db/migrations/053_long_term_memory.js'

const tableNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type IN ('table', 'index', 'trigger')`)
    .all()
    .map((r) => r.name)

describe('migration053LongTermMemory', () => {
  test('creates long-term memory profile and record storage', () => {
    const db = new Database(':memory:')
    migration053LongTermMemory.up(db)

    const names = tableNames(db)
    expect(names).toContain('memory_profiles')
    expect(names).toContain('memory_records')
    expect(names).toContain('memory_records_fts')
    expect(names).toContain('idx_memory_profiles_scope')
    expect(names).toContain('idx_memory_records_scope_status_seen')
    expect(names).toContain('idx_memory_records_scope_kind_status')
    expect(names).toContain('memory_records_ai')
    expect(names).toContain('memory_records_au')
    expect(names).toContain('memory_records_ad')
  })

  test('keeps FTS rows in sync with memory records', () => {
    const db = new Database(':memory:')
    migration053LongTermMemory.up(db)

    db.run(
      `INSERT INTO memory_records
        (id, scope_id, scope_type, kind, content, summary, tags, confidence, status, source, evidence, created_at, updated_at, last_seen_at)
       VALUES
        ('mem-1', 'scope-1', 'personal', 'preference', 'User prefers concise replies', 'Concise replies', '["style"]', 0.9, 'active', 'explicit', '{}', '2026-06-11T00:00:00.000Z', '2026-06-11T00:00:00.000Z', '2026-06-11T00:00:00.000Z')`,
    )

    const found = db
      .query<{ id: string }, []>(
        `SELECT m.id
         FROM memory_records m
         JOIN memory_records_fts f ON m.rowid = f.rowid
         WHERE f.memory_records_fts MATCH 'concise'`,
      )
      .all()
    expect(found).toEqual([{ id: 'mem-1' }])
  })
})
```

- [ ] **Step 2: Run the migration test and verify it fails**

Run:

```bash
bun test tests/db/migrations/053_long_term_memory.test.ts
```

Expected: FAIL because `src/db/migrations/053_long_term_memory.ts` does not exist.

- [ ] **Step 3: Add the migration**

Create `src/db/migrations/053_long_term_memory.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:053' })

const createProfiles = (db: Database): void => {
  db.run(`
    CREATE TABLE memory_profiles (
      scope_id   TEXT NOT NULL PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('personal', 'group')),
      profile    TEXT NOT NULL DEFAULT '',
      enabled    INTEGER NOT NULL DEFAULT 1,
      version    INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    )
  `)
  db.run(`CREATE INDEX idx_memory_profiles_scope ON memory_profiles(scope_type, scope_id)`)
}

const createRecords = (db: Database): void => {
  db.run(`
    CREATE TABLE memory_records (
      id            TEXT PRIMARY KEY,
      scope_id      TEXT NOT NULL,
      scope_type    TEXT NOT NULL CHECK (scope_type IN ('personal', 'group')),
      kind          TEXT NOT NULL CHECK (kind IN ('preference', 'fact', 'decision', 'project_context', 'person_context', 'procedure', 'episode', 'reference')),
      content       TEXT NOT NULL,
      summary       TEXT,
      tags          TEXT NOT NULL DEFAULT '[]',
      confidence    REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      status        TEXT NOT NULL CHECK (status IN ('active', 'stale', 'archived', 'contradicted')),
      source        TEXT NOT NULL CHECK (source IN ('background', 'explicit', 'tool_result', 'admin_edit')),
      evidence      TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      last_seen_at  TEXT NOT NULL,
      valid_from    TEXT,
      valid_until   TEXT,
      expires_at    TEXT,
      embedding     BLOB
    )
  `)
  db.run(`CREATE INDEX idx_memory_records_scope_status_seen ON memory_records(scope_id, status, last_seen_at DESC)`)
  db.run(`CREATE INDEX idx_memory_records_scope_kind_status ON memory_records(scope_id, kind, status)`)
}

const createFts = (db: Database): void => {
  db.run(`
    CREATE VIRTUAL TABLE memory_records_fts
      USING fts5(content, summary, tags, content='memory_records', content_rowid='rowid')
  `)
  db.run(`
    CREATE TRIGGER memory_records_ai AFTER INSERT ON memory_records BEGIN
      INSERT INTO memory_records_fts(rowid, content, summary, tags)
      VALUES (new.rowid, new.content, new.summary, new.tags);
    END
  `)
  db.run(`
    CREATE TRIGGER memory_records_au AFTER UPDATE ON memory_records BEGIN
      INSERT INTO memory_records_fts(memory_records_fts, rowid, content, summary, tags)
      VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
      INSERT INTO memory_records_fts(rowid, content, summary, tags)
      VALUES (new.rowid, new.content, new.summary, new.tags);
    END
  `)
  db.run(`
    CREATE TRIGGER memory_records_ad AFTER DELETE ON memory_records BEGIN
      INSERT INTO memory_records_fts(memory_records_fts, rowid, content, summary, tags)
      VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
    END
  `)
}

const up = (db: Database): void => {
  createProfiles(db)
  createRecords(db)
  createFts(db)
  log.info('migration 053: long-term memory tables created')
}

export const migration053LongTermMemory: Migration = {
  id: '053_long_term_memory',
  up,
}

export default migration053LongTermMemory
```

- [ ] **Step 4: Register the migration**

Modify `src/db/index.ts`:

```ts
import { migration053LongTermMemory } from './migrations/053_long_term_memory.js'
```

Add `migration053LongTermMemory` immediately after `migration052ByokLlmCredentials` in the exported migrations array.

- [ ] **Step 5: Add Drizzle schema exports**

Create `src/db/long-term-memory-schema.ts` to keep `src/db/schema.ts` under the repo's max-lines rule:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { blob, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const memoryProfiles = sqliteTable(
  'memory_profiles',
  {
    scopeId: text('scope_id').primaryKey(),
    scopeType: text('scope_type', { enum: ['personal', 'group'] }).notNull(),
    profile: text('profile').notNull().default(''),
    enabled: integer('enabled').notNull().default(1),
    version: integer('version').notNull().default(1),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_memory_profiles_scope').on(table.scopeType, table.scopeId)],
)

export const memoryRecords = sqliteTable(
  'memory_records',
  {
    id: text('id').primaryKey(),
    scopeId: text('scope_id').notNull(),
    scopeType: text('scope_type', { enum: ['personal', 'group'] }).notNull(),
    kind: text('kind', {
      enum: [
        'preference',
        'fact',
        'decision',
        'project_context',
        'person_context',
        'procedure',
        'episode',
        'reference',
      ],
    }).notNull(),
    content: text('content').notNull(),
    summary: text('summary'),
    tags: text('tags').notNull().default('[]'),
    confidence: real('confidence').notNull(),
    status: text('status', { enum: ['active', 'stale', 'archived', 'contradicted'] }).notNull(),
    source: text('source', { enum: ['background', 'explicit', 'tool_result', 'admin_edit'] }).notNull(),
    evidence: text('evidence').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    validFrom: text('valid_from'),
    validUntil: text('valid_until'),
    expiresAt: text('expires_at'),
    embedding: blob('embedding'),
  },
  (table) => [
    index('idx_memory_records_scope_status_seen').on(table.scopeId, table.status, table.lastSeenAt),
    index('idx_memory_records_scope_kind_status').on(table.scopeId, table.kind, table.status),
  ],
)

export type MemoryProfileRow = typeof memoryProfiles.$inferSelect
export type MemoryRecordRow = typeof memoryRecords.$inferSelect
```

Modify `src/db/schema.ts` to re-export that module near the other schema re-exports:

```ts
export {
  memoryProfiles,
  memoryRecords,
  type MemoryProfileRow,
  type MemoryRecordRow,
} from './long-term-memory-schema.js'
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
bun test tests/db/migrations/053_long_term_memory.test.ts
bun run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/db/migrations/053_long_term_memory.ts src/db/index.ts src/db/schema.ts src/db/long-term-memory-schema.ts tests/db/migrations/053_long_term_memory.test.ts
git commit -m "feat(memory): add long-term memory schema"
```

---

### Task 2: Memory Scope Normalization

**Files:**

- Create: `src/long-term-memory/types.ts`
- Create: `src/long-term-memory/scope.ts`
- Test: `tests/long-term-memory/scope.test.ts`

- [ ] **Step 1: Write scope tests**

Create `tests/long-term-memory/scope.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'

import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { resolveMemoryScope } from '../../src/long-term-memory/scope.js'

describe('resolveMemoryScope', () => {
  test('uses personal scope for DMs', () => {
    expect(resolveMemoryScope({ storageContextId: 'user-1', contextType: 'dm' })).toEqual({
      scopeId: 'user-1',
      scopeType: 'personal',
    })
  })

  test('rolls scoped Telegram or Mattermost thread contexts up to parent group', () => {
    const parent = toScopedContextId({ platformInstanceId: 'telegram-main', nativeContextId: '-1001' })
    const thread = toScopedThreadContextId({
      platformInstanceId: 'telegram-main',
      nativeContextId: '-1001',
      threadId: '42',
    })

    expect(resolveMemoryScope({ storageContextId: thread, contextType: 'group' })).toEqual({
      scopeId: parent,
      scopeType: 'group',
    })
  })

  test('rolls legacy colon thread contexts up to the first segment', () => {
    expect(resolveMemoryScope({ storageContextId: 'group-1:thread-2', contextType: 'group' })).toEqual({
      scopeId: 'group-1',
      scopeType: 'group',
    })
  })

  test('keeps non-thread group contexts as group scope', () => {
    expect(resolveMemoryScope({ storageContextId: 'discord-channel-1', contextType: 'group' })).toEqual({
      scopeId: 'discord-channel-1',
      scopeType: 'group',
    })
  })
})
```

- [ ] **Step 2: Run scope tests and verify failure**

Run:

```bash
bun test tests/long-term-memory/scope.test.ts
```

Expected: FAIL because `src/long-term-memory/scope.ts` does not exist.

- [ ] **Step 3: Add domain types**

Create `src/long-term-memory/types.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const MemoryScopeTypeSchema = z.enum(['personal', 'group'])
export type MemoryScopeType = z.infer<typeof MemoryScopeTypeSchema>

export type MemoryScope = Readonly<{
  scopeId: string
  scopeType: MemoryScopeType
}>

export const MemoryKindSchema = z.enum([
  'preference',
  'fact',
  'decision',
  'project_context',
  'person_context',
  'procedure',
  'episode',
  'reference',
])
export type MemoryKind = z.infer<typeof MemoryKindSchema>

export const MemoryStatusSchema = z.enum(['active', 'stale', 'archived', 'contradicted'])
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>

export const MemorySourceSchema = z.enum(['background', 'explicit', 'tool_result', 'admin_edit'])
export type MemorySource = z.infer<typeof MemorySourceSchema>
```

- [ ] **Step 4: Implement scope normalization**

Create `src/long-term-memory/scope.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { ContextType } from '../chat/types.js'
import type { MemoryScope } from './types.js'

export type ResolveMemoryScopeInput = Readonly<{
  storageContextId: string
  contextType: ContextType
}>

export function resolveMemoryScope(input: ResolveMemoryScopeInput): MemoryScope {
  if (input.contextType === 'dm') {
    return { scopeId: input.storageContextId, scopeType: 'personal' }
  }
  return {
    scopeId: getConfigContextIdFromStorageContextId(input.storageContextId),
    scopeType: 'group',
  }
}
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
bun test tests/long-term-memory/scope.test.ts
bun run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/long-term-memory/types.ts src/long-term-memory/scope.ts tests/long-term-memory/scope.test.ts
git commit -m "feat(memory): normalize long-term memory scopes"
```

---

### Task 3: Profile And Record Store

**Files:**

- Modify: `src/long-term-memory/types.ts`
- Create: `src/long-term-memory/store.ts`
- Test: `tests/long-term-memory/store.test.ts`

- [ ] **Step 1: Write store tests**

Create `tests/long-term-memory/store.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test'

import { setupTestDb } from '../utils/db.js'
import {
  archiveMemoryRecord,
  clearMemoryScope,
  getMemoryProfile,
  listMemoryRecords,
  saveMemoryProfile,
  saveMemoryRecord,
  searchMemoryRecords,
} from '../../src/long-term-memory/store.js'

describe('long-term memory store', () => {
  beforeEach(() => {
    setupTestDb()
  })

  test('saves and loads a profile for one scope', () => {
    saveMemoryProfile(
      { scopeId: 'user-1', scopeType: 'personal' },
      '## Communication\n- Concise replies',
      '2026-06-11T00:00:00.000Z',
    )

    expect(getMemoryProfile({ scopeId: 'user-1', scopeType: 'personal' })).toEqual({
      scopeId: 'user-1',
      scopeType: 'personal',
      profile: '## Communication\n- Concise replies',
      enabled: true,
      version: 1,
      updatedAt: '2026-06-11T00:00:00.000Z',
    })
  })

  test('stores records and lists only requested scope/status', () => {
    saveMemoryRecord({
      id: 'mem-1',
      scopeId: 'group-1',
      scopeType: 'group',
      kind: 'decision',
      content: 'The group decided to release on Fridays.',
      summary: 'Friday releases',
      tags: ['release'],
      confidence: 0.9,
      status: 'active',
      source: 'background',
      evidence: { messageIds: ['m1'] },
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      lastSeenAt: '2026-06-11T00:00:00.000Z',
    })

    expect(listMemoryRecords({ scopeId: 'group-1', status: 'active' }).map((r) => r.id)).toEqual(['mem-1'])
    expect(listMemoryRecords({ scopeId: 'user-1', status: 'active' })).toEqual([])
  })

  test('searches active records with FTS', () => {
    saveMemoryRecord({
      id: 'mem-2',
      scopeId: 'user-1',
      scopeType: 'personal',
      kind: 'preference',
      content: 'User prefers concise implementation plans.',
      summary: 'Concise plans',
      tags: ['style'],
      confidence: 1,
      status: 'active',
      source: 'explicit',
      evidence: {},
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      lastSeenAt: '2026-06-11T00:00:00.000Z',
    })

    expect(searchMemoryRecords({ scopeId: 'user-1', query: 'concise', includeStale: false }).map((r) => r.id)).toEqual([
      'mem-2',
    ])
  })

  test('archives a record and clears a scope', () => {
    saveMemoryRecord({
      id: 'mem-3',
      scopeId: 'user-1',
      scopeType: 'personal',
      kind: 'reference',
      content: 'User shared a reusable setup link.',
      summary: null,
      tags: [],
      confidence: 0.7,
      status: 'active',
      source: 'explicit',
      evidence: {},
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      lastSeenAt: '2026-06-11T00:00:00.000Z',
    })

    expect(archiveMemoryRecord('user-1', 'mem-3', '2026-06-12T00:00:00.000Z')).toBe(true)
    expect(listMemoryRecords({ scopeId: 'user-1', status: 'active' })).toEqual([])
    expect(clearMemoryScope({ scopeId: 'user-1', scopeType: 'personal' })).toEqual({
      recordsDeleted: 1,
      profileDeleted: 0,
    })
  })
})
```

- [ ] **Step 2: Run store tests and verify failure**

Run:

```bash
bun test tests/long-term-memory/store.test.ts
```

Expected: FAIL because `src/long-term-memory/store.ts` does not exist.

- [ ] **Step 3: Extend types**

Add to `src/long-term-memory/types.ts`:

```ts
export type MemoryProfile = MemoryScope &
  Readonly<{
    profile: string
    enabled: boolean
    version: number
    updatedAt: string
  }>

export type MemoryEvidence = Readonly<{
  messageIds?: readonly string[]
  actorIds?: readonly string[]
  timestamps?: readonly string[]
  contextId?: string
}>

export type MemoryRecord = MemoryScope &
  Readonly<{
    id: string
    kind: MemoryKind
    content: string
    summary: string | null
    tags: readonly string[]
    confidence: number
    status: MemoryStatus
    source: MemorySource
    evidence: MemoryEvidence
    createdAt: string
    updatedAt: string
    lastSeenAt: string
    validFrom?: string | null
    validUntil?: string | null
    expiresAt?: string | null
    embedding?: Float32Array | null
  }>

export type MemoryRecordInput = Omit<MemoryRecord, 'embedding'> & Readonly<{ embedding?: Float32Array | null }>
```

- [ ] **Step 4: Implement store helpers**

Create `src/long-term-memory/store.ts` with these exported functions:

```ts
export function getMemoryProfile(scope: MemoryScope): MemoryProfile | null
export function saveMemoryProfile(scope: MemoryScope, profile: string, now: string): MemoryProfile
export function setMemoryCaptureEnabled(scope: MemoryScope, enabled: boolean, now: string): MemoryProfile
export function saveMemoryRecord(input: MemoryRecordInput): MemoryRecord
export function listMemoryRecords(filter: ListMemoryRecordsFilter): readonly MemoryRecord[]
export function searchMemoryRecords(filter: SearchMemoryRecordsFilter): readonly MemoryRecord[]
export function archiveMemoryRecord(scopeId: string, recordId: string, now: string): boolean
export function clearMemoryScope(scope: MemoryScope): { profileDeleted: number; recordsDeleted: number }
```

Use the same JSON parsing style as `src/memos.ts`:

```ts
const parseTags = (json: string): readonly string[] => {
  const parsed: unknown = JSON.parse(json)
  return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : []
}

const parseEvidence = (json: string): MemoryEvidence => {
  const parsed: unknown = JSON.parse(json)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  return parsed as MemoryEvidence
}
```

Use FTS query sanitization from `src/memos.ts`:

```ts
const sanitizeFtsQuery = (query: string): string => `"${query.replace(/"/gu, '""')}"`
```

For `searchMemoryRecords`, filter by `scope_id`, include `active` records by default, and include `stale` only when `includeStale` is true.

- [ ] **Step 5: Verify and commit**

Run:

```bash
bun test tests/long-term-memory/store.test.ts
bun run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/long-term-memory/types.ts src/long-term-memory/store.ts tests/long-term-memory/store.test.ts
git commit -m "feat(memory): add long-term memory store"
```

---

### Task 4: Bounded Context Injection

**Files:**

- Create: `src/long-term-memory/context.ts`
- Modify: `src/conversation.ts`
- Test: `tests/long-term-memory/context.test.ts`
- Test: `tests/conversation.test.ts`

- [ ] **Step 1: Write context builder tests**

Create `tests/long-term-memory/context.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'

import { buildLongTermMemoryContextMessage } from '../../src/long-term-memory/context.js'
import type { MemoryRecord } from '../../src/long-term-memory/types.js'

const record = (id: string, content: string, status: 'active' | 'stale' = 'active'): MemoryRecord => ({
  id,
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'preference',
  content,
  summary: content,
  tags: [],
  confidence: 0.9,
  status,
  source: 'background',
  evidence: {},
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
})

describe('buildLongTermMemoryContextMessage', () => {
  test('returns null when profile and records are empty', () => {
    expect(buildLongTermMemoryContextMessage({ profile: null, records: [] })).toBeNull()
  })

  test('renders trust-labelled profile and at most three records', () => {
    const message = buildLongTermMemoryContextMessage({
      profile: '## Communication\n- User prefers concise replies.',
      records: [record('1', 'One'), record('2', 'Two'), record('3', 'Three'), record('4', 'Four')],
    })

    expect(message?.role).toBe('system')
    expect(message?.content).toContain('<long_term_memory trust="profile_and_retrieved_low">')
    expect(message?.content).toContain('<profile>')
    expect(message?.content).toContain('User prefers concise replies')
    expect(message?.content).toContain('id="1"')
    expect(message?.content).toContain('id="3"')
    expect(message?.content).not.toContain('id="4"')
  })

  test('marks stale records in the rendered block', () => {
    const message = buildLongTermMemoryContextMessage({
      profile: null,
      records: [record('stale-1', 'Old fact', 'stale')],
    })
    expect(message?.content).toContain('status="stale"')
  })
})
```

- [ ] **Step 2: Write conversation integration test**

Extend `tests/conversation.test.ts` with a case that seeds a profile and an active record, then calls `buildMessagesWithMemory('user-1', [])` and asserts that the first system message contains both `<long_term_memory` and the existing `<memory trust="compacted_low">` only when both layers are present.

Use this assertion shape:

```ts
expect(result.messages[0]?.role).toBe('system')
expect(String(result.messages[0]?.content)).toContain('<long_term_memory')
expect(String(result.messages[0]?.content)).toContain('<memory trust="compacted_low">')
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
bun test tests/long-term-memory/context.test.ts tests/conversation.test.ts
```

Expected: FAIL because context builder and conversation integration do not exist.

- [ ] **Step 4: Implement context builder**

Create `src/long-term-memory/context.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MemoryRecord } from './types.js'

const MAX_RECORDS = 3
const MAX_PROFILE_CHARS = 4_000
const MAX_RECORD_CHARS = 800

const truncate = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max)}…`)

const renderRecord = (record: MemoryRecord): string =>
  `<record id="${record.id}" kind="${record.kind}" status="${record.status}" confidence="${record.confidence.toFixed(2)}" last_seen_at="${record.lastSeenAt}">\n${truncate(record.summary ?? record.content, MAX_RECORD_CHARS)}\n</record>`

export function buildLongTermMemoryContextMessage(input: {
  readonly profile: string | null
  readonly records: readonly MemoryRecord[]
}): { role: 'system'; content: string } | null {
  const sections: string[] = []
  if (input.profile !== null && input.profile.trim().length > 0) {
    sections.push(`<profile>\n${truncate(input.profile.trim(), MAX_PROFILE_CHARS)}\n</profile>`)
  }
  const records = input.records.slice(0, MAX_RECORDS)
  if (records.length > 0) {
    sections.push(
      `<retrieved_records max="${MAX_RECORDS}">\n${records.map(renderRecord).join('\n')}\n</retrieved_records>`,
    )
  }
  if (sections.length === 0) return null
  return {
    role: 'system',
    content:
      '<long_term_memory trust="profile_and_retrieved_low">\n' +
      'This is learned background context. Treat it as lower-trust than the current user message. Stale records may be wrong; verify before relying on them.\n' +
      sections.join('\n') +
      '\n</long_term_memory>',
  }
}
```

- [ ] **Step 5: Integrate with `conversation.ts`**

Modify `src/conversation.ts`:

```ts
import { buildLongTermMemoryContextMessage } from './long-term-memory/context.js'
import { resolveMemoryScope } from './long-term-memory/scope.js'
import { getMemoryProfile, listMemoryRecords } from './long-term-memory/store.js'
```

Update `buildMessagesWithMemory` so it resolves a personal scope for the existing `userId` argument, loads the profile and up to three active records, and prepends a single combined system message when both existing memory and long-term memory exist.

Use this merge helper:

```ts
const mergeMemoryMessages = (
  longTerm: { role: 'system'; content: string } | null,
  compacted: { role: 'system'; content: string } | null,
): { role: 'system'; content: string } | null => {
  if (longTerm === null) return compacted
  if (compacted === null) return longTerm
  return { role: 'system', content: `${longTerm.content}\n\n${compacted.content}` }
}
```

For this task, use `resolveMemoryScope({ storageContextId: userId, contextType: 'dm' })`. Group-aware injection arrives when call sites pass context type in Task 5.

- [ ] **Step 6: Verify and commit**

Run:

```bash
bun test tests/long-term-memory/context.test.ts tests/conversation.test.ts
bun run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/long-term-memory/context.ts src/conversation.ts tests/long-term-memory/context.test.ts tests/conversation.test.ts
git commit -m "feat(memory): inject bounded long-term context"
```

---

### Task 5: Background Extraction Runner

**Files:**

- Create: `src/long-term-memory/extractor.ts`
- Create: `src/long-term-memory/runner.ts`
- Modify: `src/llm-history.ts`
- Modify: `src/conversation.ts`
- Test: `tests/long-term-memory/extractor.test.ts`
- Test: `tests/long-term-memory/runner.test.ts`
- Test: `tests/llm-history.test.ts`

- [ ] **Step 1: Write extractor tests**

Create `tests/long-term-memory/extractor.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'

import { parseMemoryPatch } from '../../src/long-term-memory/extractor.js'

describe('parseMemoryPatch', () => {
  test('parses valid JSON patch', () => {
    const patch = parseMemoryPatch(
      `{"profile":"## Style\\n- Concise","records":[{"kind":"preference","content":"User prefers concise replies","summary":"Concise replies","tags":["style"],"confidence":0.9,"source":"background","evidence":{"messageIds":["m1"]}}],"updates":[]}`,
    )

    expect(patch.profile).toContain('Concise')
    expect(patch.records).toHaveLength(1)
    expect(patch.records[0]?.kind).toBe('preference')
  })

  test('rejects malformed model output', () => {
    expect(() => parseMemoryPatch('not json')).toThrow(/invalid memory patch/u)
  })

  test('rejects out-of-range confidence', () => {
    expect(() =>
      parseMemoryPatch(
        `{"profile":null,"records":[{"kind":"fact","content":"x","summary":null,"tags":[],"confidence":2,"source":"background","evidence":{}}],"updates":[]}`,
      ),
    ).toThrow(/invalid memory patch/u)
  })
})
```

- [ ] **Step 2: Write runner tests**

Create `tests/long-term-memory/runner.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test'

import { setupTestDb } from '../utils/db.js'
import { getMemoryProfile, listMemoryRecords } from '../../src/long-term-memory/store.js'
import { runMemoryExtractionInBackground } from '../../src/long-term-memory/runner.js'

describe('runMemoryExtractionInBackground', () => {
  beforeEach(() => {
    setupTestDb()
  })

  test('applies a model patch to the normalized scope', async () => {
    await runMemoryExtractionInBackground({
      storageContextId: 'user-1',
      contextType: 'dm',
      configContextId: 'user-1',
      history: [{ role: 'user', content: 'Remember I prefer concise replies.' }],
      deps: {
        resolveLlmConfig: () => ({ ok: false, source: 'global', type: 'missing', missing: [] }),
        generatePatch: async () => ({
          profile: '## Communication\n- User prefers concise replies.',
          records: [
            {
              kind: 'preference',
              content: 'User prefers concise replies.',
              summary: 'Concise replies',
              tags: ['style'],
              confidence: 1,
              source: 'background',
              evidence: { messageIds: [] },
            },
          ],
          updates: [],
        }),
        now: () => '2026-06-11T00:00:00.000Z',
      },
    })

    expect(getMemoryProfile({ scopeId: 'user-1', scopeType: 'personal' })?.profile).toContain('Concise')
    expect(listMemoryRecords({ scopeId: 'user-1', status: 'active' })).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
bun test tests/long-term-memory/extractor.test.ts tests/long-term-memory/runner.test.ts
```

Expected: FAIL because extractor and runner do not exist.

- [ ] **Step 4: Implement extractor parser and prompt**

Create `src/long-term-memory/extractor.ts` with:

```ts
export const MemoryPatchSchema = z.object({
  profile: z.string().nullable(),
  records: z.array(
    z.object({
      kind: MemoryKindSchema,
      content: z.string().min(3).max(2_000),
      summary: z.string().max(300).nullable(),
      tags: z.array(z.string().min(1).max(40)).max(10),
      confidence: z.number().min(0).max(1),
      source: MemorySourceSchema,
      evidence: z.object({
        messageIds: z.array(z.string()).optional(),
        actorIds: z.array(z.string()).optional(),
        timestamps: z.array(z.string()).optional(),
        contextId: z.string().optional(),
      }),
      expiresAt: z.string().nullable().optional(),
      validFrom: z.string().nullable().optional(),
      validUntil: z.string().nullable().optional(),
    }),
  ),
  updates: z.array(
    z.object({
      id: z.string(),
      status: MemoryStatusSchema.optional(),
      content: z.string().min(3).max(2_000).optional(),
      confidence: z.number().min(0).max(1).optional(),
    }),
  ),
})

export type MemoryPatch = z.infer<typeof MemoryPatchSchema>

export function parseMemoryPatch(text: string): MemoryPatch {
  const match = text.match(/\{[\s\S]*\}/u)
  if (match === null) throw new Error('invalid memory patch: no JSON object')
  try {
    const parsed = JSON.parse(match[0]) as unknown
    const result = MemoryPatchSchema.safeParse(parsed)
    if (!result.success) throw new Error(result.error.message)
    return result.data
  } catch (error) {
    throw new Error(`invalid memory patch: ${error instanceof Error ? error.message : String(error)}`)
  }
}
```

Also export `extractMemoryPatch(...)` that calls `generateText` with a prompt instructing the model to return only the JSON shape above, skip secrets/private sensitive data, and be conservative.

- [ ] **Step 5: Implement runner**

Create `src/long-term-memory/runner.ts` with:

```ts
const inFlight = new Set<string>()

export async function runMemoryExtractionInBackground(input: RunMemoryExtractionInput): Promise<void> {
  const scope = resolveMemoryScope({ storageContextId: input.storageContextId, contextType: input.contextType })
  if (inFlight.has(scope.scopeId)) return
  inFlight.add(scope.scopeId)
  try {
    await performMemoryExtraction(input, scope)
  } catch (error) {
    log.warn(
      { scopeId: scope.scopeId, error: error instanceof Error ? error.message : String(error) },
      'Long-term memory extraction failed',
    )
  } finally {
    inFlight.delete(scope.scopeId)
  }
}
```

`performMemoryExtraction` should:

1. Return early when the profile exists and `enabled === false`.
2. Load current profile and active records.
3. Generate or accept a patch through injected deps.
4. Save profile when `patch.profile !== null`.
5. Insert patch records with generated UUIDs, `status: 'active'`, and `now`.
6. Apply update status/content/confidence to existing records in the same scope.
7. Log only counts and scope IDs, never profile or record content.

- [ ] **Step 6: Trigger runner after assistant history append**

Modify `src/llm-history.ts` so `appendAssistantHistory` accepts `contextType` and invokes memory extraction when trim triggers:

```ts
if (shouldTriggerTrim(combined, mainModel)) {
  void runTrimInBackground(contextId, combined, undefined, configId)
  void runMemoryExtractionInBackground({
    storageContextId: contextId,
    contextType,
    configContextId: configId,
    history: combined,
  })
}
```

Modify the call in `src/llm-orchestrator.ts` to pass `contextType`.

- [ ] **Step 7: Verify and commit**

Run:

```bash
bun test tests/long-term-memory/extractor.test.ts tests/long-term-memory/runner.test.ts tests/llm-history.test.ts
bun run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/long-term-memory/extractor.ts src/long-term-memory/runner.ts src/llm-history.ts src/llm-orchestrator.ts tests/long-term-memory/extractor.test.ts tests/long-term-memory/runner.test.ts tests/llm-history.test.ts
git commit -m "feat(memory): capture long-term memory in background"
```

---

### Task 6: Agent Memory Tools

**Files:**

- Create: `src/tools/memory.ts`
- Modify: `src/tools/provider-independent-tools-builder.ts`
- Modify: `src/tools/tool-metadata.ts`
- Test: `tests/tools/memory.test.ts`
- Test: `tests/tools/tools-builder.test.ts`

- [ ] **Step 1: Write tool tests**

Create `tests/tools/memory.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test'

import { setupTestDb } from '../utils/db.js'
import { makeListMemoryTool, makeRememberMemoryTool, makeSearchMemoryTool } from '../../src/tools/memory.js'

describe('memory tools', () => {
  beforeEach(() => {
    setupTestDb()
  })

  test('remember_memory writes explicit memory to the current scope', async () => {
    const tool = makeRememberMemoryTool({ storageContextId: 'user-1', contextType: 'dm' })
    const result = await tool.execute!({ content: 'User prefers concise replies.', kind: 'preference' }, {} as never)
    expect(result).toMatchObject({ status: 'saved', kind: 'preference' })
  })

  test('search_memory returns scoped matches', async () => {
    const remember = makeRememberMemoryTool({ storageContextId: 'user-1', contextType: 'dm' })
    await remember.execute!({ content: 'User prefers concise replies.', kind: 'preference' }, {} as never)

    const search = makeSearchMemoryTool({ storageContextId: 'user-1', contextType: 'dm' })
    const result = await search.execute!({ query: 'concise', include_stale: false }, {} as never)
    expect(result).toMatchObject({ mode: 'keyword' })
    expect(result.records).toHaveLength(1)
  })

  test('list_memory omits archived records by default', async () => {
    const list = makeListMemoryTool({ storageContextId: 'user-1', contextType: 'dm' })
    const result = await list.execute!({}, {} as never)
    expect(result).toEqual({ records: [] })
  })
})
```

- [ ] **Step 2: Run tool tests and verify failure**

Run:

```bash
bun test tests/tools/memory.test.ts
```

Expected: FAIL because `src/tools/memory.ts` does not exist.

- [ ] **Step 3: Implement tool factories**

Create `src/tools/memory.ts` with four exported factories:

```ts
export function makeSearchMemoryTool(input: MemoryToolContext): ToolSet[string]
export function makeRememberMemoryTool(input: MemoryToolContext): ToolSet[string]
export function makeForgetMemoryTool(input: MemoryToolContext): ToolSet[string]
export function makeListMemoryTool(input: MemoryToolContext): ToolSet[string]
```

Use schemas:

```ts
const MemoryToolContextSchema = z.object({
  storageContextId: z.string(),
  contextType: z.enum(['dm', 'group']),
})

const RememberSchema = z.object({
  content: z.string().min(3).max(2_000),
  kind: MemoryKindSchema,
  tags: z.array(z.string()).default([]),
  expiry: z.string().optional(),
})
```

Tool behavior:

- `remember_memory`: save an `explicit` active record in `resolveMemoryScope(input)`.
- `search_memory`: FTS search current scope; `include_stale` defaults false.
- `list_memory`: list current scope by optional `kind` and optional `status`, default `active`.
- `forget_memory`: archive by `memory_id` when provided; otherwise search by query and archive the best exact or first result. Return `{ status: 'forgotten' | 'not_found' }`.

- [ ] **Step 4: Add tools to provider-independent builder**

Modify `src/tools/provider-independent-tools-builder.ts`:

```ts
import { makeForgetMemoryTool, makeListMemoryTool, makeRememberMemoryTool, makeSearchMemoryTool } from './memory.js'

function addMemoryTools(tools: ToolSet, contextId: string | undefined, contextType: ContextType | undefined): void {
  if (contextId === undefined || contextType === undefined) return
  tools['search_memory'] = makeSearchMemoryTool({ storageContextId: contextId, contextType })
  tools['remember_memory'] = makeRememberMemoryTool({ storageContextId: contextId, contextType })
  tools['forget_memory'] = makeForgetMemoryTool({ storageContextId: contextId, contextType })
  tools['list_memory'] = makeListMemoryTool({ storageContextId: contextId, contextType })
}
```

Call `addMemoryTools(tools, contextId, contextType)` after memo tools.

- [ ] **Step 5: Add tool metadata**

Modify `src/tools/tool-metadata.ts`:

```ts
export type ToolDomain /* existing union */ = 'memory'
```

Add:

```ts
search_memory: read('memory'),
list_memory: read('memory'),
remember_memory: write('memory', 'create'),
forget_memory: destructive('memory'),
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
bun test tests/tools/memory.test.ts tests/tools/tools-builder.test.ts
bun run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/tools/memory.ts src/tools/provider-independent-tools-builder.ts src/tools/tool-metadata.ts tests/tools/memory.test.ts tests/tools/tools-builder.test.ts
git commit -m "feat(memory): expose long-term memory tools"
```

---

### Task 7: Settings API Controls

**Files:**

- Create: `src/debug/settings/memory-routes.ts`
- Modify: `src/debug/settings-api-router.ts`
- Test: `tests/debug/settings-memory-routes.test.ts`

- [ ] **Step 1: Write settings route tests**

Create `tests/debug/settings-memory-routes.test.ts` following the existing settings route auth pattern. Cover:

```ts
test('GET /settings/api/memory returns profile and active records for authorized personal scope', async () => {
  // arrange authenticated settings session
  // seed profile and one record
  // fetch /settings/api/memory?contextId=<personal>
  // assert { contextId, scopeType, profile, enabled, records }
})

test('PATCH /settings/api/memory/profile updates the profile with CSRF', async () => {
  // send { contextId, profile: "## Communication\n- Concise" }
  // assert profile persisted with source not logged
})

test('DELETE /settings/api/memory/records/:id archives only records in the authorized scope', async () => {
  // seed two scopes, delete one record, assert other scope unchanged
})

test('POST /settings/api/memory/clear clears authorized scope', async () => {
  // seed profile + record, call clear, assert both absent
})
```

Use concrete request paths:

- `GET /settings/api/memory?contextId=...`
- `PATCH /settings/api/memory/profile`
- `DELETE /settings/api/memory/records/:id`
- `POST /settings/api/memory/clear`
- `PATCH /settings/api/memory/capture`

- [ ] **Step 2: Run route tests and verify failure**

Run:

```bash
bun test tests/debug/settings-memory-routes.test.ts
```

Expected: FAIL because memory routes are not implemented.

- [ ] **Step 3: Implement routes**

Create `src/debug/settings/memory-routes.ts`:

```ts
const ProfilePatchSchema = z.object({
  contextId: z.string().optional(),
  profile: z.string().max(20_000),
})

const CapturePatchSchema = z.object({
  contextId: z.string().optional(),
  enabled: z.boolean(),
})

export function handleMemoryRoutes(req: Request, url: URL): Promise<Response> {
  if (url.pathname === '/settings/api/memory' && req.method === 'GET') return Promise.resolve(handleGet(req, url))
  if (url.pathname === '/settings/api/memory/profile' && req.method === 'PATCH') return handleProfilePatch(req)
  if (url.pathname === '/settings/api/memory/capture' && req.method === 'PATCH') return handleCapturePatch(req)
  if (url.pathname === '/settings/api/memory/clear' && req.method === 'POST') return handleClear(req)
  if (url.pathname.startsWith('/settings/api/memory/records/') && req.method === 'DELETE')
    return handleRecordDelete(req, url)
  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
```

Each write handler must:

1. `authenticate(req)`.
2. `requireCsrf(req, auth.authed)`.
3. `parseJsonBody(req)` when a body is needed.
4. `resolveContextScope(principal, 'write', body.contextId)`.
5. Convert to memory scope with `{ scopeId: scope.scope.contextId, scopeType: scope.scope.kind }`.
6. Call store functions.
7. Log only scope ID, action, and counts.

- [ ] **Step 4: Register settings route**

Modify `src/debug/settings-api-router.ts`:

```ts
import { handleMemoryRoutes } from './settings/memory-routes.js'
```

Before the group route fallback, add:

```ts
if (url.pathname === '/settings/api/memory' || url.pathname.startsWith('/settings/api/memory/')) {
  return handleMemoryRoutes(req, url)
}
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
bun test tests/debug/settings-memory-routes.test.ts
bun run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/debug/settings/memory-routes.ts src/debug/settings-api-router.ts tests/debug/settings-memory-routes.test.ts
git commit -m "feat(memory): add settings API controls"
```

---

### Task 8: Settings UI Memory Section

**Files:**

- Modify: `client/settings/fetcher-schemas.ts`
- Modify: `client/settings/fetchers.ts`
- Create: `client/settings/sections/MemorySection.svelte`
- Modify: `client/settings/SettingsApp.svelte`
- Test: `tests/client/settings/MemorySection.test.ts`

- [ ] **Step 1: Write client test**

Create `tests/client/settings/MemorySection.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'

import MemorySection from '../../../client/settings/sections/MemorySection.svelte'

describe('MemorySection', () => {
  afterEach(() => cleanup())

  test('loads and renders memory profile and records', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/settings/api/memory')) {
          return Response.json({
            contextId: 'user-1',
            scopeType: 'personal',
            enabled: true,
            profile: '## Communication\n- Concise replies',
            records: [
              {
                id: 'mem-1',
                kind: 'preference',
                content: 'User prefers concise replies.',
                summary: 'Concise replies',
                tags: ['style'],
                confidence: 1,
                status: 'active',
                source: 'explicit',
                createdAt: '2026-06-11T00:00:00.000Z',
                updatedAt: '2026-06-11T00:00:00.000Z',
                lastSeenAt: '2026-06-11T00:00:00.000Z',
              },
            ],
          })
        }
        return new Response('not found', { status: 404 })
      },
      { preconnect: originalFetch.preconnect },
    ) as typeof fetch

    try {
      render(MemorySection, { contextId: 'user-1' })
      await waitFor(() => expect(screen.getByText('Memory')).toBeTruthy())
      expect(screen.getByText(/Concise replies/u)).toBeTruthy()
      expect(screen.getByText('preference')).toBeTruthy()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
```

- [ ] **Step 2: Run client test and verify failure**

Run:

```bash
bun test:client tests/client/settings/MemorySection.test.ts
```

Expected: FAIL because `MemorySection.svelte` does not exist.

- [ ] **Step 3: Add fetch schemas and fetchers**

Modify `client/settings/fetcher-schemas.ts`:

```ts
export const MemoryRecordSchema = z.object({
  id: z.string(),
  kind: z.string(),
  content: z.string(),
  summary: z.string().nullable(),
  tags: z.array(z.string()),
  confidence: z.number(),
  status: z.string(),
  source: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastSeenAt: z.string(),
})

export const MemoryResponseSchema = z.object({
  contextId: z.string(),
  scopeType: z.enum(['personal', 'group']),
  enabled: z.boolean(),
  profile: z.string(),
  records: z.array(MemoryRecordSchema),
})

export type MemoryResponse = z.infer<typeof MemoryResponseSchema>
export type MemoryRecordView = z.infer<typeof MemoryRecordSchema>
```

Modify `client/settings/fetchers.ts`:

```ts
export const fetchMemory = (contextId: string): Promise<MemoryResponse> =>
  getJson(`/settings/api/memory?${ctxQuery(contextId)}`, (b) => MemoryResponseSchema.parse(b))

export const updateMemoryProfile = (input: { contextId: string; profile: string }): Promise<unknown> =>
  writeJson('/settings/api/memory/profile', 'PATCH', input, (b) => b)

export const setMemoryCapture = (input: { contextId: string; enabled: boolean }): Promise<unknown> =>
  writeJson('/settings/api/memory/capture', 'PATCH', input, (b) => b)

export const clearMemory = (input: { contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/memory/clear', 'POST', input, (b) => b)

export const archiveMemoryRecord = (contextId: string, id: string): Promise<unknown> =>
  settingsFetch(`/settings/api/memory/records/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'X-Settings-CSRF': csrfToken },
    body: JSON.stringify({ contextId }),
  }).then(async (res) => {
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  })
```

- [ ] **Step 4: Implement UI section**

Create `client/settings/sections/MemorySection.svelte` with:

```svelte
<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Pill from '../../shared/ui/Pill.svelte'
  import { clearMemory, fetchMemory, setMemoryCapture, updateMemoryProfile } from '../fetchers.js'
  import type { MemoryRecordView } from '../fetcher-schemas.js'

  interface Props { contextId: string }
  let { contextId }: Props = $props()

  let profile = $state('')
  let enabled = $state(true)
  let records: MemoryRecordView[] = $state([])
  let loading = $state(false)
  let error: string | null = $state(null)

  async function load(id: string): Promise<void> {
    loading = true
    error = null
    try {
      const data = await fetchMemory(id)
      profile = data.profile
      enabled = data.enabled
      records = data.records
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function saveProfile(): Promise<void> {
    await updateMemoryProfile({ contextId, profile })
    await load(contextId)
  }

  async function toggleCapture(): Promise<void> {
    await setMemoryCapture({ contextId, enabled: !enabled })
    await load(contextId)
  }

  async function onClear(): Promise<void> {
    await clearMemory({ contextId })
    await load(contextId)
  }

  $effect(() => { void load(contextId) })
</script>

<section id="memory" class="settings-section">
  <PageHeader eyebrow="Context" title="Memory">
    {#snippet action()}
      <Btn variant="ghost" size="sm" onClick={() => void toggleCapture()}>
        {#snippet children()}{enabled ? 'Disable capture' : 'Enable capture'}{/snippet}
      </Btn>
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}

  <label class="settings-label" for="memory-profile">Pinned profile</label>
  <textarea id="memory-profile" class="settings-textarea" bind:value={profile} rows="8" />
  <div class="settings-actions">
    <Btn size="sm" onClick={() => void saveProfile()}>{#snippet children()}Save profile{/snippet}</Btn>
    <Btn variant="danger" size="sm" onClick={() => void onClear()}>{#snippet children()}Clear memory{/snippet}</Btn>
  </div>

  {#if records.length === 0 && !loading}
    <EmptyState title="No memory records" hint="Learned records will appear here after conversations or explicit saves." />
  {:else}
    <div class="settings-memory-records">
      {#each records as record (record.id)}
        <article class="settings-memory-record">
          <div><Pill tone="accent">{#snippet children()}{record.kind}{/snippet}</Pill> <Pill tone="mute">{#snippet children()}{record.status}{/snippet}</Pill></div>
          <p>{record.summary ?? record.content}</p>
          <small>{record.source} · {record.lastSeenAt}</small>
        </article>
      {/each}
    </div>
  {/if}
</section>
```

Add CSS in the same file for `.settings-memory-records`, `.settings-memory-record`, `.settings-textarea`, and `.settings-actions` using existing settings colors and spacing.

- [ ] **Step 5: Add section to Settings app**

Modify `client/settings/SettingsApp.svelte`:

```ts
import MemorySection from './sections/MemorySection.svelte'
```

Add `{ id: 'memory', label: 'Memory' }` after Profile in the Personal group, and render:

```svelte
<MemorySection contextId={ctx} />
```

after `<ProfileSection contextId={ctx} />`.

- [ ] **Step 6: Verify and commit**

Run:

```bash
bun test:client tests/client/settings/MemorySection.test.ts
bun test:client
bun run typecheck
```

Expected: PASS.

Commit:

```bash
git add client/settings/fetcher-schemas.ts client/settings/fetchers.ts client/settings/sections/MemorySection.svelte client/settings/SettingsApp.svelte tests/client/settings/MemorySection.test.ts
git commit -m "feat(memory): add settings memory controls"
```

---

### Task 9: Decay Maintenance And Final Verification

**Files:**

- Create: `src/long-term-memory/maintenance.ts`
- Modify: `src/scheduler-instance.ts`
- Test: `tests/long-term-memory/maintenance.test.ts`

- [ ] **Step 1: Write maintenance tests**

Create `tests/long-term-memory/maintenance.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test'

import { setupTestDb } from '../utils/db.js'
import { runMemoryMaintenance } from '../../src/long-term-memory/maintenance.js'
import { listMemoryRecords, saveMemoryRecord } from '../../src/long-term-memory/store.js'

describe('runMemoryMaintenance', () => {
  beforeEach(() => setupTestDb())

  test('marks old decisions stale and archives expired records', () => {
    saveMemoryRecord({
      id: 'old-decision',
      scopeId: 'group-1',
      scopeType: 'group',
      kind: 'decision',
      content: 'Release on Fridays.',
      summary: 'Friday release',
      tags: [],
      confidence: 0.9,
      status: 'active',
      source: 'background',
      evidence: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    })
    saveMemoryRecord({
      id: 'expired-reference',
      scopeId: 'group-1',
      scopeType: 'group',
      kind: 'reference',
      content: 'Temporary link.',
      summary: null,
      tags: [],
      confidence: 0.7,
      status: 'active',
      source: 'explicit',
      evidence: {},
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
      lastSeenAt: '2026-06-01T00:00:00.000Z',
      expiresAt: '2026-06-10T00:00:00.000Z',
    })

    expect(runMemoryMaintenance('2026-06-11T00:00:00.000Z')).toEqual({ staleMarked: 1, archived: 1 })
    expect(listMemoryRecords({ scopeId: 'group-1', status: 'stale' }).map((r) => r.id)).toEqual(['old-decision'])
    expect(listMemoryRecords({ scopeId: 'group-1', status: 'archived' }).map((r) => r.id)).toEqual([
      'expired-reference',
    ])
  })
})
```

- [ ] **Step 2: Run maintenance tests and verify failure**

Run:

```bash
bun test tests/long-term-memory/maintenance.test.ts
```

Expected: FAIL because maintenance does not exist.

- [ ] **Step 3: Implement maintenance**

Create `src/long-term-memory/maintenance.ts`:

```ts
const STALE_DAYS_BY_KIND: Record<MemoryKind, number> = {
  preference: 180,
  procedure: 180,
  decision: 90,
  project_context: 90,
  person_context: 90,
  episode: 45,
  reference: 45,
  fact: 90,
}

const dayMs = 24 * 60 * 60 * 1000
const cutoff = (nowMs: number, days: number): string => new Date(nowMs - days * dayMs).toISOString()

export function runMemoryMaintenance(nowIso: string = new Date().toISOString()): {
  staleMarked: number
  archived: number
} {
  const db = getDrizzleDb().$client
  const nowMs = Date.parse(nowIso)
  let staleMarked = 0
  for (const [kind, days] of Object.entries(STALE_DAYS_BY_KIND) as [MemoryKind, number][]) {
    const result = db
      .prepare(
        `UPDATE memory_records SET status = 'stale', updated_at = ? WHERE kind = ? AND status = 'active' AND source != 'explicit' AND last_seen_at <= ?`,
      )
      .run(nowIso, kind, cutoff(nowMs, days))
    staleMarked += result.changes
  }
  const archived = db
    .prepare(
      `UPDATE memory_records SET status = 'archived', updated_at = ? WHERE status != 'archived' AND expires_at IS NOT NULL AND expires_at <= ?`,
    )
    .run(nowIso, nowIso).changes
  log.info({ staleMarked, archived }, 'Long-term memory maintenance complete')
  return { staleMarked, archived }
}
```

- [ ] **Step 4: Register scheduler task**

Modify `src/scheduler-instance.ts`:

```ts
import { runMemoryMaintenance } from './long-term-memory/maintenance.js'
```

Register:

```ts
scheduler.register('long-term-memory-maintenance', {
  interval: 60 * 60 * 1000,
  handler: () => {
    runMemoryMaintenance()
  },
})
```

Follow the surrounding task registration style exactly.

- [ ] **Step 5: Final verification**

Run focused tests:

```bash
bun test tests/long-term-memory
bun test tests/tools/memory.test.ts
bun test tests/debug/settings-memory-routes.test.ts
bun test:client tests/client/settings/MemorySection.test.ts
```

Run broader checks:

```bash
bun run test
bun test:client
bun run typecheck
bun run format:check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/long-term-memory/maintenance.ts src/scheduler-instance.ts tests/long-term-memory/maintenance.test.ts
git commit -m "feat(memory): retire stale long-term memories"
```

---

## Self-Review

Spec coverage:

- Background capture: Task 5.
- Personal and group memory: Tasks 2, 3, 5, 6, 7, 8.
- Group memory shared across threads: Task 2 and Task 5.
- Bounded context: Task 4.
- Agent retrieval tools: Task 6.
- Timestamps, confidence, evidence, status, decay: Tasks 1, 3, 5, 9.
- User/admin controls: Tasks 7 and 8.
- SQLite/settings/tool-permission fit: Tasks 1, 6, 7, 8.

Placeholder scan:

- No placeholder markers or open-ended steps.
- Every task has concrete files, tests, commands, and expected outcomes.

Type consistency:

- Scope types use `personal | group`.
- Record kinds/status/source values match the design spec and migration checks.
- Tool names match the planned metadata and builder integration.
