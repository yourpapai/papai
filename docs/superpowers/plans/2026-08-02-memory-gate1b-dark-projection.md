<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory Gate 1b — Dark Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shadow projection of the canonical event log — idempotent per-item apply, a derived checkpoint, bounded retry with repair, and a byte-stable snapshot — without changing any reader answer.

**Architecture:** A new `memory_projection_records` table is the shadow projection; no reader queries it. A drain loop selects pending `memory_projection_outbox` rows in position order and applies each in its own transaction, which writes the shadow row and completes the outbox row in one commit — making boundaries B3 and B4 unreachable exactly as Gate 1a made B1 unreachable. Apply is a pure function of the canonical event row rather than of the outbox `op`, so re-driving any position converges. The snapshot serializes replay-stable fields only, via the same `stableStringify` that backs `canonicalJson`.

**Tech Stack:** Bun, `bun:sqlite` via Drizzle (synchronous `db.transaction((tx) => …)`), strict TypeScript with `.js` import extensions, `bun:test`, pino logging, oxlint.

**Spec:** [`docs/superpowers/specs/2026-08-02-memory-gate1b-dark-projection-design.md`](../specs/2026-08-02-memory-gate1b-dark-projection-design.md)

## Global Constraints

- Every new file starts with the four-line BUSL header used across `src/` and `tests/` (`// SPDX-License-Identifier: BUSL-1.1` / `// Copyright (c) 2026 Dmitriy Lazarev` / `// Use of this software is governed by the Business Source License 1.1.` / `// See LICENSE in the project root for details.`). Markdown files use the same text inside an HTML comment.
- Import paths use the `.js` extension, always.
- **Never add a lint-disable or type-ignore comment.** A hook blocks them. Fix the underlying issue.
- A `max-lines` (300) or `max-lines-per-function` failure is a design signal: split the file or extract a function. Do not delete blank lines or compress formatting to get under the limit.
- oxlint rules that bit during Gate 1a and will bite again: `no-unsafe-type-assertion` (no `as SomeType`), `explicit-function-return-type` (including test helpers), `no-conditional-in-test` (no `?:`, `??`, or `if` inside a `test()` body — hoist to a module-level helper).
- Error extraction is always `error instanceof Error ? error.message : String(error)`.
- Logging is mandatory and metadata-first: `log.debug` for entry/params/internal state, `log.info` for successful high-value ops, `log.warn` for degraded or recoverable issues, `log.error` for caught exceptions. Never log content that could be user data beyond what neighbouring memory modules already log (scope ids and identities are fine; record `content` is not).
- The kill switch is `MEMORY_CANONICAL_PROJECTION`. Default **ON**. Disabled **only** by the exact string `'off'` — any other value, including unset, empty, or `'OFF'`, means enabled. This is deliberately the same inverted shape as `MEMORY_CANONICAL_CAPTURE` and deliberately the inverse of `MEMORY_SHADOW_LOG_ENABLED`.
- `MAX_PROJECTION_ATTEMPTS = 5`. `PROJECTION_DRAIN_LIMIT = 200`.
- Tie-break for equal event times is `idempotency_identity` **ascending**.
- `tests/long-term-memory/acceptance/predicate-registrations.ts` is **append-only and must not be edited**, not even to fix a typo. Task 8 reads it; nothing in this plan writes it.
- **knip will report the new files as unused from Task 1 through Task 8.** `knip-bun --strict` requires reachability from an entry point, not merely a production importer, and the only entry-point path to this code is the scheduler registration in Task 9. Do **not** add knip ignores, and do not hoist the Task 9 wiring into an earlier task to silence it. Expect `bun knip` to fail until Task 9 and to pass after it.
- Run the full gate with `bun check:full` before the final commit of a task that touches `src/`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/db/memory-projection-schema.ts` | The `memory_projection_records` Drizzle table and its row type. Nothing else. |
| `src/db/migrations/078_memory_projection_records.ts` | Creates the table and its index. |
| `src/long-term-memory/projection-fold.ts` | Pure fold rules: the projection key, and which of two candidates wins. No I/O. |
| `src/long-term-memory/projection-apply.ts` | One outbox row → one transaction. Shadow upsert, outbox completion, failure recording. |
| `src/long-term-memory/projection-drain.ts` | The bounded loop, the derived checkpoint, and repair. |
| `src/long-term-memory/projection-config.ts` | The kill switch. |
| `src/long-term-memory/projection-snapshot.ts` | O2's serializer. |

Splitting fold from apply is what lets the ordering rules be tested exhaustively without a database. Splitting apply from drain is what lets the boundary and retry tests drive a single item without the loop.

---

## Task 1: Shadow projection table

**Files:**
- Create: `src/db/memory-projection-schema.ts`
- Create: `src/db/migrations/078_memory_projection_records.ts`
- Modify: `src/db/schema.ts` (add re-exports alongside the `memory-canonical-schema.js` ones near lines 96-106)
- Modify: `src/db/index.ts` (import at ~line 90, register in the migration array at ~line 202)
- Test: `tests/long-term-memory/projection-schema.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `memoryProjectionRecords` (Drizzle table) and `type MemoryProjectionRecordRow = typeof memoryProjectionRecords.$inferSelect`, both re-exported from `src/db/schema.js`. Column names in camelCase: `projectionKey`, `recordId`, `eventId`, `idempotencyIdentity`, `contentIdentity`, `scopeId`, `scopeType`, `threadContextId`, `kind`, `content`, `summary`, `tags`, `confidence`, `source`, `actorIds`, `provenance`, `eventTime`, `lastObservedAt`, `validFrom`, `validUntil`, `expiresAt`, `schemaVersion`, `captureVersion`, `projectedAt`.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/projection-schema.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryProjectionRecords, type MemoryProjectionRecordRow } from '../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const rows = (): MemoryProjectionRecordRow[] => getDrizzleDb().select().from(memoryProjectionRecords).all()

const seed = (): void => {
  getDrizzleDb()
    .insert(memoryProjectionRecords)
    .values({
      projectionKey: 'rec-1',
      recordId: 'rec-1',
      eventId: 'evt-1',
      idempotencyIdentity: 'ident-1',
      contentIdentity: 'content-1',
      scopeId: 'user-1',
      scopeType: 'personal',
      threadContextId: null,
      kind: 'fact',
      content: 'likes dark mode',
      summary: null,
      tags: '["ui"]',
      confidence: 0.9,
      source: 'background',
      actorIds: '[]',
      provenance: '{}',
      eventTime: '2026-08-02T12:00:00.000Z',
      lastObservedAt: '2026-08-02T12:00:00.000Z',
      validFrom: null,
      validUntil: null,
      expiresAt: null,
      schemaVersion: 1,
      captureVersion: 'v1',
      projectedAt: '2026-08-02T13:00:00.000Z',
    })
    .run()
}

describe('memory_projection_records', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('the migration creates an empty table', () => {
    expect(rows()).toEqual([])
  })

  test('a row round-trips every column', () => {
    seed()

    expect(rows()).toEqual([
      {
        projectionKey: 'rec-1',
        recordId: 'rec-1',
        eventId: 'evt-1',
        idempotencyIdentity: 'ident-1',
        contentIdentity: 'content-1',
        scopeId: 'user-1',
        scopeType: 'personal',
        threadContextId: null,
        kind: 'fact',
        content: 'likes dark mode',
        summary: null,
        tags: '["ui"]',
        confidence: 0.9,
        source: 'background',
        actorIds: '[]',
        provenance: '{}',
        eventTime: '2026-08-02T12:00:00.000Z',
        lastObservedAt: '2026-08-02T12:00:00.000Z',
        validFrom: null,
        validUntil: null,
        expiresAt: null,
        schemaVersion: 1,
        captureVersion: 'v1',
        projectedAt: '2026-08-02T13:00:00.000Z',
      },
    ])
  })

  test('projection_key is the primary key, so a second row with the same key is rejected', () => {
    seed()

    expect(seed).toThrow()
  })

  test('scope_type rejects a value outside the enum', () => {
    const bad = (): void => {
      getDrizzleDb().run(`
        INSERT INTO memory_projection_records
          (projection_key, event_id, idempotency_identity, content_identity, scope_id, scope_type,
           kind, content, confidence, source, event_time, last_observed_at, schema_version,
           capture_version, projected_at)
        VALUES ('k', 'e', 'i', 'c', 's', 'organisation', 'fact', 'x', 1, 'background',
                '2026-08-02T12:00:00.000Z', '2026-08-02T12:00:00.000Z', 1, 'v1', '2026-08-02T12:00:00.000Z')
      `)
    }

    expect(bad).toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/long-term-memory/projection-schema.test.ts`
Expected: FAIL — `memoryProjectionRecords` is not exported from `src/db/schema.js`.

- [ ] **Step 3: Create the Drizzle table**

Create `src/db/memory-projection-schema.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * The shadow projection of `memory_canonical_events`. No reader queries this table: Gate 1b
 * runs dark, so the projection accrues state without changing an answer. `memory_records`
 * remains the reader's source until 1d reconciles the two.
 *
 * One row per projection key, which is the event's `record_id` when it has one and its
 * idempotency identity otherwise — so an event captured while the live save was suppressed
 * still reaches the snapshot rather than vanishing.
 */
export const memoryProjectionRecords = sqliteTable(
  'memory_projection_records',
  {
    projectionKey: text('projection_key').primaryKey(),
    recordId: text('record_id'),
    /** The winning event. Excluded from the snapshot: a fresh `randomUUID` on every run. */
    eventId: text('event_id').notNull(),
    idempotencyIdentity: text('idempotency_identity').notNull(),
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
    /** The fold's ordering key. Supersession resolves by this, never by ingest order. */
    eventTime: text('event_time').notNull(),
    lastObservedAt: text('last_observed_at').notNull(),
    validFrom: text('valid_from'),
    validUntil: text('valid_until'),
    expiresAt: text('expires_at'),
    schemaVersion: integer('schema_version').notNull(),
    captureVersion: text('capture_version').notNull(),
    /** Operational only. Excluded from the snapshot: it varies with wall-clock, not with input. */
    projectedAt: text('projected_at').notNull(),
  },
  (table) => [index('idx_memory_projection_records_scope').on(table.scopeType, table.scopeId)],
)

export type MemoryProjectionRecordRow = typeof memoryProjectionRecords.$inferSelect
```

- [ ] **Step 4: Create the migration**

Create `src/db/migrations/078_memory_projection_records.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:078' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS memory_projection_records (
      projection_key        TEXT NOT NULL PRIMARY KEY,
      record_id             TEXT,
      event_id              TEXT NOT NULL,
      idempotency_identity  TEXT NOT NULL,
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
      last_observed_at      TEXT NOT NULL,
      valid_from            TEXT,
      valid_until           TEXT,
      expires_at            TEXT,
      schema_version        INTEGER NOT NULL,
      capture_version       TEXT NOT NULL,
      projected_at          TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memory_projection_records_scope
      ON memory_projection_records(scope_type, scope_id)
  `)
  log.info('migration 078: shadow projection table created')
}

export const migration078MemoryProjectionRecords: Migration = {
  id: '078_memory_projection_records',
  up,
}

export default migration078MemoryProjectionRecords
```

- [ ] **Step 5: Re-export the table from the schema barrel**

In `src/db/schema.ts`, the block re-exporting `./memory-canonical-schema.js` ends at line 106 with `} from './memory-canonical-schema.js'`. Insert immediately after that line:

```typescript
export { memoryProjectionRecords } from './memory-projection-schema.js'
export type { MemoryProjectionRecordRow } from './memory-projection-schema.js'
```

One symbol per statement is correct here — the grouped form above exists because that module exports four tables; this one exports one.

- [ ] **Step 6: Register the migration**

In `src/db/index.ts`, add the import immediately after the line importing `migration077MemoryCanonicalCapture` (around line 90):

```typescript
import { migration078MemoryProjectionRecords } from './migrations/078_memory_projection_records.js'
```

and add the entry immediately after `migration077MemoryCanonicalCapture,` in the migration array (around line 202):

```typescript
  migration078MemoryProjectionRecords,
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun test tests/long-term-memory/projection-schema.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Commit**

```bash
git add src/db/memory-projection-schema.ts src/db/migrations/078_memory_projection_records.ts src/db/schema.ts src/db/index.ts tests/long-term-memory/projection-schema.test.ts
git commit -m "feat(memory): add the shadow projection table"
```

---

## Task 2: Fold rules

**Files:**
- Create: `src/long-term-memory/projection-fold.ts`
- Test: `tests/long-term-memory/projection-fold.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export type FoldCandidate = Readonly<{ eventTime: string; idempotencyIdentity: string }>`
  - `export function projectionKeyFor(recordId: string | null, idempotencyIdentity: string): string`
  - `export function winsAgainst(candidate: FoldCandidate, incumbent: FoldCandidate): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/projection-fold.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { type FoldCandidate, projectionKeyFor, winsAgainst } from '../../src/long-term-memory/projection-fold.js'

const at = (eventTime: string, idempotencyIdentity = 'ident-b'): FoldCandidate => ({ eventTime, idempotencyIdentity })

const EARLY = '2026-08-01T00:00:00.000Z'
const LATE = '2026-08-02T00:00:00.000Z'

describe('projectionKeyFor', () => {
  test('a record id is the key when the event has one', () => {
    expect(projectionKeyFor('rec-1', 'ident-1')).toBe('rec-1')
  })

  test('the idempotency identity is the key when the record id is null', () => {
    expect(projectionKeyFor(null, 'ident-1')).toBe('ident-1')
  })
})

describe('winsAgainst', () => {
  // Both sides carry distinct identities, chosen so the identity tie-break would push the
  // opposite way: these assert that event time dominates it, not merely that something wins.
  test('a later event time wins even when its identity sorts later', () => {
    expect(winsAgainst(at(LATE, 'ident-z'), at(EARLY, 'ident-a'))).toBe(true)
  })

  test('an earlier event time loses even when its identity sorts earlier', () => {
    expect(winsAgainst(at(EARLY, 'ident-a'), at(LATE, 'ident-z'))).toBe(false)
  })

  test('equal event times break on idempotency identity ascending', () => {
    expect(winsAgainst(at(EARLY, 'ident-a'), at(EARLY, 'ident-b'))).toBe(true)
    expect(winsAgainst(at(EARLY, 'ident-b'), at(EARLY, 'ident-a'))).toBe(false)
  })

  test('the same identity always wins against itself, so a re-apply refreshes the row', () => {
    expect(winsAgainst(at(EARLY, 'ident-a'), at(EARLY, 'ident-a'))).toBe(true)
    expect(winsAgainst(at(LATE, 'ident-a'), at(EARLY, 'ident-a'))).toBe(true)
  })

  test('the same instant written in different ISO forms is a tie, not an ordering', () => {
    expect(winsAgainst(at('2026-08-01T00:00:00Z', 'ident-a'), at('2026-08-01T00:00:00.000Z', 'ident-b'))).toBe(true)
    expect(winsAgainst(at('2026-08-01T00:00:00Z', 'ident-c'), at('2026-08-01T00:00:00.000Z', 'ident-b'))).toBe(false)
  })

  test('an unparsable candidate never wins, so a bad timestamp cannot displace a good row', () => {
    expect(winsAgainst(at('not-a-date', 'ident-a'), at(EARLY, 'ident-b'))).toBe(false)
  })

  test('an unparsable incumbent is always displaced', () => {
    expect(winsAgainst(at(EARLY, 'ident-b'), at('not-a-date', 'ident-a'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/long-term-memory/projection-fold.test.ts`
Expected: FAIL — cannot resolve `../../src/long-term-memory/projection-fold.js`.

- [ ] **Step 3: Implement the fold rules**

Create `src/long-term-memory/projection-fold.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The ordering rules the shadow projection folds by. Pure and I/O-free, so every ordering can
 * be asserted without a database — which matters because these rules are the whole content of
 * the `capture-idempotency` clause "supersession and validity resolve by event time, never by
 * ingest order".
 */

export type FoldCandidate = Readonly<{ eventTime: string; idempotencyIdentity: string }>

const instant = (iso: string): number | undefined => {
  const millis = Date.parse(iso)
  return Number.isNaN(millis) ? undefined : millis
}

/**
 * One shadow row per record. An event captured while the live save was suppressed has no
 * record id, so it projects under its own identity rather than being dropped — 1d must be able
 * to tell "correctly not projected" from "lost".
 */
export function projectionKeyFor(recordId: string | null, idempotencyIdentity: string): string {
  return recordId ?? idempotencyIdentity
}

/**
 * Whether `candidate` should replace `incumbent` as the shadow row for their shared key.
 *
 * Instants are compared numerically, not lexically, so `…T00:00:00Z` and `…T00:00:00.000Z` are
 * one instant rather than two. An unparsable candidate never wins, mirroring `laterIso`, so a
 * malformed timestamp cannot displace a good row.
 *
 * Identity equality means this is the same event being re-applied — it always wins, so a
 * re-drive refreshes `last_observed_at` instead of silently skipping. Only a genuine tie
 * between two distinct events reaches the identity tie-break, which is ascending because it
 * must be deterministic and content-derived: `event_id` is a fresh UUID per run and
 * `ingest_time` is the ordering the criterion forbids.
 */
export function winsAgainst(candidate: FoldCandidate, incumbent: FoldCandidate): boolean {
  if (candidate.idempotencyIdentity === incumbent.idempotencyIdentity) return true

  const left = instant(candidate.eventTime)
  const right = instant(incumbent.eventTime)
  if (left === undefined) return false
  if (right === undefined) return true
  if (left !== right) return left > right

  return candidate.idempotencyIdentity < incumbent.idempotencyIdentity
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/long-term-memory/projection-fold.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/projection-fold.ts tests/long-term-memory/projection-fold.test.ts
git commit -m "feat(memory): add the projection fold ordering rules"
```

---

## Task 3: Apply one outbox item

**Files:**
- Create: `src/long-term-memory/projection-apply.ts`
- Test: `tests/long-term-memory/projection-apply.test.ts`

**Interfaces:**
- Consumes: `memoryProjectionRecords` and `MemoryProjectionRecordRow` from `../db/schema.js` (Task 1); `projectionKeyFor`, `winsAgainst`, `FoldCandidate` from `./projection-fold.js` (Task 2).
- Produces:
  - `export const MAX_PROJECTION_ATTEMPTS = 5`
  - `export type ApplyOutcome = 'applied' | 'superseded' | 'missing-event' | 'failed'`
  - `export function applyOutboxItem(position: number, now?: string): ApplyOutcome`

Task 4 adds the failure path to this same file; this task delivers the success paths only.

Existing helpers this task builds on, already in the tree: `captureCanonicalEvent(input: MemoryRecordInput, recordId: string | null, now?: string): CaptureOutcome | null` from `src/long-term-memory/canonical-capture.js`, and the tables `memoryCanonicalEvents` / `memoryProjectionOutbox` from `src/db/schema.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/projection-apply.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { asc, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  memoryCanonicalEvents,
  type MemoryCanonicalEventRow,
  memoryProjectionOutbox,
  type MemoryProjectionOutboxRow,
  memoryProjectionRecords,
  type MemoryProjectionRecordRow,
} from '../../src/db/schema.js'
import { captureCanonicalEvent } from '../../src/long-term-memory/canonical-capture.js'
import { applyOutboxItem } from '../../src/long-term-memory/projection-apply.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-08-02T15:00:00.000Z'

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
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  lastSeenAt: '2026-08-01T12:00:00.000Z',
  ...overrides,
})

const shadow = (): MemoryProjectionRecordRow[] =>
  getDrizzleDb().select().from(memoryProjectionRecords).orderBy(asc(memoryProjectionRecords.projectionKey)).all()
const outbox = (): MemoryProjectionOutboxRow[] =>
  getDrizzleDb().select().from(memoryProjectionOutbox).orderBy(asc(memoryProjectionOutbox.position)).all()
const events = (): MemoryCanonicalEventRow[] => getDrizzleDb().select().from(memoryCanonicalEvents).all()

const firstPosition = (): number => {
  const rows = outbox()
  const head = rows[0]
  if (head === undefined) throw new Error('no outbox rows')
  return head.position
}

const positionAt = (index: number): number => {
  const row = outbox()[index]
  if (row === undefined) throw new Error(`no outbox row at index ${index}`)
  return row.position
}

const requireEvent = (row: MemoryCanonicalEventRow | undefined): MemoryCanonicalEventRow => {
  if (row === undefined) throw new Error('no canonical event')
  return row
}

const orphanOutboxRow = (): number => {
  getDrizzleDb()
    .insert(memoryProjectionOutbox)
    .values({ eventId: 'evt-does-not-exist', op: 'capture', state: 'pending', enqueuedAt: NOW })
    .run()
  const rows = outbox()
  const last = rows[rows.length - 1]
  if (last === undefined) throw new Error('no outbox rows')
  return last.position
}

describe('applyOutboxItem', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('applying a capture item writes one shadow row and completes the outbox row', () => {
    captureCanonicalEvent(input(), 'rec-1', NOW)

    expect(applyOutboxItem(firstPosition(), NOW)).toBe('applied')

    expect(shadow()).toHaveLength(1)
    expect(outbox()[0]?.state).toBe('complete')
    expect(outbox()[0]?.attemptCount).toBe(1)
    expect(outbox()[0]?.lastAttemptAt).toBe(NOW)
  })

  test('the shadow row carries every projected field from the winning event', () => {
    captureCanonicalEvent(
      input({
        summary: 'dark mode preference',
        validFrom: '2026-08-01T00:00:00.000Z',
        validUntil: '2027-01-01T00:00:00.000Z',
        expiresAt: '2028-01-01T00:00:00.000Z',
        threadContextId: 'thread-a',
        evidence: { actorIds: ['alice'], messageIds: ['m-1'], threads: ['thread-a'], contextId: 'ctx-1' },
      }),
      'rec-1',
      NOW,
    )
    applyOutboxItem(firstPosition(), NOW)

    const event = requireEvent(events()[0])
    expect(shadow()[0]).toEqual({
      projectionKey: 'rec-1',
      recordId: 'rec-1',
      eventId: event.eventId,
      idempotencyIdentity: event.idempotencyIdentity,
      contentIdentity: event.contentIdentity,
      scopeId: 'user-1',
      scopeType: 'personal',
      threadContextId: 'thread-a',
      kind: 'fact',
      content: 'likes dark mode',
      summary: 'dark mode preference',
      tags: '["ui"]',
      confidence: 0.9,
      source: 'background',
      actorIds: '["alice"]',
      provenance: JSON.stringify({ messageIds: ['m-1'], threads: ['thread-a'], contextId: 'ctx-1' }),
      eventTime: '2026-08-01T12:00:00.000Z',
      lastObservedAt: '2026-08-01T12:00:00.000Z',
      validFrom: '2026-08-01T00:00:00.000Z',
      validUntil: '2027-01-01T00:00:00.000Z',
      expiresAt: '2028-01-01T00:00:00.000Z',
      schemaVersion: 1,
      captureVersion: 'v1',
      projectedAt: NOW,
    })
  })

  test('a later-event-time update replaces the shadow row for the same record', () => {
    captureCanonicalEvent(input(), 'rec-1', NOW)
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: ['2026-08-05T00:00:00.000Z'] } }),
      'rec-1',
      NOW,
    )

    expect(applyOutboxItem(positionAt(0), NOW)).toBe('applied')
    expect(applyOutboxItem(positionAt(1), NOW)).toBe('applied')

    expect(shadow()).toHaveLength(1)
    expect(shadow()[0]?.content).toBe('likes light mode')
    expect(shadow()[0]?.eventTime).toBe('2026-08-05T00:00:00.000Z')
  })

  test('an earlier event applied after a later one loses and changes nothing', () => {
    captureCanonicalEvent(input(), 'rec-1', NOW)
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: ['2026-08-05T00:00:00.000Z'] } }),
      'rec-1',
      NOW,
    )

    expect(applyOutboxItem(positionAt(1), NOW)).toBe('applied')
    expect(applyOutboxItem(positionAt(0), NOW)).toBe('superseded')

    expect(shadow()).toHaveLength(1)
    expect(shadow()[0]?.content).toBe('likes light mode')
  })

  test('a superseded item still completes, so it is never retried forever', () => {
    captureCanonicalEvent(input(), 'rec-1', NOW)
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: ['2026-08-05T00:00:00.000Z'] } }),
      'rec-1',
      NOW,
    )
    applyOutboxItem(positionAt(1), NOW)
    applyOutboxItem(positionAt(0), NOW)

    expect(outbox()[0]?.state).toBe('complete')
  })

  test('re-applying the same position is a no-op beyond the attempt count', () => {
    captureCanonicalEvent(input(), 'rec-1', NOW)
    const position = firstPosition()
    applyOutboxItem(position, NOW)
    const afterFirst = shadow()

    expect(applyOutboxItem(position, NOW)).toBe('applied')
    expect(shadow()).toEqual(afterFirst)
  })

  test('an event with no record id projects under its idempotency identity', () => {
    captureCanonicalEvent(input(), null, NOW)
    applyOutboxItem(firstPosition(), NOW)

    expect(shadow()).toHaveLength(1)
    expect(shadow()[0]?.recordId).toBeNull()
    expect(shadow()[0]?.projectionKey).toBe(events()[0]?.idempotencyIdentity)
  })

  test('an observe item refreshes last_observed_at on the winning row', () => {
    captureCanonicalEvent(input(), 'rec-1', NOW)
    applyOutboxItem(positionAt(0), NOW)
    captureCanonicalEvent(input({ evidence: { timestamps: ['2026-09-01T00:00:00.000Z'] } }), 'rec-1', NOW)

    expect(outbox()[1]?.op).toBe('observe')
    expect(applyOutboxItem(positionAt(1), NOW)).toBe('applied')
    expect(shadow()[0]?.lastObservedAt).toBe('2026-09-01T00:00:00.000Z')
  })

  test('an outbox row whose event is gone fails terminally rather than retrying', () => {
    const position = orphanOutboxRow()

    expect(applyOutboxItem(position, NOW)).toBe('missing-event')

    const row = getDrizzleDb()
      .select()
      .from(memoryProjectionOutbox)
      .where(eq(memoryProjectionOutbox.position, position))
      .get()
    expect(row?.state).toBe('failed')
    expect(row?.lastError).toContain('canonical event missing')
    expect(shadow()).toHaveLength(0)
  })

  test('an unknown position reports missing-event and writes nothing', () => {
    expect(applyOutboxItem(9999, NOW)).toBe('missing-event')
    expect(shadow()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/long-term-memory/projection-apply.test.ts`
Expected: FAIL — cannot resolve `../../src/long-term-memory/projection-apply.js`.

- [ ] **Step 3: Implement apply**

Create `src/long-term-memory/projection-apply.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import {
  memoryCanonicalEvents,
  type MemoryCanonicalEventRow,
  memoryProjectionOutbox,
  memoryProjectionRecords,
} from '../db/schema.js'
import { logger } from '../logger.js'
import { projectionKeyFor, winsAgainst } from './projection-fold.js'

const log = logger.child({ scope: 'long-term-memory:projection-apply' })

/** After this many failed attempts an item stops being retried and waits for repair. */
export const MAX_PROJECTION_ATTEMPTS = 5

export type ApplyOutcome = 'applied' | 'superseded' | 'missing-event' | 'failed'

/** The transaction handle passed to `db.transaction((tx) => ...)`, for helpers outside that closure. */
type MemoryTx = Parameters<Parameters<ReturnType<typeof getDrizzleDb>['transaction']>[0]>[0]

const toProjectionValues = (
  event: MemoryCanonicalEventRow,
  projectionKey: string,
  now: string,
): typeof memoryProjectionRecords.$inferInsert =>
  ({
    projectionKey,
    recordId: event.recordId,
    eventId: event.eventId,
    idempotencyIdentity: event.idempotencyIdentity,
    contentIdentity: event.contentIdentity,
    scopeId: event.scopeId,
    scopeType: event.scopeType,
    threadContextId: event.threadContextId,
    kind: event.kind,
    content: event.content,
    summary: event.summary,
    tags: event.tags,
    confidence: event.confidence,
    source: event.source,
    actorIds: event.actorIds,
    provenance: event.provenance,
    eventTime: event.eventTime,
    lastObservedAt: event.lastObservedAt,
    validFrom: event.validFrom,
    validUntil: event.validUntil,
    expiresAt: event.expiresAt,
    schemaVersion: event.schemaVersion,
    captureVersion: event.captureVersion,
    projectedAt: now,
  }) satisfies typeof memoryProjectionRecords.$inferInsert

const upsertShadowRow = (tx: MemoryTx, event: MemoryCanonicalEventRow, projectionKey: string, now: string): void => {
  const values = toProjectionValues(event, projectionKey, now)
  tx.insert(memoryProjectionRecords)
    .values(values)
    .onConflictDoUpdate({ target: memoryProjectionRecords.projectionKey, set: values })
    .run()
}

const completeItem = (tx: MemoryTx, position: number, attemptCount: number, now: string): void => {
  tx.update(memoryProjectionOutbox)
    .set({ state: 'complete', attemptCount: attemptCount + 1, lastAttemptAt: now })
    .where(eq(memoryProjectionOutbox.position, position))
    .run()
}

const failTerminally = (tx: MemoryTx, position: number, attemptCount: number, now: string, reason: string): void => {
  tx.update(memoryProjectionOutbox)
    .set({ state: 'failed', attemptCount: attemptCount + 1, lastAttemptAt: now, lastError: reason })
    .where(eq(memoryProjectionOutbox.position, position))
    .run()
}

/**
 * Applies one outbox item to the shadow projection.
 *
 * The shadow upsert and the outbox state change are one transaction, which is what makes
 * boundaries B3 (partial projection writes) and B4 (projected but not checkpointed) unreachable
 * rather than merely unlikely: there is no window between them and no partial commit for a
 * crash to leave behind. The checkpoint is not written at all — it is `max(position)` over
 * completed rows, derived on read.
 *
 * Apply reads the canonical event rather than branching on the outbox `op`, so `capture` and
 * `observe` share one path and re-driving any position converges on the same state. `op`
 * survives as an O3 observability field.
 */
export function applyOutboxItem(position: number, now = new Date().toISOString()): ApplyOutcome {
  const outcome = applyWithinTransaction(position, now)
  // `missing-event` writes the item to a terminal `failed` state, so it must be greppable
  // apart from a routine apply. `failed` is already warned about inside `recordApplyFailure`.
  if (outcome === 'missing-event') {
    log.warn({ position, outcome }, 'Projection apply found no canonical event; outbox item failed terminally')
  } else {
    log.debug({ position, outcome }, 'Projection apply attempt')
  }
  return outcome
}

function applyWithinTransaction(position: number, now: string): ApplyOutcome {
  return getDrizzleDb().transaction((tx): ApplyOutcome => {
    const item = tx
      .select({ eventId: memoryProjectionOutbox.eventId, attemptCount: memoryProjectionOutbox.attemptCount })
      .from(memoryProjectionOutbox)
      .where(eq(memoryProjectionOutbox.position, position))
      .get()
    if (item === undefined) return 'missing-event'

    const event = tx
      .select()
      .from(memoryCanonicalEvents)
      .where(eq(memoryCanonicalEvents.eventId, item.eventId))
      .get()
    if (event === undefined) {
      // Unreachable while B1 holds. Retrying cannot conjure the event, so this fails terminally
      // and waits for a human rather than burning the retry budget.
      failTerminally(tx, position, item.attemptCount, now, `canonical event missing: ${item.eventId}`)
      return 'missing-event'
    }

    const projectionKey = projectionKeyFor(event.recordId, event.idempotencyIdentity)
    const incumbent = tx
      .select({
        eventTime: memoryProjectionRecords.eventTime,
        idempotencyIdentity: memoryProjectionRecords.idempotencyIdentity,
      })
      .from(memoryProjectionRecords)
      .where(eq(memoryProjectionRecords.projectionKey, projectionKey))
      .get()

    const wins = incumbent === undefined || winsAgainst(event, incumbent)
    if (wins) upsertShadowRow(tx, event, projectionKey, now)
    completeItem(tx, position, item.attemptCount, now)
    return wins ? 'applied' : 'superseded'
  })
}
```

Note the `'failed'` member of `ApplyOutcome` is declared here and returned in Task 4; nothing in this task produces it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/long-term-memory/projection-apply.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/projection-apply.ts tests/long-term-memory/projection-apply.test.ts
git commit -m "feat(memory): apply one outbox item to the shadow projection"
```

---

## Task 4: Failure, retry, and the B3 boundary

**Files:**
- Modify: `src/long-term-memory/projection-apply.ts` (wrap `applyWithinTransaction` in a try/catch, add `recordApplyFailure`)
- Test: `tests/long-term-memory/projection-faults.test.ts`

**Interfaces:**
- Consumes: `applyOutboxItem`, `MAX_PROJECTION_ATTEMPTS`, `ApplyOutcome` from Task 3.
- Produces: no new exports. `applyOutboxItem` now returns `'failed'` on a rolled-back apply and never throws.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/projection-faults.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { asc, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  memoryProjectionOutbox,
  type MemoryProjectionOutboxRow,
  memoryProjectionRecords,
  type MemoryProjectionRecordRow,
} from '../../src/db/schema.js'
import { captureCanonicalEvent } from '../../src/long-term-memory/canonical-capture.js'
import { applyOutboxItem, MAX_PROJECTION_ATTEMPTS } from '../../src/long-term-memory/projection-apply.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-08-02T15:00:00.000Z'

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
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  lastSeenAt: '2026-08-01T12:00:00.000Z',
  ...overrides,
})

const shadow = (): MemoryProjectionRecordRow[] => getDrizzleDb().select().from(memoryProjectionRecords).all()
const outbox = (): MemoryProjectionOutboxRow[] =>
  getDrizzleDb().select().from(memoryProjectionOutbox).orderBy(asc(memoryProjectionOutbox.position)).all()

const firstPosition = (): number => {
  const head = outbox()[0]
  if (head === undefined) throw new Error('no outbox rows')
  return head.position
}

/** Injects a fault at exactly the B3 boundary: on the shadow-row write, mid-transaction. */
const failTheShadowWrite = (): void => {
  getDrizzleDb().run(
    sql`CREATE TRIGGER fail_projection_insert BEFORE INSERT ON memory_projection_records
        BEGIN SELECT RAISE(ABORT, 'injected projection fault'); END`,
  )
}

/**
 * Injects a fault at the *second* write, after `upsertShadowRow` has already succeeded: the
 * outbox-completion update inside the same transaction. This is the direction that actually
 * distinguishes a real transaction from no transaction at all — a fault on the first write
 * (see `failTheShadowWrite` above) halts plain sequential JS before the second write is ever
 * reached, so those assertions would hold even with the `db.transaction(...)` wrapper deleted.
 * Faulting the second write instead means the shadow row was written, and only a genuine
 * rollback can make it disappear. Do not "simplify" this back into a first-write fault; that
 * would silently drop the one assertion in this file that a rollback, rather than control
 * flow, is doing the work.
 *
 * The trigger is scoped to `WHEN NEW.state = 'complete'` so it fires only on `completeItem`'s
 * write. `recordApplyFailure` runs afterward in its own, separate transaction and sets
 * `state` to `'pending'` or `'failed'`, never `'complete'` — an unscoped `BEFORE UPDATE`
 * trigger would also abort that out-of-transaction bookkeeping and destroy the retry state
 * this file's other tests depend on.
 */
const failTheOutboxCompletion = (): void => {
  getDrizzleDb().run(
    sql`CREATE TRIGGER fail_projection_complete BEFORE UPDATE ON memory_projection_outbox
        WHEN NEW.state = 'complete'
        BEGIN SELECT RAISE(ABORT, 'injected completion fault'); END`,
  )
}

const clearTheFault = (): void => {
  getDrizzleDb().run(sql`DROP TRIGGER IF EXISTS fail_projection_insert`)
  getDrizzleDb().run(sql`DROP TRIGGER IF EXISTS fail_projection_complete`)
}

const applyUnderFault = (position: number, times: number): void => {
  failTheShadowWrite()
  for (let attempt = 0; attempt < times; attempt += 1) applyOutboxItem(position, NOW)
  clearTheFault()
}

describe('projection apply faults', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    captureCanonicalEvent(input(), 'rec-1', NOW)
  })

  afterEach(() => {
    clearTheFault()
  })

  test('B3 is unreachable: a fault mid-apply leaves no shadow row and no completed item', () => {
    const position = firstPosition()
    applyUnderFault(position, 1)

    expect(shadow()).toHaveLength(0)
    expect(outbox()[0]?.state).toBe('pending')
  })

  test('B3 rolls back an already-written shadow row when the outbox completion write fails', () => {
    const position = firstPosition()
    failTheOutboxCompletion()
    const outcome = applyOutboxItem(position, NOW)
    clearTheFault()

    expect(outcome).toBe('failed')
    // Load-bearing: the shadow INSERT itself succeeded before the completion write faulted, so
    // an empty shadow table here is proof of a real rollback, not proof the insert never ran.
    expect(shadow()).toHaveLength(0)
    expect(outbox()[0]?.state).toBe('pending')
    expect(outbox()[0]?.attemptCount).toBe(1)
  })

  test('a failed apply reports failed rather than throwing', () => {
    failTheShadowWrite()
    const position = firstPosition()
    const run = (): unknown => applyOutboxItem(position, NOW)

    expect(run).not.toThrow()
    clearTheFault()
  })

  test('the attempt count and error survive the rolled-back transaction', () => {
    applyUnderFault(firstPosition(), 1)

    expect(outbox()[0]?.attemptCount).toBe(1)
    expect(outbox()[0]?.lastAttemptAt).toBe(NOW)
    expect(outbox()[0]?.lastError).toContain('injected projection fault')
  })

  test('the item stays pending while attempts remain', () => {
    applyUnderFault(firstPosition(), MAX_PROJECTION_ATTEMPTS - 1)

    expect(outbox()[0]?.attemptCount).toBe(MAX_PROJECTION_ATTEMPTS - 1)
    expect(outbox()[0]?.state).toBe('pending')
  })

  test('the item fails terminally once the attempt bound is reached', () => {
    applyUnderFault(firstPosition(), MAX_PROJECTION_ATTEMPTS)

    expect(outbox()[0]?.attemptCount).toBe(MAX_PROJECTION_ATTEMPTS)
    expect(outbox()[0]?.state).toBe('failed')
  })

  test('a terminal failure leaves the canonical evidence untouched', () => {
    applyUnderFault(firstPosition(), MAX_PROJECTION_ATTEMPTS)

    expect(shadow()).toHaveLength(0)
    expect(outbox()).toHaveLength(1)
  })

  test('apply recovers once the fault clears', () => {
    const position = firstPosition()
    applyUnderFault(position, 1)

    expect(applyOutboxItem(position, NOW)).toBe('applied')
    expect(shadow()).toHaveLength(1)
    expect(outbox()[0]?.state).toBe('complete')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/long-term-memory/projection-faults.test.ts`
Expected: FAIL — the injected `RAISE(ABORT)` propagates out of `applyOutboxItem`, so the first test throws instead of asserting.

- [ ] **Step 3: Add the failure path**

In `src/long-term-memory/projection-apply.ts`, replace the body of `applyOutboxItem` with the catching version and add `recordApplyFailure` above it:

```typescript
/**
 * Records a rolled-back apply in its own transaction.
 *
 * The main transaction rolled back, taking its own attempt bookkeeping with it, so the retry
 * state is written separately — the same reason canonical capture records a failed attempt
 * outside its transaction. At the attempt bound the item goes terminal: retrying a poison row
 * forever would make outbox depth ambiguous between a backlog and one stuck item.
 */
const recordApplyFailure = (position: number, now: string, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error)
  try {
    getDrizzleDb().transaction((tx) => {
      const item = tx
        .select({ attemptCount: memoryProjectionOutbox.attemptCount })
        .from(memoryProjectionOutbox)
        .where(eq(memoryProjectionOutbox.position, position))
        .get()
      if (item === undefined) return
      const attemptCount = item.attemptCount + 1
      tx.update(memoryProjectionOutbox)
        .set({
          attemptCount,
          lastAttemptAt: now,
          lastError: message,
          state: attemptCount >= MAX_PROJECTION_ATTEMPTS ? 'failed' : 'pending',
        })
        .where(eq(memoryProjectionOutbox.position, position))
        .run()
    })
    log.warn({ position, error: message }, 'Projection apply failed; retry state recorded')
  } catch (recordingError) {
    const recordingMessage = recordingError instanceof Error ? recordingError.message : String(recordingError)
    log.error({ position, error: message, recordingMessage }, 'Projection apply failed and could not be recorded')
  }
}

export function applyOutboxItem(position: number, now = new Date().toISOString()): ApplyOutcome {
  let outcome: ApplyOutcome
  try {
    outcome = applyWithinTransaction(position, now)
  } catch (error) {
    recordApplyFailure(position, now, error)
    outcome = 'failed'
  }
  // `missing-event` writes the item to a terminal `failed` state, so it must be greppable
  // apart from a routine apply. `failed` is already warned about inside `recordApplyFailure`.
  if (outcome === 'missing-event') {
    log.warn({ position, outcome }, 'Projection apply found no canonical event; outbox item failed terminally')
  } else {
    log.debug({ position, outcome }, 'Projection apply attempt')
  }
  return outcome
}
```

Keep `applyWithinTransaction` exactly as Task 3 wrote it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/long-term-memory/projection-faults.test.ts tests/long-term-memory/projection-apply.test.ts`
Expected: PASS, 17 tests total.

- [ ] **Step 5: Check the file size budget**

Run: `bun lint`
Expected: PASS. If `max-lines` fails on `projection-apply.ts`, extract `toProjectionValues` into a new `src/long-term-memory/projection-values.ts` and import it — do not compress formatting.

- [ ] **Step 6: Commit**

```bash
git add src/long-term-memory/projection-apply.ts tests/long-term-memory/projection-faults.test.ts
git commit -m "feat(memory): record projection apply failures and bound retries"
```

---

## Task 5: Kill switch, drain loop, checkpoint, and repair

**Files:**
- Create: `src/long-term-memory/projection-config.ts`
- Create: `src/long-term-memory/projection-drain.ts`
- Test: `tests/long-term-memory/projection-config.test.ts`
- Test: `tests/long-term-memory/projection-drain.test.ts`

**Interfaces:**
- Consumes: `applyOutboxItem`, `ApplyOutcome` from `./projection-apply.js` (Tasks 3-4).
- Produces:
  - `export function isCanonicalProjectionEnabled(): boolean`
  - `export const PROJECTION_DRAIN_LIMIT = 200`
  - `export type DrainResult = Readonly<{ applied: number; superseded: number; failed: number; remaining: number }>`
  - `export function drainProjectionOutbox(now?: string): DrainResult`
  - `export function projectionCheckpoint(): number | null`
  - `export function repairFailedProjections(): number`

- [ ] **Step 1: Write the failing kill-switch test**

Create `tests/long-term-memory/projection-config.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { isCanonicalProjectionEnabled } from '../../src/long-term-memory/projection-config.js'

const setSwitch = (value: string | undefined): void => {
  if (value === undefined) delete process.env['MEMORY_CANONICAL_PROJECTION']
  else process.env['MEMORY_CANONICAL_PROJECTION'] = value
}

describe('isCanonicalProjectionEnabled', () => {
  afterEach(() => {
    setSwitch(undefined)
  })

  test('projection is on when the variable is unset', () => {
    setSwitch(undefined)
    expect(isCanonicalProjectionEnabled()).toBe(true)
  })

  test('the exact string "off" disables it', () => {
    setSwitch('off')
    expect(isCanonicalProjectionEnabled()).toBe(false)
  })

  test('an upper-case OFF does not disable it', () => {
    setSwitch('OFF')
    expect(isCanonicalProjectionEnabled()).toBe(true)
  })

  test('an empty value does not disable it', () => {
    setSwitch('')
    expect(isCanonicalProjectionEnabled()).toBe(true)
  })

  test('any other value leaves it enabled', () => {
    setSwitch('false')
    expect(isCanonicalProjectionEnabled()).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/long-term-memory/projection-config.test.ts`
Expected: FAIL — cannot resolve `../../src/long-term-memory/projection-config.js`.

- [ ] **Step 3: Implement the kill switch**

Create `src/long-term-memory/projection-config.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Kill switch for the dark projection. Default **ON**, matching `MEMORY_CANONICAL_CAPTURE`:
 * the projection writes only to a table no reader queries, and defaulting it off would leave
 * the shadow table empty in every real deployment — which would make Gate 1d's reconciliation
 * compare the live path against nothing and pass trivially.
 *
 * Only the exact string `'off'` disables it; any other value, including unset or empty, is
 * treated as enabled.
 */
export function isCanonicalProjectionEnabled(): boolean {
  return process.env['MEMORY_CANONICAL_PROJECTION'] !== 'off'
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test tests/long-term-memory/projection-config.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing drain test**

Create `tests/long-term-memory/projection-drain.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { asc, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  memoryProjectionOutbox,
  type MemoryProjectionOutboxRow,
  memoryProjectionRecords,
  type MemoryProjectionRecordRow,
} from '../../src/db/schema.js'
import { captureCanonicalEvent } from '../../src/long-term-memory/canonical-capture.js'
import { MAX_PROJECTION_ATTEMPTS } from '../../src/long-term-memory/projection-apply.js'
import {
  drainProjectionOutbox,
  PROJECTION_DRAIN_LIMIT,
  projectionCheckpoint,
  repairFailedProjections,
} from '../../src/long-term-memory/projection-drain.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-08-02T15:00:00.000Z'

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
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  lastSeenAt: '2026-08-01T12:00:00.000Z',
  ...overrides,
})

const shadow = (): MemoryProjectionRecordRow[] => getDrizzleDb().select().from(memoryProjectionRecords).all()
const outbox = (): MemoryProjectionOutboxRow[] =>
  getDrizzleDb().select().from(memoryProjectionOutbox).orderBy(asc(memoryProjectionOutbox.position)).all()

const captureMany = (count: number): void => {
  for (let index = 0; index < count; index += 1) {
    captureCanonicalEvent(input({ id: `rec-${index}`, content: `fact number ${index}` }), `rec-${index}`, NOW)
  }
}

const failTheShadowWrite = (): void => {
  getDrizzleDb().run(
    sql`CREATE TRIGGER fail_projection_insert BEFORE INSERT ON memory_projection_records
        BEGIN SELECT RAISE(ABORT, 'injected projection fault'); END`,
  )
}

const clearTheFault = (): void => {
  getDrizzleDb().run(sql`DROP TRIGGER IF EXISTS fail_projection_insert`)
}

const drainUnderFault = (times: number): void => {
  failTheShadowWrite()
  for (let attempt = 0; attempt < times; attempt += 1) drainProjectionOutbox(NOW)
  clearTheFault()
}

describe('drainProjectionOutbox', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterEach(() => {
    clearTheFault()
    delete process.env['MEMORY_CANONICAL_PROJECTION']
  })

  test('an empty outbox drains to zeros', () => {
    expect(drainProjectionOutbox(NOW)).toEqual({ applied: 0, superseded: 0, failed: 0, remaining: 0 })
  })

  test('a drain applies every pending item and reports the counts', () => {
    captureMany(3)

    expect(drainProjectionOutbox(NOW)).toEqual({ applied: 3, superseded: 0, failed: 0, remaining: 0 })
    expect(shadow()).toHaveLength(3)
  })

  test('B2 is holdable: without a drain the item stays pending and no shadow row exists', () => {
    captureMany(1)

    expect(outbox()[0]?.state).toBe('pending')
    expect(shadow()).toHaveLength(0)
  })

  test('a second drain finds nothing left to do', () => {
    captureMany(2)
    drainProjectionOutbox(NOW)

    expect(drainProjectionOutbox(NOW)).toEqual({ applied: 0, superseded: 0, failed: 0, remaining: 0 })
  })

  test('a superseded item is counted separately from an applied one', () => {
    captureCanonicalEvent(input(), 'rec-1', NOW)
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: ['2026-08-05T00:00:00.000Z'] } }),
      'rec-1',
      NOW,
    )

    expect(drainProjectionOutbox(NOW)).toEqual({ applied: 2, superseded: 0, failed: 0, remaining: 0 })
    expect(shadow()).toHaveLength(1)
  })

  test('the drain stops at the cap and reports the remainder', () => {
    captureMany(PROJECTION_DRAIN_LIMIT + 5)
    const result = drainProjectionOutbox(NOW)

    expect(result.applied).toBe(PROJECTION_DRAIN_LIMIT)
    expect(result.remaining).toBe(5)
  })

  test('a following drain clears the remainder', () => {
    captureMany(PROJECTION_DRAIN_LIMIT + 5)
    drainProjectionOutbox(NOW)

    expect(drainProjectionOutbox(NOW).applied).toBe(5)
    expect(shadow()).toHaveLength(PROJECTION_DRAIN_LIMIT + 5)
  })

  test('the kill switch off drains nothing and writes no shadow row', () => {
    captureMany(2)
    process.env['MEMORY_CANONICAL_PROJECTION'] = 'off'

    expect(drainProjectionOutbox(NOW)).toEqual({ applied: 0, superseded: 0, failed: 0, remaining: 0 })
    expect(shadow()).toHaveLength(0)
    expect(outbox()[0]?.state).toBe('pending')
  })

  test('failing items are counted and left for retry', () => {
    captureMany(2)
    drainUnderFault(1)

    expect(outbox().every((row) => row.state === 'pending')).toBe(true)
    expect(shadow()).toHaveLength(0)
  })
})

describe('projectionCheckpoint', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('an undrained outbox has no checkpoint', () => {
    captureMany(2)

    expect(projectionCheckpoint()).toBeNull()
  })

  test('the checkpoint is the highest completed position', () => {
    captureMany(3)
    drainProjectionOutbox(NOW)
    const positions = outbox().map((row) => row.position)

    expect(projectionCheckpoint()).toBe(Math.max(...positions))
  })
})

describe('repairFailedProjections', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterEach(() => {
    clearTheFault()
  })

  test('nothing to repair returns zero', () => {
    expect(repairFailedProjections()).toBe(0)
  })

  test('a terminally failed item is re-driven to pending with a cleared error', () => {
    captureMany(1)
    drainUnderFault(MAX_PROJECTION_ATTEMPTS)

    expect(outbox()[0]?.state).toBe('failed')
    expect(repairFailedProjections()).toBe(1)
    expect(outbox()[0]?.state).toBe('pending')
    expect(outbox()[0]?.attemptCount).toBe(0)
    expect(outbox()[0]?.lastError).toBeNull()
  })

  test('a repaired item applies on the next drain', () => {
    captureMany(1)
    drainUnderFault(MAX_PROJECTION_ATTEMPTS)
    repairFailedProjections()

    expect(drainProjectionOutbox(NOW).applied).toBe(1)
    expect(shadow()).toHaveLength(1)
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `bun test tests/long-term-memory/projection-drain.test.ts`
Expected: FAIL — cannot resolve `../../src/long-term-memory/projection-drain.js`.

- [ ] **Step 7: Implement the drain**

Create `src/long-term-memory/projection-drain.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { asc, count, desc, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryProjectionOutbox } from '../db/schema.js'
import { logger } from '../logger.js'
import { applyOutboxItem } from './projection-apply.js'
import { isCanonicalProjectionEnabled } from './projection-config.js'

const log = logger.child({ scope: 'long-term-memory:projection-drain' })

/** One drain run applies at most this many items, so a backlog cannot monopolise a tick. */
export const PROJECTION_DRAIN_LIMIT = 200

export type DrainResult = Readonly<{ applied: number; superseded: number; failed: number; remaining: number }>

const EMPTY: DrainResult = { applied: 0, superseded: 0, failed: 0, remaining: 0 }

const pendingPositions = (): readonly number[] =>
  getDrizzleDb()
    .select({ position: memoryProjectionOutbox.position })
    .from(memoryProjectionOutbox)
    .where(eq(memoryProjectionOutbox.state, 'pending'))
    .orderBy(asc(memoryProjectionOutbox.position))
    .limit(PROJECTION_DRAIN_LIMIT)
    .all()
    .map((row) => row.position)

const pendingCount = (): number =>
  getDrizzleDb()
    .select({ value: count() })
    .from(memoryProjectionOutbox)
    .where(eq(memoryProjectionOutbox.state, 'pending'))
    .get()?.value ?? 0

/**
 * Applies pending outbox items in position order, one transaction each.
 *
 * The loop holds no state of its own: every decision lives in `applyOutboxItem`, which is what
 * lets the boundary tests drive a single item without a scheduler. A run bounded by the cap
 * logs the remaining depth, so a partial drain is never mistaken for a drained queue.
 */
export function drainProjectionOutbox(now = new Date().toISOString()): DrainResult {
  if (!isCanonicalProjectionEnabled()) {
    log.debug('Projection drain skipped: kill switch off')
    return EMPTY
  }

  let applied = 0
  let superseded = 0
  let failed = 0
  for (const position of pendingPositions()) {
    const outcome = applyOutboxItem(position, now)
    if (outcome === 'applied') applied += 1
    else if (outcome === 'superseded') superseded += 1
    else failed += 1
  }

  const remaining = pendingCount()
  const result: DrainResult = { applied, superseded, failed, remaining }
  if (remaining > 0) log.info(result, 'Projection drain stopped with work remaining')
  else log.debug(result, 'Projection drain complete')
  return result
}

/**
 * The projection checkpoint, derived rather than stored: the highest position whose item is
 * complete. Nothing writes it, so it cannot drift from the work it describes — which is the
 * failure a stored checkpoint would hand to Gate 1d as an ambiguous discrepancy.
 */
export function projectionCheckpoint(): number | null {
  return (
    getDrizzleDb()
      .select({ position: memoryProjectionOutbox.position })
      .from(memoryProjectionOutbox)
      .where(eq(memoryProjectionOutbox.state, 'complete'))
      .orderBy(desc(memoryProjectionOutbox.position))
      .limit(1)
      .get()?.position ?? null
  )
}

/**
 * Re-drives terminally failed items. Repair is a data operation over the existing machinery
 * rather than new machinery: the canonical evidence was never touched, so returning an item to
 * `pending` is enough for the next drain to converge it.
 */
export function repairFailedProjections(): number {
  const db = getDrizzleDb()
  const repaired = db
    .select({ value: count() })
    .from(memoryProjectionOutbox)
    .where(eq(memoryProjectionOutbox.state, 'failed'))
    .get()?.value ?? 0
  if (repaired === 0) return 0

  db.update(memoryProjectionOutbox)
    .set({ state: 'pending', attemptCount: 0, lastError: null })
    .where(eq(memoryProjectionOutbox.state, 'failed'))
    .run()
  log.info({ repaired }, 'Failed projection items re-driven to pending')
  return repaired
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test tests/long-term-memory/projection-drain.test.ts tests/long-term-memory/projection-config.test.ts`
Expected: PASS, 19 tests total.

- [ ] **Step 9: Commit**

```bash
git add src/long-term-memory/projection-config.ts src/long-term-memory/projection-drain.ts tests/long-term-memory/projection-config.test.ts tests/long-term-memory/projection-drain.test.ts
git commit -m "feat(memory): drain the projection outbox with a derived checkpoint and repair"
```

---

## Task 6: The O2 snapshot

**Files:**
- Modify: `src/long-term-memory/canonical-identity.ts` (export the existing `stableStringify` — add `export` to its declaration at ~line 71; change nothing else)
- Create: `src/long-term-memory/projection-snapshot.ts`
- Modify: `knip.config.ts` (declare the snapshot an entry — see Step 5b)
- Test: `tests/long-term-memory/projection-snapshot.test.ts`

**Interfaces:**
- Consumes: `memoryProjectionRecords` from `../db/schema.js` (Task 1); `drainProjectionOutbox` from `./projection-drain.js` (Task 5) in tests only; `CAPTURE_VERSION` and `stableStringify` from `./canonical-identity.js`.
- Produces: `export function projectionSnapshot(scope: MemoryScope): string`

`stableStringify` already exists in `canonical-identity.ts` as a module-private recursive key-sorting serializer. It is reused rather than reimplemented for the same reason `contentHash` is imported from `tombstone.ts`: two serializers meant to agree eventually will not.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/projection-snapshot.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { captureCanonicalEvent } from '../../src/long-term-memory/canonical-capture.js'
import { drainProjectionOutbox } from '../../src/long-term-memory/projection-drain.js'
import { projectionSnapshot } from '../../src/long-term-memory/projection-snapshot.js'
import type { MemoryRecordInput, MemoryScope } from '../../src/long-term-memory/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-08-02T15:00:00.000Z'
const SCOPE: MemoryScope = { scopeId: 'user-1', scopeType: 'personal' }
const OTHER: MemoryScope = { scopeId: 'user-2', scopeType: 'personal' }

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
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  lastSeenAt: '2026-08-01T12:00:00.000Z',
  ...overrides,
})

const captureAndDrain = (record: MemoryRecordInput, recordId: string | null, ingest: string): void => {
  captureCanonicalEvent(record, recordId, ingest)
  drainProjectionOutbox(ingest)
}

describe('projectionSnapshot', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('an empty scope has a stable empty snapshot', () => {
    expect(projectionSnapshot(SCOPE)).toBe(projectionSnapshot(SCOPE))
  })

  test('two scopes with no rows still produce different snapshots', () => {
    expect(projectionSnapshot(SCOPE)).not.toBe(projectionSnapshot(OTHER))
  })

  test('the snapshot changes when content changes', () => {
    captureAndDrain(input(), 'rec-1', NOW)
    const before = projectionSnapshot(SCOPE)
    captureAndDrain(
      input({ content: 'likes light mode', evidence: { timestamps: ['2026-08-05T00:00:00.000Z'] } }),
      'rec-1',
      NOW,
    )

    expect(projectionSnapshot(SCOPE)).not.toBe(before)
  })

  test('the snapshot excludes the event id, which is a fresh UUID on every run', () => {
    captureAndDrain(input(), 'rec-1', NOW)

    expect(projectionSnapshot(SCOPE)).not.toContain('eventId')
  })

  test('the snapshot excludes the projection timestamp', () => {
    captureAndDrain(input(), 'rec-1', NOW)

    expect(projectionSnapshot(SCOPE)).not.toContain('projectedAt')
  })

  test('a different ingest time yields the same snapshot', async () => {
    captureAndDrain(input(), 'rec-1', NOW)
    const first = projectionSnapshot(SCOPE)

    await setupTestDb()
    captureAndDrain(input(), 'rec-1', '2027-01-01T00:00:00.000Z')

    expect(projectionSnapshot(SCOPE)).toBe(first)
  })

  test('the snapshot carries the observed instant, which is replay-stable by construction', () => {
    captureAndDrain(input(), 'rec-1', NOW)

    expect(projectionSnapshot(SCOPE)).toContain('lastObservedAt')
  })

  test('the snapshot is scoped: another scope’s rows never appear', () => {
    captureAndDrain(input(), 'rec-1', NOW)
    captureAndDrain(input({ id: 'rec-2', scopeId: 'user-2', content: 'other scope fact' }), 'rec-2', NOW)

    expect(projectionSnapshot(SCOPE)).not.toContain('other scope fact')
  })

  test('rows are ordered by projection key, not by insertion order', () => {
    captureAndDrain(input({ id: 'rec-z', content: 'zebra fact' }), 'rec-z', NOW)
    captureAndDrain(input({ id: 'rec-a', content: 'alpha fact' }), 'rec-a', NOW)
    const snapshot = projectionSnapshot(SCOPE)

    expect(snapshot.indexOf('alpha fact')).toBeLessThan(snapshot.indexOf('zebra fact'))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/long-term-memory/projection-snapshot.test.ts`
Expected: FAIL — cannot resolve `../../src/long-term-memory/projection-snapshot.js`.

- [ ] **Step 3: Export `stableStringify`**

In `src/long-term-memory/canonical-identity.ts`, change the declaration at around line 71 from

```typescript
const stableStringify = (value: unknown): string => {
```

to

```typescript
export const stableStringify = (value: unknown): string => {
```

Change nothing else in that file. `canonicalJson` keeps using it exactly as before.

- [ ] **Step 4: Implement the snapshot**

Create `src/long-term-memory/projection-snapshot.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, asc, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryProjectionRecords, type MemoryProjectionRecordRow } from '../db/schema.js'
import { CAPTURE_VERSION, stableStringify } from './canonical-identity.js'
import type { MemoryScope } from './types.js'

/**
 * The replay-stable view of one shadow row.
 *
 * Every field here derives from the winning event, and the winner is chosen by event time, so
 * ingest order cannot reach any of them. `lastObservedAt` is included deliberately: it looks
 * ingest-dependent and is not, because capture advances it by monotonic event-time max, so any
 * ingest order converges on the same value. Excluding it would leave that designed property
 * unasserted.
 *
 * `eventId` and `projectedAt` are excluded because they genuinely vary per run — a fresh UUID
 * and a wall clock — and including either would make the byte-identity contract unsatisfiable
 * for reasons that have nothing to do with correctness. Outbox fields are excluded for the
 * same reason.
 */
const snapshotRow = (row: MemoryProjectionRecordRow): Record<string, unknown> => ({
  projectionKey: row.projectionKey,
  recordId: row.recordId,
  idempotencyIdentity: row.idempotencyIdentity,
  contentIdentity: row.contentIdentity,
  scopeId: row.scopeId,
  scopeType: row.scopeType,
  threadContextId: row.threadContextId,
  kind: row.kind,
  content: row.content,
  summary: row.summary,
  tags: row.tags,
  confidence: row.confidence,
  source: row.source,
  actorIds: row.actorIds,
  provenance: row.provenance,
  eventTime: row.eventTime,
  lastObservedAt: row.lastObservedAt,
  validFrom: row.validFrom,
  validUntil: row.validUntil,
  expiresAt: row.expiresAt,
  schemaVersion: row.schemaVersion,
  captureVersion: row.captureVersion,
})

/**
 * Observable O2: a deterministic, order-stable serialization of a scope's projection state,
 * comparable byte-for-byte across runs.
 *
 * Defined **at quiescence** — the outbox drained. That is the only point at which byte-identity
 * is a meaningful claim; mid-drain the shadow table is legitimately partial.
 *
 * Serialized by the same `stableStringify` that backs `canonicalJson`, imported rather than
 * reimplemented so the two cannot drift.
 */
export function projectionSnapshot(scope: MemoryScope): string {
  const rows = getDrizzleDb()
    .select()
    .from(memoryProjectionRecords)
    .where(
      and(
        eq(memoryProjectionRecords.scopeType, scope.scopeType),
        eq(memoryProjectionRecords.scopeId, scope.scopeId),
      ),
    )
    .orderBy(asc(memoryProjectionRecords.projectionKey))
    .all()

  return stableStringify({
    captureVersion: CAPTURE_VERSION,
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    rows: rows.map(snapshotRow),
  })
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `bun test tests/long-term-memory/projection-snapshot.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5b: Declare the snapshot a knip entry point**

Every other Gate 1b module gains a production importer as the chain lands — `projection-fold` from `projection-apply`, `projection-apply` and `projection-config` from `projection-drain`, `projection-drain` from the scheduler in Task 9. `projection-snapshot` does not: knip's project scope is production-only (`src/**/*.ts!`), so its test importers do not count, and its next production consumer is Gate 1d's reconciliation. Without a declaration it stays permanently unused and Task 9's knip step cannot pass.

`knip.config.ts` states its own preference for this case: *"prefer targeted fixes (`*.testing.ts` shims, entry declarations) over new ignore lines."* An entry declaration is the sanctioned mechanism, and `src/coding-sessions/*.ts!` are existing precedent for declaring a stable boundary an entry. This is **not** an ignore, and it does not suppress a finding — the file is still fully type-checked, linted, and traced for its own unused exports.

In `knip.config.ts`, add to the `entry` array, immediately after the `'scripts/behavior-audit/reset.ts!'` group or alongside the `src/coding-sessions/` block — wherever the surrounding comment style fits best:

```typescript
    // Observable O2 of the memory canonical-capture gate: a deterministic projection
    // snapshot with no production importer until Gate 1d's reconciliation consumes it.
    // Declared an entry rather than ignored so its own exports stay traced.
    'src/long-term-memory/projection-snapshot.ts!',
```

Do not add an `ignore` or `ignoreIssues` line for this file.

- [ ] **Step 6: Prove the field-discipline test is load-bearing**

Temporarily add `eventId: row.eventId,` to the `snapshotRow` object, run `bun test tests/long-term-memory/projection-snapshot.test.ts`, and confirm the "excludes the event id" and "a different ingest time yields the same snapshot" tests FAIL. Then remove that line and re-run to confirm PASS.

Run: `git diff --exit-code src/long-term-memory/projection-snapshot.ts`
Expected: no output — the file is byte-identical to what Step 4 wrote.

This step exists because Gate 1a shipped an equality assertion that a same-type field swap passed unchanged. An assertion that cannot fail reports coverage it does not have.

- [ ] **Step 7: Commit**

```bash
git add src/long-term-memory/canonical-identity.ts src/long-term-memory/projection-snapshot.ts knip.config.ts tests/long-term-memory/projection-snapshot.test.ts
git commit -m "feat(memory): add the deterministic projection snapshot"
```

---

## Task 7: Replay, ordering, and boundary evidence

**Files:**
- Test: `tests/long-term-memory/projection-replay.test.ts` (create)

No production code changes. This task assembles the evidence the `capture-idempotency` predicate demands, end to end, so that Task 8's promotion rests on an executed contract rather than on component tests.

**Interfaces:**
- Consumes: `captureCanonicalEvent` (existing); `drainProjectionOutbox`, `projectionCheckpoint` from `./projection-drain.js` (Task 5); `projectionSnapshot` from `./projection-snapshot.js` (Task 6).
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/projection-replay.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  memoryCanonicalEvents,
  type MemoryCanonicalEventRow,
  memoryProjectionRecords,
  type MemoryProjectionRecordRow,
} from '../../src/db/schema.js'
import { captureCanonicalEvent } from '../../src/long-term-memory/canonical-capture.js'
import { drainProjectionOutbox, projectionCheckpoint } from '../../src/long-term-memory/projection-drain.js'
import { projectionSnapshot } from '../../src/long-term-memory/projection-snapshot.js'
import type { MemoryRecordInput, MemoryScope } from '../../src/long-term-memory/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const SCOPE: MemoryScope = { scopeId: 'user-1', scopeType: 'personal' }

const EARLY = '2026-08-01T00:00:00.000Z'
const LATE = '2026-08-09T00:00:00.000Z'

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
  createdAt: EARLY,
  updatedAt: EARLY,
  lastSeenAt: EARLY,
  ...overrides,
})

const events = (): MemoryCanonicalEventRow[] => getDrizzleDb().select().from(memoryCanonicalEvents).all()
const shadow = (): MemoryProjectionRecordRow[] => getDrizzleDb().select().from(memoryProjectionRecords).all()

const captureTimes = (times: number, ingest: string): void => {
  for (let attempt = 0; attempt < times; attempt += 1) captureCanonicalEvent(input(), 'rec-1', ingest)
}

const settle = (): string => {
  drainProjectionOutbox('2026-08-10T00:00:00.000Z')
  return projectionSnapshot(SCOPE)
}

describe('projection replay', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('one capture produces one event and one shadow row', () => {
    captureTimes(1, '2026-08-02T00:00:00.000Z')
    settle()

    expect(events()).toHaveLength(1)
    expect(shadow()).toHaveLength(1)
  })

  test('N identical replays yield exactly one canonical event', () => {
    captureTimes(5, '2026-08-02T00:00:00.000Z')

    expect(events()).toHaveLength(1)
  })

  test('the snapshot after N replays is byte-identical to the snapshot after one', async () => {
    captureTimes(1, '2026-08-02T00:00:00.000Z')
    const afterOne = settle()

    await setupTestDb()
    captureTimes(5, '2026-08-02T00:00:00.000Z')

    expect(settle()).toBe(afterOne)
  })

  test('draining between replays does not change the settled snapshot', async () => {
    captureTimes(1, '2026-08-02T00:00:00.000Z')
    const afterOne = settle()

    await setupTestDb()
    captureCanonicalEvent(input(), 'rec-1', '2026-08-02T00:00:00.000Z')
    drainProjectionOutbox('2026-08-03T00:00:00.000Z')
    captureCanonicalEvent(input(), 'rec-1', '2026-08-04T00:00:00.000Z')

    expect(settle()).toBe(afterOne)
  })

  test('reversing ingest order relative to event time yields the same settled snapshot', async () => {
    captureCanonicalEvent(input({ evidence: { timestamps: [EARLY] } }), 'rec-1', '2026-08-02T00:00:00.000Z')
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: [LATE] } }),
      'rec-1',
      '2026-08-03T00:00:00.000Z',
    )
    const forward = settle()

    await setupTestDb()
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: [LATE] } }),
      'rec-1',
      '2026-08-02T00:00:00.000Z',
    )
    captureCanonicalEvent(input({ evidence: { timestamps: [EARLY] } }), 'rec-1', '2026-08-03T00:00:00.000Z')

    expect(settle()).toBe(forward)
  })

  test('draining after each capture yields the same snapshot as draining once at the end', async () => {
    captureCanonicalEvent(input({ evidence: { timestamps: [EARLY] } }), 'rec-1', '2026-08-02T00:00:00.000Z')
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: [LATE] } }),
      'rec-1',
      '2026-08-03T00:00:00.000Z',
    )
    const batched = settle()

    await setupTestDb()
    captureCanonicalEvent(input({ evidence: { timestamps: [EARLY] } }), 'rec-1', '2026-08-02T00:00:00.000Z')
    drainProjectionOutbox('2026-08-02T01:00:00.000Z')
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: [LATE] } }),
      'rec-1',
      '2026-08-03T00:00:00.000Z',
    )

    expect(settle()).toBe(batched)
  })

  test('the later event time wins regardless of which arrived first', () => {
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: [LATE] } }),
      'rec-1',
      '2026-08-02T00:00:00.000Z',
    )
    captureCanonicalEvent(input({ evidence: { timestamps: [EARLY] } }), 'rec-1', '2026-08-03T00:00:00.000Z')
    settle()

    expect(shadow()).toHaveLength(1)
    expect(shadow()[0]?.content).toBe('likes light mode')
  })

  test('B4 is unreachable: every shadow row has a completed item at or below the checkpoint', () => {
    captureCanonicalEvent(input(), 'rec-1', '2026-08-02T00:00:00.000Z')
    captureCanonicalEvent(input({ id: 'rec-2', content: 'prefers metric units' }), 'rec-2', '2026-08-02T00:00:00.000Z')
    settle()

    expect(shadow()).toHaveLength(2)
    expect(projectionCheckpoint()).not.toBeNull()
  })

  test('B2 is holdable: capture without a drain leaves the snapshot empty', () => {
    const empty = projectionSnapshot(SCOPE)
    captureCanonicalEvent(input(), 'rec-1', '2026-08-02T00:00:00.000Z')

    expect(projectionSnapshot(SCOPE)).toBe(empty)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/long-term-memory/projection-replay.test.ts`
Expected: PASS if Tasks 1-6 are correct. This is a characterization suite over already-built behavior, so a green first run is the expected outcome — it is not evidence of a vacuous test.

To confirm the suite is load-bearing, temporarily change `winsAgainst` in `src/long-term-memory/projection-fold.ts` so the final comparison reads `return left < right` instead of `return left > right`, run the suite, and confirm "the later event time wins regardless of which arrived first" and "reversing ingest order…" FAIL. Then revert and confirm `git diff --exit-code src/long-term-memory/projection-fold.ts` produces no output.

- [ ] **Step 3: Run the whole memory suite**

Run: `bun test tests/long-term-memory/`
Expected: PASS, with no regression against the pre-Gate-1b count.

- [ ] **Step 4: Commit**

```bash
git add tests/long-term-memory/projection-replay.test.ts
git commit -m "test(memory): cover projection replay, ordering, and the B2/B4 boundaries"
```

---

## Task 8: Promote the `capture-idempotency` criterion

**Files:**
- Modify: `tests/long-term-memory/acceptance/corpus.ts` (add `seedLongHorizon`, bump `CORPUS_VERSION`)
- Create: `tests/long-term-memory/acceptance/capture-idempotency.cases.ts`
- Create: `tests/long-term-memory/acceptance/capture-idempotency.test.ts`
- Modify: `tests/long-term-memory/acceptance/coverage.ts` (register the new case table)
- Modify: `tests/long-term-memory/acceptance/registry.ts` (promote the criterion; flip two shapes)
- Modify: `tests/long-term-memory/acceptance/registry.test.ts` (three assertions become false on promotion)
- Modify: `tests/long-term-memory/acceptance/report.test.ts` (two assertions become false on promotion)
- Modify: `tests/long-term-memory/acceptance/corpus.test.ts` (cover the new seeder)

**Do not touch `tests/long-term-memory/acceptance/predicate-registrations.ts`.** It is append-only, and nothing here amends a predicate — promotion means satisfying the frozen text, not changing it. `registry.test.ts` already asserts the criterion's `passPredicate` matches its registration verbatim, and that assertion must keep passing untouched.

**Interfaces:**
- Consumes: `captureCanonicalEvent`, `drainProjectionOutbox`, `projectionSnapshot` (Tasks 5-6); `saveMemoryRecord` and the corpus helpers already in `corpus.ts`.
- Produces: `export function seedLongHorizon(scope: MemoryScope): readonly string[]` in `corpus.ts`; `export const CASES` in `capture-idempotency.cases.ts`.

- [ ] **Step 1: Add the long-horizon corpus fixture**

In `tests/long-term-memory/acceptance/corpus.ts`, add this after `seedDuplicateOutOfOrder`:

```typescript
/**
 * A twelve-month horizon: distinct facts whose event times span far enough that lexical or
 * insertion-order ordering would diverge from event-time ordering. The last entry restates the
 * first month's content at a later event time, so supersession must resolve across the whole
 * span rather than between adjacent writes.
 */
export function seedLongHorizon(scope: MemoryScope): readonly string[] {
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
  const written = months.map((month) => {
    const stamp = `2025-${month}-01T00:00:00.000Z`
    return write(
      acceptanceRecord({
        ...scope,
        id: `${scope.scopeId}-acc-horizon-${month}`,
        content: `Month ${month} status was recorded`,
        createdAt: stamp,
        updatedAt: stamp,
        lastSeenAt: stamp,
        evidence: { timestamps: [stamp] },
      }),
    )
  })
  return written
}
```

Then bump the version constant near the top of the file:

```typescript
export const CORPUS_VERSION = '2026-08-02.1'
```

- [ ] **Step 2: Cover the new seeder**

In `tests/long-term-memory/acceptance/corpus.test.ts`, add `seedLongHorizon` to the existing import from `./corpus.js`, and add this test beside `'duplicate-out-of-order seeds identical content twice with reversed timestamps'`:

```typescript
  test('long-horizon seeds twelve months of distinct facts', () => {
    const ids = seedLongHorizon(PERSONAL)
    expect(ids).toHaveLength(12)
  })
```

- [ ] **Step 3: Run the corpus tests**

Run: `bun test tests/long-term-memory/acceptance/corpus.test.ts`
Expected: PASS. If a snapshot of `CORPUS_VERSION` fails elsewhere, update that expectation to `'2026-08-02.1'` — the version exists precisely so a fixture change cannot pass silently.

- [ ] **Step 4: Write the acceptance cases table**

Create `tests/long-term-memory/acceptance/capture-idempotency.cases.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ShapeKey } from './registry.js'

/** Declared cells for the capture-idempotency criterion. Read by the suite AND by coverage.ts. */
export const CASES: Partial<Record<ShapeKey, string>> = {
  'duplicate-out-of-order':
    'identical content captured twice with reversed timestamps yields one canonical event and one shadow row',
  'long-horizon':
    'a twelve-month span replays to a byte-identical snapshot regardless of ingest order',
}
```

- [ ] **Step 5: Write the acceptance suite**

Create `tests/long-term-memory/acceptance/capture-idempotency.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import {
  memoryCanonicalCaptureAttempts,
  type MemoryCanonicalCaptureAttemptRow,
  memoryCanonicalEvents,
  type MemoryCanonicalEventRow,
} from '../../../src/db/schema.js'
import { drainProjectionOutbox } from '../../../src/long-term-memory/projection-drain.js'
import { projectionSnapshot } from '../../../src/long-term-memory/projection-snapshot.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'
import { PERSONAL, seedDuplicateOutOfOrder, seedLongHorizon } from './corpus.js'

const DRAIN_AT = '2026-08-02T18:00:00.000Z'

const events = (): MemoryCanonicalEventRow[] => getDrizzleDb().select().from(memoryCanonicalEvents).all()
const attempts = (): MemoryCanonicalCaptureAttemptRow[] =>
  getDrizzleDb().select().from(memoryCanonicalCaptureAttempts).all()

const settle = (): string => {
  drainProjectionOutbox(DRAIN_AT)
  return projectionSnapshot(PERSONAL)
}

const duplicateSuppressions = (): number =>
  attempts().filter((row) => row.outcome === 'suppressed-duplicate').length

describe('acceptance: capture-idempotency / duplicate-out-of-order', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('identical content captured twice yields exactly one canonical event', () => {
    seedDuplicateOutOfOrder(PERSONAL)

    expect(events()).toHaveLength(1)
  })

  test('the suppressed replay is observable as a duplicate suppression', () => {
    seedDuplicateOutOfOrder(PERSONAL)

    expect(duplicateSuppressions()).toBe(1)
  })

  test('the settled snapshot after the duplicate equals the snapshot after the first write alone', async () => {
    seedDuplicateOutOfOrder(PERSONAL)
    const withDuplicate = settle()

    await setupTestDb()
    seedDuplicateOutOfOrder(PERSONAL)

    expect(settle()).toBe(withDuplicate)
  })
})

describe('acceptance: capture-idempotency / long-horizon', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('a twelve-month horizon projects one shadow row per distinct fact', () => {
    seedLongHorizon(PERSONAL)
    settle()

    expect(events()).toHaveLength(12)
  })

  test('draining once at the end equals draining after every write', async () => {
    seedLongHorizon(PERSONAL)
    const batched = settle()

    await setupTestDb()
    seedLongHorizon(PERSONAL)
    drainProjectionOutbox('2026-08-02T17:00:00.000Z')

    expect(settle()).toBe(batched)
  })

  test('replaying the whole horizon a second time leaves the snapshot byte-identical', async () => {
    seedLongHorizon(PERSONAL)
    const once = settle()

    await setupTestDb()
    seedLongHorizon(PERSONAL)
    seedLongHorizon(PERSONAL)

    expect(settle()).toBe(once)
  })
})
```

If `seedLongHorizon` throws `corpus write suppressed` on the second call in the last test, that is the live store's own duplicate handling rather than a projection defect: change that test to call `seedLongHorizon(PERSONAL)` once and then re-run the same writes through `captureCanonicalEvent` directly, importing it from `../../../src/long-term-memory/canonical-capture.js`. Report which form you used.

- [ ] **Step 6: Register the case table**

In `tests/long-term-memory/acceptance/coverage.ts`, add the import beside the existing ones (alphabetical by module path, matching the file's current ordering):

```typescript
import { CASES as captureIdempotency } from './capture-idempotency.cases.js'
```

and add the entry to `CASE_TABLES`:

```typescript
  'capture-idempotency': captureIdempotency,
```

- [ ] **Step 7: Promote the criterion and its two shapes**

In `tests/long-term-memory/acceptance/registry.ts`, replace the `capture-idempotency` entry (around lines 151-161) with:

```typescript
  {
    key: 'capture-idempotency',
    status: 'implemented',
    passPredicate:
      'Replaying an identical capture input, repeatedly and with ingest order reversed relative to event time, yields exactly one canonical event per idempotency identity, and the projection snapshot after N replays is byte-identical to the snapshot after one. Supersession and validity resolve by event time, never by ingest order. Every suppressed replay is observable as a duplicate suppression, never as a silent success.',
    blocker: null,
    predicateRule: null,
    shapes: ['duplicate-out-of-order', 'long-horizon'],
    registeredShapes: [],
  },
```

The `passPredicate` string must stay byte-identical to the registration; do not retype it, copy it from the existing entry.

In the `SHAPES` array, replace the `duplicate-out-of-order` and `long-horizon` entries with:

```typescript
  { key: 'duplicate-out-of-order', status: 'implemented', blocker: null },
```

```typescript
  { key: 'long-horizon', status: 'implemented', blocker: null },
```

Leave `contradiction` and `abstention` exactly as they are.

- [ ] **Step 8: Update the registry tests that promotion falsifies**

In `tests/long-term-memory/acceptance/registry.test.ts`:

Replace the test at around lines 54-58 with:

```typescript
  test('the two remaining Gate 1 exit criteria are predicate-registered', () => {
    for (const key of ['races', 'crash-recovery'] as const) {
      expect(criterionByKey(key).status).toBe('predicate-registered')
    }
  })

  test('capture-idempotency was promoted by Gate 1b and now carries executed cells', () => {
    expect(criterionByKey('capture-idempotency').status).toBe('implemented')
    expect(criterionByKey('capture-idempotency').shapes).toEqual(['duplicate-out-of-order', 'long-horizon'])
  })
```

Replace the expectation at around line 90 with:

```typescript
    ).toEqual(['crash-recovery', 'races'])
```

Replace the test at around lines 169-173 with:

```typescript
  test('a registered cell names a shape, whether or not that shape has a fixture yet', () => {
    const registered = new Set(CRITERIA.flatMap((c) => c.registeredShapes))
    expect(registered.size).toBeGreaterThan(0)
    for (const shape of registered) expect(SHAPE_KEYS).toContain(shape)
  })
```

The original asserted that `long-horizon` was still `declared-unimplemented`, which was its live example of the rule "registering a cell is a promise to build the fixture, not a claim that it exists". Gate 1b builds that fixture, so no registered cell names an unimplemented shape any more and the example no longer exists. The rule itself stays documented on the `registeredShapes` field in `registry.ts`; the replacement asserts what remains checkable — that every registered cell names a real shape key.

- [ ] **Step 9: Update the report tests that promotion falsifies**

In `tests/long-term-memory/acceptance/report.test.ts`:

At around line 30, the readiness count changes as one criterion moves from predicate-registered to implemented:

```typescript
    expect(output).toContain('production ready = NO (5 implemented, 2 predicate-registered, 4 unmet)')
```

Replace the test at around lines 40-47 with:

```typescript
  test('renders registered cells distinctly from executed cells', () => {
    const output = renderAcceptanceReport()
    const registered = output.split('\n').find((row) => row.includes('crash-recovery'))
    const executed = output.split('\n').find((row) => row.includes('capture-idempotency'))
    expect(registered).toContain('registered cells: long-horizon, duplicate-out-of-order')
    expect(executed).toContain('shapes: duplicate-out-of-order, long-horizon')
    expect(registered).not.toContain('shapes:')
  })
```

If the rendered order of `crash-recovery`'s registered cells differs from `long-horizon, duplicate-out-of-order`, use the order the report actually emits — read it from the failure output rather than guessing, and do not reorder `registeredShapes` in `registry.ts` to make the string match.

At around lines 56-61, remove `'long-horizon'` and `'duplicate-out-of-order'` from the unimplemented-shapes list, leaving:

```typescript
    for (const key of ['abstention', 'contradiction']) {
```

- [ ] **Step 10: Run the acceptance suite**

Run: `bun test tests/long-term-memory/acceptance/`
Expected: PASS. In particular `registry.test.ts`'s "every criterion holding a predicate matches its registration verbatim" and "every registration names a criterion that carries its predicate" must pass **without having been edited** — that is the proof the promotion satisfies the frozen predicate rather than a softened one.

- [ ] **Step 11: Run the acceptance report**

Run: `bun run memory:acceptance`
Expected: exit 0, with `capture-idempotency` rendered as implemented and the counts matching Step 9.

- [ ] **Step 12: Commit**

```bash
git add tests/long-term-memory/acceptance/
git commit -m "test(memory): promote capture-idempotency on projection replay evidence"
```

---

## Task 9: Schedule the drain and close the gate's bookkeeping

**Files:**
- Modify: `src/scheduler-instance.ts` (add one registration in `registerDeferredDefaultTasks`, around lines 76-84)
- Modify: `docs/superpowers/plans/2026-07-26-memory-production-roadmap.md` (append a Gate 1 status note after the existing 2026-07-30 note)
- Test: `tests/scheduler-instance.test.ts` if it exists; otherwise no new test — see Step 3

**Interfaces:**
- Consumes: `drainProjectionOutbox` from `./long-term-memory/projection-drain.js` (Task 5).
- Produces: nothing.

This is the task that makes the new modules reachable from an entry point, so it is the task where `bun knip` goes from failing to passing.

- [ ] **Step 1: Confirm knip currently fails**

Run: `bun knip`
Expected: FAIL, listing the Gate 1b modules as unused files. Record the exact list in your report — it is the before-state for Step 5.

- [ ] **Step 2: Register the drain**

In `src/scheduler-instance.ts`, add the import beside the other long-term-memory imports:

```typescript
import { drainProjectionOutbox } from './long-term-memory/projection-drain.js'
```

and add this registration inside `registerDeferredDefaultTasks`, immediately after the `memory-capture-sweep` registration:

```typescript
  scheduler.register('memory-projection-drain', {
    interval: 5 * 60 * 1000,
    handler: () => {
      drainProjectionOutbox()
    },
    options: { immediate: false },
  })
```

`immediate: false` matches the other memory sweeps: the projection is dark, so nothing depends on it having run by any particular instant, and a deferred first tick keeps startup unchanged.

- [ ] **Step 3: Cover the registration if the file has a test**

Run: `ls tests/scheduler-instance.test.ts`

If it exists, add a test asserting `'memory-projection-drain'` appears among the registered task names, following whatever assertion style that file already uses for `'memory-capture-sweep'`. If it does not exist, do not create one — the drain's behavior is covered by Task 5, and a new test file whose only assertion is "a name is in a list" would restate the source.

Report which branch you took.

- [ ] **Step 4: Run the scheduler and memory suites**

Run: `bun test tests/long-term-memory/ tests/scheduler-instance.test.ts`
Expected: PASS. If `tests/scheduler-instance.test.ts` does not exist, run only the first path.

- [ ] **Step 5: Confirm knip now passes**

Run: `bun knip`
Expected: exit 0.

Note that knip's `project` globs are production-only (`'src/**/*.ts!'`), so a module imported *only* by tests still reports as unused. Every Gate 1b module gains a production importer as the chain lands — except `projection-snapshot.ts`, whose only consumer is Gate 1d's reconciliation. That one clears via the entry declaration added in Task 6, Step 5b, not via an importer; if it is still reported unused here, confirm that declaration landed in `knip.config.ts`.

For any other Gate 1b module still reported unused, it is genuinely unreachable — find the missing import rather than adding an ignore. `knip.config.ts` states that new ignores require an inline justification naming a dynamic mechanism knip cannot trace; an unwired module is not that.

- [ ] **Step 6: Update the roadmap**

In `docs/superpowers/plans/2026-07-26-memory-production-roadmap.md`, append this after the existing **Named gap carried into 1c/1d** paragraph:

```markdown
**Status (2026-08-02):** **1b — dark projection** is implemented per
`docs/superpowers/specs/2026-08-02-memory-gate1b-dark-projection-design.md`: the shadow projection
table, per-item idempotent apply, the derived checkpoint, bounded retry with repair, and the O2
snapshot. It satisfies observables O2 and O4 for boundaries B2–B4 and promotes the
`capture-idempotency` criterion, which moved to `implemented` with the `duplicate-out-of-order` and
`long-horizon` cells executed. B3 and B4 are unreachable by construction — apply writes the shadow
row and completes the outbox row in one transaction, and the checkpoint is `max(position)` over
completed rows rather than a stored value. O4 does not close until 1c holds B5. Remaining: **1c**
canonical tombstones and the concurrency harness (O5; B5; promotes `races` and `crash-recovery`);
**1d** reconciliation against the current path, which is this gate's exit.
```

- [ ] **Step 7: Run the full gate**

Run: `bun check:full`
Expected: 12/12 checks pass. If `tests/review-loop/worktree.test.ts` times out, re-run it in isolation — it flaked once during Gate 1a and passed on retry. Report both results rather than silently re-running.

- [ ] **Step 8: Commit**

```bash
git add src/scheduler-instance.ts docs/superpowers/plans/2026-07-26-memory-production-roadmap.md
git commit -m "feat(memory): schedule the projection drain and record Gate 1b status"
```

---

## Plan Self-Review

**Spec coverage.** Every spec section maps to a task: shadow table §1 → Task 1; apply as a pure function of the event §2 → Task 3; event-time supersession and the ascending identity tie-break §3 → Tasks 2, 3, 7; null-`record_id` projection §4 → Tasks 2, 3; per-item atomicity and the derived checkpoint §5 → Tasks 3, 5; failure, retry bound, and repair §6 → Tasks 4, 5; explicit drain plus separate scheduler wiring §7 → Tasks 5, 9; kill switch §8 → Task 5; the schema table → Task 1; the snapshot's included and excluded field sets → Task 6; every listed test → Tasks 3-7; the `capture-idempotency` promotion the spec claims → Task 8.

**One gap the spec did not anticipate, resolved here:** promotion falsifies five existing assertions in `registry.test.ts` and `report.test.ts`, and requires a `long-horizon` corpus fixture that did not exist. Task 8 covers both, and states explicitly why the one deleted contract test can no longer be true.

**Placeholders.** None. Every code step carries complete code; every run step carries an exact command and expected result.

**Type consistency.** `applyOutboxItem(position: number, now?: string): ApplyOutcome` is defined in Task 3 and used unchanged in Tasks 4, 5. `winsAgainst(candidate, incumbent)` keeps argument order across Tasks 2, 3. `projectionKeyFor(recordId, idempotencyIdentity)` matches between Tasks 2 and 3. `drainProjectionOutbox(now?)` returns the same `DrainResult` shape in Tasks 5, 7, 8, 9. `MAX_PROJECTION_ATTEMPTS` is exported from `projection-apply.ts` in Task 3 and imported in Tasks 4, 5. `stableStringify` is exported in Task 6 and used only there.
