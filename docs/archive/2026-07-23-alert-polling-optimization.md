<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Alert Polling Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut alert-polling cost and fix alert semantics: edge-triggered firing (fire once per new match), one LLM call per delivery context, shared task fetches per task instance, and a change gate that makes quiet cycles nearly free.

**Architecture:** Restructure the alert poller (`src/deferred-prompts/poller.ts`) into a two-level pipeline: group eligible alerts by task instance (shared `listProjects`+`listTasks` fetch), then per delivery context apply a snapshot-based change gate, edge-trigger evaluation against a per-alert stored match set (`matched_task_ids` column), and a single batched `dispatchExecution` per context. Spec: `docs/superpowers/specs/2026-07-23-alert-polling-optimization-design.md`.

**Tech Stack:** Bun, TypeScript (strict), Drizzle ORM (bun:sqlite), Zod v4, Vercel AI SDK, bun:test.

## Global Constraints

- Runtime Bun; tests use `bun:test` (`import { describe, expect, mock, test } from 'bun:test'`).
- Strict TypeScript; **use `.js` extension in all import paths**.
- Error extraction idiom: `error instanceof Error ? error.message : String(error)`.
- **Never add lint-disable or type-ignore comments** — the write hook blocks them.
- A `max-lines` / `max-lines-per-function` lint failure is a design signal: split the file or extract functions.
- Conventional commit messages (`feat:`, `fix:`, `docs:`) matching repo history.
- Test helpers live in `tests/utils/test-helpers.ts` (`mockLogger()`, `setupTestDb()`, `createMockChatWithSentMessages()`, `seedAdminLlmBinding()`, `seedCommonTestPlatformInstances()`, `seedTestPlatformInstance()`, `seedTestTaskInstance()`); `createMockProvider()` lives in `tests/tools/mock-provider.ts`.
- Focused test runs: `bun test <file>`. Lint/typecheck/format run automatically on commit via hooks.
- The store function `createAlertPrompt` accepts `cooldownMinutes = 0` (only the tool-level zod schema enforces min 1). Edge-semantics poller tests MUST use cooldown `0`, otherwise a fired alert is ineligible on the next in-test poll and silence assertions pass vacuously.

---

### Task 1: Migration 068 — `matched_task_ids` column + domain type plumbing

**Files:**
- Create: `src/db/migrations/068_alert_matched_task_ids.ts`
- Modify: `src/db/index.ts` (import at ~line 80, `MIGRATIONS` array tail)
- Modify: `src/db/deferred-schema.ts:57`
- Modify: `src/deferred-prompts/types.ts:240-253`
- Modify: `src/deferred-prompts/alerts.ts:26-39`
- Test: `tests/db/alert-matched-task-ids-migration.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `AlertPrompt.matchedTaskIds: string[]`; `parseMatchedTaskIds(raw: string): string[]` from `src/deferred-prompts/types.js`; drizzle column `alertPrompts.matchedTaskIds` (TEXT NOT NULL DEFAULT `'[]'`).

- [ ] **Step 1: Write the failing migration test**

Create `tests/db/alert-matched-task-ids-migration.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { alertPrompts } from '../../src/db/schema.js'
import { createAlertPrompt } from '../../src/deferred-prompts/alerts.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('migration 068: alert matched task ids', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('matched_task_ids column defaults to empty JSON array', () => {
    const db = getDrizzleDb()
    db.insert(alertPrompts)
      .values({
        id: 'ap1',
        createdByUserId: 'u1',
        prompt: 'notify',
        condition: '{"field":"task.status","op":"eq","value":"done"}',
      })
      .run()

    const row = db.select().from(alertPrompts).where(eq(alertPrompts.id, 'ap1')).get()
    expect(row).not.toBeUndefined()
    expect(row!.matchedTaskIds).toBe('[]')
  })

  test('domain mapping parses matched task ids', () => {
    const alert = createAlertPrompt('u1', 'notify', { field: 'task.status', op: 'eq', value: 'done' })
    expect(alert.matchedTaskIds).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/db/alert-matched-task-ids-migration.test.ts`
Expected: FAIL — `matchedTaskIds` does not exist on the drizzle schema / `AlertPrompt` type.

- [ ] **Step 3: Create the migration**

Create `src/db/migrations/068_alert_matched_task_ids.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:068' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  if (!columnExists(db, 'alert_prompts', 'matched_task_ids')) {
    db.run(`ALTER TABLE alert_prompts ADD COLUMN matched_task_ids TEXT NOT NULL DEFAULT '[]'`)
  }
  log.info('migration 068: matched_task_ids added to alert_prompts')
}

export const migration068AlertMatchedTaskIds: Migration = { id: '068_alert_matched_task_ids', up }

export default migration068AlertMatchedTaskIds
```

- [ ] **Step 4: Register the migration**

In `src/db/index.ts`, add after the `migration067MultiLlmProviders` import:

```typescript
import { migration068AlertMatchedTaskIds } from './migrations/068_alert_matched_task_ids.js'
```

and append `migration068AlertMatchedTaskIds,` at the end of the `MIGRATIONS` array (after `migration067MultiLlmProviders`).

- [ ] **Step 5: Add the drizzle column**

In `src/db/deferred-schema.ts`, inside the `alertPrompts` table definition, add after the `executionMetadata` line (line 57):

```typescript
    executionMetadata: text('execution_metadata').notNull().default('{}'),
    matchedTaskIds: text('matched_task_ids').notNull().default('[]'),
```

- [ ] **Step 6: Add the domain type field and parser**

In `src/deferred-prompts/types.ts`, add `matchedTaskIds` to `AlertPrompt` (after `executionMetadata`):

```typescript
export type AlertPrompt = {
  type: 'alert'
  id: string
  createdByUserId: string
  createdByUsername: string | null
  deliveryTarget: DeferredPromptDelivery
  prompt: string
  condition: AlertCondition
  status: 'active' | 'cancelled'
  createdAt: string
  lastTriggeredAt: string | null
  cooldownMinutes: number
  executionMetadata: ExecutionMetadata
  matchedTaskIds: string[]
}
```

and add the parser next to `parseExecutionMetadata`:

```typescript
export function parseMatchedTaskIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}
```

- [ ] **Step 7: Map the column in `toAlertPrompt`**

In `src/deferred-prompts/alerts.ts`, add to the `toAlertPrompt` return object:

```typescript
  matchedTaskIds: parseMatchedTaskIds(row.matchedTaskIds),
```

and add `parseMatchedTaskIds` to the existing import from `./types.js`.

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test tests/db/alert-matched-task-ids-migration.test.ts`
Expected: PASS (2 tests). Also run `bun test tests/deferred-prompts/alerts.test.ts tests/deferred-prompts/tools.test.ts` to confirm no shape regressions.

- [ ] **Step 9: Commit**

```bash
git add src/db/migrations/068_alert_matched_task_ids.ts src/db/index.ts src/db/deferred-schema.ts src/deferred-prompts/types.ts src/deferred-prompts/alerts.ts tests/db/alert-matched-task-ids-migration.test.ts
git commit -m "feat: add matched_task_ids column to alert_prompts (migration 068)"
```

---

### Task 2: Match-state store helpers

**Files:**
- Modify: `src/deferred-prompts/alerts.ts` (after `updateAlertTriggerTime`, ~line 182)
- Test: `tests/deferred-prompts/alerts.test.ts`

**Interfaces:**
- Consumes: Task 1's `matchedTaskIds` column and `AlertPrompt.matchedTaskIds`.
- Produces: `updateAlertMatchedTaskIds(id: string, userId: string, matchedTaskIds: string[]): void` and `updateAlertMatchState(id: string, userId: string, lastTriggeredAt: string, matchedTaskIds: string[]): void` from `src/deferred-prompts/alerts.js`. The poller (Task 6) calls both.

- [ ] **Step 1: Write the failing tests**

Add to `tests/deferred-prompts/alerts.test.ts` inside the `describe('alert prompt CRUD')` block, plus import `updateAlertMatchedTaskIds` and `updateAlertMatchState` from `../../src/deferred-prompts/alerts.js`:

```typescript
  test('updateAlertMatchedTaskIds updates match set without touching trigger time', () => {
    const condition: AlertCondition = { field: 'task.status', op: 'eq', value: 'done' }
    const created = createAlertPrompt('user1', 'Alert', condition)

    updateAlertMatchedTaskIds(created.id, 'user1', ['task-1', 'task-2'])

    const found = getAlertPrompt(created.id, 'user1')
    expect(found).not.toBeNull()
    expect(found!.matchedTaskIds).toEqual(['task-1', 'task-2'])
    expect(found!.lastTriggeredAt).toBeNull()
  })

  test('updateAlertMatchState updates trigger time and match set together', () => {
    const condition: AlertCondition = { field: 'task.status', op: 'eq', value: 'done' }
    const created = createAlertPrompt('user1', 'Alert', condition)
    const now = new Date().toISOString()

    updateAlertMatchState(created.id, 'user1', now, ['task-1'])

    const found = getAlertPrompt(created.id, 'user1')
    expect(found).not.toBeNull()
    expect(found!.lastTriggeredAt).toBe(now)
    expect(found!.matchedTaskIds).toEqual(['task-1'])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/deferred-prompts/alerts.test.ts`
Expected: FAIL — `updateAlertMatchedTaskIds` / `updateAlertMatchState` are not exported.

- [ ] **Step 3: Implement the helpers**

In `src/deferred-prompts/alerts.ts`, add after `updateAlertTriggerTime`:

```typescript
export const updateAlertMatchedTaskIds = (id: string, userId: string, matchedTaskIds: string[]): void => {
  log.debug({ id, userId, count: matchedTaskIds.length }, 'updateAlertMatchedTaskIds called')
  const db = getDrizzleDb()
  db.update(alertPrompts)
    .set({ matchedTaskIds: JSON.stringify(matchedTaskIds) })
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.createdByUserId, userId)))
    .run()
  log.info({ id, userId }, 'Alert matched task ids updated')
}

export const updateAlertMatchState = (
  id: string,
  userId: string,
  lastTriggeredAt: string,
  matchedTaskIds: string[],
): void => {
  log.debug({ id, userId, lastTriggeredAt, count: matchedTaskIds.length }, 'updateAlertMatchState called')
  const db = getDrizzleDb()
  db.update(alertPrompts)
    .set({ lastTriggeredAt, matchedTaskIds: JSON.stringify(matchedTaskIds) })
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.createdByUserId, userId)))
    .run()
  log.info({ id, userId }, 'Alert match state updated')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/deferred-prompts/alerts.test.ts`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add src/deferred-prompts/alerts.ts tests/deferred-prompts/alerts.test.ts
git commit -m "feat: alert match-state store helpers"
```

---

### Task 3: Snapshot task labels

**Files:**
- Modify: `src/deferred-prompts/snapshots.ts:15-21`
- Test: `tests/deferred-prompts/snapshots.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: exported `SNAPSHOT_FIELDS: Array<{ field: string; extract: (task: Task) => string | null }>` from `src/deferred-prompts/snapshots.js`, now including a `labels` entry (sorted, comma-joined label names). The change gate (Task 4) reads it.

- [ ] **Step 1: Write the failing test**

Add to `tests/deferred-prompts/snapshots.test.ts` inside `describe('snapshots')`:

```typescript
  test('captures labels as sorted comma-joined names', () => {
    const tasks = [
      makeTask({
        id: 'task-3',
        status: 'todo',
        labels: [
          { id: 'l2', name: 'urgent' },
          { id: 'l1', name: 'bug' },
        ],
      }),
    ]

    updateSnapshots('user-1', tasks)

    const snapshots = getSnapshotsForUser('user-1')
    expect(snapshots.get('task-3:labels')).toBe('bug,urgent')
  })

  test('skips labels snapshot when task has no labels', () => {
    updateSnapshots('user-1', [makeTask({ id: 'task-4', status: 'todo', labels: [] })])

    expect(getSnapshotsForUser('user-1').has('task-4:labels')).toBe(false)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/snapshots.test.ts`
Expected: FAIL — `task-3:labels` snapshot is not written.

- [ ] **Step 3: Implement**

In `src/deferred-prompts/snapshots.ts`, replace the `SNAPSHOT_FIELDS` declaration (lines 15-21) with an exported version that includes labels:

```typescript
export const SNAPSHOT_FIELDS: Array<{ field: string; extract: (task: Task) => string | null }> = [
  { field: 'status', extract: (t) => t.status ?? null },
  { field: 'priority', extract: (t) => t.priority ?? null },
  { field: 'assignee', extract: (t) => t.assignee ?? null },
  { field: 'dueDate', extract: (t) => t.dueDate ?? null },
  { field: 'project', extract: (t) => t.projectId ?? null },
  {
    field: 'labels',
    extract: (t) => {
      const names = (t.labels ?? []).map((l) => l.name).sort()
      return names.length > 0 ? names.join(',') : null
    },
  },
]
```

(`updateSnapshots` already iterates `SNAPSHOT_FIELDS` and skips null values — no other change needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/snapshots.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/deferred-prompts/snapshots.ts tests/deferred-prompts/snapshots.test.ts
git commit -m "feat: snapshot task labels for alert change detection"
```

---

### Task 4: Change gate module

**Files:**
- Create: `src/deferred-prompts/change-gate.ts`
- Test: `tests/deferred-prompts/change-gate.test.ts` (create)

**Interfaces:**
- Consumes: `SNAPSHOT_FIELDS` from `./snapshots.js` (Task 3), `Task` from `../providers/types.js`.
- Produces (used by Task 7's poller wiring):
  - `LIGHTWEIGHT_SNAPSHOT_FIELDS: readonly string[]` — `['status', 'priority', 'dueDate', 'project']`
  - `RICH_SNAPSHOT_FIELDS: readonly string[]` — lightweight + `['assignee', 'labels']`
  - `hasTaskChanges(tasks: Task[], snapshots: Map<string, string>, fields: readonly string[]): boolean` — `true` when the fetched task set or any listed field value differs from the stored snapshots.

- [ ] **Step 1: Write the failing tests**

Create `tests/deferred-prompts/change-gate.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { hasTaskChanges, LIGHTWEIGHT_SNAPSHOT_FIELDS, RICH_SNAPSHOT_FIELDS } from '../../src/deferred-prompts/change-gate.js'
import type { Task } from '../../src/providers/types.js'
import { mockLogger } from '../utils/test-helpers.js'

const makeTask = (overrides: Partial<Task> & { id: string }): Task => ({
  title: 'Test task',
  url: 'https://example.com/task',
  ...overrides,
})

const doneTask = makeTask({ id: 'task-1', status: 'done', priority: 'high' })

beforeEach(() => {
  mockLogger()
})

describe('hasTaskChanges', () => {
  test('returns true when snapshots are empty (first cycle)', () => {
    expect(hasTaskChanges([doneTask], new Map(), LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(true)
  })

  test('returns false when tasks match snapshots', () => {
    const snapshots = new Map([
      ['task-1:status', 'done'],
      ['task-1:priority', 'high'],
    ])
    expect(hasTaskChanges([doneTask], snapshots, LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(false)
  })

  test('returns true when a field value changed', () => {
    const snapshots = new Map([['task-1:status', 'todo']])
    expect(hasTaskChanges([doneTask], snapshots, LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(true)
  })

  test('returns true when a task was added', () => {
    const snapshots = new Map([['task-1:status', 'done']])
    const tasks = [doneTask, makeTask({ id: 'task-2', status: 'todo' })]
    expect(hasTaskChanges(tasks, snapshots, LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(true)
  })

  test('returns true when a task was removed', () => {
    const snapshots = new Map([
      ['task-1:status', 'done'],
      ['task-2:status', 'todo'],
    ])
    expect(hasTaskChanges([doneTask], snapshots, LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(true)
  })

  test('treats missing field value and missing snapshot as equal', () => {
    const snapshots = new Map([['task-1:status', 'done']])
    const task = makeTask({ id: 'task-1', status: 'done' })
    expect(hasTaskChanges([task], snapshots, LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(false)
  })

  test('returns true when a previously set field becomes empty', () => {
    const snapshots = new Map([
      ['task-1:status', 'done'],
      ['task-1:dueDate', '2026-06-01T00:00:00Z'],
    ])
    expect(hasTaskChanges([doneTask], snapshots, LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(true)
  })

  test('ignores assignee and labels changes for lightweight fields', () => {
    const snapshots = new Map([
      ['task-1:status', 'done'],
      ['task-1:assignee', 'alice'],
      ['task-1:labels', 'bug'],
    ])
    const task = makeTask({ id: 'task-1', status: 'done', assignee: 'bob', labels: [{ id: 'l1', name: 'feature' }] })
    expect(hasTaskChanges([task], snapshots, LIGHTWEIGHT_SNAPSHOT_FIELDS)).toBe(false)
  })

  test('detects assignee and labels changes for rich fields', () => {
    const base = new Map([
      ['task-1:status', 'done'],
      ['task-1:assignee', 'alice'],
      ['task-1:labels', 'bug'],
    ])
    const reassigned = makeTask({ id: 'task-1', status: 'done', assignee: 'bob', labels: [{ id: 'l1', name: 'bug' }] })
    expect(hasTaskChanges([reassigned], base, RICH_SNAPSHOT_FIELDS)).toBe(true)

    const relabeled = makeTask({ id: 'task-1', status: 'done', assignee: 'alice', labels: [{ id: 'l2', name: 'feature' }] })
    expect(hasTaskChanges([relabeled], base, RICH_SNAPSHOT_FIELDS)).toBe(true)

    const unchanged = makeTask({ id: 'task-1', status: 'done', assignee: 'alice', labels: [{ id: 'l1', name: 'bug' }] })
    expect(hasTaskChanges([unchanged], base, RICH_SNAPSHOT_FIELDS)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/change-gate.test.ts`
Expected: FAIL — module `change-gate.js` does not exist.

- [ ] **Step 3: Implement the module**

Create `src/deferred-prompts/change-gate.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Task } from '../providers/types.js'
import { SNAPSHOT_FIELDS } from './snapshots.js'

/** Snapshot fields knowable from a lightweight TaskListItem-derived Task. */
export const LIGHTWEIGHT_SNAPSHOT_FIELDS: readonly string[] = ['status', 'priority', 'dueDate', 'project']

/** All snapshot fields, including those requiring full getTask enrichment. */
export const RICH_SNAPSHOT_FIELDS: readonly string[] = [...LIGHTWEIGHT_SNAPSHOT_FIELDS, 'assignee', 'labels']

const extractors = new Map(SNAPSHOT_FIELDS.map((f) => [f.field, f.extract]))

const snapshotTaskIds = (snapshots: Map<string, string>): Set<string> => {
  const ids = new Set<string>()
  for (const key of snapshots.keys()) {
    ids.add(key.slice(0, key.indexOf(':')))
  }
  return ids
}

/**
 * True when the fetched task set or any of the given field values differs from the
 * stored snapshots. Tasks with no snapshot-able values at all keep reporting "changed"
 * (fails toward evaluation, never toward silence).
 */
export function hasTaskChanges(tasks: Task[], snapshots: Map<string, string>, fields: readonly string[]): boolean {
  const fetchedIds = new Set(tasks.map((t) => t.id))
  const storedIds = snapshotTaskIds(snapshots)
  if (fetchedIds.size !== storedIds.size) return true
  for (const id of fetchedIds) {
    if (!storedIds.has(id)) return true
  }

  for (const task of tasks) {
    for (const field of fields) {
      const extract = extractors.get(field)
      if (extract === undefined) continue
      const current = extract(task)
      const previous = snapshots.get(`${task.id}:${field}`)
      if (current === null && previous === undefined) continue
      if (current !== previous) return true
    }
  }
  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/change-gate.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/deferred-prompts/change-gate.ts tests/deferred-prompts/change-gate.test.ts
git commit -m "feat: task change gate for alert polling"
```

---

### Task 5: `enrichTasks` fails loudly on rejection

**Files:**
- Modify: `src/deferred-prompts/fetch-tasks.ts:93-97`
- Test: `tests/deferred-prompts/fetch-tasks.test.ts` (create)

**Interfaces:**
- Consumes: `createMockProvider()` from `tests/tools/mock-provider.js`.
- Produces: `enrichTasks(provider: TaskProvider, tasks: Task[]): Promise<Task[]>` — same signature, but now rejects when any `getTask` fails (previously dropped failed tasks silently). The poller (Task 7) catches this and aborts the instance cycle.

- [ ] **Step 1: Write the failing tests**

Create `tests/deferred-prompts/fetch-tasks.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { enrichTasks } from '../../src/deferred-prompts/fetch-tasks.js'
import type { Task } from '../../src/providers/types.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger } from '../utils/test-helpers.js'

const lightTasks: Task[] = [
  { id: 'task-1', title: 'One', url: 'http://test/1' },
  { id: 'task-2', title: 'Two', url: 'http://test/2' },
]

beforeEach(() => {
  mockLogger()
})

describe('enrichTasks', () => {
  test('returns full details for all tasks', async () => {
    const provider = createMockProvider({
      getTask: mock((taskId: string) =>
        Promise.resolve({ id: taskId, title: `Full ${taskId}`, url: `http://test/${taskId}`, assignee: 'alice' }),
      ),
    })

    const result = await enrichTasks(provider, lightTasks)
    expect(result).toHaveLength(2)
    expect(result[0]!.assignee).toBe('alice')
  })

  test('rejects when any getTask call fails', async () => {
    const provider = createMockProvider({
      getTask: mock((taskId: string) =>
        taskId === 'task-2'
          ? Promise.reject(new Error('getTask boom'))
          : Promise.resolve({ id: taskId, title: `Full ${taskId}`, url: `http://test/${taskId}` }),
      ),
    })

    await expect(enrichTasks(provider, lightTasks)).rejects.toThrow('getTask boom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/fetch-tasks.test.ts`
Expected: FAIL — second test: current implementation resolves with the failed task dropped.

- [ ] **Step 3: Implement**

In `src/deferred-prompts/fetch-tasks.ts`, replace `enrichTasks` (lines 93-97):

```typescript
/** Enrich lightweight tasks with full details via getTask. Rejects if any getTask fails. */
export function enrichTasks(provider: TaskProvider, tasks: Task[]): Promise<Task[]> {
  return Promise.all(tasks.map((t) => provider.getTask(t.id)))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/fetch-tasks.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/deferred-prompts/fetch-tasks.ts tests/deferred-prompts/fetch-tasks.test.ts
git commit -m "feat: fail alert enrichment on any getTask rejection"
```

---

### Task 6: Edge-triggered batched alert firing

Move the alert pipeline out of `poller.ts` into `poller-alerts.ts`, replacing per-alert LLM calls with a per-context batched dispatch gated by per-alert match sets. Fetch structure stays per-context in this task; Task 7 adds instance sharing and the change gate.

**Files:**
- Create: `src/deferred-prompts/poller-alerts.ts`
- Modify: `src/deferred-prompts/poller.ts` (remove alert pipeline, re-export `pollAlertsOnce`)
- Modify: `src/deferred-prompts/poller-scheduled.ts:13` (generalize `mergeExecutionMetadata`)
- Test: `tests/deferred-prompts/poller.test.ts`

**Interfaces:**
- Consumes: `updateAlertMatchedTaskIds` / `updateAlertMatchState` (Task 2), `AlertPrompt.matchedTaskIds` (Task 1).
- Produces:
  - `pollAlertsOnce(chat: ChatProvider, buildProviderFn: BuildProviderFn): Promise<void>` — re-exported from `poller.js`, so existing imports keep working.
  - `logSettledErrors(results: PromiseSettledResult<unknown>[], context: string): void` and `MAX_CONCURRENT_USERS: number` from `poller-alerts.js` (consumed by `poller.ts`).
  - `mergeExecutionMetadata(prompts: Array<{ executionMetadata: ExecutionMetadata }>): ExecutionMetadata` (generalized; `ScheduledPrompt[]` still assignable).

- [ ] **Step 1: Generalize `mergeExecutionMetadata`**

In `src/deferred-prompts/poller-scheduled.ts`, change the signature (line 13) to:

```typescript
export function mergeExecutionMetadata(prompts: Array<{ executionMetadata: ExecutionMetadata }>): ExecutionMetadata {
```

(body unchanged). Run `bun test tests/deferred-prompts/poller-scheduled.test.ts` to confirm no regression.

- [ ] **Step 2: Write the failing edge-trigger tests**

Add this new describe block at the end of `tests/deferred-prompts/poller.test.ts` (imports needed at top of file: `spyOn`, `afterEach` are already imported; `proactiveLlmModule` is already imported):

```typescript
describe('pollAlertsOnce — edge-triggered batched firing', () => {
  let sentMessages: Array<{ platformInstanceId: string; target: DeferredDeliveryTarget; text: string }>
  let chat: ChatProvider
  let dispatchCalls: unknown[][]
  const spies: Array<{ mockRestore: () => void }> = []

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    const result = createMockChatWithSentMessages()
    chat = result.provider
    sentMessages = result.sentMessages
    setupUserConfig(USER_ID)
    dispatchCalls = []
    spies.push(
      spyOn(proactiveLlmModule, 'dispatchExecution').mockImplementation((...args: unknown[]) => {
        dispatchCalls.push(args)
        return Promise.resolve('Alert triggered.')
      }),
    )
  })

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    spies.length = 0
  })

  const doneTaskProvider = (tasks: Array<{ id: string; title: string; status: string }>): TaskProvider =>
    createMockProvider({
      listProjects: mock(() => Promise.resolve([{ id: 'proj-1', name: 'Test', url: 'http://test/proj/1' }])),
      listTasks: mock(() => Promise.resolve(tasks.map((t) => ({ ...t, url: `http://test/${t.id}` })))),
    })

  test('fires once for a persistent match and stays silent while the match persists', async () => {
    createAlertPrompt(USER_ID, 'Notify on done', { field: 'task.status', op: 'eq', value: 'done' }, 0)
    const provider = doneTaskProvider([{ id: 'task-1', title: 'Task A', status: 'done' }])

    await pollAlertsOnce(chat, () => provider)
    expect(sentMessages).toHaveLength(1)
    expect(dispatchCalls).toHaveLength(1)

    await pollAlertsOnce(chat, () => provider)
    expect(sentMessages).toHaveLength(1)
    expect(dispatchCalls).toHaveLength(1)
  })

  test('re-fires when a new task enters the match, summary lists only new tasks', async () => {
    createAlertPrompt(USER_ID, 'Notify on done', { field: 'task.status', op: 'eq', value: 'done' }, 0)
    const taskA = { id: 'task-a', title: 'Task A', status: 'done' }
    const taskB = { id: 'task-b', title: 'Task B', status: 'done' }

    await pollAlertsOnce(chat, () => doneTaskProvider([taskA]))
    expect(dispatchCalls).toHaveLength(1)

    await pollAlertsOnce(chat, () => doneTaskProvider([taskA, taskB]))
    expect(dispatchCalls).toHaveLength(2)
    const summary = dispatchCalls[1]![5] as string
    expect(summary).toContain('Task B')
    expect(summary).not.toContain('Task A')
  })

  test('re-fires when a task leaves and re-enters the match', async () => {
    createAlertPrompt(USER_ID, 'Notify on done', { field: 'task.status', op: 'eq', value: 'done' }, 0)
    const done = [{ id: 'task-1', title: 'Task A', status: 'done' }]
    const todo = [{ id: 'task-1', title: 'Task A', status: 'todo' }]

    await pollAlertsOnce(chat, () => doneTaskProvider(done))
    await pollAlertsOnce(chat, () => doneTaskProvider(done))
    expect(dispatchCalls).toHaveLength(1)

    await pollAlertsOnce(chat, () => doneTaskProvider(todo))
    await pollAlertsOnce(chat, () => doneTaskProvider(done))
    expect(dispatchCalls).toHaveLength(2)
    expect(sentMessages).toHaveLength(2)
  })

  test('batches multiple firing alerts in one context into a single LLM call and message', async () => {
    const first = createAlertPrompt(USER_ID, 'Alert one', { field: 'task.status', op: 'eq', value: 'done' })
    const second = createAlertPrompt(USER_ID, 'Alert two', { field: 'task.priority', op: 'eq', value: 'high' })
    const provider = createMockProvider({
      listProjects: mock(() => Promise.resolve([{ id: 'proj-1', name: 'Test', url: 'http://test/proj/1' }])),
      listTasks: mock(() =>
        Promise.resolve([{ id: 'task-1', title: 'Task A', status: 'done', priority: 'high', url: 'http://test/1' }]),
      ),
    })

    await pollAlertsOnce(chat, () => provider)

    expect(dispatchCalls).toHaveLength(1)
    expect(sentMessages).toHaveLength(1)
    const mergedPrompt = dispatchCalls[0]![2] as string
    expect(mergedPrompt).toContain('"Alert one"')
    expect(mergedPrompt).toContain('"Alert two"')
    expect(getAlertPrompt(first.id, USER_ID)!.lastTriggeredAt).not.toBeNull()
    expect(getAlertPrompt(second.id, USER_ID)!.lastTriggeredAt).not.toBeNull()
  })

  test('does not update match state when delivery fails; next poll retries the same diff', async () => {
    const created = createAlertPrompt(USER_ID, 'Notify on done', { field: 'task.status', op: 'eq', value: 'done' }, 0)
    const failOnceThenRecord = mock(
      (platformInstanceId: string, _target: DeferredDeliveryTarget, text: string): Promise<void> => {
        sentMessages.push({ platformInstanceId, target: _target, text })
        return Promise.resolve()
      },
    )
    failOnceThenRecord.mockImplementationOnce(() => Promise.reject(new Error('delivery failed')))
    chat = { ...chat, sendMessage: failOnceThenRecord }
    const provider = doneTaskProvider([{ id: 'task-1', title: 'Task A', status: 'done' }])

    await pollAlertsOnce(chat, () => provider)
    expect(sentMessages).toHaveLength(0)
    expect(getAlertPrompt(created.id, USER_ID)!.lastTriggeredAt).toBeNull()
    expect(getAlertPrompt(created.id, USER_ID)!.matchedTaskIds).toEqual([])

    await pollAlertsOnce(chat, () => provider)
    expect(sentMessages).toHaveLength(1)
    expect(getAlertPrompt(created.id, USER_ID)!.matchedTaskIds).toEqual(['task-1'])
  })
})
```

- [ ] **Step 3: Run new tests to verify they fail**

Run: `bun test tests/deferred-prompts/poller.test.ts -t 'edge-triggered'`
Expected: FAIL — alerts currently re-fire every eligible cycle (test 1 gets 2 dispatch calls), no batching (test 4 gets 2 calls), etc. (Tests run against the OLD implementation inside `poller.ts` — they fail because the new behavior doesn't exist yet.)

- [ ] **Step 4: Create `poller-alerts.ts`**

Create `src/deferred-prompts/poller-alerts.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { ChatProvider } from '../chat/types.js'
import { emitGlobal, emitUser } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import { recordProactiveInHistory } from '../proactive-history.js'
import type { Task } from '../providers/types.js'
import {
  describeCondition,
  evaluateCondition,
  getEligibleAlertPrompts,
  updateAlertMatchedTaskIds,
  updateAlertMatchState,
} from './alerts.js'
import { alertsNeedFullTasks, enrichTasks, fetchAllTasks } from './fetch-tasks.js'
import { mergeExecutionMetadata } from './poller-scheduled.js'
import { resolveProactivePlatformInstanceId, sendProactiveMessage } from './proactive-delivery.js'
import { getStorageContextId } from './proactive-llm-helpers.js'
import { dispatchExecution, type BuildProviderFn, type DeferredExecutionContext } from './proactive-llm.js'
import { getSnapshotsForUser, updateSnapshots } from './snapshots.js'
import type { AlertPrompt } from './types.js'

const log = logger.child({ scope: 'deferred:poller:alerts' })

export const MAX_CONCURRENT_USERS = 10

export function logSettledErrors(results: PromiseSettledResult<unknown>[], context: string): void {
  for (const r of results) {
    if (r.status === 'rejected') log.error({ error: String(r.reason) }, context)
  }
}

type AlertEvaluation = {
  alert: AlertPrompt
  matchedNow: string[]
  newMatchedTasks: Task[]
}

const alertToExecCtx = (alert: AlertPrompt): DeferredExecutionContext => ({
  createdByUserId: alert.createdByUserId,
  deliveryTarget: alert.deliveryTarget,
})

const alertDeliveryContextKey = (alert: AlertPrompt): string => getStorageContextId(alert.deliveryTarget)

const configContextIdForDelivery = (deliveryTarget: DeferredExecutionContext['deliveryTarget']): string =>
  getConfigContextIdFromStorageContextId(getStorageContextId(deliveryTarget))

const formatTaskStatus = (status: string | undefined): string => (status === undefined ? '' : ` (${status})`)

const buildAlertSummary = (evaluations: AlertEvaluation[]): string =>
  evaluations
    .map(({ alert, newMatchedTasks }) => {
      const taskList = newMatchedTasks.map((t) => `- [${t.title}](${t.url})${formatTaskStatus(t.status)}`).join('\n')
      return `Alert condition: ${describeCondition(alert.condition)}\n${taskList}`
    })
    .join('\n\n')

const mergeAlertPrompts = (evaluations: AlertEvaluation[]): string =>
  evaluations.length === 1
    ? evaluations[0]!.alert.prompt
    : evaluations.map((e, i) => `${String(i + 1)}. "${e.alert.prompt}"`).join('\n')

function markAlertsDelivered(evaluations: AlertEvaluation[], now: string, emitNotifications: boolean): void {
  for (const { alert, matchedNow } of evaluations) {
    updateAlertMatchState(alert.id, alert.createdByUserId, now, matchedNow)
    log.info({ id: alert.id, userId: alert.createdByUserId, matchedCount: matchedNow.length }, 'Alert triggered')
    if (emitNotifications) {
      emitUser('deferred:alerted', alert.createdByUserId, { promptId: alert.id })
      emitUser('notify:deferred_alert', alert.createdByUserId, { promptId: alert.id })
    }
  }
}

async function fireAlertBatch(
  storageContextId: string,
  evaluations: AlertEvaluation[],
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
): Promise<boolean> {
  const first = evaluations[0]!.alert
  const execCtx = alertToExecCtx(first)
  if (resolveProactivePlatformInstanceId(chat, first.deliveryTarget) === null) return false
  const now = new Date().toISOString()
  let response: string
  try {
    response = await dispatchExecution(
      execCtx,
      'alert',
      mergeAlertPrompts(evaluations),
      mergeExecutionMetadata(evaluations.map((e) => e.alert)),
      buildProviderFn,
      buildAlertSummary(evaluations),
    )
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    log.error(
      { userId: first.createdByUserId, alertIds: evaluations.map((e) => e.alert.id), error: errMsg },
      'Alert prompt execution failed before delivery',
    )
    const errText = `Sorry, something went wrong while preparing this update: ${errMsg}`
    const errDelivered = await sendProactiveMessage(chat, first.deliveryTarget, errText)
    if (!errDelivered) return false
    recordProactiveInHistory(storageContextId, errText)
    markAlertsDelivered(evaluations, now, false)
    return true
  }

  const delivered = await sendProactiveMessage(chat, first.deliveryTarget, response)
  if (!delivered) return false
  markAlertsDelivered(evaluations, now, true)
  return true
}

async function executeAlertsForContext(
  alerts: AlertPrompt[],
  tasks: Task[],
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
  evalNow: Date,
): Promise<void> {
  const storageContextId = getStorageContextId(alerts[0]!.deliveryTarget)
  const snapshots = getSnapshotsForUser(storageContextId)

  const firing: AlertEvaluation[] = []
  for (const alert of alerts) {
    const matchedTasks = tasks.filter((task) => evaluateCondition(alert.condition, task, snapshots, evalNow))
    const matchedNow = matchedTasks.map((t) => t.id)
    const previous = new Set(alert.matchedTaskIds)
    const newMatchedTasks = matchedTasks.filter((t) => !previous.has(t.id))
    if (newMatchedTasks.length === 0) {
      updateAlertMatchedTaskIds(alert.id, alert.createdByUserId, matchedNow)
    } else {
      firing.push({ alert, matchedNow, newMatchedTasks })
    }
  }

  const delivered = firing.length === 0 ? true : await fireAlertBatch(storageContextId, firing, chat, buildProviderFn)
  if (delivered) updateSnapshots(storageContextId, tasks)
}

async function executeAlertsForUser(
  userId: string,
  alerts: AlertPrompt[],
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
  evalNow: Date,
): Promise<void> {
  const storageContextId = getStorageContextId(alerts[0]!.deliveryTarget)
  const configContextId = configContextIdForDelivery(alerts[0]!.deliveryTarget)
  if (resolveProactivePlatformInstanceId(chat, alerts[0]!.deliveryTarget) === null) return
  const provider = await buildProviderFn(configContextId)
  if (provider === null) {
    log.warn({ userId, storageContextId, configContextId }, 'Could not build task provider for alert polling')
    return
  }

  let tasks = await fetchAllTasks(provider)
  if (tasks.length > 0 && alertsNeedFullTasks(alerts)) {
    log.debug({ userId, taskCount: tasks.length }, 'Enriching tasks with full details for alert conditions')
    tasks = await enrichTasks(provider, tasks)
  }

  await executeAlertsForContext(alerts, tasks, chat, buildProviderFn, evalNow)
}

export async function pollAlertsOnce(chat: ChatProvider, buildProviderFn: BuildProviderFn): Promise<void> {
  log.debug('pollAlertsOnce called')
  const eligibleAlerts = getEligibleAlertPrompts()
  emitGlobal('poller:alerts', { eligibleCount: eligibleAlerts.length })
  if (eligibleAlerts.length === 0) return
  const now = new Date()
  const byDeliveryContext = new Map<string, AlertPrompt[]>()
  for (const alert of eligibleAlerts) {
    const key = alertDeliveryContextKey(alert)
    const existing = byDeliveryContext.get(key)
    if (existing === undefined) byDeliveryContext.set(key, [alert])
    else existing.push(alert)
  }
  const userLimit = pLimit(MAX_CONCURRENT_USERS)
  const results = await Promise.allSettled(
    [...byDeliveryContext.values()].map((alerts) =>
      userLimit((): Promise<void> => executeAlertsForUser(alerts[0]!.createdByUserId, alerts, chat, buildProviderFn, now)),
    ),
  )
  logSettledErrors(results, 'Error polling alerts for user')
}
```

- [ ] **Step 5: Strip the alert pipeline from `poller.ts`**

In `src/deferred-prompts/poller.ts`:

1. Delete from the alert section: `markAlertDelivered`, `executeSingleAlert`, `shouldAdvanceAlertSnapshots`, `executeAlertsForUser`, `pollAlertsOnce`, `alertToExecCtx`, `alertDeliveryContextKey`, `configContextIdForDelivery`, the `AlertDeliveryResult` type, and the `formatTaskStatus` helper (lines 34, 36, 46-52, 126-249 of the original file).
2. Delete now-unused imports: the entire `./alerts.js` import (`describeCondition`, `evaluateCondition`, `getEligibleAlertPrompts`, `updateAlertTriggerTime` all move to `poller-alerts.js`), `alertsNeedFullTasks`, `enrichTasks`, `fetchAllTasks` from `./fetch-tasks.js`, `getSnapshotsForUser`, `updateSnapshots` from `./snapshots.js`, `Task` from `../providers/types.js`, and `AlertPrompt` from `./types.js` (keep `ScheduledPrompt`).
3. Delete the `logSettledErrors` definition and `MAX_CONCURRENT_USERS` constant (both now live in `poller-alerts.js`); import them instead.
4. Add the re-export so existing imports keep working:

```typescript
import { logSettledErrors, MAX_CONCURRENT_USERS, pollAlertsOnce } from './poller-alerts.js'

export { pollAlertsOnce } from './poller-alerts.js'
```

The remaining file keeps: `promptToExecCtx`, `executeScheduledPromptsForGroup`, `pollScheduledOnce`, `inFlightPrompts`, `startPollers`, `stopPollers`, `getPollerSnapshot`, and the `ALERT_POLL_MS` / `SCHEDULED_POLL_MS` / `MAX_CONCURRENT_LLM_CALLS` constants. Verify with `bunx tsc --noEmit` that no unused imports remain (the commit hook also runs lint).

- [ ] **Step 6: Update the multi-creator batching test**

In `tests/deferred-prompts/poller.test.ts`, find the test `'same delivery context alerts from different creators share one snapshot cycle'` (in `describe('delivery target routing')`). Capture the created alerts and update the final assertions — the two alerts now batch into ONE message:

Replace:

```typescript
    await pollAlertsOnce(chat, resolveProvider)

    expect(sentMessages).toHaveLength(2)
```

with:

```typescript
    await pollAlertsOnce(chat, resolveProvider)

    expect(sentMessages).toHaveLength(1)
    expect(getAlertPrompt(firstAlert.id, USER_ID)!.lastTriggeredAt).not.toBeNull()
    expect(getAlertPrompt(secondAlert.id, otherUserId)!.lastTriggeredAt).not.toBeNull()
```

and change the two `createAlertPrompt(...)` calls earlier in that test so their return values are captured — prefix the first call (the one with prompt `'Notify first creator'`) with `const firstAlert = ` and the second (prompt `'Notify second creator'`) with `const secondAlert = `. Arguments of both calls stay exactly as they are.

Also update the stale comment about "one per alert's own full-toolset generation" to note that alerts in the same delivery context now share one batched generation.

- [ ] **Step 7: Run the full poller suite**

Run: `bun test tests/deferred-prompts/poller.test.ts`
Expected: PASS — all existing tests (behavior preserved for first-fire, routing, error-notice, retry paths) plus the 5 new edge-trigger tests.

- [ ] **Step 8: Commit**

```bash
git add src/deferred-prompts/poller-alerts.ts src/deferred-prompts/poller.ts src/deferred-prompts/poller-scheduled.ts tests/deferred-prompts/poller.test.ts
git commit -m "feat: edge-triggered batched alert firing"
```

---

### Task 7: Instance-level fetch sharing + change gate wiring

**Files:**
- Modify: `src/deferred-prompts/poller-alerts.ts`
- Test: `tests/deferred-prompts/poller.test.ts`

**Interfaces:**
- Consumes: `hasTaskChanges`, `LIGHTWEIGHT_SNAPSHOT_FIELDS`, `RICH_SNAPSHOT_FIELDS` (Task 4); `enrichTasks` throwing behavior (Task 5).
- Produces: no new exports. `pollAlertsOnce` groups alerts two levels deep: `configContextId` (task instance) → `storageContextId` (delivery context).

- [ ] **Step 1: Write the failing tests**

Add this describe block to `tests/deferred-prompts/poller.test.ts` (needs `toScopedContextId`, `toScopedThreadContextId`, `setConfig`, `setContextSettings` — all already imported in the file):

```typescript
describe('pollAlertsOnce — change gate and fetch sharing', () => {
  let sentMessages: Array<{ platformInstanceId: string; target: DeferredDeliveryTarget; text: string }>
  let chat: ChatProvider
  let dispatchCalls: unknown[][]
  const spies: Array<{ mockRestore: () => void }> = []

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    const result = createMockChatWithSentMessages()
    chat = result.provider
    sentMessages = result.sentMessages
    setupUserConfig(USER_ID)
    dispatchCalls = []
    spies.push(
      spyOn(proactiveLlmModule, 'dispatchExecution').mockImplementation((...args: unknown[]) => {
        dispatchCalls.push(args)
        return Promise.resolve('Alert triggered.')
      }),
    )
  })

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    spies.length = 0
  })

  test('quiet cycle performs no LLM work', async () => {
    createAlertPrompt(USER_ID, 'Notify on done', { field: 'task.status', op: 'eq', value: 'done' }, 0)
    const provider = createMockProvider({
      listProjects: mock(() => Promise.resolve([{ id: 'proj-1', name: 'Test', url: 'http://test/proj/1' }])),
      listTasks: mock(() =>
        Promise.resolve([{ id: 'task-1', title: 'Task A', status: 'done', url: 'http://test/1' }]),
      ),
    })

    await pollAlertsOnce(chat, () => provider)
    expect(dispatchCalls).toHaveLength(1)

    await pollAlertsOnce(chat, () => provider)
    await pollAlertsOnce(chat, () => provider)
    expect(dispatchCalls).toHaveLength(1)
    expect(sentMessages).toHaveLength(1)
  })

  test('shares one task fetch across delivery contexts on the same task instance', async () => {
    const scopedUserId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: USER_ID })
    const scopedMainContextId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: '-1001' })
    const thread42 = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: '-1001',
      threadId: '42',
    })
    const thread43 = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: '-1001',
      threadId: '43',
    })
    setConfig(scopedUserId, 'timezone', 'UTC')
    setContextSettings({
      contextId: scopedMainContextId,
      taskInstanceId: 'kaneo-default',
      platformInstanceId: 'telegram-default',
    })
    const delivery = (
      threadId: string,
      storageContextId: string,
    ): Parameters<typeof createAlertPrompt>[5] => ({
      contextId: '-1001',
      storageContextId,
      contextType: 'group',
      threadId,
      audience: 'personal',
      mentionUserIds: [USER_ID],
      createdByUserId: USER_ID,
      createdByUsername: null,
    })
    createAlertPrompt(USER_ID, 'Notify thread 42', { field: 'task.status', op: 'eq', value: 'done' }, 60, undefined, delivery('42', thread42))
    createAlertPrompt(USER_ID, 'Notify thread 43', { field: 'task.status', op: 'eq', value: 'done' }, 60, undefined, delivery('43', thread43))

    const listProjectsMock = mock(() => Promise.resolve([{ id: 'proj-1', name: 'Test', url: 'http://test/proj/1' }]))
    const provider = createMockProvider({
      listProjects: listProjectsMock,
      listTasks: mock(() => Promise.resolve([{ id: 'task-1', title: 'Done Task', status: 'done', url: 'http://test/1' }])),
    })

    await pollAlertsOnce(chat, () => provider)

    expect(listProjectsMock.mock.calls).toHaveLength(1)
    expect(sentMessages).toHaveLength(2)
  })

  test('label-only change wakes a rich-field context, then goes quiet again', async () => {
    createAlertPrompt(USER_ID, 'Notify on bug label', { field: 'task.labels', op: 'contains', value: 'bug' }, 0)
    let labels: Array<{ id: string; name: string }> = []
    const provider = createMockProvider({
      listProjects: mock(() => Promise.resolve([{ id: 'proj-1', name: 'Test', url: 'http://test/proj/1' }])),
      listTasks: mock(() =>
        Promise.resolve([{ id: 'task-1', title: 'Task A', status: 'todo', url: 'http://test/1' }]),
      ),
      getTask: mock(() =>
        Promise.resolve({ id: 'task-1', title: 'Task A', status: 'todo', url: 'http://test/1', labels }),
      ),
    })

    // Cycle 1: no labels yet — silent, but snapshots get written
    await pollAlertsOnce(chat, () => provider)
    expect(dispatchCalls).toHaveLength(0)

    // Cycle 2: task gains the label (lightweight list is identical) — fires
    labels = [{ id: 'l1', name: 'bug' }]
    await pollAlertsOnce(chat, () => provider)
    expect(dispatchCalls).toHaveLength(1)

    // Cycle 3: nothing changed — quiet again
    await pollAlertsOnce(chat, () => provider)
    expect(dispatchCalls).toHaveLength(1)
    expect(sentMessages).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run new tests to verify they fail**

Run: `bun test tests/deferred-prompts/poller.test.ts -t 'change gate'`
Expected: FAIL on the fetch-sharing test (`listProjects` is called twice, once per context). The quiet-cycle and label tests may already pass via Task 6's match sets — they are characterization tests locking in behavior the gate must preserve, so keep them either way.

- [ ] **Step 3: Rewrite the executor functions in `poller-alerts.ts`**

Replace `executeAlertsForContext`, `executeAlertsForUser`, and `pollAlertsOnce` in `src/deferred-prompts/poller-alerts.ts` with the versions below, and add the change-gate import:

```typescript
import { hasTaskChanges, LIGHTWEIGHT_SNAPSHOT_FIELDS, RICH_SNAPSHOT_FIELDS } from './change-gate.js'
```

```typescript
async function executeAlertsForContext(
  storageContextId: string,
  alerts: AlertPrompt[],
  lightTasks: Task[],
  enrichedTasks: Task[] | null,
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
  evalNow: Date,
): Promise<void> {
  const needsRich = alertsNeedFullTasks(alerts)
  const tasks = needsRich && enrichedTasks !== null ? enrichedTasks : lightTasks
  const snapshots = getSnapshotsForUser(storageContextId)
  const fields = needsRich ? RICH_SNAPSHOT_FIELDS : LIGHTWEIGHT_SNAPSHOT_FIELDS
  if (!hasTaskChanges(tasks, snapshots, fields)) {
    log.debug({ storageContextId }, 'No task changes detected; skipping alert evaluation')
    return
  }

  const firing: AlertEvaluation[] = []
  for (const alert of alerts) {
    const matchedTasks = tasks.filter((task) => evaluateCondition(alert.condition, task, snapshots, evalNow))
    const matchedNow = matchedTasks.map((t) => t.id)
    const previous = new Set(alert.matchedTaskIds)
    const newMatchedTasks = matchedTasks.filter((t) => !previous.has(t.id))
    if (newMatchedTasks.length === 0) {
      updateAlertMatchedTaskIds(alert.id, alert.createdByUserId, matchedNow)
    } else {
      firing.push({ alert, matchedNow, newMatchedTasks })
    }
  }

  const delivered = firing.length === 0 ? true : await fireAlertBatch(storageContextId, firing, chat, buildProviderFn)
  if (delivered) updateSnapshots(storageContextId, tasks)
}

async function executeAlertsForInstance(
  configContextId: string,
  contextGroups: Map<string, AlertPrompt[]>,
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
  evalNow: Date,
): Promise<void> {
  const routable = new Map<string, AlertPrompt[]>()
  for (const [storageContextId, alerts] of contextGroups) {
    if (resolveProactivePlatformInstanceId(chat, alerts[0]!.deliveryTarget) !== null) {
      routable.set(storageContextId, alerts)
    }
  }
  if (routable.size === 0) return

  const provider = await buildProviderFn(configContextId)
  if (provider === null) {
    log.warn({ configContextId }, 'Could not build task provider for alert polling')
    return
  }

  const lightTasks = await fetchAllTasks(provider)
  const needsEnrichment = [...routable.values()].some((alerts) => alertsNeedFullTasks(alerts))
  let enrichedTasks: Task[] | null = null
  if (needsEnrichment && lightTasks.length > 0) {
    try {
      log.debug({ configContextId, taskCount: lightTasks.length }, 'Enriching tasks with full details for alert conditions')
      enrichedTasks = await enrichTasks(provider, lightTasks)
    } catch (error) {
      log.warn(
        { configContextId, error: error instanceof Error ? error.message : String(error) },
        'Task enrichment failed; skipping alert cycle for instance',
      )
      return
    }
  }

  for (const [storageContextId, alerts] of routable) {
    await executeAlertsForContext(storageContextId, alerts, lightTasks, enrichedTasks, chat, buildProviderFn, evalNow)
  }
}

export async function pollAlertsOnce(chat: ChatProvider, buildProviderFn: BuildProviderFn): Promise<void> {
  log.debug('pollAlertsOnce called')
  const eligibleAlerts = getEligibleAlertPrompts()
  emitGlobal('poller:alerts', { eligibleCount: eligibleAlerts.length })
  if (eligibleAlerts.length === 0) return
  const now = new Date()
  const byInstance = new Map<string, Map<string, AlertPrompt[]>>()
  for (const alert of eligibleAlerts) {
    const storageContextId = alertDeliveryContextKey(alert)
    const configContextId = configContextIdForDelivery(alert.deliveryTarget)
    let contextGroups = byInstance.get(configContextId)
    if (contextGroups === undefined) {
      contextGroups = new Map()
      byInstance.set(configContextId, contextGroups)
    }
    const group = contextGroups.get(storageContextId)
    if (group === undefined) contextGroups.set(storageContextId, [alert])
    else group.push(alert)
  }
  const userLimit = pLimit(MAX_CONCURRENT_USERS)
  const results = await Promise.allSettled(
    [...byInstance.entries()].map(([configContextId, contextGroups]) =>
      userLimit((): Promise<void> => executeAlertsForInstance(configContextId, contextGroups, chat, buildProviderFn, now)),
    ),
  )
  logSettledErrors(results, 'Error polling alerts for user')
}
```

(`executeAlertsForUser` is deleted; `alertToExecCtx`, `alertDeliveryContextKey`, `configContextIdForDelivery`, `buildAlertSummary`, `mergeAlertPrompts`, `markAlertsDelivered`, `fireAlertBatch` stay unchanged from Task 6.)

- [ ] **Step 4: Run the full poller suite**

Run: `bun test tests/deferred-prompts/poller.test.ts`
Expected: PASS — including the 3 new gate/sharing tests and the existing `'skips alert task-provider work when routed platform instance is stopped'` (route precheck now happens before `buildProviderFn`).

- [ ] **Step 5: Commit**

```bash
git add src/deferred-prompts/poller-alerts.ts tests/deferred-prompts/poller.test.ts
git commit -m "feat: share task fetches per instance and skip quiet alert cycles"
```

---

### Task 8: Full-suite verification

**Files:** none (fix-forward if fallout appears).

- [ ] **Step 1: Run the deferred-prompts suites**

Run: `bun test tests/deferred-prompts/ tests/db/`
Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run: `bun run test`
Expected: PASS. Any cross-suite fallout (e.g. a tool-handlers test asserting `AlertPrompt` shape) is fixed in place with a focused commit: `git commit -m "fix: update <suite> for alert match-state shape"`.

- [ ] **Step 3: Confirm hooks**

The per-commit hooks already ran lint, typecheck, format, and license-headers on every task commit. If any task required an uncommitted fix, commit it now.

---

## Self-Review Notes

- **Spec coverage:** migration + one-time re-fire (T1), match-state helpers (T2), labels snapshots (T3), change gate (T4, T7), enrichment failure (T5), edge-trigger + batching + error paths (T6), fetch sharing + route precheck ordering (T7), full verification (T8). Non-goals untouched.
- **Type consistency:** `updateAlertMatchedTaskIds` / `updateAlertMatchState` (T2) match T6 usage; `SNAPSHOT_FIELDS` export shape (T3) matches T4's extractor map; `LIGHTWEIGHT_SNAPSHOT_FIELDS` / `RICH_SNAPSHOT_FIELDS` / `hasTaskChanges` (T4) match T7 usage; `mergeExecutionMetadata` generalization (T6 step 1) accepts both `ScheduledPrompt[]` and `AlertPrompt[]`.
- **Known safe-direction edge:** a task with all snapshot fields null never writes snapshot rows, so `hasTaskChanges` keeps reporting "changed" for it — it fails toward evaluation, never toward silence.
