<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# `src/deferred-prompts/tool-handlers.ts` Mutation Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the paired mutation score of `src/deferred-prompts/tool-handlers.ts` from 0.58 to ≥ 0.95 (ceiling 0.970) with pure unit tests — no source changes.

**Architecture:** Two test files. Behavioral error-path/event-gating tests extend the existing `tests/deferred-prompts/tool-handlers.test.ts` (public API against a real in-memory DB). Logging-metadata and store-null-branch tests live in a new `tests/deferred-prompts/tool-handlers-logging.test.ts` that installs a tracked logger mock and re-imports the module under test through a cache-busting query (pattern from `tests/coding-credentials/redaction-log.test.ts`), because `tool-handlers.ts` binds `const log = logger.child(...)` at module load.

**Tech Stack:** Bun test (`bun:test`), `tests/utils/test-helpers.ts` (`setupTestDb`, `mockLogger`), `tests/utils/logger-mock.ts` (`createTrackedLoggerMock`), `src/config.testing.js` (`setConfig`), Stryker paired runner (`bun test:mutate:file`).

**Spec:** `docs/superpowers/specs/2026-08-04-deferred-tool-handlers-mutation-design.md`

## Global Constraints

- No changes to `src/` files. Tests only, plus `scripts/mutation/overrides.json` and `scripts/mutation/baseline.json`. Approved exception: `src/deferred-prompts/alerts.ts` gained an empty-set guard in `updateAlertPrompt` (mirroring `updateScheduledPrompt`) after characterization tests exposed that an alert update with only an invalid `execution` payload threw `No values to set` from drizzle.
- Test runner is `bun:test` — no Jest/Vitest APIs. Use `.js` extensions in import paths.
- No wall-clock timing assertions (repo policy); all dates used are fixed strings far in the past/future.
- Error-string assertions must be exact (`toBe`/`toEqual`/`toContainEqual`) — substrings only where the message embeds a zod payload (`'Invalid condition:'` prefix).
- These are characterization tests against existing behavior: every new test is expected to PASS on first run. If one fails, STOP — the expectation or the understanding of the source is wrong; re-read the source before touching anything.
- Exact error strings (from `src/deferred-prompts/tool-handlers.ts` and `src/utils/config-timezone.ts`):
  - `'Provide either a schedule or a condition, not both.'`
  - `'Provide either a schedule (for time-based) or a condition (for event-based).'`
  - `'fire_at must be a future date and time.'`
  - `'Your configured timezone is invalid. Please update it in /config (settings web UI) and try again.'`
  - `'Could not compute next occurrence for the given rrule spec.'`
  - `'Schedule must include either fire_at or rrule.'`
  - `'Reminder or alert not found.'`
  - `'Cannot apply a condition to a scheduled prompt. Use schedule fields instead.'`
  - `'Cannot apply a schedule to an alert prompt. Use condition fields instead.'`

---

### Task 1: Create-path guard tests

**Files:**
- Modify: `tests/deferred-prompts/tool-handlers.test.ts` (append new describes at end of file)

**Interfaces:**
- Consumes: existing harness in that file — `USER_ID`, `setConfig`, `collectEvents(type)`, `setupTestDb`, `mockLogger`, and `executeCreate` from `../../src/deferred-prompts/tool-handlers.js`.
- Produces: nothing consumed by later tasks (each task is independent).

- [ ] **Step 1: Append the guard tests**

```typescript
describe('executeCreate — input guards', () => {
  test('rejects schedule and condition together', () => {
    const { events, cleanup } = collectEvents('deferred:created')
    try {
      const result = executeCreate(USER_ID, {
        prompt: 'both',
        schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
        condition: { field: 'task.status', op: 'changed_to', value: 'done' },
      })
      expect(result).toEqual({ error: 'Provide either a schedule or a condition, not both.' })
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  test('rejects missing schedule and condition', () => {
    const { events, cleanup } = collectEvents('deferred:created')
    try {
      const result = executeCreate(USER_ID, { prompt: 'neither' })
      expect(result).toEqual({
        error: 'Provide either a schedule (for time-based) or a condition (for event-based).',
      })
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  test('rejects empty schedule object', () => {
    setConfig(USER_ID, 'timezone', 'UTC')
    const result = executeCreate(USER_ID, { prompt: 'empty', schedule: {} })
    expect(result).toEqual({ error: 'Schedule must include either fire_at or rrule.' })
  })

  test('rejects past fire_at', () => {
    setConfig(USER_ID, 'timezone', 'UTC')
    const result = executeCreate(USER_ID, {
      prompt: 'past',
      schedule: { fire_at: { date: '2000-01-01', time: '00:00' } },
    })
    expect(result).toEqual({ error: 'fire_at must be a future date and time.' })
  })

  test('passes through invalid-timezone error', () => {
    setConfig(USER_ID, 'timezone', 'Not/AZone')
    const result = executeCreate(USER_ID, {
      prompt: 'tz',
      schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
    })
    expect(result).toEqual({
      error: 'Your configured timezone is invalid. Please update it in /config (settings web UI) and try again.',
    })
  })
})

describe('executeCreate — rrule edge cases', () => {
  test('explicit startDate/startTime anchor dtstartUtc, not midnight', () => {
    setConfig(USER_ID, 'timezone', 'UTC')
    executeCreate(USER_ID, {
      prompt: 'anchored',
      schedule: {
        rrule: { freq: 'DAILY', byHour: [9], byMinute: [0], startDate: '2030-03-15', startTime: '08:30' },
      },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    expect(prompts).toHaveLength(1)
    const prompt = prompts[0]!
    assert.ok(prompt.type === 'scheduled')
    expect(prompt.dtstartUtc).toBe('2030-03-15T08:30:00.000Z')
  })

  test('rrule with until in the past has no next occurrence', () => {
    setConfig(USER_ID, 'timezone', 'UTC')
    const result = executeCreate(USER_ID, {
      prompt: 'expired',
      schedule: {
        rrule: { freq: 'DAILY', byHour: [9], byMinute: [0], until: '2000-01-01T00:00:00.000Z' },
      },
    })
    expect(result).toEqual({ error: 'Could not compute next occurrence for the given rrule spec.' })
  })
})
```

- [ ] **Step 2: Run the file, verify green**

Run: `bun test tests/deferred-prompts/tool-handlers.test.ts`
Expected: all tests pass, 0 fail. If a new test fails, STOP and re-check the expectation against `src/deferred-prompts/tool-handlers.ts`.

- [ ] **Step 3: Commit**

```bash
git add tests/deferred-prompts/tool-handlers.test.ts
git commit -m "test(deferred): cover executeCreate input guards and rrule edge cases"
```

---

### Task 2: Alert create + get tests

**Files:**
- Modify: `tests/deferred-prompts/tool-handlers.test.ts` (append)

**Interfaces:**
- Consumes: same harness as Task 1; `getAlertPrompt` is already imported in the file.
- Produces: —

- [ ] **Step 1: Append the tests**

```typescript
describe('executeCreate — alert validation and events', () => {
  test('rejects invalid condition and emits nothing', () => {
    const { events, cleanup } = collectEvents('deferred:created')
    try {
      const result = executeCreate(USER_ID, {
        prompt: 'bad condition',
        condition: { field: 'task.status', op: 'bogus_op', value: 'x' },
      })
      expect(result).toHaveProperty('error')
      assert.ok('error' in result)
      expect(result.error).toContain('Invalid condition:')
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  test('valid alert emits deferred:created with the alert id', () => {
    const { events, cleanup } = collectEvents('deferred:created')
    try {
      const result = executeCreate(USER_ID, {
        prompt: 'good condition',
        condition: { field: 'task.status', op: 'changed_to', value: 'done' },
      })
      expect(result).toMatchObject({ status: 'created', type: 'alert' })
      assert.ok('id' in result)
      expect(events).toHaveLength(1)
      expect(events[0]!.data['promptId']).toBe(result.id)
    } finally {
      cleanup()
    }
  })
})

describe('executeGet', () => {
  test('returns not-found for unknown id', () => {
    const result = executeGet(USER_ID, { id: 'does-not-exist' })
    expect(result).toEqual({ error: 'Reminder or alert not found.' })
  })

  test('returns the alert when the id belongs to an alert', () => {
    const created = executeCreate(USER_ID, {
      prompt: 'find me',
      condition: { field: 'task.status', op: 'changed_to', value: 'done' },
    })
    assert.ok('id' in created)
    const result = executeGet(USER_ID, { id: created.id })
    expect(result).toMatchObject({ type: 'alert', id: created.id, prompt: 'find me' })
  })
})
```

Add `executeGet` to the existing import from `../../src/deferred-prompts/tool-handlers.js`:

```typescript
import { executeCancel, executeCreate, executeGet, executeList, executeUpdate } from '../../src/deferred-prompts/tool-handlers.js'
```

- [ ] **Step 2: Run the file, verify green**

Run: `bun test tests/deferred-prompts/tool-handlers.test.ts`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add tests/deferred-prompts/tool-handlers.test.ts
git commit -m "test(deferred): cover alert create validation, create events, executeGet"
```

---

### Task 3: Update-scheduled tests

**Files:**
- Modify: `tests/deferred-prompts/tool-handlers.test.ts` (append)

**Interfaces:**
- Consumes: same harness; `getScheduledPrompt` already imported.
- Produces: —

- [ ] **Step 1: Append the tests**

```typescript
describe('executeUpdate — scheduled prompt fields', () => {
  const createDaily = (): string => {
    setConfig(USER_ID, 'timezone', 'UTC')
    executeCreate(USER_ID, {
      prompt: 'Original',
      schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0] } },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    return prompts[0]!.id
  }

  test('rejects a condition on a scheduled prompt and emits nothing', () => {
    const id = createDaily()
    const { events, cleanup } = collectEvents('deferred:updated')
    try {
      const result = executeUpdate(USER_ID, {
        id,
        condition: { field: 'task.status', op: 'changed_to', value: 'done' },
      })
      expect(result).toEqual({
        error: 'Cannot apply a condition to a scheduled prompt. Use schedule fields instead.',
      })
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  test('prompt-only update is persisted', () => {
    const id = createDaily()
    const result = executeUpdate(USER_ID, { id, prompt: 'Rewritten' })
    expect(result).toMatchObject({ status: 'updated', prompt: 'Rewritten' })
    expect(getScheduledPrompt(id, USER_ID)!.prompt).toBe('Rewritten')
  })

  test('valid execution replaces stored metadata', () => {
    const id = createDaily()
    const result = executeUpdate(USER_ID, {
      id,
      execution: { delivery_brief: 'new brief', context_snapshot: 'snap' },
    })
    expect(result).toMatchObject({ status: 'updated' })
    expect(getScheduledPrompt(id, USER_ID)!.executionMetadata).toEqual({
      delivery_brief: 'new brief',
      context_snapshot: 'snap',
    })
  })

  test('invalid execution is ignored and keeps previous metadata', () => {
    const id = createDaily()
    executeUpdate(USER_ID, { id, execution: { delivery_brief: 'kept brief' } })
    const result = executeUpdate(USER_ID, {
      id,
      execution: { context_snapshot: 'no brief' } as unknown as { delivery_brief: string },
    })
    expect(result).toMatchObject({ status: 'updated' })
    expect(getScheduledPrompt(id, USER_ID)!.executionMetadata.delivery_brief).toBe('kept brief')
  })
})
```

- [ ] **Step 2: Run the file, verify green**

Run: `bun test tests/deferred-prompts/tool-handlers.test.ts`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add tests/deferred-prompts/tool-handlers.test.ts
git commit -m "test(deferred): cover scheduled-prompt update field handling"
```

---

### Task 4: Update-alert tests

**Files:**
- Modify: `tests/deferred-prompts/tool-handlers.test.ts` (append)

**Interfaces:**
- Consumes: same harness; `getAlertPrompt` already imported.
- Produces: —

- [ ] **Step 1: Append the tests**

```typescript
describe('executeUpdate — alert prompt fields', () => {
  const createAlert = (): string => {
    const result = executeCreate(USER_ID, {
      prompt: 'watch it',
      condition: { field: 'task.status', op: 'changed_to', value: 'done' },
    })
    assert.ok('id' in result)
    return result.id
  }

  test('rejects a schedule on an alert prompt and emits nothing', () => {
    const id = createAlert()
    const { events, cleanup } = collectEvents('deferred:updated')
    try {
      const result = executeUpdate(USER_ID, {
        id,
        schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
      })
      expect(result).toEqual({
        error: 'Cannot apply a schedule to an alert prompt. Use condition fields instead.',
      })
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  test('prompt update is persisted', () => {
    const id = createAlert()
    const result = executeUpdate(USER_ID, { id, prompt: 'watch harder' })
    expect(result).toMatchObject({ status: 'updated', prompt: 'watch harder' })
    expect(getAlertPrompt(id, USER_ID)!.prompt).toBe('watch harder')
  })

  test('valid condition update is persisted and emits deferred:updated', () => {
    const id = createAlert()
    const { events, cleanup } = collectEvents('deferred:updated')
    try {
      const condition = { field: 'task.labels', op: 'contains', value: 'bug' } as const
      const result = executeUpdate(USER_ID, { id, condition })
      expect(result).toMatchObject({ status: 'updated' })
      expect(getAlertPrompt(id, USER_ID)!.condition).toEqual(condition)
      expect(events).toHaveLength(1)
      expect(events[0]!.data['promptId']).toBe(id)
    } finally {
      cleanup()
    }
  })

  test('invalid condition update fails and emits nothing', () => {
    const id = createAlert()
    const { events, cleanup } = collectEvents('deferred:updated')
    try {
      const result = executeUpdate(USER_ID, {
        id,
        condition: { field: 'task.status', op: 'bogus_op', value: 'x' },
      })
      expect(result).toHaveProperty('error')
      assert.ok('error' in result)
      expect(result.error).toContain('Invalid condition:')
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  test('cooldown update is persisted', () => {
    const id = createAlert()
    const result = executeUpdate(USER_ID, { id, cooldown_minutes: 15 })
    expect(result).toMatchObject({ status: 'updated' })
    expect(getAlertPrompt(id, USER_ID)!.cooldownMinutes).toBe(15)
  })

  test('valid execution update is persisted; invalid execution is ignored', () => {
    const id = createAlert()
    executeUpdate(USER_ID, { id, execution: { delivery_brief: 'alert brief' } })
    expect(getAlertPrompt(id, USER_ID)!.executionMetadata.delivery_brief).toBe('alert brief')

    // Widen + delete: lint-safe way to feed a payload missing delivery_brief
    // (oxlint no-unsafe-type-assertion blocks `as unknown as` narrowing casts).
    const invalidExecution = { delivery_brief: 'x', context_snapshot: 'no brief' }
    delete (invalidExecution as { delivery_brief?: string }).delivery_brief
    const result = executeUpdate(USER_ID, { id, execution: invalidExecution })
    expect(result).toMatchObject({ status: 'updated' })
    expect(getAlertPrompt(id, USER_ID)!.executionMetadata.delivery_brief).toBe('alert brief')
  })

  test('returns not-found for unknown id', () => {
    const result = executeUpdate(USER_ID, { id: 'does-not-exist', prompt: 'x' })
    expect(result).toEqual({ error: 'Reminder or alert not found.' })
  })
})
```

- [ ] **Step 2: Run the file, verify green**

Run: `bun test tests/deferred-prompts/tool-handlers.test.ts`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add tests/deferred-prompts/tool-handlers.test.ts
git commit -m "test(deferred): cover alert-prompt update field handling"
```

---

### Task 5: Cancel-path tests

**Files:**
- Modify: `tests/deferred-prompts/tool-handlers.test.ts` (append)

**Interfaces:**
- Consumes: same harness; `executeCancel` already imported; `getAlertPrompt` already imported.
- Produces: —

- [ ] **Step 1: Append the tests**

```typescript
describe('executeCancel — alerts and unknown ids', () => {
  test('cancels an alert and emits deferred:cancelled', () => {
    const created = executeCreate(USER_ID, {
      prompt: 'alert to cancel',
      condition: { field: 'task.status', op: 'changed_to', value: 'done' },
    })
    assert.ok('id' in created)

    const { events, cleanup } = collectEvents('deferred:cancelled')
    try {
      const result = executeCancel(USER_ID, { id: created.id })
      expect(result).toEqual({ status: 'cancelled', id: created.id })
      expect(getAlertPrompt(created.id, USER_ID)!.status).toBe('cancelled')
      expect(events).toHaveLength(1)
      expect(events[0]!.data['promptId']).toBe(created.id)
    } finally {
      cleanup()
    }
  })

  test('returns not-found for unknown id and emits nothing', () => {
    const { events, cleanup } = collectEvents('deferred:cancelled')
    try {
      const result = executeCancel(USER_ID, { id: 'does-not-exist' })
      expect(result).toEqual({ error: 'Reminder or alert not found.' })
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })
})
```

- [ ] **Step 2: Run the file, verify green**

Run: `bun test tests/deferred-prompts/tool-handlers.test.ts`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add tests/deferred-prompts/tool-handlers.test.ts
git commit -m "test(deferred): cover alert cancellation and cancel not-found"
```

---

### Task 6: Logging-metadata test file

**Files:**
- Create: `tests/deferred-prompts/tool-handlers-logging.test.ts`

**Interfaces:**
- Consumes: `createTrackedLoggerMock` / `TrackedLoggerMock` from `tests/utils/logger-mock.ts`; `setupTestDb` from `tests/utils/test-helpers.ts`; `setConfig` from `src/config.testing.js`. Cache-busted import pattern from `tests/coding-credentials/redaction-log.test.ts`.
- Produces: `importHandlers()` helper reused by Task 7 (same file).

**Why a separate file:** `tool-handlers.ts` binds `const log = logger.child({ scope: 'deferred:tools' })` at module load. A cache-busting dynamic import (`?test=<uuid>`) re-evaluates the module so the binding resolves the tracked mock installed via `mock.module`. The global preload (`tests/mock-reset.ts`) restores the real logger in a global `beforeEach`, which runs before this suite's `beforeEach` re-installs the tracked mock.

- [ ] **Step 1: Create the file**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tool-handlers.ts binds `const log = logger.child(...)` at module load, so we
// install a tracked logger mock and import the module through a cachebuster
// query (mirroring tests/coding-credentials/redaction-log.test.ts) to get a
// fresh binding that resolves the mocked logger.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert'

import { setConfig } from '../../src/config.testing.js'
import { createTrackedLoggerMock, type TrackedLoggerMock } from '../utils/logger-mock.js'
import { setupTestDb } from '../utils/test-helpers.js'

type ToolHandlersModule = typeof import('../../src/deferred-prompts/tool-handlers.js')

const importHandlers = (): Promise<ToolHandlersModule> =>
  import(`../../src/deferred-prompts/tool-handlers.js?test=${crypto.randomUUID()}`)

const USER_ID = 'user-log-test'

const tracked: TrackedLoggerMock = createTrackedLoggerMock()

beforeEach(async () => {
  tracked.clearCalls()
  void mock.module('../../src/logger.js', () => ({
    getLogLevel: tracked.getLogLevel,
    logger: tracked.logger,
  }))
  await setupTestDb()
})

const infoArgs = (): unknown[][] => tracked.getCallsByLevel('info').map((c) => c.args)
const debugArgs = (): unknown[][] => tracked.getCallsByLevel('debug').map((c) => c.args)

describe('tool-handlers logging', () => {
  test('binds the child logger with the deferred:tools scope', async () => {
    await importHandlers()
    expect(tracked.logger.child).toHaveBeenCalledWith({ scope: 'deferred:tools' })
  })

  test('create scheduled logs debug entry and info with id/userId/type', async () => {
    const { executeCreate } = await importHandlers()
    setConfig(USER_ID, 'timezone', 'UTC')
    const result = executeCreate(USER_ID, {
      prompt: 'logged',
      schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
    })
    assert.ok('id' in result)
    expect(debugArgs()).toContainEqual([
      { userId: USER_ID, hasSchedule: true, hasCondition: false },
      'create_reminder/create_alert called',
    ])
    expect(infoArgs()).toContainEqual([
      { id: result.id, userId: USER_ID, type: 'scheduled' },
      'Deferred prompt created',
    ])
  })

  test('create alert logs info with id/userId/type', async () => {
    const { executeCreate } = await importHandlers()
    const result = executeCreate(USER_ID, {
      prompt: 'logged alert',
      condition: { field: 'task.status', op: 'changed_to', value: 'done' },
    })
    assert.ok('id' in result)
    expect(debugArgs()).toContainEqual([
      { userId: USER_ID, hasSchedule: false, hasCondition: true },
      'create_reminder/create_alert called',
    ])
    expect(infoArgs()).toContainEqual([
      { id: result.id, userId: USER_ID, type: 'alert' },
      'Deferred prompt created',
    ])
  })

  test('list logs debug entry and info count', async () => {
    const { executeCreate, executeList } = await importHandlers()
    setConfig(USER_ID, 'timezone', 'UTC')
    executeCreate(USER_ID, {
      prompt: 'counted',
      schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
    })
    executeList(USER_ID, {})
    expect(debugArgs()).toContainEqual([
      { userId: USER_ID, type: undefined, status: undefined },
      'list_reminders called',
    ])
    expect(infoArgs()).toContainEqual([{ userId: USER_ID, count: 1 }, 'Listed deferred prompts'])
  })

  test('get logs debug entry', async () => {
    const { executeGet } = await importHandlers()
    executeGet(USER_ID, { id: 'nope' })
    expect(debugArgs()).toContainEqual([{ userId: USER_ID, id: 'nope' }, 'get_reminder called'])
  })

  test('update logs debug entry and per-type info', async () => {
    const { executeCreate, executeList, executeUpdate } = await importHandlers()
    setConfig(USER_ID, 'timezone', 'UTC')
    executeCreate(USER_ID, {
      prompt: 'upd',
      schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    const id = prompts[0]!.id

    executeUpdate(USER_ID, { id, prompt: 'upd2' })
    expect(debugArgs()).toContainEqual([{ userId: USER_ID, id }, 'update_reminder called'])
    expect(infoArgs()).toContainEqual([{ id, userId: USER_ID }, 'Scheduled prompt updated via tool'])

    const alert = executeCreate(USER_ID, {
      prompt: 'upd alert',
      condition: { field: 'task.status', op: 'changed_to', value: 'done' },
    })
    assert.ok('id' in alert)
    executeUpdate(USER_ID, { id: alert.id, prompt: 'upd alert 2' })
    expect(infoArgs()).toContainEqual([{ id: alert.id, userId: USER_ID }, 'Alert prompt updated via tool'])
  })

  test('cancel logs debug entry and per-type info', async () => {
    const { executeCreate, executeList, executeCancel } = await importHandlers()
    setConfig(USER_ID, 'timezone', 'UTC')
    executeCreate(USER_ID, {
      prompt: 'cancel me',
      schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    const id = prompts[0]!.id

    executeCancel(USER_ID, { id })
    expect(debugArgs()).toContainEqual([{ userId: USER_ID, id }, 'cancel_reminder called'])
    expect(infoArgs()).toContainEqual([
      { id, userId: USER_ID, type: 'scheduled' },
      'Deferred prompt cancelled',
    ])

    const alert = executeCreate(USER_ID, {
      prompt: 'cancel alert',
      condition: { field: 'task.status', op: 'changed_to', value: 'done' },
    })
    assert.ok('id' in alert)
    executeCancel(USER_ID, { id: alert.id })
    expect(infoArgs()).toContainEqual([
      { id: alert.id, userId: USER_ID, type: 'alert' },
      'Deferred prompt cancelled',
    ])
  })
})
```

- [ ] **Step 2: Run the new file, verify green**

Run: `bun test tests/deferred-prompts/tool-handlers-logging.test.ts`
Expected: all pass. If the `child` assertion fails with "not called", the tracked mock was installed after module evaluation — confirm the import goes through `importHandlers()` (cache-busted) and not a static import.

- [ ] **Step 3: Commit**

```bash
git add tests/deferred-prompts/tool-handlers-logging.test.ts
git commit -m "test(deferred): assert tool-handlers log metadata via tracked logger"
```

---

### Task 7: Store-null branch tests (update-returns-null)

**Files:**
- Modify: `tests/deferred-prompts/tool-handlers-logging.test.ts` (append a second describe)

**Interfaces:**
- Consumes: `importHandlers`, `tracked`, `USER_ID` from Task 6 (same file).
- Produces: —

**Why:** `executeUpdate` resolves the prompt via `getScheduledPrompt`/`getAlertPrompt`, then the update-store call can still return `null` (L211/L237). Reaching this through the public API requires mocking the `scheduled.js`/`alerts.js` store boundary. The mock spreads the real module and overrides only the update function; the cache-busted `importHandlers()` then resolves the mocked module. The global preload restores the real `scheduled.js` in a global `beforeEach`, so each test installs its mock **inside the test body** (test bodies run after all `beforeEach` hooks) and imports the handlers immediately after.

- [ ] **Step 1: Append the describe**

```typescript
describe('tool-handlers store-null update branches', () => {
  test('updateScheduledPrompt returning null surfaces not-found', async () => {
    const scheduledActual = await import('../../src/deferred-prompts/scheduled.js')
    void mock.module('../../src/deferred-prompts/scheduled.js', () => ({
      ...scheduledActual,
      updateScheduledPrompt: (): null => null,
    }))
    const { executeCreate, executeList, executeUpdate } = await importHandlers()
    setConfig(USER_ID, 'timezone', 'UTC')
    executeCreate(USER_ID, {
      prompt: 'will vanish',
      schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    const id = prompts[0]!.id

    const result = executeUpdate(USER_ID, { id, prompt: 'too late' })
    expect(result).toEqual({ error: 'Reminder or alert not found.' })
  })

  test('updateAlertPrompt returning null surfaces not-found', async () => {
    const alertsActual = await import('../../src/deferred-prompts/alerts.js')
    void mock.module('../../src/deferred-prompts/alerts.js', () => ({
      ...alertsActual,
      updateAlertPrompt: (): null => null,
    }))
    const { executeCreate, executeUpdate } = await importHandlers()
    const created = executeCreate(USER_ID, {
      prompt: 'will vanish',
      condition: { field: 'task.status', op: 'changed_to', value: 'done' },
    })
    assert.ok('id' in created)

    const result = executeUpdate(USER_ID, { id: created.id, prompt: 'too late' })
    expect(result).toEqual({ error: 'Reminder or alert not found.' })
  })
})
```

- [ ] **Step 2: Run the file, verify green**

Run: `bun test tests/deferred-prompts/tool-handlers-logging.test.ts`
Expected: all pass (both describes).

- [ ] **Step 3: Run both deferred test files together**

Run: `bun test tests/deferred-prompts/`
Expected: all pass; no cross-file pollution from the store mocks (each test file is its own worker under `--parallel`, and the full-suite run will confirm).

- [ ] **Step 4: Commit**

```bash
git add tests/deferred-prompts/tool-handlers-logging.test.ts
git commit -m "test(deferred): cover update-store null branches via narrow store mocks"
```

---

### Task 8: Mutation verification + baseline update

**Files:**
- Modify: `scripts/mutation/overrides.json` (add one entry)
- Modify: `scripts/mutation/baseline.json` (one value)

**Interfaces:**
- Consumes: all previous tasks.
- Produces: the ratcheted floor for `src/deferred-prompts/tool-handlers.ts`.

- [ ] **Step 1: Pair both test files with the source in overrides.json**

Add to `scripts/mutation/overrides.json` (alphabetical position near the other `src/deferred-prompts` / `src/` entries):

```json
  "src/deferred-prompts/tool-handlers.ts": [
    "tests/deferred-prompts/tool-handlers.test.ts",
    "tests/deferred-prompts/tool-handlers-logging.test.ts"
  ],
```

- [ ] **Step 2: Run the full unit suite once to catch cross-file regressions**

Run: `bun run test`
Expected: green. (The store mocks in Task 7 must not leak into other files.)

- [ ] **Step 3: Run the paired mutation probe**

Run: `bun test:mutate:file src/deferred-prompts/tool-handlers.ts`
Expected: mutation score ≥ 0.95. Remaining survivors should be only the documented residuals — L77 (3 mutants: dead NaN guard), L78 `<=` vs `<` (1), L123 (4: unreachable `utcToLocal` fallback). Ceiling is (155 + 104) / 267 ≈ 0.970.

- [ ] **Step 4: Investigate any unexpected survivor**

If a survivor outside the residual set remains, read its line/replacement in `reports/paired/src__deferred-prompts__tool-handlers.ts.stryker-report.json`, add the missing assertion (extend the relevant describe), re-run the probe. Do not lower the target silently.

- [ ] **Step 5: Update the baseline**

Set the `src/deferred-prompts/tool-handlers.ts` entry in `scripts/mutation/baseline.json` to the measured score (rounded as emitted by the runner summary; never lower than the previous 0.5805243445692884).

- [ ] **Step 6: Commit**

```bash
git add scripts/mutation/overrides.json scripts/mutation/baseline.json tests/
git commit -m "chore(mutation): ratchet tool-handlers baseline after coverage work"
```

---

## Self-review notes

- Spec coverage: behavioral clusters → Tasks 1–5; logging cluster → Task 6; store-null cluster → Task 7; residuals documented in Task 8 Step 3; overrides + baseline → Task 8. All spec sections map to a task.
- No placeholders: every test step contains complete code; every command has expected output.
- Type consistency: `importHandlers`, `tracked`, `USER_ID`, `infoArgs`/`debugArgs` are defined in Task 6 and consumed in Task 7 within the same file; `executeGet` import extension happens in Task 2 Step 1 before Task 2's tests use it.
