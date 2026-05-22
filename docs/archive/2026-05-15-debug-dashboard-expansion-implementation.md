<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Debug Dashboard Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose memo lifecycle, recurring tasks, deferred prompts, reply content, per-turn transitions, group/identity/auth context, and tool-failure analysis through the debug dashboard, with admin-scoped visibility and log cross-linking.

**Architecture:** Three cross-cutting infra changes (typed emit helpers with scope, AdminVisibility allow-list, turnId correlation) feed into four mergeable phases. Each phase adds events, collector state, REST endpoints, and dashboard panels. Existing SSE server, log buffer, and dashboard shell are reused.

**Tech Stack:** Bun, TypeScript, Zod v4, pino (structured logging), Vercel AI SDK (tool hooks), plain DOM (no framework)

**Spec:** `docs/superpowers/specs/2026-04-20-debug-dashboard-expansion-design.md`

---

## File Structure

### Modified files (Phase 1)

- `src/debug/event-bus.ts` — add Scope type, emitUser/emitGroup/emitGlobal helpers, deprecation wrapper
- `src/debug/state-collector.ts` — add AdminVisibility, isVisibleToAdmin, applyVisibility, replace isAdminEvent
- `src/debug/schemas.ts` — add Scope schema, AdminVisibility schema
- 12 source files — migrate emit() calls to typed helpers (bot.ts, bot-reply-tracking.ts, llm-orchestrator.ts, llm-orchestrator-events.ts, llm-orchestrator-support.ts, cache.ts, scheduler.ts, scheduler-recurring.ts, deferred-prompts/poller.ts, conversation.ts, wizard/state.ts, message-cache/cache.ts)

### Modified files (Phase 2)

- `src/message-queue/types.ts` — add turnId to QueueItem, CoalescedItem
- `src/message-queue/queue.ts` — mint turnId on flush, emit turn:start
- `src/message-queue/index.ts` — emit turn:end, pass turnId to handler
- `src/llm-orchestrator.ts` — accept turnId, pass to events/tools/reply
- `src/llm-orchestrator-events.ts` — emit turnId on llm:start/llm:end
- `src/llm-orchestrator-support.ts` — emit tool:\* events with turnId
- `src/tools/wrap-tool-execution.ts` — emit tool:execute_start/end with turnId
- `src/tools/confirmation-gate.ts` — emit tool:confirm_required/result with turnId
- `src/bot-reply-tracking.ts` — emit reply:sent with turnId
- `src/reply-typing-heartbeat.ts` — emit typing:start/stop with turnId
- `src/scheduler-recurring.ts` — emit recurring:fired, notify:scheduler_fired
- `src/deferred-prompts/poller.ts` — emit deferred:fired/alerted, notify:deferred_alert
- `src/tool-failure.ts` — emit tool:failure_classified
- `src/debug/state-collector.ts` — add Turn assembly, ring buffers, new event handlers
- `src/debug/schemas.ts` — add Turn, Notification, ToolFailure schemas
- `src/debug/server.ts` — add /turns/:id endpoint
- `client/debug/dashboard-types.ts` — add new state fields
- `client/debug/dashboard.html` — add context switcher, panel grid
- `client/debug/dashboard.css` — add panel grid, context chip styles
- `client/debug/handlers.ts` — add turn/queue/tool/reply/typing/notify handlers
- New: `client/debug/panels/turns.ts`
- New: `client/debug/panels/tool-failures.ts`
- New: `client/debug/panels/notifications.ts`

### Modified files (Phase 3)

- `src/recurring.ts` — add emit calls for recurring:\* events
- `src/deferred-prompts/tools.ts` — add emit calls for deferred:created/updated/cancelled
- `src/memos.ts` — add emit calls for memo:\* events
- `src/debug/state-collector.ts` — add recurring/deferred snapshot getters
- `src/debug/server.ts` — add /recurring, /deferred, /memos endpoints
- `client/debug/handlers.ts` — add recurring/deferred/memo event handlers
- New: `client/debug/panels/reminders.ts`
- New: `client/debug/panels/memos.ts`

### Modified files (Phase 4)

- `src/identity/mapping.ts` — add emit calls for identity:set/cleared
- `src/group-settings/state.ts` — add emit for group_settings:target_changed
- `src/config-editor/` — add emit for config_editor:opened/step/closed
- `src/group-settings/access.ts` — add emit for auth:group_authorized/revoked, group_member:added/removed
- `src/debug/state-collector.ts` — add context panel data, turnId filter on logs
- `src/debug/server.ts` — add turnId param to /logs
- `src/debug/log-buffer.ts` — add turnId field to LogEntry
- `client/debug/handlers.ts` — add identity/file_relay/group_settings/config_editor/auth handlers
- New: `client/debug/panels/context.ts`
- `client/debug/dashboard-api.ts` — add log cross-link action

### New test files

- `tests/debug/event-bus-scope.test.ts`
- `tests/debug/admin-visibility.test.ts`
- `tests/debug/turn-assembly.test.ts`
- `tests/debug/ring-buffers.test.ts`
- `tests/client/debug/panels/turns.test.ts`
- `tests/client/debug/panels/tool-failures.test.ts`
- `tests/client/debug/panels/notifications.test.ts`
- `tests/client/debug/panels/reminders.test.ts`
- `tests/client/debug/panels/memos.test.ts`
- `tests/client/debug/panels/context.test.ts`

---

## Phase 1 — Infra (typed emit + admin visibility)

### Task 1: Add Scope type and typed emit helpers to event-bus

**Files:**

- Modify: `src/debug/event-bus.ts`
- Test: `tests/debug/event-bus-scope.test.ts`

- [ ] **Step 1: Write failing tests for emitUser/emitGroup/emitGlobal**

```ts
// tests/debug/event-bus-scope.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'
import { emitUser, emitGroup, emitGlobal, subscribe, unsubscribe, type DebugEvent } from '../../src/debug/event-bus.js'

describe('typed emit helpers', () => {
  let events: DebugEvent[] = []
  const capture = (e: DebugEvent): void => {
    events.push(e)
  }

  beforeEach(() => {
    events = []
    subscribe(capture)
    return () => unsubscribe(capture)
  })

  it('emitUser injects user scope and userId', () => {
    emitUser('test:event', 'user-1', { foo: 'bar' })
    expect(events).toHaveLength(1)
    expect(events[0]!.__scope).toEqual({ kind: 'user', userId: 'user-1' })
    expect(events[0]!.data.foo).toBe('bar')
  })

  it('emitUser injects turnId when provided', () => {
    emitUser('test:event', 'user-1', {}, 'turn-abc')
    expect(events[0]!.turnId).toBe('turn-abc')
  })

  it('emitGroup injects group scope', () => {
    emitGroup('test:event', 'group-1', { x: 1 })
    expect(events[0]!.__scope).toEqual({ kind: 'group', groupId: 'group-1' })
  })

  it('emitGroup injects threadId when provided', () => {
    emitGroup('test:event', 'group-1', {}, undefined, 'thread-1')
    expect(events[0]!.__scope).toEqual({ kind: 'group', groupId: 'group-1', threadId: 'thread-1' })
  })

  it('emitGlobal injects global scope', () => {
    emitGlobal('test:event', { y: 2 })
    expect(events[0]!.__scope).toEqual({ kind: 'global' })
  })

  it('bare emit() still works and defaults to global scope', () => {
    const { emit } = require('../../src/debug/event-bus.js')
    emit('test:event', { z: 3 })
    expect(events[0]!.__scope).toEqual({ kind: 'global' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/debug/event-bus-scope.test.ts`
Expected: FAIL — `emitUser`, `emitGroup`, `emitGlobal` not exported

- [ ] **Step 3: Implement Scope type and typed emit helpers**

```ts
// src/debug/event-bus.ts — add after existing types
export type Scope =
  | { kind: 'user'; userId: string }
  | { kind: 'group'; groupId: string; threadId?: string }
  | { kind: 'global' }

export type DebugEvent = {
  type: string
  timestamp: number
  data: Record<string, unknown>
  __scope: Scope
  turnId?: string
}

export function emitUser(type: string, userId: string, data: Record<string, unknown>, turnId?: string): void {
  if (listeners.size === 0) return
  const event: DebugEvent = { type, timestamp: Date.now(), data, __scope: { kind: 'user', userId }, turnId }
  for (const fn of listeners) fn(event)
}

export function emitGroup(
  type: string,
  groupId: string,
  data: Record<string, unknown>,
  turnId?: string,
  threadId?: string,
): void {
  if (listeners.size === 0) return
  const event: DebugEvent = { type, timestamp: Date.now(), data, __scope: { kind: 'group', groupId, threadId }, turnId }
  for (const fn of listeners) fn(event)
}

export function emitGlobal(type: string, data: Record<string, unknown>): void {
  if (listeners.size === 0) return
  const event: DebugEvent = { type, timestamp: Date.now(), data, __scope: { kind: 'global' } }
  for (const fn of listeners) fn(event)
}
```

Update existing `emit()` to inject `__scope: { kind: 'global' }` and log a one-shot warning per event type.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/debug/event-bus-scope.test.ts`
Expected: PASS

- [ ] **Step 5: Run existing event-bus tests to verify no regression**

Run: `bun test tests/debug/event-bus.test.ts`
Expected: PASS (existing emit() still works with added \_\_scope field)

- [ ] **Step 6: Commit**

```bash
git add src/debug/event-bus.ts tests/debug/event-bus-scope.test.ts
git commit -m "feat(debug): add Scope type and typed emit helpers to event-bus"
```

---

### Task 2: Add AdminVisibility and isVisibleToAdmin filter

**Files:**

- Modify: `src/debug/state-collector.ts`
- Modify: `src/debug/schemas.ts`
- Test: `tests/debug/admin-visibility.test.ts`

- [ ] **Step 1: Write failing tests for AdminVisibility**

```ts
// tests/debug/admin-visibility.test.ts
import { describe, it, expect } from 'bun:test'
import { isVisibleToAdmin, type AdminVisibility } from '../../src/debug/state-collector.js'
import type { Scope } from '../../src/debug/event-bus.js'

describe('isVisibleToAdmin', () => {
  const vis: AdminVisibility = {
    adminUserId: 'admin-1',
    groupIds: new Set(['group-a', 'group-b']),
  }

  it('global events are visible', () => {
    expect(isVisibleToAdmin({ kind: 'global' }, vis)).toBe(true)
  })

  it('user events for admin are visible', () => {
    expect(isVisibleToAdmin({ kind: 'user', userId: 'admin-1' }, vis)).toBe(true)
  })

  it('user events for non-admin are not visible', () => {
    expect(isVisibleToAdmin({ kind: 'user', userId: 'other' }, vis)).toBe(false)
  })

  it('group events for admin-member groups are visible', () => {
    expect(isVisibleToAdmin({ kind: 'group', groupId: 'group-a' }, vis)).toBe(true)
  })

  it('group events for non-member groups are not visible', () => {
    expect(isVisibleToAdmin({ kind: 'group', groupId: 'group-c' }, vis)).toBe(false)
  })

  it('unscoped events are denied (default-deny)', () => {
    // Simulate legacy emit() without __scope — the type system prevents this,
    // but at runtime the filter should handle missing __scope gracefully
    expect(isVisibleToAdmin(undefined as unknown as Scope, vis)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/debug/admin-visibility.test.ts`
Expected: FAIL — `isVisibleToAdmin` and `AdminVisibility` not exported

- [ ] **Step 3: Implement AdminVisibility and isVisibleToAdmin**

```ts
// src/debug/state-collector.ts — add after imports
export type AdminVisibility = {
  adminUserId: string
  groupIds: ReadonlySet<string>
}

export function isVisibleToAdmin(scope: Scope, vis: AdminVisibility): boolean {
  if (scope.kind === 'global') return true
  if (scope.kind === 'user') return scope.userId === vis.adminUserId
  if (scope.kind === 'group') return vis.groupIds.has(scope.groupId)
  return false
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/debug/admin-visibility.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/debug/state-collector.ts tests/debug/admin-visibility.test.ts
git commit -m "feat(debug): add AdminVisibility type and isVisibleToAdmin filter"
```

---

### Task 3: Replace isAdminEvent with isVisibleToAdmin in collector

**Files:**

- Modify: `src/debug/state-collector.ts`
- Test: `tests/debug/state-collector.test.ts` (existing)

- [ ] **Step 1: Write failing test for scope-based filtering**

Add to existing `tests/debug/state-collector.test.ts`:

```ts
it('filters events by scope instead of userId field', () => {
  // Set up admin
  init('admin-1')
  // ... set up mock AdminVisibility with groupIds

  // Event for non-admin user should be filtered
  // Event for admin user should pass
  // Event with global scope should pass
  // Event with group scope for member group should pass
  // Event with group scope for non-member group should be filtered
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/state-collector.test.ts`
Expected: FAIL — current `isAdminEvent` doesn't use scope

- [ ] **Step 3: Replace isAdminEvent with isVisibleToAdmin**

Update `onEvent` in `state-collector.ts` to use `isVisibleToAdmin(event.__scope, adminVisibility)` instead of `isAdminEvent(event)`. Compute `AdminVisibility` in `init()` and `addClient()`.

- [ ] **Step 4: Run all debug tests**

Run: `bun test tests/debug/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/debug/state-collector.ts tests/debug/state-collector.test.ts
git commit -m "feat(debug): replace isAdminEvent with scope-based isVisibleToAdmin"
```

---

### Task 4: Add applyVisibility helper for snapshots

**Files:**

- Modify: `src/debug/state-collector.ts`
- Test: `tests/debug/admin-visibility.test.ts`

- [ ] **Step 1: Write failing test**

```ts
describe('applyVisibility', () => {
  it('filters entries by scope', () => {
    const entries = [
      { userId: 'admin-1', name: 'a' },
      { userId: 'other', name: 'b' },
      { groupId: 'group-a', name: 'c' },
    ]
    const vis: AdminVisibility = { adminUserId: 'admin-1', groupIds: new Set(['group-a']) }
    const filtered = applyVisibility(
      entries,
      (e) => {
        if ('groupId' in e) return { kind: 'group', groupId: e.groupId as string }
        return { kind: 'user', userId: e.userId as string }
      },
      vis,
    )
    expect(filtered).toHaveLength(2)
    expect(filtered[0]!.name).toBe('a')
    expect(filtered[1]!.name).toBe('c')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/admin-visibility.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement applyVisibility**

```ts
export function applyVisibility<T>(entries: T[], getScope: (entry: T) => Scope, vis: AdminVisibility): T[] {
  return entries.filter((entry) => isVisibleToAdmin(getScope(entry), vis))
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/debug/admin-visibility.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/debug/state-collector.ts tests/debug/admin-visibility.test.ts
git commit -m "feat(debug): add applyVisibility helper for snapshot filtering"
```

---

### Task 5: Migrate existing emit sites to typed helpers

**Files:**

- Modify: `src/bot.ts` (2 sites)
- Modify: `src/bot-reply-tracking.ts` (1 site)
- Modify: `src/llm-orchestrator.ts` (1 site)
- Modify: `src/llm-orchestrator-events.ts` (2 sites)
- Modify: `src/llm-orchestrator-support.ts` (3 sites)
- Modify: `src/cache.ts` (14 sites)
- Modify: `src/scheduler.ts` (1 site)
- Modify: `src/scheduler-recurring.ts` (1 site)
- Modify: `src/deferred-prompts/poller.ts` (2 sites)
- Modify: `src/conversation.ts` (3 sites)
- Modify: `src/wizard/state.ts` (4 sites)
- Modify: `src/message-cache/cache.ts` (1 site)
- Modify: `src/debug/log-buffer.ts` (1 site)
- Test: existing tests (no new test file needed)

- [ ] **Step 1: Migrate bot.ts emit sites**

Replace `emit('message:received', {...})` with `emitUser('message:received', userId, {...})` and `emit('auth:check', {...})` with `emitUser('auth:check', userId, {...})`.

- [ ] **Step 2: Migrate llm-orchestrator\*.ts emit sites**

Replace `emit('llm:tool_call', ...)` → `emitUser('llm:tool_call', userId, ...)`, same for `llm:start`, `llm:end`, `llm:tool_result`, `llm:error`.

- [ ] **Step 3: Migrate cache.ts emit sites**

Replace all 14 `emit('cache:load/sync/expire', ...)` → `emitUser('cache:...', userId, ...)`. For `contextId`-based calls (instructions), use `emitUser('cache:...', contextId, ...)`.

- [ ] **Step 4: Migrate scheduler/recurring/poller emit sites**

`scheduler:tick` → `emitGlobal('scheduler:tick', ...)`, `scheduler:task_executed` → `emitUser(...)` with task userId, `poller:scheduled/alerts` → `emitGlobal(...)`.

- [ ] **Step 5: Migrate conversation/wizard/message-cache/log-buffer emit sites**

`trim:start/end` → `emitUser(...)`, `wizard:*` → `emitUser(...)`, `msgcache:sweep` → `emitGlobal(...)`, `log:entry` → `emitGlobal(...)`.

- [ ] **Step 6: Run full test suite**

Run: `bun test tests/debug/ && bun test tests/`
Expected: PASS

- [ ] **Step 7: Run lint and typecheck**

Run: `bun lint && bun typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A src/
git commit -m "feat(debug): migrate all 39 emit sites to typed helpers"
```

---

## Phase 2 — Turns, tool failures, notifications

### Task 6: Add turnId to message-queue types and mint on flush

**Files:**

- Modify: `src/message-queue/types.ts`
- Modify: `src/message-queue/queue.ts`
- Test: `tests/message-queue/queue.test.ts` (existing)

- [ ] **Step 1: Write failing test for turnId minting**

Add to existing queue tests:

```ts
it('mints a turnId on flush', async () => {
  const queue = new MessageQueue('ctx-1')
  const handler = mock().returns(Promise.resolve())
  queue.setHandler(handler)
  queue.enqueue(
    { text: 'hello', userId: 'u1', username: null, storageContextId: 'ctx-1', newAttachmentIds: [], contextType: 'dm' },
    mockReply,
  )
  queue.forceFlush()
  expect(handler).toHaveBeenCalledTimes(1)
  const coalesced = handler.mock.calls[0]![0]
  expect(coalesced.turnId).toBeTypeOf('string')
  expect(coalesced.turnId.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/message-queue/queue.test.ts`
Expected: FAIL — `turnId` not on CoalescedItem

- [ ] **Step 3: Add turnId to types and mint on flush**

Add `turnId: string` to `CoalescedItem` in `types.ts`. In `queue.ts`, add `import { randomUUID } from 'node:crypto'` and set `turnId: randomUUID()` in the `flush()` method's result object.

- [ ] **Step 4: Run tests**

Run: `bun test tests/message-queue/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/message-queue/types.ts src/message-queue/queue.ts tests/message-queue/queue.test.ts
git commit -m "feat(debug): mint turnId on message-queue flush"
```

---

### Task 7: Emit turn:start, turn:end, and queue:\* events from message-queue

**Files:**

- Modify: `src/message-queue/queue.ts` — emit `queue:enqueue` on enqueue, `queue:coalesce` on flush, `turn:start` after flush
- Modify: `src/message-queue/index.ts` — emit `queue:dequeue` on handler invocation, `turn:end` after handler completes
- Test: `tests/message-queue/queue.test.ts`

- [ ] **Step 1: Write failing tests for turn:start/turn:end and queue events**

```ts
it('emits queue:enqueue when message is buffered', () => {
  // ... enqueue a message, check emitted event has { storageContextId, userId, bufferedCount }
})

it('emits queue:coalesce when messages are flushed', () => {
  // ... enqueue multiple messages, flush, check event has { storageContextId, itemCount, attachmentCount }
})

it('emits queue:dequeue when handler is invoked', () => {
  // ... enqueue, trigger flush, check dequeue event
})

it('emits turn:start with scope and message ids', () => {
  // ... enqueue messages, flush, check turn:start event has { turnId, scope, contextType, incomingMessageCount }
})

it('emits turn:end with status ok on success', async () => {
  // ... enqueue, handler succeeds, check turn:end event has { turnId, status:'ok', duration }
})

it('emits turn:end with status error on handler failure', async () => {
  // ... enqueue, handler throws, check turn:end event has { turnId, status:'error', error }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/message-queue/queue.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement queue:enqueue emission in queue.ts**

In `enqueue()`, emit `queue:enqueue` using `emitUser` or `emitGroup` based on `contextType` with `{ storageContextId, userId, bufferedCount }`.

- [ ] **Step 4: Implement queue:coalesce and turn:start in queue.ts**

In `flush()`, after building the `CoalescedItem`, emit `queue:coalesce` and then `turn:start` using the appropriate scoped emit helper.

- [ ] **Step 5: Implement queue:dequeue and turn:end in index.ts**

In `enqueueMessage` and `flushOnShutdown`, emit `queue:dequeue` before handler invocation. Wrap handler calls in try/finally that emits `turn:end` with status `ok` or `error`.

- [ ] **Step 6: Run tests**

Run: `bun test tests/message-queue/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/message-queue/queue.ts src/message-queue/index.ts tests/message-queue/queue.test.ts
git commit -m "feat(debug): emit turn:start, turn:end, and queue:* events from message-queue"
```

---

### Task 8: Thread turnId through orchestrator

**Files:**

- Modify: `src/llm-orchestrator.ts` — accept `turnId` parameter
- Modify: `src/llm-orchestrator-events.ts` — include `turnId` in emitted events
- Modify: `src/llm-orchestrator-support.ts` — include `turnId` in emitted events
- Modify: `src/llm-orchestrator-types.ts` — add `turnId` to deps/options if needed
- Test: existing orchestrator tests

- [ ] **Step 1: Write failing test for turnId propagation**

```ts
it('passes turnId to llm:start and llm:end events', async () => {
  // Call processMessage with turnId='test-turn'
  // Verify emitted llm:start and llm:end events have turnId='test-turn'
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/llm-orchestrator`
Expected: FAIL

- [ ] **Step 3: Add turnId parameter to processMessage**

Add `turnId?: string` to `processMessage` signature. Default to `crypto.randomUUID()` when absent. Pass to `callLlm`, which passes to `invokeModelWithTyping` and event emission functions.

- [ ] **Step 4: Update event emission to include turnId**

In `llm-orchestrator-events.ts`, pass `turnId` to `emitUser` calls. In `llm-orchestrator-support.ts`, pass `turnId` to `emitUser` calls.

- [ ] **Step 5: Update message-queue to pass turnId to orchestrator**

In `index.ts` and `queue.ts`, pass `coalesced.turnId` to the handler. Update the handler type in `bot.ts` to accept and forward `turnId`.

- [ ] **Step 6: Run all orchestrator tests**

Run: `bun test tests/llm-orchestrator`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/llm-orchestrator.ts src/llm-orchestrator-events.ts src/llm-orchestrator-support.ts src/message-queue/
git commit -m "feat(debug): thread turnId through orchestrator and LLM events"
```

---

### Task 9: Add tool:\* events with turnId

**Files:**

- Modify: `src/tools/wrap-tool-execution.ts` — emit `tool:execute_start`, `tool:execute_end`
- Modify: `src/tools/confirmation-gate.ts` — emit `tool:confirm_required`, `tool:confirm_result`
- Modify: `src/llm-orchestrator.ts` — emit `tool:request`
- Test: `tests/tools/wrap-tool-execution.test.ts` (existing)

- [ ] **Step 1: Write failing tests**

```ts
it('emits tool:execute_start and tool:execute_end with turnId', async () => {
  // ... execute a wrapped tool with turnId, check events
})

it('emits tool:failure_classified on tool error', async () => {
  // ... execute a wrapped tool that throws, check event
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/tools/wrap-tool-execution.test.ts`
Expected: FAIL

- [ ] **Step 3: Add turnId to wrapToolExecution signature**

Accept `turnId` as optional parameter. Emit `tool:execute_start` before calling the original execute, `tool:execute_end` after (or `tool:failure_classified` on error).

- [ ] **Step 4: Thread turnId from orchestrator to tool execution**

The AI SDK's `generateText` calls tool `execute` directly. Use a closure or context variable to pass `turnId` from the orchestrator to the wrapped tool execute function.

- [ ] **Step 5: Run tests**

Run: `bun test tests/tools/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/wrap-tool-execution.ts src/tools/confirmation-gate.ts src/llm-orchestrator.ts
git commit -m "feat(debug): add tool:* events with turnId"
```

---

### Task 10: Add reply:sent and typing:\* events

**Files:**

- Modify: `src/bot-reply-tracking.ts` — emit `reply:sent`
- Modify: `src/reply-typing-heartbeat.ts` — emit `typing:start`, `typing:stop`
- Test: `tests/bot-reply-tracking.test.ts` (existing)

- [ ] **Step 1: Write failing tests**

```ts
it('emits reply:sent with text, target, duration, and turnId', async () => {
  // ... trigger a reply, check emitted event
})

it('emits typing:start and typing:stop', async () => {
  // ... run withReplyTypingHeartbeat, check events
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/bot-reply-tracking.test.ts`
Expected: FAIL

- [ ] **Step 3: Add turnId to emitReplyCompleted and emit reply:sent**

Accept `turnId` parameter in `emitReplyCompletedIfNeeded`. Emit `reply:sent` with `{ text: firstNChars, target, duration, turnId }` using `emitUser`.

- [ ] **Step 4: Add typing events to reply-typing-heartbeat**

Emit `typing:start` at heartbeat start, `typing:stop` when heartbeat stops or any reply method is called. Include `turnId`.

- [ ] **Step 5: Run tests**

Run: `bun test tests/bot-reply-tracking.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/bot-reply-tracking.ts src/reply-typing-heartbeat.ts
git commit -m "feat(debug): add reply:sent and typing:* events"
```

---

### Task 11: Add notify:\* events from scheduler and poller

**Files:**

- Modify: `src/scheduler-recurring.ts` — emit `notify:scheduler_fired` and `recurring:fired`
- Modify: `src/deferred-prompts/poller.ts` — emit `notify:deferred_alert` and `deferred:fired`/`deferred:alerted`
- Test: existing scheduler/poller tests

- [ ] **Step 1: Write failing tests**

```ts
it('emits notify:scheduler_fired when recurring task fires', async () => {
  // ... trigger scheduler execution, check event
})

it('emits notify:deferred_alert when deferred prompt alert fires', async () => {
  // ... trigger poller alert, check event
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/scheduler-recurring`
Expected: FAIL

- [ ] **Step 3: Add notify events**

In `scheduler-recurring.ts`, after `markExecuted`, emit `notify:scheduler_fired` and `recurring:fired` with `emitUser(type, task.userId, ...)`. In `poller.ts`, emit `notify:deferred_alert` and `deferred:fired`/`deferred:alerted`.

- [ ] **Step 4: Run tests**

Run: `bun test tests/scheduler-recurring && bun test tests/deferred-prompts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scheduler-recurring.ts src/deferred-prompts/poller.ts
git commit -m "feat(debug): add notify:scheduler_fired and notify:deferred_alert events"
```

---

### Task 12: Add tool:failure_classified event

**Files:**

- Modify: `src/tool-failure.ts` — emit `tool:failure_classified` when building failure result
- Test: `tests/tool-failure.test.ts` (existing)

- [ ] **Step 1: Write failing test**

```ts
it('emits tool:failure_classified with reason code and retriable flag', () => {
  // ... call buildToolFailureResult, check emitted event
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tool-failure.test.ts`
Expected: FAIL

- [ ] **Step 3: Add emit in buildToolFailureResult**

Emit `tool:failure_classified` with `{ toolName, toolCallId, errorType, errorCode, retryable, recovered }` using `emitUser` (userId from context) or `emitGlobal` if userId unavailable. Accept optional `turnId` and `userId` parameters.

- [ ] **Step 4: Run tests**

Run: `bun test tests/tool-failure.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tool-failure.ts
git commit -m "feat(debug): emit tool:failure_classified from tool-failure.ts"
```

---

### Task 13: Add Turn assembly and ring buffers to state-collector

**Files:**

- Modify: `src/debug/state-collector.ts`
- Modify: `src/debug/schemas.ts`
- Test: `tests/debug/turn-assembly.test.ts`

- [ ] **Step 1: Write failing tests for Turn assembly**

```ts
describe('Turn assembly', () => {
  it('assembles a Turn from turn:start through turn:end', () => {
    // Emit turn:start, some tool events, turn:end
    // Verify recentTurns contains completed Turn with correct fields
  })

  it('handles overlapping turns for different users', () => {
    // Emit turn:start for user A, turn:start for user B, turn:end for A, turn:end for B
    // Verify both turns completed independently
  })

  it('closes stalled turn on turn:end with error status', () => {
    // Emit turn:start, then turn:end with error
    // Verify turn status is 'error'
  })

  it('enforces 512-entry cap on recentTurns', () => {
    // Emit 513 completed turns
    // Verify recentTurns has exactly 512 entries
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/debug/turn-assembly.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement Turn type and assembly**

Add to `state-collector.ts`:

- `Turn` type with `turnId, scope, startedAt, endedAt, status, incomingMessageIds, llmCalls, toolCalls, reply, error`
- `recentTurns: Turn[]` (capacity 512)
- `recentNotifications: Notification[]` (capacity 2048)
- `recentToolFailures: ToolFailure[]` (capacity 1024)
- `inFlightTurns: Map<string, Turn>` for assembly
- Event handlers for `turn:start`, `turn:end`, `queue:*`, `tool:*`, `reply:sent`, `typing:*`, `notify:*`

- [ ] **Step 4: Add Zod schemas for new types**

Add `TurnSchema`, `NotificationSchema`, `ToolFailureSchema` to `schemas.ts`.

- [ ] **Step 5: Include new data in state:init snapshot and turn:summary broadcasts**

Add `recentTurns`, `recentNotifications`, `recentToolFailures` to the `initData` object in `addClient()`. On `turn:end`, broadcast a compact `turn:summary` event so reconnecting clients don't need to replay raw events.

- [ ] **Step 6: Run tests**

Run: `bun test tests/debug/turn-assembly.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/debug/state-collector.ts src/debug/schemas.ts tests/debug/turn-assembly.test.ts
git commit -m "feat(debug): add Turn assembly, ring buffers, and new event handlers"
```

---

### Task 14: Add /turns/:id REST endpoint

**Files:**

- Modify: `src/debug/server.ts`
- Test: `tests/debug/server.test.ts` (existing)

- [ ] **Step 1: Write failing test**

```ts
it('GET /turns/:id returns turn details', async () => {
  // Set up a turn in recentTurns
  // Request /turns/<turnId>
  // Expect 200 with turn JSON
})

it('GET /turns/:id returns 404 for unknown turnId', async () => {
  // Request /turns/nonexistent
  // Expect 404
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/server.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement /turns/:id handler**

Add route in `server.ts` that looks up `turnId` in `recentTurns` (imported from state-collector). Return JSON with full Turn details. Respect `isAuthorizedRequest` gate.

- [ ] **Step 4: Run tests**

Run: `bun test tests/debug/server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/debug/server.ts tests/debug/server.test.ts
git commit -m "feat(debug): add /turns/:id REST endpoint"
```

---

### Task 15: Add context switcher and panel grid to dashboard HTML

**Files:**

- Modify: `client/debug/dashboard.html`
- Modify: `client/debug/dashboard.css`
- Modify: `client/debug/dashboard-types.ts`
- Test: `tests/client/debug/dashboard-api.test.ts` (existing)

- [ ] **Step 1: Write failing test for context switcher**

```ts
it('renders context chips from admin allow-list', () => {
  // Set up state with contexts
  // Call render function
  // Verify DOM has .context-chips with DM and group chips
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/debug/dashboard-api.test.ts`
Expected: FAIL

- [ ] **Step 3: Update dashboard.html**

Add context switcher chip row after header. Replace single-column layout with 2-column panel grid. Add placeholder sections for Turns, Reminders, Memos, Notifications, Tool failures, Context panels.

- [ ] **Step 4: Update dashboard.css**

Add `.panel-grid` (2-column CSS grid), `.context-chips` (horizontal chip row), `.chip` (individual chip), panel wrapper styles.

- [ ] **Step 5: Update DashboardState**

Add `turns`, `reminders`, `notifications`, `toolFailures`, `memosByUser`, `activeContext`, `activeLogFilter` fields.

- [ ] **Step 6: Run tests**

Run: `bun test tests/client/debug/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add client/debug/dashboard.html client/debug/dashboard.css client/debug/dashboard-types.ts
git commit -m "feat(debug): add context switcher and 2-column panel grid to dashboard"
```

---

### Task 16: Add SSE handlers for new event types

**Files:**

- Modify: `client/debug/handlers.ts`
- Modify: `client/debug/sse.ts` (if needed)
- Test: `tests/client/debug/handlers.test.ts` (existing or new)

- [ ] **Step 1: Write failing tests for new handlers**

```ts
it('handleTurnStart adds turn to state', () => { ... })
it('handleTurnEnd updates turn status', () => { ... })
it('handleReplySent adds to notifications', () => { ... })
it('handleToolFailureClassified adds to toolFailures', () => { ... })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/client/debug/handlers.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement new handlers**

Add handlers for: `turn:start`, `turn:end`, `turn:summary`, `queue:enqueue/dequeue/coalesce`, `tool:request/confirm_required/confirm_result/execute_start/execute_end/failure_classified`, `reply:sent`, `typing:start/stop`, `notify:scheduler_fired/deferred_alert`.

- [ ] **Step 4: Register handlers in sse.ts**

Add new entries to the `handlers` map.

- [ ] **Step 5: Run tests**

Run: `bun test tests/client/debug/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/debug/handlers.ts client/debug/sse.ts
git commit -m "feat(debug): add SSE handlers for turn/tool/reply/typing/notify events"
```

---

### Task 17: Add Turns panel

**Files:**

- New: `client/debug/panels/turns.ts`
- Modify: `client/debug/dashboard-api.ts`
- Test: `tests/client/debug/panels/turns.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it('renders turn rows from state', () => {
  // Set up state.turns with mock data
  // Call renderTurns()
  // Verify DOM has turn rows with status, duration, tool count
})

it('click on turn row fetches /turns/:id and opens modal', () => {
  // ...
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/debug/panels/turns.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement Turns panel**

Create `panels/turns.ts` with `renderTurns(state)` function. Each row shows: time, scope (user/group), status (running/ok/error/cancelled), duration, tool call count. Click opens `/turns/:id` via REST and shows detail in modal.

- [ ] **Step 4: Wire into dashboard-api.ts**

Call `renderTurns` from the main render loop.

- [ ] **Step 5: Run tests**

Run: `bun test tests/client/debug/panels/turns.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/debug/panels/turns.ts client/debug/dashboard-api.ts tests/client/debug/panels/turns.test.ts
git commit -m "feat(debug): add Turns panel to dashboard"
```

---

### Task 18: Add Tool failures and Notifications panels

**Files:**

- New: `client/debug/panels/tool-failures.ts`
- New: `client/debug/panels/notifications.ts`
- Modify: `client/debug/dashboard-api.ts`
- Test: `tests/client/debug/panels/tool-failures.test.ts`
- Test: `tests/client/debug/panels/notifications.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tool-failures.test.ts
it('renders tool failure rows with reason code and retriable flag', () => { ... })

// notifications.test.ts
it('renders notification timeline with reply content and typing events', () => { ... })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/client/debug/panels/`
Expected: FAIL

- [ ] **Step 3: Implement Tool failures panel**

Each row: time, tool name, error type, retriable flag, failure reason. Click opens tree-view modal with full error details.

- [ ] **Step 4: Implement Notifications panel**

Timeline of: reply:sent (with text preview), typing:start/stop, notify:scheduler_fired, notify:deferred_alert. Each entry has timestamp and context.

- [ ] **Step 5: Wire into dashboard-api.ts**

- [ ] **Step 6: Run tests**

Run: `bun test tests/client/debug/panels/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add client/debug/panels/tool-failures.ts client/debug/panels/notifications.ts client/debug/dashboard-api.ts
git commit -m "feat(debug): add Tool failures and Notifications panels"
```

---

## Phase 3 — Reminders & memos

### Task 19: Add recurring:\* events to recurring.ts

**Files:**

- Modify: `src/recurring.ts`
- Test: `tests/recurring.test.ts` (existing)

- [ ] **Step 1: Write failing tests**

```ts
it('emits recurring:created on createRecurringTask', () => { ... })
it('emits recurring:paused on pauseRecurringTask', () => { ... })
it('emits recurring:resumed on resumeRecurringTask', () => { ... })
it('emits recurring:deleted on deleteRecurringTask', () => { ... })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/recurring.test.ts`
Expected: FAIL

- [ ] **Step 3: Add emit calls**

Emit `recurring:created/updated/paused/resumed/skipped/deleted` with `emitUser(type, userId, { taskId, ... })` after each successful CRUD operation.

- [ ] **Step 4: Run tests**

Run: `bun test tests/recurring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/recurring.ts
git commit -m "feat(debug): add recurring:* lifecycle events"
```

---

### Task 20: Add deferred:\* events to deferred-prompts

**Files:**

- Modify: `src/deferred-prompts/tools.ts` (or `tool-handlers.ts`)
- Modify: `src/deferred-prompts/poller.ts`
- Test: `tests/deferred-prompts/` (existing)

- [ ] **Step 1: Write failing tests**

```ts
it('emits deferred:created on prompt creation', () => { ... })
it('emits deferred:fired on prompt execution', () => { ... })
it('emits deferred:cancelled on prompt cancellation', () => { ... })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/deferred-prompts/`
Expected: FAIL

- [ ] **Step 3: Add emit calls**

Emit `deferred:created/updated/cancelled/fired/alerted` with `emitUser(type, userId, { promptId, ... })`.

- [ ] **Step 4: Run tests**

Run: `bun test tests/deferred-prompts/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/deferred-prompts/tools.ts src/deferred-prompts/poller.ts
git commit -m "feat(debug): add deferred:* lifecycle events"
```

---

### Task 21: Add memo:\* events to memos.ts

**Files:**

- Modify: `src/memos.ts`
- Test: `tests/memos.test.ts` (existing)

- [ ] **Step 1: Write failing tests**

```ts
it('emits memo:created on saveMemo', () => { ... })
it('emits memo:archived on archiveMemos', () => { ... })
it('emits memo:searched on keywordSearchMemos', () => { ... })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/memos.test.ts`
Expected: FAIL

- [ ] **Step 3: Add emit calls**

Emit `memo:created/updated/archived/promoted/searched` with `emitUser(type, userId, { memoId, ... })`.

- [ ] **Step 4: Run tests**

Run: `bun test tests/memos.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/memos.ts
git commit -m "feat(debug): add memo:* lifecycle events"
```

---

### Task 22: Add recurring/deferred/memo snapshot getters and REST endpoints

**Files:**

- Modify: `src/recurring.ts` — add `getRecurringSnapshot(vis)`
- Modify: `src/deferred-prompts/` — add `getDeferredSnapshot(vis)`
- Modify: `src/debug/server.ts` — add `/recurring`, `/deferred`, `/memos` endpoints
- Modify: `src/debug/state-collector.ts` — add compact snapshots to state:init
- Test: `tests/debug/server.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it('GET /recurring?userId=... returns recurring tasks for admin-visible user', () => { ... })
it('GET /deferred?userId=... returns deferred prompts', () => { ... })
it('GET /memos?userId=...&state=active returns active memos', () => { ... })
it('GET /memos returns 403 for non-admin user', () => { ... })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/debug/server.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement snapshot getters**

Add `getRecurringSnapshot(vis)` that queries DB for recurring tasks filtered by admin-visibility. Same for deferred prompts. Add compact versions to `state:init`.

- [ ] **Step 4: Implement REST endpoints**

Add routes with `isAuthorizedRequest` + `assertScopeAllowed(vis, params)` checks.

- [ ] **Step 5: Run tests**

Run: `bun test tests/debug/server.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/recurring.ts src/deferred-prompts/ src/debug/server.ts src/debug/state-collector.ts
git commit -m "feat(debug): add recurring/deferred/memo snapshot getters and REST endpoints"
```

---

### Task 23: Add Reminders and Memos panels

**Files:**

- New: `client/debug/panels/reminders.ts`
- New: `client/debug/panels/memos.ts`
- Modify: `client/debug/dashboard-api.ts`
- Modify: `client/debug/handlers.ts`
- Test: `tests/client/debug/panels/reminders.test.ts`
- Test: `tests/client/debug/panels/memos.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// reminders.test.ts
it('renders recurring tasks with next-fire time and pause state', () => { ... })
it('renders deferred prompts with last-fire outcome', () => { ... })

// memos.test.ts
it('renders memo list with search box', () => { ... })
it('memo:* events update panel in place', () => { ... })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/client/debug/panels/`
Expected: FAIL

- [ ] **Step 3: Implement Reminders panel**

Two sections: recurring tasks and deferred prompts. Each shows compact info with click-to-expand via REST drill-down.

- [ ] **Step 4: Implement Memos panel**

Lazy-loaded from `/memos`. Search box filters client-side. `memo:*` events patch in place.

- [ ] **Step 5: Add SSE handlers for recurring/deferred/memo events**

- [ ] **Step 6: Run tests**

Run: `bun test tests/client/debug/panels/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add client/debug/panels/reminders.ts client/debug/panels/memos.ts client/debug/dashboard-api.ts client/debug/handlers.ts
git commit -m "feat(debug): add Reminders and Memos panels"
```

---

## Phase 4 — Context & log cross-links

### Task 24: Add identity:_ and file_relay:_ events

**Files:**

- Modify: `src/identity/mapping.ts` — emit `identity:set`, `identity:cleared`
- Modify: `src/attachments/` — emit `file_relay:attached/consumed/dropped` (find the appropriate module)
- Test: existing identity/attachment tests

- [ ] **Step 1: Write failing tests**

```ts
it('emits identity:set on setIdentityMapping', () => { ... })
it('emits identity:cleared on clearIdentityMapping', () => { ... })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/identity/`
Expected: FAIL

- [ ] **Step 3: Add emit calls**

In `identity/mapping.ts`, emit `identity:set` and `identity:cleared` with `emitUser(type, userId, { providerUserId, ... })`. Find attachment ingest/consume/drop points and emit `file_relay:*` events.

- [ ] **Step 4: Run tests**

Run: `bun test tests/identity/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/identity/mapping.ts src/attachments/
git commit -m "feat(debug): add identity:* and file_relay:* events"
```

---

### Task 25: Add group*settings:* and config*editor:* events

**Files:**

- Modify: `src/group-settings/state.ts` — emit `group_settings:target_changed`
- Modify: `src/config-editor/` — emit `config_editor:opened/step/closed`
- Test: existing tests

- [ ] **Step 1: Write failing tests**

```ts
it('emits group_settings:target_changed on target change', () => { ... })
it('emits config_editor:opened on editor start', () => { ... })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/group-settings/ && bun test tests/config-editor/`
Expected: FAIL

- [ ] **Step 3: Add emit calls**

- [ ] **Step 4: Run tests**

Run: `bun test tests/group-settings/ && bun test tests/config-editor/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/group-settings/state.ts src/config-editor/
git commit -m "feat(debug): add group_settings:* and config_editor:* events"
```

---

### Task 26: Add auth:group\__ and group_member:_ events

**Files:**

- Modify: `src/group-settings/access.ts` (or `registry.ts`)
- Test: existing tests

- [ ] **Step 1: Write failing tests**

```ts
it('emits auth:group_authorized on group authorization', () => { ... })
it('emits group_member:added on member addition', () => { ... })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/group-settings/`
Expected: FAIL

- [ ] **Step 3: Add emit calls**

Emit `auth:group_authorized/revoked` and `group_member:added/removed` with `emitGroup(type, groupId, ...)`. These trigger AdminVisibility recompute in the collector.

- [ ] **Step 4: Add recompute trigger to state-collector**

On receiving `auth:*` or `group_member:*` events, recompute `AdminVisibility`.

- [ ] **Step 5: Run tests**

Run: `bun test tests/group-settings/ && bun test tests/debug/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/group-settings/access.ts src/debug/state-collector.ts
git commit -m "feat(debug): add auth:group_* and group_member:* events with allow-list recompute"
```

---

### Task 27: Add Context panel

**Files:**

- New: `client/debug/panels/context.ts`
- Modify: `client/debug/dashboard-api.ts`
- Modify: `client/debug/handlers.ts`
- Modify: `src/debug/server.ts` — add `/identity`, `/file-relay` endpoints
- Test: `tests/client/debug/panels/context.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it('renders identity mappings for selected context', () => { ... })
it('renders file-relay contents for selected turn', () => { ... })
it('renders active config-editor sessions', () => { ... })
it('renders authorized groups with member status', () => { ... })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/client/debug/panels/context.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement Context panel**

Sections: identity mappings (lazy `/identity?userId=`), file-relay turn contents (lazy `/file-relay?turnId=`), group settings target, active config-editor/wizard sessions, authorized groups.

- [ ] **Step 4: Add REST endpoints for identity and file-relay**

- [ ] **Step 5: Add SSE handlers for context events**

- [ ] **Step 6: Run tests**

Run: `bun test tests/client/debug/panels/context.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add client/debug/panels/context.ts client/debug/dashboard-api.ts client/debug/handlers.ts src/debug/server.ts
git commit -m "feat(debug): add Context panel with identity/file-relay/auth sections"
```

---

### Task 28: Add turnId filter to log drawer and cross-links

**Files:**

- Modify: `src/debug/server.ts` — add `turnId` param to `/logs`
- Modify: `src/debug/log-buffer.ts` — add `turnId` field to `LogEntry`
- Modify: `client/debug/logs.ts` — add turnId filter UI
- Modify: `client/debug/dashboard-api.ts` — add cross-link action
- Test: `tests/debug/server.test.ts`, `tests/client/debug/logs.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// server.test.ts
it('GET /logs?turnId=... filters by turnId', () => { ... })

// logs.test.ts
it('turnId filter updates log display', () => { ... })
it('cross-link action from Turns panel sets log filter', () => { ... })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/debug/server.test.ts`
Expected: FAIL

- [ ] **Step 3: Add turnId to LogEntry and /logs**

Add optional `turnId` field to `LogEntry` type in `log-buffer.ts`. Update `search()` to filter by `turnId`. Update `handleLogs` in `server.ts` to parse `turnId` query param.

- [ ] **Step 4: Thread turnId into pino child logger**

In `src/message-queue/index.ts` (or `bot.ts`), create a pino child logger with `{ turnId }` for the duration of orchestrator execution. This ensures all structured log lines emitted during a turn carry `turnId`.

- [ ] **Step 5: Add turnId filter to log drawer UI**

Add a `<select>` or input for turnId in the log toolbar. Filter logs client-side by `turnId` field.

- [ ] **Step 6: Add cross-link action to panels**

Each row in Turns, Reminders, Notifications, Tool-failures panels has a "logs" action that sets `state.activeLogFilter.turnId` and scrolls the log drawer into view.

- [ ] **Step 7: Run tests**

Run: `bun test tests/debug/server.test.ts && bun test tests/client/debug/logs.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/debug/server.ts src/debug/log-buffer.ts client/debug/logs.ts client/debug/dashboard-api.ts
git commit -m "feat(debug): add turnId filter to log drawer and cross-links from panels"
```

---

### Task 29: Remove bare emit() after full migration

**Files:**

- Modify: `src/debug/event-bus.ts`
- Test: `tests/debug/event-bus.test.ts`

- [ ] **Step 1: Verify no callers of bare emit() remain**

Search `src/` for `import { emit }` from event-bus (not `emitUser`/`emitGroup`/`emitGlobal`). If any remain, migrate them first.

- [ ] **Step 2: Remove bare emit() and its deprecation path**

Delete the `emit()` function and any one-shot warning logic from `event-bus.ts`.

- [ ] **Step 3: Update event-bus tests**

Remove tests for bare `emit()`. Ensure all tests use typed helpers.

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: PASS

- [ ] **Step 5: Run lint and typecheck**

Run: `bun lint && bun typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/debug/event-bus.ts tests/debug/event-bus.test.ts
git commit -m "feat(debug): remove bare emit() after full migration to typed helpers"
```

---

## Verification Commands

After each task, run:

```bash
bun test tests/debug/          # debug module tests
bun test tests/client/debug/   # dashboard client tests
bun lint                       # oxlint
bun typecheck                  # tsc --noEmit
```

After each phase, run:

```bash
bun test                       # full test suite
bun check:full                 # broader check suite
```
