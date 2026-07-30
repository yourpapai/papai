<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory Gate 1a — Canonical Capture Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every memory capture as a canonical event with a durable outbox, a durable attempt
log, and a stable identity model, written in dark mode beside the existing `memory_records` path.

**Architecture:** Four new SQLite tables (`memory_canonical_events`, `memory_projection_outbox`,
`memory_canonical_capture_attempts`, `memory_canonical_state`). A pure identity module derives an
idempotency identity from `(scopeType, scopeId, contentHash(content))` — reusing the tombstone
module's hash so dedup and erasure agree on what content means — and a content identity from a
canonical JSON encoding of the full payload. One function, `captureCanonicalEvent`, performs the
whole write in a single synchronous `db.transaction()` and returns one of four outcomes. Two hooks in
`saveMemoryRecord` and one in `updateMemoryRecord` call it after the live path has already decided,
so a canonical failure can never change a reader answer.

**Spec:** [`docs/superpowers/specs/2026-07-30-memory-gate1a-canonical-capture-spine-design.md`](../specs/2026-07-30-memory-gate1a-canonical-capture-spine-design.md)

**Tech Stack:** Bun, `bun:sqlite` + Drizzle ORM (`drizzle-orm/sqlite-core`), Bun test runner, pino
logging, strict TypeScript.

## Global Constraints

- Every new `.ts` file starts with the four-line BUSL header comment used by every file in `src/` and
  `tests/` (`// SPDX-License-Identifier: BUSL-1.1` / `// Copyright (c) 2026 Dmitriy Lazarev` / `// Use
  of this software is governed by the Business Source License 1.1.` / `// See LICENSE in the project
  root for details.`). The pre-commit hook fails without it.
- **All import paths use the `.js` extension**, even for TypeScript sources (`./tombstone.js`).
- **Never add a lint-disable or type-ignore comment.** The write hook blocks them; fix the underlying
  issue instead. A `max-lines` failure is a signal to split the file, not to compress formatting.
- Error extraction is always `error instanceof Error ? error.message : String(error)`.
- Logging is mandatory and metadata-first: `logger.child({ scope: 'long-term-memory:<module>' })`,
  then `log.debug({ ... }, 'message')`. **Never log memory content, tokens, or keys** — log scope
  ids, identities (hashes), outcomes, and counts only.
- `contentHash` and `normalizeForHash` are **imported from `src/long-term-memory/tombstone.js`** and
  never reimplemented. This is a spec requirement, not a convenience.
- **Do not touch `tests/long-term-memory/acceptance/` at all.** No criterion promotes in this plan,
  and `registry.test.ts` asserts that a `predicate-registered` criterion exports no `CASES` table.
  `tests/long-term-memory/acceptance/predicate-registrations.ts` is append-only and must never be
  edited.
- **No backfill.** The canonical tables start empty; the migration records only a cutover marker.
- The canonical write must never throw into its caller and must never alter what
  `saveMemoryRecord` / `updateMemoryRecord` return.
- Fixed constants used across tasks: `CAPTURE_VERSION = 'v1'`, `CANONICAL_SCHEMA_VERSION = 1`, kill
  switch env var `MEMORY_CANONICAL_CAPTURE`, disabled **only** by the exact string `'off'`.
- Tests use `setupTestDb()` from `tests/utils/test-helpers.js` in `beforeEach`; no fixed-wall-clock
  timing assertions; any `process.env` mutation is restored in `afterEach`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/db/migrations/077_memory_canonical_capture.ts` | Creates the four tables, their indexes, and the cutover marker row |
| `src/db/memory-canonical-schema.ts` | Drizzle table definitions + row types for the four tables |
| `src/db/schema.ts` (modify) | Re-exports the new tables and row types from the barrel |
| `src/db/index.ts` (modify) | Registers migration 077 in `MIGRATIONS` |
| `src/long-term-memory/canonical-identity.ts` | Pure identity derivation: `idempotencyIdentity`, `canonicalJson`, `contentIdentity`, version constants |
| `src/long-term-memory/canonical-event-values.ts` | Pure mapping: `MemoryRecordInput` → payload and event row values; event-time derivation; ISO max |
| `src/long-term-memory/canonical-capture-config.ts` | Kill switch `isCanonicalCaptureEnabled()` |
| `src/long-term-memory/canonical-capture.ts` | `captureCanonicalEvent` — the transaction, the four outcomes, the attempt log |
| `src/long-term-memory/store.ts` (modify) | Three hook call sites |
| `tests/long-term-memory/canonical-schema.test.ts` | Migration/table/constraint tests |
| `tests/long-term-memory/canonical-identity.test.ts` | Identity determinism and tombstone-hash agreement |
| `tests/long-term-memory/canonical-event-values.test.ts` | Event-time derivation and payload mapping |
| `tests/long-term-memory/canonical-capture.test.ts` | Outcomes, replay, monotonic observation, UNIQUE |
| `tests/long-term-memory/canonical-capture-faults.test.ts` | B1 fault injection, enumeration invariant, failure recording, kill switch |
| `tests/long-term-memory/canonical-hook.test.ts` | `store.ts` hook behavior and non-interference |

---

### Task 1: Canonical schema and migration

**Files:**

- Create: `src/db/migrations/077_memory_canonical_capture.ts`
- Create: `src/db/memory-canonical-schema.ts`
- Modify: `src/db/schema.ts` (add exports beside the existing long-term-memory re-exports at lines 81–94)
- Modify: `src/db/index.ts` (import at ~line 89, registration at ~line 200)
- Test: `tests/long-term-memory/canonical-schema.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: Drizzle tables `memoryCanonicalEvents`, `memoryProjectionOutbox`,
  `memoryCanonicalCaptureAttempts`, `memoryCanonicalState`, exported from
  `src/db/memory-canonical-schema.js` and re-exported from `src/db/schema.js`. Row types
  `MemoryCanonicalEventRow`, `MemoryProjectionOutboxRow`, `MemoryCanonicalCaptureAttemptRow`,
  `MemoryCanonicalStateRow`.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/canonical-schema.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  memoryCanonicalCaptureAttempts,
  memoryCanonicalEvents,
  memoryCanonicalState,
  memoryProjectionOutbox,
} from '../../src/db/schema.js'
import { setupTestDb } from '../utils/test-helpers.js'

const EVENT = {
  eventId: 'evt-1',
  idempotencyIdentity: 'ident-1',
  contentIdentity: 'content-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'likes dark mode',
  confidence: 0.9,
  source: 'background',
  eventTime: '2026-07-30T00:00:00.000Z',
  ingestTime: '2026-07-30T00:00:01.000Z',
  lastObservedAt: '2026-07-30T00:00:00.000Z',
  schemaVersion: 1,
  captureVersion: 'v1',
} satisfies typeof memoryCanonicalEvents.$inferInsert

describe('canonical capture schema', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('the canonical tables start empty — the migration backfills nothing', () => {
    expect(getDrizzleDb().select().from(memoryCanonicalEvents).all()).toHaveLength(0)
    expect(getDrizzleDb().select().from(memoryProjectionOutbox).all()).toHaveLength(0)
    expect(getDrizzleDb().select().from(memoryCanonicalCaptureAttempts).all()).toHaveLength(0)
  })

  test('the migration records exactly one cutover marker', () => {
    const rows = getDrizzleDb().select().from(memoryCanonicalState).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('singleton')
    expect(rows[0]?.cutoverAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
  })

  test('idempotency_identity is UNIQUE — a second event for one identity is rejected', () => {
    getDrizzleDb().insert(memoryCanonicalEvents).values(EVENT).run()
    expect(() => {
      getDrizzleDb()
        .insert(memoryCanonicalEvents)
        .values({ ...EVENT, eventId: 'evt-2' })
        .run()
    }).toThrow()
  })

  test('outbox positions are monotonic and never reused after deletion', () => {
    const db = getDrizzleDb()
    db.insert(memoryCanonicalEvents).values(EVENT).run()
    db.insert(memoryProjectionOutbox)
      .values({ eventId: 'evt-1', op: 'capture', state: 'pending', enqueuedAt: EVENT.ingestTime })
      .run()
    const first = db.select().from(memoryProjectionOutbox).all()[0]?.position ?? 0

    db.delete(memoryProjectionOutbox).run()
    db.insert(memoryProjectionOutbox)
      .values({ eventId: 'evt-1', op: 'observe', state: 'pending', enqueuedAt: EVENT.ingestTime })
      .run()
    const second = db.select().from(memoryProjectionOutbox).all()[0]?.position ?? 0

    expect(second).toBeGreaterThan(first)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/long-term-memory/canonical-schema.test.ts`
Expected: FAIL — the imports from `../../src/db/schema.js` do not resolve
(`memoryCanonicalEvents` is not exported).

- [ ] **Step 3: Write the Drizzle schema**

Create `src/db/memory-canonical-schema.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * The canonical capture log: one row per captured memory item, keyed by its idempotency
 * identity. `memory_records` is its projection. Append-only apart from `last_observed_at`,
 * which advances monotonically when the same item is observed again.
 */
export const memoryCanonicalEvents = sqliteTable(
  'memory_canonical_events',
  {
    eventId: text('event_id').primaryKey(),
    idempotencyIdentity: text('idempotency_identity').notNull().unique(),
    contentIdentity: text('content_identity').notNull(),
    scopeId: text('scope_id').notNull(),
    scopeType: text('scope_type', { enum: ['personal', 'group'] }).notNull(),
    threadContextId: text('thread_context_id'),
    kind: text('kind').notNull(),
    content: text('content').notNull(),
    summary: text('summary'),
    tags: text('tags').notNull().default('[]'),
    confidence: real('confidence').notNull(),
    source: text('source').notNull(),
    actorIds: text('actor_ids').notNull().default('[]'),
    provenance: text('provenance').notNull().default('{}'),
    eventTime: text('event_time').notNull(),
    ingestTime: text('ingest_time').notNull(),
    lastObservedAt: text('last_observed_at').notNull(),
    validFrom: text('valid_from'),
    validUntil: text('valid_until'),
    expiresAt: text('expires_at'),
    /** Reserved for 1b's supersession resolution; always null in 1a. */
    supersedes: text('supersedes'),
    /** The `memory_records` row this event corresponds to, for 1d's reconciliation. */
    recordId: text('record_id'),
    schemaVersion: integer('schema_version').notNull(),
    captureVersion: text('capture_version').notNull(),
  },
  (table) => [index('idx_memory_canonical_events_scope_time').on(table.scopeType, table.scopeId, table.eventTime)],
)

/**
 * Projection work queue. `position` is the checkpoint position 1b consumes: monotonic and
 * never reused, so a checkpoint can never be overtaken by a lower-numbered later row.
 */
export const memoryProjectionOutbox = sqliteTable(
  'memory_projection_outbox',
  {
    position: integer('position').primaryKey({ autoIncrement: true }),
    eventId: text('event_id').notNull(),
    op: text('op', { enum: ['capture', 'observe'] }).notNull(),
    state: text('state', { enum: ['pending', 'complete', 'failed'] })
      .notNull()
      .default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    enqueuedAt: text('enqueued_at').notNull(),
    lastAttemptAt: text('last_attempt_at'),
    lastError: text('last_error'),
  },
  (table) => [index('idx_memory_projection_outbox_state_position').on(table.state, table.position)],
)

/**
 * Every capture attempt, including the ones that wrote no event. Required by observable O1,
 * which this spec reads as "suppressed attempts are themselves enumerable from storage".
 */
export const memoryCanonicalCaptureAttempts = sqliteTable(
  'memory_canonical_capture_attempts',
  {
    position: integer('position').primaryKey({ autoIncrement: true }),
    idempotencyIdentity: text('idempotency_identity').notNull(),
    contentIdentity: text('content_identity').notNull(),
    scopeId: text('scope_id').notNull(),
    scopeType: text('scope_type', { enum: ['personal', 'group'] }).notNull(),
    outcome: text('outcome', {
      enum: ['captured', 'suppressed-duplicate', 'suppressed-tombstoned', 'failed'],
    }).notNull(),
    eventId: text('event_id'),
    eventTime: text('event_time').notNull(),
    ingestTime: text('ingest_time').notNull(),
    captureVersion: text('capture_version').notNull(),
  },
  (table) => [index('idx_memory_canonical_capture_attempts_identity').on(table.idempotencyIdentity)],
)

/**
 * Single-row marker recording when canonical capture started. 1d scopes its reconciliation to
 * records created at or after this instant, because nothing before it was ever captured
 * canonically and no history is fabricated to pretend otherwise.
 */
export const memoryCanonicalState = sqliteTable('memory_canonical_state', {
  id: text('id').primaryKey(),
  cutoverAt: text('cutover_at').notNull(),
})

export type MemoryCanonicalEventRow = typeof memoryCanonicalEvents.$inferSelect
export type MemoryProjectionOutboxRow = typeof memoryProjectionOutbox.$inferSelect
export type MemoryCanonicalCaptureAttemptRow = typeof memoryCanonicalCaptureAttempts.$inferSelect
export type MemoryCanonicalStateRow = typeof memoryCanonicalState.$inferSelect
```

- [ ] **Step 4: Write the migration**

Create `src/db/migrations/077_memory_canonical_capture.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:077' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS memory_canonical_events (
      event_id              TEXT NOT NULL PRIMARY KEY,
      idempotency_identity  TEXT NOT NULL UNIQUE,
      content_identity      TEXT NOT NULL,
      scope_id              TEXT NOT NULL,
      scope_type            TEXT NOT NULL CHECK (scope_type IN ('personal', 'group')),
      thread_context_id     TEXT,
      kind                  TEXT NOT NULL,
      content               TEXT NOT NULL,
      summary               TEXT,
      tags                  TEXT NOT NULL DEFAULT '[]',
      confidence            REAL NOT NULL,
      source                TEXT NOT NULL,
      actor_ids             TEXT NOT NULL DEFAULT '[]',
      provenance            TEXT NOT NULL DEFAULT '{}',
      event_time            TEXT NOT NULL,
      ingest_time           TEXT NOT NULL,
      last_observed_at      TEXT NOT NULL,
      valid_from            TEXT,
      valid_until           TEXT,
      expires_at            TEXT,
      supersedes            TEXT,
      record_id             TEXT,
      schema_version        INTEGER NOT NULL,
      capture_version       TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memory_canonical_events_scope_time
      ON memory_canonical_events(scope_type, scope_id, event_time)
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS memory_projection_outbox (
      position         INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id         TEXT NOT NULL,
      op               TEXT NOT NULL CHECK (op IN ('capture', 'observe')),
      state            TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'complete', 'failed')),
      attempt_count    INTEGER NOT NULL DEFAULT 0,
      enqueued_at      TEXT NOT NULL,
      last_attempt_at  TEXT,
      last_error       TEXT
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memory_projection_outbox_state_position
      ON memory_projection_outbox(state, position)
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS memory_canonical_capture_attempts (
      position              INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_identity  TEXT NOT NULL,
      content_identity      TEXT NOT NULL,
      scope_id              TEXT NOT NULL,
      scope_type            TEXT NOT NULL CHECK (scope_type IN ('personal', 'group')),
      outcome               TEXT NOT NULL CHECK (
        outcome IN ('captured', 'suppressed-duplicate', 'suppressed-tombstoned', 'failed')
      ),
      event_id              TEXT,
      event_time            TEXT NOT NULL,
      ingest_time           TEXT NOT NULL,
      capture_version       TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memory_canonical_capture_attempts_identity
      ON memory_canonical_capture_attempts(idempotency_identity)
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS memory_canonical_state (
      id          TEXT NOT NULL PRIMARY KEY CHECK (id = 'singleton'),
      cutover_at  TEXT NOT NULL
    )
  `)
  // The cutover marker, not a backfill: canonical history begins here, and nothing earlier is
  // fabricated to look as though it went through this path.
  db.run(`
    INSERT OR IGNORE INTO memory_canonical_state (id, cutover_at)
    VALUES ('singleton', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `)

  log.info('migration 077: canonical capture tables created; cutover marker recorded')
}

export const migration077MemoryCanonicalCapture: Migration = {
  id: '077_memory_canonical_capture',
  up,
}

export default migration077MemoryCanonicalCapture
```

- [ ] **Step 5: Register the migration and the barrel exports**

In `src/db/index.ts`, add the import immediately after the line importing
`migration076MemoryProfileContaminatedAt` (~line 89):

```typescript
import { migration077MemoryCanonicalCapture } from './migrations/077_memory_canonical_capture.js'
```

and add the entry as the last element of the `MIGRATIONS` array, immediately after
`migration076MemoryProfileContaminatedAt,` (~line 200):

```typescript
  migration077MemoryCanonicalCapture,
```

In `src/db/schema.ts`, immediately after the existing `export type { ... } from
'./long-term-memory-schema.js'` block (which ends at line 94), add:

```typescript
export {
  memoryCanonicalEvents,
  memoryProjectionOutbox,
  memoryCanonicalCaptureAttempts,
  memoryCanonicalState,
} from './memory-canonical-schema.js'
export type {
  MemoryCanonicalEventRow,
  MemoryProjectionOutboxRow,
  MemoryCanonicalCaptureAttemptRow,
  MemoryCanonicalStateRow,
} from './memory-canonical-schema.js'
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test tests/long-term-memory/canonical-schema.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 7: Verify nothing else broke**

Run: `bun test tests/long-term-memory/ tests/db/`
Expected: PASS, no failures.

- [ ] **Step 8: Commit**

```bash
git add src/db/memory-canonical-schema.ts src/db/migrations/077_memory_canonical_capture.ts \
  src/db/schema.ts src/db/index.ts tests/long-term-memory/canonical-schema.test.ts
git commit -m "feat(memory): add the canonical capture tables and cutover marker"
```

---

### Task 2: Identity module

**Files:**

- Create: `src/long-term-memory/canonical-identity.ts`
- Test: `tests/long-term-memory/canonical-identity.test.ts`

**Interfaces:**

- Consumes: `contentHash` from `src/long-term-memory/tombstone.js`; `MemoryScope` from
  `src/long-term-memory/types.js`.
- Produces:
  - `export const CAPTURE_VERSION = 'v1'`
  - `export const CANONICAL_SCHEMA_VERSION = 1`
  - `export type CanonicalPayload = Readonly<{ scopeType: MemoryScopeType; scopeId: string;
    threadContextId: string | null; kind: string; content: string; summary: string | null; tags:
    readonly string[]; confidence: number; source: string; actorIds: readonly string[]; provenance:
    CanonicalProvenance; eventTime: string; validFrom: string | null; validUntil: string | null;
    expiresAt: string | null }>`
  - `export type CanonicalProvenance = Readonly<{ messageIds: readonly string[]; threads: readonly
    string[]; contextId: string | null }>`
  - `export const idempotencyIdentity: (scope: MemoryScope, content: string) => string`
  - `export const canonicalJson: (payload: CanonicalPayload) => string`
  - `export const contentIdentity: (payload: CanonicalPayload) => string`

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/canonical-identity.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  type CanonicalPayload,
  canonicalJson,
  contentIdentity,
  idempotencyIdentity,
} from '../../src/long-term-memory/canonical-identity.js'
import { contentHash } from '../../src/long-term-memory/tombstone.js'
import type { MemoryScope } from '../../src/long-term-memory/types.js'

const scope: MemoryScope = { scopeId: 'user-1', scopeType: 'personal' }

const payload = (overrides: Partial<CanonicalPayload> = {}): CanonicalPayload => ({
  scopeType: 'personal',
  scopeId: 'user-1',
  threadContextId: null,
  kind: 'fact',
  content: 'likes dark mode',
  summary: null,
  tags: ['ui', 'theme'],
  confidence: 0.9,
  source: 'background',
  actorIds: ['actor-1'],
  provenance: { messageIds: ['m-1'], threads: [], contextId: 'ctx-1' },
  eventTime: '2026-07-30T00:00:00.000Z',
  validFrom: null,
  validUntil: null,
  expiresAt: null,
  ...overrides,
})

describe('idempotencyIdentity', () => {
  test('is deterministic across calls', () => {
    expect(idempotencyIdentity(scope, 'likes dark mode')).toBe(idempotencyIdentity(scope, 'likes dark mode'))
  })

  test('inherits the tombstone normalization: case and whitespace variants share an identity', () => {
    expect(idempotencyIdentity(scope, '  Likes   DARK mode ')).toBe(idempotencyIdentity(scope, 'likes dark mode'))
  })

  test('separates scopes that differ only by type or id', () => {
    const byType = idempotencyIdentity({ scopeId: 'user-1', scopeType: 'group' }, 'x')
    const byId = idempotencyIdentity({ scopeId: 'user-2', scopeType: 'personal' }, 'x')
    expect(idempotencyIdentity(scope, 'x')).not.toBe(byType)
    expect(idempotencyIdentity(scope, 'x')).not.toBe(byId)
  })

  test('the field separator prevents boundary collisions between scope type and id', () => {
    // Concatenation without a separator that cannot occur in a field would let
    // ('personal', 'x-user') and ('personalx', '-user') join to the same string.
    const a = idempotencyIdentity({ scopeType: 'personal', scopeId: 'x-user' }, 'c')
    const b = idempotencyIdentity({ scopeType: 'personal', scopeId: 'x' }, 'c')
    const c = idempotencyIdentity({ scopeType: 'group', scopeId: 'x-user' }, 'c')
    expect(new Set([a, b, c]).size).toBe(3)
  })

  test('differs whenever the tombstone content hash differs', () => {
    // The load-bearing agreement: the tombstone hash IS a component of this key, so
    // "is this tombstoned?" and "is this a duplicate?" cannot disagree about what
    // content means. Same hash => same identity; different hash => different identity.
    expect(contentHash('likes dark mode')).toBe(contentHash('LIKES  dark MODE '))
    expect(idempotencyIdentity(scope, 'LIKES  dark MODE ')).toBe(idempotencyIdentity(scope, 'likes dark mode'))

    expect(contentHash('likes dark mode')).not.toBe(contentHash('likes light mode'))
    expect(idempotencyIdentity(scope, 'likes light mode')).not.toBe(idempotencyIdentity(scope, 'likes dark mode'))
  })
})

describe('canonicalJson', () => {
  test('is stable under key reordering', () => {
    const reordered = { ...payload() }
    expect(canonicalJson(reordered)).toBe(canonicalJson(payload()))
  })

  test('is stable under tag reordering', () => {
    expect(canonicalJson(payload({ tags: ['theme', 'ui'] }))).toBe(canonicalJson(payload({ tags: ['ui', 'theme'] })))
  })

  test('encodes nulls explicitly rather than dropping the key', () => {
    expect(canonicalJson(payload({ summary: null }))).toContain('"summary":null')
  })
})

describe('contentIdentity', () => {
  test('two payloads sharing an idempotency identity but differing in metadata are distinguishable', () => {
    const base = payload()
    const other = payload({ confidence: 0.5 })
    expect(idempotencyIdentity(scope, base.content)).toBe(idempotencyIdentity(scope, other.content))
    expect(contentIdentity(base)).not.toBe(contentIdentity(other))
  })

  test('is deterministic for an identical payload', () => {
    expect(contentIdentity(payload())).toBe(contentIdentity(payload()))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/long-term-memory/canonical-identity.test.ts`
Expected: FAIL — `Cannot find module '../../src/long-term-memory/canonical-identity.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/long-term-memory/canonical-identity.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { contentHash } from './tombstone.js'
import type { MemoryScope, MemoryScopeType } from './types.js'

/**
 * Which derivation rule produced an identity. Bump this whenever `normalizeForHash`, the
 * field list, or the join changes, so an identity written under the old rule stays
 * attributable instead of being silently reinterpreted.
 */
export const CAPTURE_VERSION = 'v1'

/** Shape version of a canonical event row. */
export const CANONICAL_SCHEMA_VERSION = 1

export type CanonicalProvenance = Readonly<{
  messageIds: readonly string[]
  threads: readonly string[]
  contextId: string | null
}>

/** The identity-bearing view of a capture. Everything here participates in `contentIdentity`. */
export type CanonicalPayload = Readonly<{
  scopeType: MemoryScopeType
  scopeId: string
  threadContextId: string | null
  kind: string
  content: string
  summary: string | null
  tags: readonly string[]
  confidence: number
  source: string
  actorIds: readonly string[]
  provenance: CanonicalProvenance
  eventTime: string
  validFrom: string | null
  validUntil: string | null
  expiresAt: string | null
}>

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')

/**
 * U+0000 separator: it cannot occur in a scope id or a hex hash, so no two distinct field
 * tuples can join to the same string.
 */
const join = (...parts: readonly string[]): string => parts.join('\u0000')

/**
 * Decides whether two capture attempts are the same attempt.
 *
 * `contentHash` is imported from the tombstone module rather than reimplemented: a
 * tombstone's stored hash is literally a component of this key, so "is this content
 * tombstoned?" and "is this content a duplicate?" cannot disagree about what content means.
 */
export const idempotencyIdentity = (scope: MemoryScope, content: string): string =>
  sha256(join(scope.scopeType, scope.scopeId, contentHash(content)))

/** Sorted keys, sorted tags, explicit nulls — so encoding order can never change an identity. */
export const canonicalJson = (payload: CanonicalPayload): string => {
  const ordered = {
    confidence: payload.confidence,
    content: payload.content,
    eventTime: payload.eventTime,
    expiresAt: payload.expiresAt,
    kind: payload.kind,
    provenance: {
      contextId: payload.provenance.contextId,
      messageIds: [...payload.provenance.messageIds].sort(),
      threads: [...payload.provenance.threads].sort(),
    },
    actorIds: [...payload.actorIds].sort(),
    scopeId: payload.scopeId,
    scopeType: payload.scopeType,
    source: payload.source,
    summary: payload.summary,
    tags: [...payload.tags].sort(),
    threadContextId: payload.threadContextId,
    validFrom: payload.validFrom,
    validUntil: payload.validUntil,
  }
  return JSON.stringify(ordered, Object.keys(ordered).sort())
}

/**
 * Distinguishes two attempts that share an idempotency identity but differ in metadata —
 * what 1d compares when reconciling payload identities against the current path.
 */
export const contentIdentity = (payload: CanonicalPayload): string => sha256(canonicalJson(payload))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/long-term-memory/canonical-identity.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/canonical-identity.ts tests/long-term-memory/canonical-identity.test.ts
git commit -m "feat(memory): derive canonical idempotency and content identities"
```

---

### Task 3: Event-time derivation and payload mapping

**Files:**

- Create: `src/long-term-memory/canonical-event-values.ts`
- Test: `tests/long-term-memory/canonical-event-values.test.ts`

**Interfaces:**

- Consumes: `CanonicalPayload`, `CanonicalProvenance`, `CANONICAL_SCHEMA_VERSION`,
  `CAPTURE_VERSION`, `contentIdentity` from `./canonical-identity.js`; `MemoryRecordInput` from
  `./types.js`; `memoryCanonicalEvents` from `../db/schema.js`.
- Produces:
  - `export const deriveEventTime: (input: MemoryRecordInput) => string`
  - `export const laterIso: (a: string, b: string) => string`
  - `export const toCanonicalPayload: (input: MemoryRecordInput) => CanonicalPayload`
  - `export const toEventValues: (args: Readonly<{ eventId: string; identity: string; payload:
    CanonicalPayload; input: MemoryRecordInput; ingestTime: string; recordId: string | null }>) =>
    typeof memoryCanonicalEvents.$inferInsert`

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/canonical-event-values.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  deriveEventTime,
  laterIso,
  toCanonicalPayload,
  toEventValues,
} from '../../src/long-term-memory/canonical-event-values.js'
import { contentIdentity, idempotencyIdentity } from '../../src/long-term-memory/canonical-identity.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'

const input = (overrides: Partial<MemoryRecordInput> = {}): MemoryRecordInput => ({
  id: 'rec-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'likes dark mode',
  summary: null,
  tags: ['ui'],
  confidence: 0.9,
  status: 'active',
  source: 'background',
  evidence: {},
  createdAt: '2026-07-30T12:00:00.000Z',
  updatedAt: '2026-07-30T12:00:00.000Z',
  lastSeenAt: '2026-07-30T12:00:00.000Z',
  ...overrides,
})

describe('deriveEventTime', () => {
  test('uses the latest evidence timestamp when evidence carries any', () => {
    const derived = deriveEventTime(
      input({
        evidence: { timestamps: ['2026-07-29T09:00:00.000Z', '2026-07-29T11:00:00.000Z'] },
      }),
    )
    expect(derived).toBe('2026-07-29T11:00:00.000Z')
  })

  test('picks the maximum regardless of the order timestamps arrive in', () => {
    const ascending = deriveEventTime(input({ evidence: { timestamps: ['2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z'] } }))
    const descending = deriveEventTime(input({ evidence: { timestamps: ['2026-07-02T00:00:00.000Z', '2026-07-01T00:00:00.000Z'] } }))
    expect(ascending).toBe(descending)
  })

  test('falls back to createdAt when evidence has no timestamps', () => {
    expect(deriveEventTime(input())).toBe('2026-07-30T12:00:00.000Z')
  })

  test('falls back to createdAt when every evidence timestamp is unparsable', () => {
    expect(deriveEventTime(input({ evidence: { timestamps: ['not-a-date'] } }))).toBe('2026-07-30T12:00:00.000Z')
  })

  test('ignores unparsable timestamps mixed in with valid ones', () => {
    expect(deriveEventTime(input({ evidence: { timestamps: ['nonsense', '2026-07-05T00:00:00.000Z'] } }))).toBe(
      '2026-07-05T00:00:00.000Z',
    )
  })

  test('is not validFrom — a validity claim about the fact is not when the evidence occurred', () => {
    const derived = deriveEventTime(input({ validFrom: '2020-01-01T00:00:00.000Z' }))
    expect(derived).toBe('2026-07-30T12:00:00.000Z')
  })
})

describe('laterIso', () => {
  test('returns the later of two instants', () => {
    expect(laterIso('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')).toBe('2026-02-01T00:00:00.000Z')
    expect(laterIso('2026-02-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe('2026-02-01T00:00:00.000Z')
  })

  test('is idempotent on equal instants', () => {
    expect(laterIso('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe('2026-01-01T00:00:00.000Z')
  })

  test('keeps the first argument when the second is unparsable', () => {
    expect(laterIso('2026-01-01T00:00:00.000Z', 'garbage')).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('toCanonicalPayload', () => {
  test('lifts actor ids and provenance out of evidence', () => {
    const payload = toCanonicalPayload(
      input({
        evidence: { actorIds: ['a-1'], messageIds: ['m-1'], threads: ['t-1'], contextId: 'ctx-1' },
      }),
    )
    expect(payload.actorIds).toEqual(['a-1'])
    expect(payload.provenance).toEqual({ messageIds: ['m-1'], threads: ['t-1'], contextId: 'ctx-1' })
  })

  test('normalizes absent evidence to empty arrays and null, never undefined', () => {
    const payload = toCanonicalPayload(input())
    expect(payload.actorIds).toEqual([])
    expect(payload.provenance).toEqual({ messageIds: [], threads: [], contextId: null })
    expect(payload.summary).toBeNull()
    expect(payload.threadContextId).toBeNull()
  })
})

describe('toEventValues', () => {
  test('sets lastObservedAt to the event time and stamps both versions', () => {
    const recordInput = input()
    const payload = toCanonicalPayload(recordInput)
    const values = toEventValues({
      eventId: 'evt-1',
      identity: idempotencyIdentity(recordInput, recordInput.content),
      payload,
      input: recordInput,
      ingestTime: '2026-07-30T13:00:00.000Z',
      recordId: 'rec-1',
    })
    expect(values.lastObservedAt).toBe(values.eventTime)
    expect(values.eventTime).toBe('2026-07-30T12:00:00.000Z')
    expect(values.ingestTime).toBe('2026-07-30T13:00:00.000Z')
    expect(values.schemaVersion).toBe(1)
    expect(values.captureVersion).toBe('v1')
    expect(values.contentIdentity).toBe(contentIdentity(payload))
    expect(values.recordId).toBe('rec-1')
    expect(values.supersedes).toBeNull()
  })

  test('serializes tags, actor ids, and provenance as JSON text', () => {
    const recordInput = input({ tags: ['ui', 'theme'], evidence: { actorIds: ['a-1'] } })
    const payload = toCanonicalPayload(recordInput)
    const values = toEventValues({
      eventId: 'evt-1',
      identity: 'ident',
      payload,
      input: recordInput,
      ingestTime: '2026-07-30T13:00:00.000Z',
      recordId: null,
    })
    expect(JSON.parse(values.tags ?? '[]')).toEqual(['ui', 'theme'])
    expect(JSON.parse(values.actorIds ?? '[]')).toEqual(['a-1'])
    expect(JSON.parse(values.provenance ?? '{}')).toEqual({ messageIds: [], threads: [], contextId: null })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/long-term-memory/canonical-event-values.test.ts`
Expected: FAIL — `Cannot find module '../../src/long-term-memory/canonical-event-values.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/long-term-memory/canonical-event-values.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { memoryCanonicalEvents } from '../db/schema.js'
import {
  CANONICAL_SCHEMA_VERSION,
  CAPTURE_VERSION,
  type CanonicalPayload,
  type CanonicalProvenance,
  contentIdentity,
} from './canonical-identity.js'
import type { MemoryRecordInput } from './types.js'

export type CanonicalEventValues = typeof memoryCanonicalEvents.$inferInsert

const parsed = (iso: string): number | undefined => {
  const millis = Date.parse(iso)
  return Number.isNaN(millis) ? undefined : millis
}

/** The later of two instants. An unparsable candidate never wins, so the stored value cannot regress. */
export const laterIso = (a: string, b: string): string => {
  const left = parsed(a)
  const right = parsed(b)
  if (right === undefined) return a
  if (left === undefined) return b
  return right > left ? b : a
}

/**
 * When the evidence occurred, not when it was ingested and not when the claim became valid.
 *
 * Deliberately not `validFrom`: validity is a claim about the fact, while event time is when
 * the evidence occurred, and only the latter makes "ingest order reversed relative to event
 * time" a meaningful condition to test.
 */
export const deriveEventTime = (input: MemoryRecordInput): string => {
  const timestamps = input.evidence.timestamps ?? []
  const latest = timestamps.filter((stamp) => parsed(stamp) !== undefined).reduce<string | null>(
    (best, stamp) => (best === null ? stamp : laterIso(best, stamp)),
    null,
  )
  return latest ?? input.createdAt
}

const toProvenance = (input: MemoryRecordInput): CanonicalProvenance => ({
  messageIds: input.evidence.messageIds ?? [],
  threads: input.evidence.threads ?? [],
  contextId: input.evidence.contextId ?? null,
})

/** The identity-bearing view of one capture. Absent fields normalize to `[]` or `null`, never `undefined`. */
export const toCanonicalPayload = (input: MemoryRecordInput): CanonicalPayload => ({
  scopeType: input.scopeType,
  scopeId: input.scopeId,
  threadContextId: input.threadContextId ?? null,
  kind: input.kind,
  content: input.content,
  summary: input.summary,
  tags: input.tags,
  confidence: input.confidence,
  source: input.source,
  actorIds: input.evidence.actorIds ?? [],
  provenance: toProvenance(input),
  eventTime: deriveEventTime(input),
  validFrom: input.validFrom ?? null,
  validUntil: input.validUntil ?? null,
  expiresAt: input.expiresAt ?? null,
})

export const toEventValues = (
  args: Readonly<{
    eventId: string
    identity: string
    payload: CanonicalPayload
    input: MemoryRecordInput
    ingestTime: string
    recordId: string | null
  }>,
): CanonicalEventValues => ({
  eventId: args.eventId,
  idempotencyIdentity: args.identity,
  contentIdentity: contentIdentity(args.payload),
  scopeId: args.payload.scopeId,
  scopeType: args.payload.scopeType,
  threadContextId: args.payload.threadContextId,
  kind: args.payload.kind,
  content: args.payload.content,
  summary: args.payload.summary,
  tags: JSON.stringify(args.payload.tags),
  confidence: args.payload.confidence,
  source: args.payload.source,
  actorIds: JSON.stringify(args.payload.actorIds),
  provenance: JSON.stringify(args.payload.provenance),
  eventTime: args.payload.eventTime,
  ingestTime: args.ingestTime,
  // A fresh event has been observed exactly once, at its own event time.
  lastObservedAt: args.payload.eventTime,
  validFrom: args.payload.validFrom,
  validUntil: args.payload.validUntil,
  expiresAt: args.payload.expiresAt,
  // Supersession is resolved by 1b's projection, not at capture time.
  supersedes: null,
  recordId: args.recordId,
  schemaVersion: CANONICAL_SCHEMA_VERSION,
  captureVersion: CAPTURE_VERSION,
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/long-term-memory/canonical-event-values.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/canonical-event-values.ts tests/long-term-memory/canonical-event-values.test.ts
git commit -m "feat(memory): map a memory record input onto canonical event values"
```

---

### Task 4: `captureCanonicalEvent` — the three non-failure outcomes

**Files:**

- Create: `src/long-term-memory/canonical-capture-config.ts`
- Create: `src/long-term-memory/canonical-capture.ts`
- Test: `tests/long-term-memory/canonical-capture.test.ts`

**Interfaces:**

- Consumes: `idempotencyIdentity`, `CAPTURE_VERSION`, `contentIdentity` from
  `./canonical-identity.js`; `toCanonicalPayload`, `toEventValues`, `laterIso` from
  `./canonical-event-values.js`; `isContentTombstoned` from `./tombstone.js`; the four tables from
  `../db/schema.js`; `getDrizzleDb` from `../db/drizzle.js`.
- Produces:
  - `export type CaptureOutcome = 'captured' | 'suppressed-duplicate' | 'suppressed-tombstoned' | 'failed'`
  - `export function captureCanonicalEvent(input: MemoryRecordInput, recordId: string | null, now?: string): CaptureOutcome | null`
    — returns `null` when the kill switch is off (no attempt was made, so there is no outcome).
  - `export function isCanonicalCaptureEnabled(): boolean` from `./canonical-capture-config.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/canonical-capture.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  memoryCanonicalCaptureAttempts,
  memoryCanonicalEvents,
  memoryProjectionOutbox,
  memoryTombstones,
} from '../../src/db/schema.js'
import { captureCanonicalEvent } from '../../src/long-term-memory/canonical-capture.js'
import { contentHash } from '../../src/long-term-memory/tombstone.js'
import { insertTombstone } from '../../src/long-term-memory/tombstone.testing.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const INGEST = '2026-07-30T13:00:00.000Z'

const input = (overrides: Partial<MemoryRecordInput> = {}): MemoryRecordInput => ({
  id: 'rec-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'likes dark mode',
  summary: null,
  tags: ['ui'],
  confidence: 0.9,
  status: 'active',
  source: 'background',
  evidence: {},
  createdAt: '2026-07-30T12:00:00.000Z',
  updatedAt: '2026-07-30T12:00:00.000Z',
  lastSeenAt: '2026-07-30T12:00:00.000Z',
  ...overrides,
})

const events = () => getDrizzleDb().select().from(memoryCanonicalEvents).all()
const outbox = () => getDrizzleDb().select().from(memoryProjectionOutbox).all()
const attempts = () => getDrizzleDb().select().from(memoryCanonicalCaptureAttempts).all()

describe('captureCanonicalEvent', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('a first capture writes one event, one capture outbox item, and one attempt', () => {
    expect(captureCanonicalEvent(input(), 'rec-1', INGEST)).toBe('captured')

    expect(events()).toHaveLength(1)
    expect(events()[0]?.recordId).toBe('rec-1')
    expect(events()[0]?.lastObservedAt).toBe('2026-07-30T12:00:00.000Z')
    expect(outbox()).toHaveLength(1)
    expect(outbox()[0]?.op).toBe('capture')
    expect(outbox()[0]?.state).toBe('pending')
    expect(attempts()).toHaveLength(1)
    expect(attempts()[0]?.outcome).toBe('captured')
    expect(attempts()[0]?.eventId).toBe(events()[0]?.eventId)
  })

  test('a pure replay adds no event, no outbox item, and no timestamp change — only an attempt', () => {
    captureCanonicalEvent(input(), 'rec-1', INGEST)
    const before = events()[0]

    expect(captureCanonicalEvent(input(), 'rec-1', '2026-07-30T14:00:00.000Z')).toBe('suppressed-duplicate')

    expect(events()).toHaveLength(1)
    expect(events()[0]?.lastObservedAt).toBe(before?.lastObservedAt)
    expect(outbox()).toHaveLength(1)
    expect(attempts()).toHaveLength(2)
    expect(attempts()[1]?.outcome).toBe('suppressed-duplicate')
  })

  test('ten replays leave exactly one event and one outbox item', () => {
    for (let i = 0; i < 10; i += 1) captureCanonicalEvent(input(), 'rec-1', INGEST)
    expect(events()).toHaveLength(1)
    expect(outbox()).toHaveLength(1)
    expect(attempts()).toHaveLength(10)
  })

  test('a later observation advances lastObservedAt and enqueues an observe item', () => {
    captureCanonicalEvent(input({ evidence: { timestamps: ['2026-07-01T00:00:00.000Z'] } }), 'rec-1', INGEST)
    expect(captureCanonicalEvent(input({ evidence: { timestamps: ['2026-07-05T00:00:00.000Z'] } }), 'rec-1', INGEST)).toBe(
      'suppressed-duplicate',
    )

    expect(events()[0]?.lastObservedAt).toBe('2026-07-05T00:00:00.000Z')
    expect(outbox()).toHaveLength(2)
    expect(outbox()[1]?.op).toBe('observe')
  })

  test('reversed ingest order still leaves lastObservedAt at the maximum event time', () => {
    captureCanonicalEvent(input({ evidence: { timestamps: ['2026-07-05T00:00:00.000Z'] } }), 'rec-1', INGEST)
    captureCanonicalEvent(input({ evidence: { timestamps: ['2026-07-01T00:00:00.000Z'] } }), 'rec-1', INGEST)

    expect(events()[0]?.lastObservedAt).toBe('2026-07-05T00:00:00.000Z')
    // The earlier observation advanced nothing, so it enqueued nothing.
    expect(outbox()).toHaveLength(1)
  })

  test('case and whitespace variants of the same content are one event', () => {
    captureCanonicalEvent(input(), 'rec-1', INGEST)
    captureCanonicalEvent(input({ id: 'rec-2', content: '  LIKES   dark MODE ' }), 'rec-2', INGEST)
    expect(events()).toHaveLength(1)
  })

  test('the same content in a different scope is a different event', () => {
    captureCanonicalEvent(input(), 'rec-1', INGEST)
    captureCanonicalEvent(input({ id: 'rec-2', scopeId: 'user-2' }), 'rec-2', INGEST)
    expect(events()).toHaveLength(2)
  })

  test('tombstoned content is suppressed: no event, no outbox item, but an attempt is recorded', () => {
    insertTombstone({ scopeId: 'user-1', scopeType: 'personal' }, 'likes dark mode', INGEST)

    expect(captureCanonicalEvent(input(), null, INGEST)).toBe('suppressed-tombstoned')

    expect(events()).toHaveLength(0)
    expect(outbox()).toHaveLength(0)
    expect(attempts()).toHaveLength(1)
    expect(attempts()[0]?.outcome).toBe('suppressed-tombstoned')
    expect(attempts()[0]?.eventId).toBeNull()
  })

  test('an explicit save is never gated by a tombstone', () => {
    insertTombstone({ scopeId: 'user-1', scopeType: 'personal' }, 'likes dark mode', INGEST)
    expect(captureCanonicalEvent(input({ source: 'explicit' }), 'rec-1', INGEST)).toBe('captured')
    expect(events()).toHaveLength(1)
  })

  test('the hash a tombstone stores is the hash the identity is built from', () => {
    // Read from storage rather than recomputed: this is the only assertion that catches a
    // future divergence between what erasure records and what dedup keys on.
    insertTombstone({ scopeId: 'user-1', scopeType: 'personal' }, 'likes dark mode', INGEST)
    const stored = getDrizzleDb().select().from(memoryTombstones).all()[0]

    expect(stored?.contentHash).toBe(contentHash('likes dark mode'))
    // And that hash is what suppresses the capture, from the same scope tuple.
    expect(captureCanonicalEvent(input(), null, INGEST)).toBe('suppressed-tombstoned')
  })

  test('every attempt row carries the capture version and both identities', () => {
    captureCanonicalEvent(input(), 'rec-1', INGEST)
    const attempt = attempts()[0]
    expect(attempt?.captureVersion).toBe('v1')
    expect(attempt?.idempotencyIdentity).toBe(events()[0]?.idempotencyIdentity)
    expect(attempt?.contentIdentity).toBe(events()[0]?.contentIdentity)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/long-term-memory/canonical-capture.test.ts`
Expected: FAIL — `Cannot find module '../../src/long-term-memory/canonical-capture.js'`.

- [ ] **Step 3: Write the kill switch**

Create `src/long-term-memory/canonical-capture-config.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Kill switch for dark canonical capture. Default **ON**: capture cannot change a reader
 * answer, and it accrues value only by accruing data, so the useful default is to record.
 * Only the exact string `'off'` disables it; any other value, including unset or empty, is
 * treated as enabled.
 */
export function isCanonicalCaptureEnabled(): boolean {
  return process.env['MEMORY_CANONICAL_CAPTURE'] !== 'off'
}
```

- [ ] **Step 4: Write the capture function**

Create `src/long-term-memory/canonical-capture.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryCanonicalCaptureAttempts, memoryCanonicalEvents, memoryProjectionOutbox } from '../db/schema.js'
import { logger } from '../logger.js'
import { isCanonicalCaptureEnabled } from './canonical-capture-config.js'
import { laterIso, toCanonicalPayload, toEventValues } from './canonical-event-values.js'
import { CAPTURE_VERSION, type CanonicalPayload, contentIdentity, idempotencyIdentity } from './canonical-identity.js'
import { isContentTombstoned } from './tombstone.js'
import type { MemoryRecordInput, MemoryScope } from './types.js'

const log = logger.child({ scope: 'long-term-memory:canonical-capture' })

export type CaptureOutcome = 'captured' | 'suppressed-duplicate' | 'suppressed-tombstoned' | 'failed'

/** The transaction handle passed to `db.transaction((tx) => ...)`, for helpers outside that closure. */
type MemoryTx = Parameters<Parameters<ReturnType<typeof getDrizzleDb>['transaction']>[0]>[0]

type AttemptArgs = Readonly<{
  identity: string
  payload: CanonicalPayload
  ingestTime: string
  outcome: CaptureOutcome
  eventId: string | null
}>

const insertAttempt = (tx: MemoryTx, args: AttemptArgs): void => {
  tx.insert(memoryCanonicalCaptureAttempts)
    .values({
      idempotencyIdentity: args.identity,
      contentIdentity: contentIdentity(args.payload),
      scopeId: args.payload.scopeId,
      scopeType: args.payload.scopeType,
      outcome: args.outcome,
      eventId: args.eventId,
      eventTime: args.payload.eventTime,
      ingestTime: args.ingestTime,
      captureVersion: CAPTURE_VERSION,
    })
    .run()
}

const enqueue = (tx: MemoryTx, eventId: string, op: 'capture' | 'observe', ingestTime: string): void => {
  tx.insert(memoryProjectionOutbox).values({ eventId, op, state: 'pending', enqueuedAt: ingestTime }).run()
}

/**
 * Records one capture attempt in the canonical log.
 *
 * The whole write is one synchronous transaction, which is what makes boundary B1 — a state
 * where an event exists without its outbox item — unreachable rather than merely unlikely:
 * there is no await point between the two inserts for an interleaving to enter, and no
 * partial commit for a crash to leave behind.
 *
 * The tombstone check is repeated here rather than trusted from the caller, so the function
 * is self-contained: both paths reach the same verdict from the same data, which is what the
 * forget-versus-ingest interleavings compare.
 *
 * Returns `null` when the kill switch is off — no attempt was made, so there is no outcome.
 */
export function captureCanonicalEvent(
  input: MemoryRecordInput,
  recordId: string | null,
  now = new Date().toISOString(),
): CaptureOutcome | null {
  if (!isCanonicalCaptureEnabled()) return null

  const scope: MemoryScope = { scopeId: input.scopeId, scopeType: input.scopeType }
  const payload = toCanonicalPayload(input)
  const identity = idempotencyIdentity(scope, input.content)

  const outcome = getDrizzleDb().transaction((tx): CaptureOutcome => {
    if (input.source !== 'explicit' && isContentTombstoned(scope, input.content)) {
      insertAttempt(tx, { identity, payload, ingestTime: now, outcome: 'suppressed-tombstoned', eventId: null })
      return 'suppressed-tombstoned'
    }

    const existing = tx
      .select({ eventId: memoryCanonicalEvents.eventId, lastObservedAt: memoryCanonicalEvents.lastObservedAt })
      .from(memoryCanonicalEvents)
      .where(eq(memoryCanonicalEvents.idempotencyIdentity, identity))
      .get()

    if (existing !== undefined) {
      // Monotonic max over event time: a replay of the same input advances nothing, while a
      // genuinely later observation advances even if it arrives out of ingest order.
      const advanced = laterIso(existing.lastObservedAt, payload.eventTime)
      if (advanced !== existing.lastObservedAt) {
        tx.update(memoryCanonicalEvents)
          .set({ lastObservedAt: advanced })
          .where(eq(memoryCanonicalEvents.eventId, existing.eventId))
          .run()
        enqueue(tx, existing.eventId, 'observe', now)
      }
      insertAttempt(tx, {
        identity,
        payload,
        ingestTime: now,
        outcome: 'suppressed-duplicate',
        eventId: existing.eventId,
      })
      return 'suppressed-duplicate'
    }

    const eventId = randomUUID()
    tx.insert(memoryCanonicalEvents)
      .values(toEventValues({ eventId, identity, payload, input, ingestTime: now, recordId }))
      .run()
    enqueue(tx, eventId, 'capture', now)
    insertAttempt(tx, { identity, payload, ingestTime: now, outcome: 'captured', eventId })
    return 'captured'
  })

  log.debug({ scopeType: input.scopeType, scopeId: input.scopeId, identity, outcome }, 'Canonical capture attempt')
  return outcome
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/long-term-memory/canonical-capture.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 6: Commit**

```bash
git add src/long-term-memory/canonical-capture.ts src/long-term-memory/canonical-capture-config.ts \
  tests/long-term-memory/canonical-capture.test.ts
git commit -m "feat(memory): capture canonical events with an atomic projection outbox"
```

---

### Task 5: Failure recording, B1 unreachability, and the kill switch

**Files:**

- Modify: `src/long-term-memory/canonical-capture.ts` (wrap the transaction; add the failure path)
- Test: `tests/long-term-memory/canonical-capture-faults.test.ts`

**Interfaces:**

- Consumes: everything Task 4 produced.
- Produces: no new exports. `captureCanonicalEvent` gains the guarantee that it never throws and
  records a `failed` attempt when the transaction rolls back.

**Fault-injection method:** a SQLite `BEFORE INSERT` trigger on `memory_projection_outbox` that
raises `ABORT`. This is a real database-level fault at exactly the B1 boundary and needs no
test-only seam in production code. The trigger is created and dropped inside the test.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/canonical-capture-faults.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  memoryCanonicalCaptureAttempts,
  memoryCanonicalEvents,
  memoryProjectionOutbox,
} from '../../src/db/schema.js'
import { captureCanonicalEvent } from '../../src/long-term-memory/canonical-capture.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const INGEST = '2026-07-30T13:00:00.000Z'

const input = (overrides: Partial<MemoryRecordInput> = {}): MemoryRecordInput => ({
  id: 'rec-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'likes dark mode',
  summary: null,
  tags: ['ui'],
  confidence: 0.9,
  status: 'active',
  source: 'background',
  evidence: {},
  createdAt: '2026-07-30T12:00:00.000Z',
  updatedAt: '2026-07-30T12:00:00.000Z',
  lastSeenAt: '2026-07-30T12:00:00.000Z',
  ...overrides,
})

const events = () => getDrizzleDb().select().from(memoryCanonicalEvents).all()
const outbox = () => getDrizzleDb().select().from(memoryProjectionOutbox).all()
const attempts = () => getDrizzleDb().select().from(memoryCanonicalCaptureAttempts).all()

/** Injects a fault at exactly the B1 boundary: after the event insert, on the outbox insert. */
const failTheOutboxInsert = (): void => {
  getDrizzleDb().run(
    sql`CREATE TRIGGER fail_outbox_insert BEFORE INSERT ON memory_projection_outbox
        BEGIN SELECT RAISE(ABORT, 'injected outbox fault'); END`,
  )
}

const clearTheFault = (): void => {
  getDrizzleDb().run(sql`DROP TRIGGER IF EXISTS fail_outbox_insert`)
}

describe('canonical capture faults', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterEach(() => {
    delete process.env['MEMORY_CANONICAL_CAPTURE']
  })

  test('B1 is unreachable: a fault between the two inserts leaves neither row', () => {
    failTheOutboxInsert()
    const outcome = captureCanonicalEvent(input(), 'rec-1', INGEST)
    clearTheFault()

    expect(outcome).toBe('failed')
    expect(events()).toHaveLength(0)
    expect(outbox()).toHaveLength(0)
  })

  test('a failed capture is recorded durably outside the rolled-back transaction', () => {
    failTheOutboxInsert()
    captureCanonicalEvent(input(), 'rec-1', INGEST)
    clearTheFault()

    expect(attempts()).toHaveLength(1)
    expect(attempts()[0]?.outcome).toBe('failed')
    expect(attempts()[0]?.eventId).toBeNull()
  })

  test('a failure never propagates to the caller', () => {
    failTheOutboxInsert()
    expect(() => captureCanonicalEvent(input(), 'rec-1', INGEST)).not.toThrow()
    clearTheFault()
  })

  test('capture recovers once the fault clears', () => {
    failTheOutboxInsert()
    captureCanonicalEvent(input(), 'rec-1', INGEST)
    clearTheFault()

    expect(captureCanonicalEvent(input(), 'rec-1', INGEST)).toBe('captured')
    expect(events()).toHaveLength(1)
    expect(outbox()).toHaveLength(1)
  })

  test('enumeration holds forward: every event has at least one outbox item', () => {
    captureCanonicalEvent(input(), 'rec-1', INGEST)
    captureCanonicalEvent(input({ id: 'rec-2', content: 'prefers metric units' }), 'rec-2', INGEST)

    const enqueuedIds = new Set(outbox().map((row) => row.eventId))
    for (const event of events()) expect(enqueuedIds.has(event.eventId)).toBe(true)
  })

  test('enumeration holds backward: every outbox item resolves to an event', () => {
    captureCanonicalEvent(input(), 'rec-1', INGEST)
    captureCanonicalEvent(input({ evidence: { timestamps: ['2027-01-01T00:00:00.000Z'] } }), 'rec-1', INGEST)

    const eventIds = new Set(events().map((row) => row.eventId))
    expect(outbox().length).toBeGreaterThan(0)
    for (const item of outbox()) expect(eventIds.has(item.eventId)).toBe(true)
  })

  test('the kill switch off writes nothing and reports no outcome', () => {
    process.env['MEMORY_CANONICAL_CAPTURE'] = 'off'

    expect(captureCanonicalEvent(input(), 'rec-1', INGEST)).toBeNull()
    expect(events()).toHaveLength(0)
    expect(outbox()).toHaveLength(0)
    expect(attempts()).toHaveLength(0)
  })

  test('any value other than the exact string "off" leaves capture enabled', () => {
    process.env['MEMORY_CANONICAL_CAPTURE'] = 'OFF'
    expect(captureCanonicalEvent(input(), 'rec-1', INGEST)).toBe('captured')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/long-term-memory/canonical-capture-faults.test.ts`
Expected: FAIL — the B1 and failure-recording tests fail because the injected abort propagates out
of `captureCanonicalEvent` instead of being recorded as `'failed'`.

- [ ] **Step 3: Add the failure path**

In `src/long-term-memory/canonical-capture.ts`, replace the body of `captureCanonicalEvent` from
`const outcome = getDrizzleDb().transaction(...)` through the closing `return outcome` with the
version below. Everything above it (the kill-switch guard, `scope`, `payload`, `identity`) is
unchanged, and the transaction closure itself is unchanged — it is only moved inside a helper and
wrapped.

Add this helper immediately above `captureCanonicalEvent`:

```typescript
/**
 * Records a rolled-back attempt in its own transaction.
 *
 * A `failed` outcome means the main transaction rolled back, which would have taken its own
 * attempt row with it — so the failure is written separately. If even this write fails there
 * is nowhere durable left to put it, and the log line is the last resort.
 */
const recordFailure = (identity: string, payload: CanonicalPayload, ingestTime: string, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error)
  try {
    getDrizzleDb().transaction((tx) => {
      insertAttempt(tx, { identity, payload, ingestTime, outcome: 'failed', eventId: null })
    })
    log.warn(
      { scopeType: payload.scopeType, scopeId: payload.scopeId, identity, error: message },
      'Canonical capture failed; attempt recorded',
    )
  } catch (recordingError) {
    const recordingMessage = recordingError instanceof Error ? recordingError.message : String(recordingError)
    log.error(
      { scopeType: payload.scopeType, scopeId: payload.scopeId, identity, error: message, recordingMessage },
      'Canonical capture failed and the failure could not be recorded',
    )
  }
}
```

Then wrap the transaction:

```typescript
  let outcome: CaptureOutcome
  try {
    outcome = getDrizzleDb().transaction((tx): CaptureOutcome => {
      // ... the closure body from Task 4, unchanged ...
    })
  } catch (error) {
    recordFailure(identity, payload, now, error)
    outcome = 'failed'
  }

  log.debug({ scopeType: input.scopeType, scopeId: input.scopeId, identity, outcome }, 'Canonical capture attempt')
  return outcome
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/long-term-memory/canonical-capture-faults.test.ts tests/long-term-memory/canonical-capture.test.ts`
Expected: PASS — 19 tests total.

- [ ] **Step 5: Check the file size**

Run: `bun run lint`
Expected: PASS. If `max-lines` fires on `canonical-capture.ts`, extract `insertAttempt`, `enqueue`,
and `recordFailure` into `src/long-term-memory/canonical-capture-writes.ts` and import them —
**do not** compress formatting or add a disable comment.

- [ ] **Step 6: Commit**

```bash
git add src/long-term-memory/canonical-capture.ts tests/long-term-memory/canonical-capture-faults.test.ts
git commit -m "feat(memory): record failed canonical captures and close boundary B1"
```

---

### Task 6: Dual-write hook in `store.ts`

**Files:**

- Modify: `src/long-term-memory/store.ts` (imports; `saveMemoryRecord` at lines 177–198;
  `updateMemoryRecord` at lines 255–279)
- Test: `tests/long-term-memory/canonical-hook.test.ts`

**Interfaces:**

- Consumes: `captureCanonicalEvent` from `./canonical-capture.js`.
- Produces: no new exports. `saveMemoryRecord` and `updateMemoryRecord` keep their exact existing
  signatures and return values.

**The rule this task must not break:** the hook runs *after* the live path has decided, and its
result is discarded. Nothing about the canonical write may change what these functions return.

**Three call sites, not four.** `updateMemoryRecord` has its own tombstone early-return at line 261;
it is deliberately **not** a capture site. It holds only a scope, a record id, and a candidate
string — not a record — so capturing there would mean fabricating a payload. 1c introduces canonical
tombstones and can record that suppression properly.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/canonical-hook.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryCanonicalCaptureAttempts, memoryCanonicalEvents } from '../../src/db/schema.js'
import { saveMemoryRecord, updateMemoryRecord } from '../../src/long-term-memory/store.js'
import { insertTombstone } from '../../src/long-term-memory/tombstone.testing.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-07-30T12:00:00.000Z'
const scope = { scopeId: 'user-1', scopeType: 'personal' } as const

const input = (overrides: Partial<MemoryRecordInput> = {}): MemoryRecordInput => ({
  id: 'rec-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'likes dark mode',
  summary: null,
  tags: ['ui'],
  confidence: 0.9,
  status: 'active',
  source: 'background',
  evidence: {},
  createdAt: NOW,
  updatedAt: NOW,
  lastSeenAt: NOW,
  ...overrides,
})

const events = () => getDrizzleDb().select().from(memoryCanonicalEvents).all()
const attempts = () => getDrizzleDb().select().from(memoryCanonicalCaptureAttempts).all()

describe('canonical capture hook in the store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterEach(() => {
    delete process.env['MEMORY_CANONICAL_CAPTURE']
    getDrizzleDb().run(sql`DROP TRIGGER IF EXISTS fail_canonical_event_insert`)
  })

  test('a saved record captures a canonical event linked back to the record', () => {
    const saved = saveMemoryRecord(input())
    expect(saved?.id).toBe('rec-1')
    expect(events()).toHaveLength(1)
    expect(events()[0]?.recordId).toBe('rec-1')
  })

  test('a tombstone-suppressed save records an attempt and still returns null', () => {
    insertTombstone(scope, 'likes dark mode', NOW)

    expect(saveMemoryRecord(input())).toBeNull()
    expect(events()).toHaveLength(0)
    expect(attempts()).toHaveLength(1)
    expect(attempts()[0]?.outcome).toBe('suppressed-tombstoned')
  })

  test('a canonical write failure does not change what saveMemoryRecord returns', () => {
    getDrizzleDb().run(
      sql`CREATE TRIGGER fail_canonical_event_insert BEFORE INSERT ON memory_canonical_events
          BEGIN SELECT RAISE(ABORT, 'injected'); END`,
    )

    const saved = saveMemoryRecord(input())

    expect(saved?.id).toBe('rec-1')
    expect(saved?.content).toBe('likes dark mode')
    expect(events()).toHaveLength(0)
    expect(attempts()[0]?.outcome).toBe('failed')
  })

  test('a content-changing update captures a second canonical event', () => {
    saveMemoryRecord(input())
    updateMemoryRecord(scope, 'rec-1', { content: 'prefers light mode' }, '2026-07-30T13:00:00.000Z')

    expect(events()).toHaveLength(2)
    expect(events().map((row) => row.content)).toContain('prefers light mode')
  })

  test('a status-only update captures nothing', () => {
    saveMemoryRecord(input())
    const before = attempts().length

    updateMemoryRecord(scope, 'rec-1', { status: 'stale' }, '2026-07-30T13:00:00.000Z')

    expect(events()).toHaveLength(1)
    expect(attempts()).toHaveLength(before)
  })

  test('a confidence-only update captures nothing', () => {
    saveMemoryRecord(input())
    const before = attempts().length

    updateMemoryRecord(scope, 'rec-1', { confidence: 0.2 }, '2026-07-30T13:00:00.000Z')

    expect(attempts()).toHaveLength(before)
  })

  test('an update that matches no record captures nothing', () => {
    updateMemoryRecord(scope, 'missing', { content: 'never stored' }, NOW)
    expect(attempts()).toHaveLength(0)
  })

  test('a tombstone-suppressed update captures nothing', () => {
    saveMemoryRecord(input())
    insertTombstone(scope, 'forgotten thing', NOW)
    const before = attempts().length

    expect(updateMemoryRecord(scope, 'rec-1', { content: 'forgotten thing' }, NOW)).toBeNull()

    // Unlike saveMemoryRecord, this early-return has no full record to build a canonical
    // payload from — only a scope, an id, and a candidate string. 1c introduces canonical
    // tombstones and can record the suppression properly; 1a does not fabricate a payload.
    expect(attempts()).toHaveLength(before)
  })

  test('with the kill switch off the store behaves exactly as before', () => {
    process.env['MEMORY_CANONICAL_CAPTURE'] = 'off'

    const saved = saveMemoryRecord(input())

    expect(saved?.id).toBe('rec-1')
    expect(events()).toHaveLength(0)
    expect(attempts()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/long-term-memory/canonical-hook.test.ts`
Expected: FAIL — the canonical tables stay empty because `store.ts` never calls the capture.

- [ ] **Step 3: Add the hook to `saveMemoryRecord`**

In `src/long-term-memory/store.ts`, add the import alongside the existing relative imports (keep the
group alphabetically ordered — it goes immediately before the `./record-conditions.js` import):

```typescript
import { captureCanonicalEvent } from './canonical-capture.js'
```

Replace the body of `saveMemoryRecord` (lines 177–198) with:

```typescript
export function saveMemoryRecord(input: MemoryRecordInput): MemoryRecord | null {
  const scope: MemoryScope = { scopeId: input.scopeId, scopeType: input.scopeType }
  if (input.source !== 'explicit' && isContentTombstoned(scope, input.content)) {
    log.info(
      { scopeId: input.scopeId, scopeType: input.scopeType, source: input.source },
      'Memory write suppressed by tombstone',
    )
    // Dark capture: the suppression itself is canonical evidence, and the outcome is
    // discarded so it cannot alter what this function returns.
    captureCanonicalEvent(input, null)
    return null
  }

  const values = inputToRecordValues(input)

  getDrizzleDb()
    .insert(memoryRecords)
    .values(values)
    .onConflictDoUpdate({
      target: memoryRecords.id,
      set: values,
    })
    .run()
  const saved = loadRecord(input.id)
  captureCanonicalEvent(input, saved.id)
  return saved
}
```

- [ ] **Step 4: Add the hook to `updateMemoryRecord`**

Replace the `return` statement at the end of `updateMemoryRecord` (currently line 278) with:

```typescript
  const updated = rows[0] === undefined ? null : rowToRecord(rows[0])
  // A content-changing update is a real capture; a status- or confidence-only update is not.
  if (updated !== null && patch.content !== undefined) {
    captureCanonicalEvent({ ...updated, embedding: null }, updated.id)
  }
  return updated
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/long-term-memory/canonical-hook.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 6: Verify the live path is unchanged**

Run: `bun test tests/long-term-memory/`
Expected: PASS with no failures. Every pre-existing store, capture, purge, promotion, and erasure
test must still pass untouched — that is the evidence that dark capture changed no answer. If any
pre-existing test now fails, the hook is affecting the live path: fix the hook, never the test.

- [ ] **Step 7: Commit**

```bash
git add src/long-term-memory/store.ts tests/long-term-memory/canonical-hook.test.ts
git commit -m "feat(memory): dual-write canonical events from the store choke point"
```

---

### Task 7: Documentation

**Files:**

- Modify: `docs/architecture/environment.md` (add a paragraph after the
  `**Memory recall shadow-logging study …**` paragraph at line 22)
- Modify: `docs/superpowers/plans/2026-07-26-memory-production-roadmap.md` (append to the Gate 1
  `**Status (2026-07-29):**` block, which ends at line 79)
- Modify: `docs/research/agent-memory/implementation-status.md` (add a bullet after the
  `**Gate 0 acceptance harness**` bullet, which ends with "not a defect." at line 76)

**Interfaces:**

- Consumes: the behavior delivered by Tasks 1–6.
- Produces: nothing code-facing.

**Constraint:** do not edit `tests/long-term-memory/acceptance/` or any file under it. No criterion
promotes in this plan, and the acceptance report's counts are unchanged.

- [ ] **Step 1: Document the environment variable**

In `docs/architecture/environment.md`, insert this paragraph immediately after the
`**Memory recall shadow-logging study (...)**` paragraph, which ends with
"`docs/deployment/memory-shadow-logging.md`." at line 22, and before the
`**BYOK LLM credentials ...**` paragraph:

```markdown
**Canonical capture kill switch (`MEMORY_CANONICAL_CAPTURE`):** Gate 1a writes every memory capture to the canonical event log (`memory_canonical_events`), its projection outbox (`memory_projection_outbox`), and its attempt log (`memory_canonical_capture_attempts`) in dark mode — nothing reads those tables yet, and no reader answer depends on them. Default **ON**, unlike the shadow-logging study: dark capture cannot change an answer and accrues value only by accruing data. Only the exact string `'off'` disables it (`isCanonicalCaptureEnabled`, `src/long-term-memory/canonical-capture-config.ts`); any other value, including unset or empty, leaves capture enabled. With it off there is no capture attempt and therefore no outcome and no rows. The capture runs in its own transaction after the live write has already been decided, so a canonical failure is recorded as a `failed` attempt and never propagates. Design: `docs/superpowers/specs/2026-07-30-memory-gate1a-canonical-capture-spine-design.md`.
```

- [ ] **Step 2: Record the delivery in the roadmap**

In `docs/superpowers/plans/2026-07-26-memory-production-roadmap.md`, append this paragraph directly
after the Gate 1 `**Status (2026-07-29):**` paragraph (which ends at line 79) and before the
`### Gate 2` heading:

```markdown
**Status (2026-07-30):** Gate 1 is being executed as four specs. **1a — canonical capture spine** is
implemented per `docs/superpowers/specs/2026-07-30-memory-gate1a-canonical-capture-spine-design.md`:
the canonical event log, the projection outbox, the durable attempt log, the identity model, and the
dark-mode dual write at `saveMemoryRecord`. It satisfies observables O1, O3, and O6 and makes
boundary B1 unreachable by construction. It promotes no criterion — `capture-idempotency`'s predicate
compares projection snapshots, and no projection exists until 1b. Remaining: **1b** dark projection,
checkpoint, idempotent apply, repair (O2, O4; B2–B4; promotes `capture-idempotency`); **1c** canonical
tombstones and the concurrency harness (O5; B5; promotes `races` and `crash-recovery`); **1d**
reconciliation against the current path, which is this gate's exit. There is no backfill: the
migration records a cutover marker, and 1d scopes its reconciliation to records created at or after
it.
```

- [ ] **Step 3: Record the delivery in the implementation status**

In `docs/research/agent-memory/implementation-status.md`, add this bullet immediately after the
"Gate 0 acceptance harness" bullet (which ends with "not a defect." at line 76), matching the
surrounding bullet style:

```markdown
- **Gate 1a canonical capture spine** — landed 2026-07-30. `memory_canonical_events`,
  `memory_projection_outbox`, `memory_canonical_capture_attempts`, and the `memory_canonical_state`
  cutover marker, written in dark mode from `saveMemoryRecord` behind `MEMORY_CANONICAL_CAPTURE`
  (default on, `'off'` disables). Nothing reads these tables yet; no reader answer changed and no
  acceptance criterion promoted. Design:
  `docs/superpowers/specs/2026-07-30-memory-gate1a-canonical-capture-spine-design.md`.
```

- [ ] **Step 4: Verify the acceptance report is unchanged**

Run: `bun run memory:acceptance`
Expected: the final line still reads
`production ready = NO (4 implemented, 3 predicate-registered, 4 unmet)`. If any count moved,
something touched the registry — revert that change; this plan promotes nothing.

- [ ] **Step 5: Run the full check**

Run: `bun run check:full`
Expected: all checks pass.

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/environment.md docs/superpowers/plans/2026-07-26-memory-production-roadmap.md \
  docs/research/agent-memory/implementation-status.md
git commit -m "docs(memory): record the Gate 1a canonical capture spine"
```
