<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Debug Observability Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix eleven correctness, privacy, and UX defects on the `/debug` observability surface (server `src/debug/` + client `client/debug/`).

**Architecture:** Enforce one privacy invariant — every event reaching `onEvent` carries an honest `scope`; the consumer (`isVisibleToAdmin`) filters. Re-scope the one leaking event, unify the trace key on `scope.userId`, redact the global log buffer at egress, and fix SSE lifecycle + client display defects.

**Tech Stack:** Bun + `bun:test`, TypeScript (strict, `.js` import suffix), Svelte 5 runes (client), pino logging, Server-Sent Events. Branch: `fix/debug-observability-privacy` (already created).

**Design spec:** `docs/superpowers/specs/2026-06-15-debug-observability-fixes-design.md`

---

## File Structure

| File                                               | Responsibility                       | Change                                                                              |
| -------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| `src/llm-orchestrator-support.ts`                  | Tool-result emission                 | Modify — emit `llm:tool_result` user-scoped (A)                                     |
| `src/debug/llm-trace-collector.ts`                 | Assembles LLM traces from events     | Modify — key on `scope.userId` (#2)                                                 |
| `src/debug/state-collector.ts`                     | SSE fan-out, client lifecycle, stats | Modify — pass scope to collector (#2), client-drop unsubscribe (#3), heartbeat (#6) |
| `src/debug/log-redaction.ts`                       | Allowlist-based log redactor         | **Create** — `redactLogEntry` (C)                                                   |
| `src/debug/log-buffer.ts`                          | Ring buffer + `log:entry` emit       | Modify — redact at emit (C)                                                         |
| `src/debug/server.ts`                              | Route table, `/logs`, `/events`      | Modify — redact `/logs` (C), SSE `retry:` hint (#6)                                 |
| `src/debug/turn-assembly.ts`                       | Turn buffers + lookup                | Modify — `findTurnById` checks in-flight (#5)                                       |
| `src/message-queue/queue.ts`                       | Emits `turn:start`                   | Modify — add server `startedAt` (#11)                                               |
| `src/debug/auth-routes.ts`                         | Sign-in claim flow                   | Modify — redirect to `/debug` (#9)                                                  |
| `client/debug/handlers.ts`                         | Client SSE event handlers            | Modify — init ordering (#4), live `startedAt` (#11)                                 |
| `CLAUDE.md`, `docs/deployment/dashboard-access.md` | Operator docs                        | Modify — document `DEBUG_SERVER` gate boundary (#10)                                |

Each task is a self-contained TDD cycle ending in a commit. The repo's write-hook pipeline enforces test-first, so write the failing test before the implementation in every task.

---

## Task 1: Re-scope `llm:tool_result` to the context (Finding A)

**Files:**

- Modify: `src/llm-orchestrator-support.ts`
- Test: `tests/llm-orchestrator-support.test.ts`

- [ ] **Step 1: Update the two existing emit-assertion tests to the new 3-arg signature**

In `tests/llm-orchestrator-support.test.ts`, the deps `emit` mock currently captures `(event, payload)`. Change both occurrences (lines ~20-23 and ~63-66) and the first test's assertion. Replace the first `deps` declaration and its assertion block:

```typescript
const emitCalls: Array<{ event: string; userId: string; payload: unknown }> = []
const deps = {
  emit: (event: string, userId: string, payload: unknown): void => {
    emitCalls.push({ event, userId, payload })
  },
  log: {
    warn: mock(() => {}),
    error: mock(() => {}),
  },
}
```

And replace the `expect(emitCalls[0]).toEqual({...})` block with:

```typescript
expect(emitCalls).toHaveLength(1)
expect(emitCalls[0]).toEqual({
  event: 'llm:tool_result',
  userId: 'ctx-1',
  payload: {
    toolName: 'get_task',
    toolCallId: 'call-1',
    durationMs: 25,
    success: false,
    result: failure,
    error: failure.error,
  },
})
```

For the second test (reply suppressed), update its `deps.emit` signature the same way (add `userId: string` as the second param). For the third test (`handleOrchestratorMessageError`), update its no-op `emit` to `(_event: string, _userId: string, _payload: unknown): void => {}`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/llm-orchestrator-support.test.ts`
Expected: FAIL — the production `emit` still passes 2 args / includes `userId` in the payload, so the new assertion does not match.

- [ ] **Step 3: Change the emitter signature and call sites**

In `src/llm-orchestrator-support.ts`:

Change the import (line 10) to drop the now-unused `emitGlobal`:

```typescript
import { emitUser } from './debug/event-bus.js'
```

Change the deps interface (lines ~29-35) and default (line 37):

```typescript
export interface LlmOrchestratorSupportDeps {
  emit: (event: string, userId: string, payload: Record<string, unknown>) => void
  log: {
    warn: (context: LogContext, message: string) => void
    error: (context: LogContext, message: string) => void
  }
}

const defaultDeps: LlmOrchestratorSupportDeps = { emit: emitUser, log }
```

Change `emitToolFailure` (lines ~64-72) to emit user-scoped without `userId` in the payload:

```typescript
deps.emit('llm:tool_result', contextId, {
  toolName,
  toolCallId,
  durationMs: event.durationMs,
  success: false,
  result: toolFailure,
  error: toolFailure.error,
})
```

Change `emitToolSuccess` (lines ~89-96) the same way:

```typescript
deps.emit('llm:tool_result', contextId, {
  toolName,
  toolCallId,
  durationMs: event.durationMs,
  success: true,
  result: event.output,
})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/llm-orchestrator-support.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm-orchestrator-support.ts tests/llm-orchestrator-support.test.ts
git commit -m "fix(debug): emit llm:tool_result user-scoped to stop cross-context leak (A)"
```

---

## Task 2: Unify trace key on `scope.userId` (Findings #2, B)

**Files:**

- Modify: `src/debug/llm-trace-collector.ts`
- Modify: `src/debug/state-collector.ts`
- Test: `tests/debug/llm-trace-collector.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/debug/llm-trace-collector.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { Scope } from '../../src/debug/event-bus.js'
import { handleLlmTraceEvent, type LlmTrace } from '../../src/debug/llm-trace-collector.js'

const userScope = (userId: string): Scope => ({ kind: 'user', userId })

const callbacks = (pushed: LlmTrace[]) => ({
  pushTrace: (t: LlmTrace): void => {
    pushed.push(t)
  },
  broadcastTrace: (): void => {},
})

describe('handleLlmTraceEvent', () => {
  let pushed: LlmTrace[]
  let stats: { totalLlmCalls: number; totalToolCalls: number }

  beforeEach(() => {
    pushed = []
    stats = { totalLlmCalls: 0, totalToolCalls: 0 }
  })

  test('accumulates tool calls and userId from scope across start/tool_result/end', () => {
    const ctx = 'u:42'
    handleLlmTraceEvent(
      {
        type: 'llm:start',
        timestamp: 1,
        scope: userScope(ctx),
        data: { model: 'm' },
      },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      {
        type: 'llm:tool_result',
        timestamp: 2,
        scope: userScope(ctx),
        data: {
          toolName: 'get_task',
          toolCallId: 'c1',
          durationMs: 5,
          success: true,
        },
      },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      {
        type: 'llm:end',
        timestamp: 3,
        scope: userScope(ctx),
        data: { tokenUsage: { inputTokens: 10, outputTokens: 2 }, steps: 1 },
      },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed).toHaveLength(1)
    expect(pushed[0]!.userId).toBe(ctx)
    expect(pushed[0]!.toolCalls).toHaveLength(1)
    expect(pushed[0]!.toolCalls[0]!.toolName).toBe('get_task')
    expect(stats.totalToolCalls).toBe(1)
  })

  test('concurrent contexts keep separate pending traces', () => {
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 1, scope: userScope('a'), data: {} },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:start', timestamp: 1, scope: userScope('b'), data: {} },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      {
        type: 'llm:tool_result',
        timestamp: 2,
        scope: userScope('a'),
        data: { toolName: 'ta', toolCallId: 'x', durationMs: 1, success: true },
      },
      callbacks(pushed),
      stats,
      () => {},
    )
    handleLlmTraceEvent(
      { type: 'llm:end', timestamp: 3, scope: userScope('b'), data: {} },
      callbacks(pushed),
      stats,
      () => {},
    )

    expect(pushed).toHaveLength(1)
    expect(pushed[0]!.userId).toBe('b')
    expect(pushed[0]!.toolCalls).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/llm-trace-collector.test.ts`
Expected: FAIL — `TraceEvent` has no `scope`; the collector keys on `data.userId` (empty), so `userId` is `''` and `toolCalls` is empty.

- [ ] **Step 3: Key the collector on `scope.userId`**

In `src/debug/llm-trace-collector.ts`:

Add the scope import at the top:

```typescript
import type { Scope } from './event-bus.js'
```

Change the `TraceEvent` type (line ~49) to include scope:

```typescript
type TraceEvent = {
  type: string
  timestamp: number
  scope: Scope
  data: Record<string, unknown>
}
```

Add a key helper above `handleLlmTraceEvent`:

```typescript
function traceKey(event: TraceEvent): string {
  return event.scope.kind === 'user' ? event.scope.userId : str(event.data['userId'])
}
```

In `handleLlmTraceEvent` (line ~146), replace `const userId = str(event.data['userId'])` with:

```typescript
const userId = traceKey(event)
```

- [ ] **Step 4: Pass the scope-carrying event from `state-collector`**

`onEvent` in `src/debug/state-collector.ts` (line ~106) already passes the full `DebugEvent` (which has `scope`) to `handleLlmTraceEvent`. Confirm no change is needed there; the widened `TraceEvent` type is structurally satisfied by `DebugEvent`. If the TypeScript compiler reports a mismatch, it is because `DebugEvent.data` is `Record<string, unknown>` and `scope` is `Scope` — both already match. No code edit expected; this step is a typecheck gate.

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/debug/llm-trace-collector.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/debug/llm-trace-collector.ts tests/debug/llm-trace-collector.test.ts
git commit -m "fix(debug): key LLM traces on scope.userId so tool calls + userId populate (#2, B)"
```

---

## Task 3: Create the log redactor (Finding C, part 1)

**Files:**

- Create: `src/debug/log-redaction.ts`
- Test: `tests/debug/log-redaction.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/debug/log-redaction.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { LogEntry } from '../../src/debug/log-buffer.js'
import { redactLogEntry } from '../../src/debug/log-redaction.js'

const base: LogEntry = {
  level: 30,
  time: '2026-06-15T00:00:00.000Z',
  msg: 'Message received from user',
}

describe('redactLogEntry', () => {
  test('keeps allowlisted fields, drops everything else', () => {
    const entry: LogEntry = {
      ...base,
      scope: 'orchestrator',
      turnId: 't_9',
      messageLength: 8,
      userText: 'buy milk',
      chatUserId: '123',
      contextId: 'u:123',
    }
    expect(redactLogEntry(entry)).toEqual({
      level: 30,
      time: '2026-06-15T00:00:00.000Z',
      msg: 'Message received from user',
      scope: 'orchestrator',
      turnId: 't_9',
      messageLength: 8,
    })
  })

  test('redacts msg not in the safe-template set', () => {
    expect(redactLogEntry({ ...base, msg: 'fetched https://x.com/abc' }).msg).toBe('[redacted]')
  })

  test('keeps a safe-template msg verbatim', () => {
    expect(redactLogEntry({ ...base, msg: 'Tool execution failed' }).msg).toBe('Tool execution failed')
  })

  test('drops free-text error but keeps errorType/errorCode', () => {
    const out = redactLogEntry({
      ...base,
      error: 'TASK-9 buy milk failed',
      errorType: 'provider',
      errorCode: 'NOT_FOUND',
    })
    expect(out).not.toHaveProperty('error')
    expect(out.errorType).toBe('provider')
    expect(out.errorCode).toBe('NOT_FOUND')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/log-redaction.test.ts`
Expected: FAIL — module `src/debug/log-redaction.ts` does not exist.

- [ ] **Step 3: Implement the redactor**

Create `src/debug/log-redaction.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LogEntry } from './log-buffer.js'

const REDACTED = '[redacted]'

/** Non-identifying fields safe to surface in the /debug + /logs egress. Default-deny: anything not here is dropped. */
const ALLOWED_FIELDS = new Set<string>([
  'level',
  'time',
  'scope',
  'turnId',
  'durationMs',
  'messageLength',
  'stepCount',
  'toolCount',
  'messageCount',
  'count',
  'size',
  'capacity',
  'tickCount',
  'statusCode',
  'ok',
  'success',
  'finishReason',
  'errorType',
  'errorCode',
  'toolName',
])

/** Known content-free static log messages shown verbatim; every other msg is redacted. Extend as new safe templates appear. */
const SAFE_MSG_TEMPLATES = new Set<string>(['Message received from user', 'Tool execution failed'])

/** Allowlist-redact a log entry for the privacy-constrained /debug + /logs egress. Pure; never mutates the input. */
export function redactLogEntry(entry: LogEntry): LogEntry {
  const out: LogEntry = {
    level: entry.level,
    time: entry.time,
    msg: SAFE_MSG_TEMPLATES.has(entry.msg) ? entry.msg : REDACTED,
  }
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'level' || key === 'time' || key === 'msg') continue
    if (ALLOWED_FIELDS.has(key)) out[key] = value
  }
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/debug/log-redaction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/log-redaction.ts tests/debug/log-redaction.test.ts
git commit -m "feat(debug): add allowlist log redactor for /debug egress (C)"
```

---

## Task 4: Apply redaction at both egress points (Finding C, part 2)

**Files:**

- Modify: `src/debug/log-buffer.ts`
- Modify: `src/debug/server.ts`
- Test: `tests/debug/log-buffer.test.ts`, `tests/debug/logs-route-redaction.test.ts` (create)

- [ ] **Step 1: Write the failing buffer-emit test**

Append to `tests/debug/log-buffer.test.ts` (inside the top-level, after the existing `describe` blocks):

```typescript
describe('log:entry emit redaction', () => {
  test('redacts sensitive fields in the broadcast payload but keeps them in the buffer', () => {
    const buf = new LogRingBuffer(10)
    const events: DebugEvent[] = []
    const listener = (e: DebugEvent): void => {
      events.push(e)
    }
    subscribe(listener)
    try {
      buf.push(
        makeEntry({
          msg: 'Message received from user',
          userText: 'secret',
          scope: 'bot',
          messageLength: 6,
        }),
      )
    } finally {
      unsubscribe(listener)
    }

    expect(events).toHaveLength(1)
    expect(events[0]!.data).not.toHaveProperty('userText')
    expect(events[0]!.data['messageLength']).toBe(6)
    // Buffer retains the full entry
    expect(buf.entries()[0]).toHaveProperty('userText', 'secret')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/debug/log-buffer.test.ts`
Expected: FAIL — the emitted `log:entry` data still contains `userText`.

- [ ] **Step 3: Redact at the buffer emit boundary**

In `src/debug/log-buffer.ts`, add the import:

```typescript
import { redactLogEntry } from './log-redaction.js'
```

In `push` (line ~60), change the emit to redact:

```typescript
emitGlobal('log:entry', redactLogEntry(entry) as Record<string, unknown>)
```

(The line `this.buffer.push(entry)` / wrap-around storage above is unchanged — the buffer keeps the full entry.)

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test tests/debug/log-buffer.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `/logs` route test**

Create `tests/debug/logs-route-redaction.test.ts` (mirrors the real-server + session pattern from `billing-route.test.ts`):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { SESSION_COOKIE_NAME } from '../../src/dashboard-auth/cookie.js'
import { mintSession } from '../../src/dashboard-auth/index.js'
import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { logBuffer } from '../../src/debug/log-buffer.js'
import { startDebugServer, stopDebugServer } from '../../src/debug/server.js'
import { getTestDb, mockLogger, setupTestDb } from '../utils/test-helpers.js'

const TEST_PORT = 19233
const ADMIN = 'admin-user'

describe('/logs redaction', () => {
  let cookie: string

  beforeAll(async () => {
    mockLogger()
    await setupTestDb()
    setStoreDb(getTestDb())
    process.env['DEBUG_PORT'] = String(TEST_PORT) // getPort() reads DEBUG_PORT; bind a unique port for this worker
    startDebugServer(ADMIN, { debugEnabled: true })
    const setCookie = mintSession(ADMIN, { secure: false }).setCookie
    cookie = `${SESSION_COOKIE_NAME}=${setCookie.split(';')[0]!.split('=')[1]!}`
    logBuffer.clear()
    logBuffer.push({
      level: 30,
      time: '2026-06-15T00:00:00.000Z',
      msg: 'Message received from user',
      userText: 'top secret',
      scope: 'bot',
      messageLength: 10,
    })
  })

  afterAll(() => {
    stopDebugServer()
    logBuffer.clear()
    delete process.env['DEBUG_PORT']
  })

  test('does not return sensitive fields', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/logs`, {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<Record<string, unknown>>
    expect(body).toHaveLength(1)
    expect(body[0]).not.toHaveProperty('userText')
    expect(body[0]!.messageLength).toBe(10)
    expect(body[0]!.msg).toBe('Message received from user')
  })
})
```

Note: `TEST_PORT` (19233) must be unique across the repo's real-server test files — grep `TEST_PORT` under `tests/` and pick a free value if it collides.

- [ ] **Step 6: Run it to verify it fails**

Run: `bun test tests/debug/logs-route-redaction.test.ts`
Expected: FAIL — `/logs` returns the raw entry including `userText`.

- [ ] **Step 7: Redact the `/logs` response**

In `src/debug/server.ts`, add the import:

```typescript
import { redactLogEntry } from './log-redaction.js'
```

In `handleLogs` (line ~98-108), map the results through the redactor:

```typescript
return jsonResponse(results.map(redactLogEntry))
```

- [ ] **Step 8: Run it to verify it passes**

Run: `bun test tests/debug/logs-route-redaction.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/debug/log-buffer.ts src/debug/server.ts tests/debug/log-buffer.test.ts tests/debug/logs-route-redaction.test.ts
git commit -m "fix(debug): redact log buffer at /logs and log:entry egress (C)"
```

---

## Task 5: Fix SSE subscription leak on enqueue failure (Finding #3)

**Files:**

- Modify: `src/debug/state-collector.ts`
- Test: `tests/debug/state-collector-lifecycle.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/debug/state-collector-lifecycle.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { emitGlobal, subscribeCountForTest } from '../../src/debug/event-bus.js'
import { addClient, init, removeClient } from '../../src/debug/state-collector.js'

// Track controllers so afterEach tears down shared module singletons (clients set,
// onEvent subscription, heartbeat interval) between tests in this file.
const added: ReadableStreamDefaultController[] = []
const track = (c: ReadableStreamDefaultController): ReadableStreamDefaultController => {
  added.push(c)
  return c
}

afterEach(() => {
  for (const c of added.splice(0)) removeClient(c)
})

describe('state-collector client lifecycle', () => {
  test('last client dying during broadcast unsubscribes onEvent', () => {
    init('admin')
    let alive = true
    // Succeeds on the initial state:init enqueue (so onEvent subscribes), then throws.
    const controller = track({
      enqueue: (): void => {
        if (!alive) throw new Error('closed')
      },
    } as unknown as ReadableStreamDefaultController)

    addClient(controller)
    expect(subscribeCountForTest()).toBe(1)

    alive = false
    emitGlobal('log:entry', { level: 30, time: 't', msg: 'x' }) // broadcast -> enqueue throws -> removeClient
    expect(subscribeCountForTest()).toBe(0)
  })
})
```

- [ ] **Step 2: Add the test seam to `event-bus.ts`**

In `src/debug/event-bus.ts`, export a listener-count helper for tests:

```typescript
export function subscribeCountForTest(): number {
  return listeners.size
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/debug/state-collector-lifecycle.test.ts`
Expected: FAIL — `broadcast`'s catch does a bare `clients.delete` without unsubscribing, so after the dead client is dropped a listener remains (`subscribeCountForTest()` is 1, not 0).

- [ ] **Step 4: Route enqueue-failure drops through `removeClient`**

In `src/debug/state-collector.ts`:

In `broadcast` (line ~115-124), change the catch:

```typescript
function broadcast(event: DebugEvent): void {
  const payload = formatSse(event)
  for (const client of clients) {
    try {
      client.enqueue(payload)
    } catch {
      removeClient(client)
    }
  }
}
```

In `sendTo` (line ~126-132), change the catch:

```typescript
function sendTo(controller: ReadableStreamDefaultController, event: DebugEvent): void {
  try {
    controller.enqueue(formatSse(event))
  } catch {
    removeClient(controller)
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/debug/state-collector-lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/debug/state-collector.ts src/debug/event-bus.ts tests/debug/state-collector-lifecycle.test.ts
git commit -m "fix(debug): unsubscribe onEvent when last SSE client dies on enqueue (#3)"
```

---

## Task 6: SSE heartbeat (Finding #6)

**Files:**

- Modify: `src/debug/state-collector.ts`
- Modify: `src/debug/server.ts`
- Test: `tests/debug/state-collector-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

Add `pingClientsForTest` to the existing `state-collector` import at the top of the file, then append this `describe` block (it reuses the `track`/`afterEach` teardown already in the file):

```typescript
// import line becomes:
// import { addClient, init, pingClientsForTest, removeClient } from '../../src/debug/state-collector.js'

describe('state-collector heartbeat', () => {
  test('ping reaches live clients and drops dead ones', () => {
    init('admin')
    const enqueued: Uint8Array[] = []
    const live = track({
      enqueue: (c: Uint8Array): void => void enqueued.push(c),
    } as unknown as ReadableStreamDefaultController)

    addClient(live) // sends state:init (1 enqueue), subscribes onEvent, starts heartbeat
    pingClientsForTest()

    // The live client received the state:init frame plus a comment-frame ping.
    expect(enqueued.length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/debug/state-collector-lifecycle.test.ts`
Expected: FAIL — `pingClientsForTest` is not exported.

- [ ] **Step 3: Implement the heartbeat**

In `src/debug/state-collector.ts`, near the top (after `const encoder = new TextEncoder()`):

```typescript
const HEARTBEAT_MS = 15000
const PING_FRAME = encoder.encode(': ping\n\n')
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function pingClients(): void {
  for (const client of clients) {
    try {
      client.enqueue(PING_FRAME)
    } catch {
      removeClient(client)
    }
  }
}

function startHeartbeat(): void {
  if (heartbeatTimer !== null) return
  heartbeatTimer = setInterval(pingClients, HEARTBEAT_MS)
}

function stopHeartbeat(): void {
  if (heartbeatTimer === null) return
  clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

/** @public -- test seam for the heartbeat ping path */
export function pingClientsForTest(): void {
  pingClients()
}
```

In `addClient`, where it does `if (clients.size === 1) { subscribe(onEvent) }`, also start the heartbeat:

```typescript
if (clients.size === 1) {
  subscribe(onEvent)
  startHeartbeat()
}
```

In `removeClient`, where it does `if (clients.size === 0) { unsubscribe(onEvent) }`, also stop it:

```typescript
if (clients.size === 0) {
  unsubscribe(onEvent)
  stopHeartbeat()
}
```

- [ ] **Step 4: Add the SSE `retry:` hint**

In `src/debug/server.ts`, in `handleEvents`, enqueue a retry hint on stream start so reconnects are paced. In the `start(controller)` body, after `addClient(controller)`:

```typescript
controller.enqueue(new TextEncoder().encode('retry: 3000\n\n'))
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/debug/state-collector-lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/debug/state-collector.ts src/debug/server.ts tests/debug/state-collector-lifecycle.test.ts
git commit -m "feat(debug): SSE heartbeat + retry hint to survive idle proxies (#6)"
```

---

## Task 7: `findTurnById` resolves in-flight turns (Finding #5)

**Files:**

- Modify: `src/debug/turn-assembly.ts`
- Test: `tests/debug/turn-assembly.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/debug/turn-assembly.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { DebugEvent } from '../../src/debug/event-bus.js'
import { findTurnById, handleTurnAssembly, resetTurnBuffers } from '../../src/debug/turn-assembly.js'

const startEvent = (turnId: string): DebugEvent => ({
  type: 'turn:start',
  timestamp: 1,
  scope: { kind: 'user', userId: 'u' },
  data: { turnId, incomingMessageCount: 1 },
})

describe('findTurnById', () => {
  beforeEach(() => {
    resetTurnBuffers()
  })

  test('resolves a still-running (in-flight) turn', () => {
    handleTurnAssembly(startEvent('t-run'), () => {})
    const turn = findTurnById('t-run')
    expect(turn).toBeDefined()
    expect(turn!.status).toBe('running')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/debug/turn-assembly.test.ts`
Expected: FAIL — `findTurnById` only searches `recentTurns`, so an in-flight turn returns `undefined`.

- [ ] **Step 3: Check in-flight first**

In `src/debug/turn-assembly.ts`, change `findTurnById` (line ~87-89):

```typescript
export function findTurnById(turnId: string): Turn | undefined {
  return inFlightTurns.get(turnId) ?? recentTurns.find((t) => t.turnId === turnId)
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test tests/debug/turn-assembly.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/turn-assembly.ts tests/debug/turn-assembly.test.ts
git commit -m "fix(debug): resolve in-flight turns in findTurnById (#5)"
```

---

## Task 8: Server `startedAt` on `turn:start` (Finding #11, server side)

**Files:**

- Modify: `src/message-queue/queue.ts`
- Test: `tests/message-queue/queue.test.ts` (or the file that asserts `turn:start`; locate first)

- [ ] **Step 1: Locate the existing `turn:start` assertion**

Run: `rg -n "turn:start" tests/`
If a test asserts the `turn:start` payload with `toEqual`, update it to `expect.objectContaining({...})` so the added `startedAt` does not break it. If it uses `objectContaining` already, no test change is needed and you add a fresh assertion in Step 2.

- [ ] **Step 2: Write/extend the failing test**

Add an assertion (in the located queue test, or create `tests/message-queue/queue-turn-start.test.ts` following that file's setup) verifying the emitted `turn:start` data includes a numeric `startedAt`:

```typescript
test('turn:start payload carries a server startedAt timestamp', () => {
  // ...drive the queue to flush a coalesced turn (reuse the file's existing harness)...
  const startEvent = emittedEvents.find((e) => e.type === 'turn:start')
  expect(startEvent).toBeDefined()
  expect(typeof startEvent!.data.startedAt).toBe('number')
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test tests/message-queue/`
Expected: FAIL — `turn:start` data has no `startedAt`.

- [ ] **Step 4: Add `startedAt` to the emit**

In `src/message-queue/queue.ts`, the `turn:start` emit (lines ~221-231), add `startedAt`:

```typescript
this.emitScoped(
  'turn:start',
  userId,
  {
    turnId: result.turnId,
    contextType: result.contextType,
    incomingMessageCount: textCount,
    startedAt: Date.now(),
  },
  result.turnId,
  result.contextType,
)
```

- [ ] **Step 5: Run it to verify it passes**

Run: `bun test tests/message-queue/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/message-queue/queue.ts tests/message-queue/
git commit -m "feat(debug): stamp server startedAt on turn:start (#11 server)"
```

---

## Task 9: Client init ordering + live `startedAt` (Findings #4, #11 client side)

**Files:**

- Modify: `client/debug/handlers.ts`
- Test: `tests/client/debug/handlers.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/client/debug/handlers.test.ts` (use the file's existing `freshState()` helper):

```typescript
test('handleStateInit orders turns/notifications/toolFailures newest-first', () => {
  const state = freshState()
  handleStateInit(state, {
    recentTurns: [
      {
        turnId: 'old',
        scope: { kind: 'user', userId: 'u' },
        startedAt: 1,
        status: 'ok',
        incomingMessageCount: 1,
        toolCalls: [],
      },
      {
        turnId: 'new',
        scope: { kind: 'user', userId: 'u' },
        startedAt: 2,
        status: 'ok',
        incomingMessageCount: 1,
        toolCalls: [],
      },
    ],
  } as never)
  expect(state.turns[0]!.turnId).toBe('new')
})

test('handleTurnStart uses server startedAt when present', () => {
  const state = freshState()
  handleTurnStart(state, {
    turnId: 't1',
    startedAt: 1234,
    scope: { kind: 'user', userId: 'u' },
  })
  expect(state.turns[0]!.startedAt).toBe(1234)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test:client tests/client/debug/handlers.test.ts`
Expected: FAIL — init keeps server (oldest-first) order; `handleTurnStart` stamps `Date.now()`.

- [ ] **Step 3: Reverse the three buffers on init**

In `client/debug/handlers.ts`, in `handleStateInit`, change the turns/notifications/toolFailures assignments (lines ~63-71) to reverse, mirroring `llmTraces`:

```typescript
if (Array.isArray(d.recentTurns)) {
  state.turns = d.recentTurns
    .map(safeParseTurn)
    .filter((t): t is Turn => t !== null)
    .reverse()
}
if (Array.isArray(d.recentNotifications)) {
  state.notifications = d.recentNotifications
    .map(safeParseNotification)
    .filter((n): n is Notification => n !== null)
    .reverse()
}
if (Array.isArray(d.recentToolFailures)) {
  state.toolFailures = d.recentToolFailures
    .map(safeParseToolFailure)
    .filter((f): f is ToolFailure => f !== null)
    .reverse()
}
```

- [ ] **Step 4: Use server `startedAt` in live turn start**

In `client/debug/handlers.ts`, `handleTurnStart` (line ~146-159), replace `startedAt: Date.now()` with a server-value-preferring read:

```typescript
const startedAt = typeof d['startedAt'] === 'number' ? d['startedAt'] : Date.now()
state.turns.unshift({
  turnId,
  scope: parseScope(d['scope']),
  startedAt,
  status: 'running',
  incomingMessageCount,
  toolCalls: [],
})
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test:client tests/client/debug/handlers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/debug/handlers.ts tests/client/debug/handlers.test.ts
git commit -m "fix(debug): newest-first init ordering + server turn startedAt (#4, #11 client)"
```

---

## Task 10: Sign-in redirect to `/debug` (Finding #9)

**Files:**

- Modify: `src/debug/auth-routes.ts`
- Test: `tests/debug/auth-routes.test.ts`

- [ ] **Step 1: Write/extend the failing test**

In `tests/debug/auth-routes.test.ts`, find the POST `/auth/claim` success test (it asserts the 302 `Location`). Add or update an assertion:

```typescript
expect(res.status).toBe(302)
expect(res.headers.get('Location')).toBe('/debug')
```

If the existing test asserts `'/admin'`, change it to `'/debug'`.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/debug/auth-routes.test.ts`
Expected: FAIL — handler redirects to `/admin`.

- [ ] **Step 3: Change the redirect target**

In `src/debug/auth-routes.ts`, in `handleAuthClaimConfirm` (line ~103), change:

```typescript
      Location: '/debug',
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test tests/debug/auth-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/auth-routes.ts tests/debug/auth-routes.test.ts
git commit -m "fix(debug): land dashboard sign-in on /debug, not /admin (#9)"
```

---

## Task 11: Document the `DEBUG_SERVER` gate boundary (Finding #10)

**Files:**

- Modify: `CLAUDE.md`
- Modify: `docs/deployment/dashboard-access.md`

- [ ] **Step 1: Add the clarification to `CLAUDE.md`**

In the "Debug/settings server surfaces" section of `CLAUDE.md`, add a sentence:

```markdown
- **`DEBUG_SERVER` gate scope:** `debugEnabled=false` only 404s the engineer live-observability subset (`DEBUG_ONLY_PATHS`: `/debug`, `/events`, `/logs`, `/logs/stats`, `/dashboard`, `/turns/*`). The operator surfaces (`/admin`, `/billing`, `/stats`, instance routes) remain reachable with a valid dashboard session even when `DEBUG_SERVER=false`, because operators must manage LLM creds/instances in production. Authorization is the session cookie, not `DEBUG_SERVER`.
```

- [ ] **Step 2: Add the same note to the deployment doc**

In `docs/deployment/dashboard-access.md`, add a short subsection mirroring the above so operators understand what is/isn't exposed when `DEBUG_SERVER` is off.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/deployment/dashboard-access.md
git commit -m "docs(debug): clarify DEBUG_SERVER gate covers only live-observability paths (#10)"
```

---

## Task 12: Full-suite verification

- [ ] **Step 1: Run the server suite**

Run: `bun run test`
Expected: PASS (all suites green).

- [ ] **Step 2: Run the client suite**

Run: `bun test:client`
Expected: PASS.

- [ ] **Step 3: Run the full check**

Run: `bun check:full`
Expected: lint, typecheck, format, license-headers all green.

- [ ] **Step 4: Manual smoke (optional but recommended)**

With `DEBUG_SERVER=true`, sign in via `/dashboard`, confirm: (a) sign-in lands on `/debug`; (b) a DM turn shows tool calls and a populated User ID in the trace detail; (c) `/logs` shows `[redacted]` for non-template messages and no `userText`/`chatUserId`; (d) the stream stays open >30s behind a proxy (heartbeat).

---

## Notes for the Implementer

- **Import suffix:** always `.js` in TypeScript import paths, even for `.ts` sources.
- **No lint-disable / ts-ignore:** the write-hook blocks them; fix the root cause.
- **Test isolation:** each test file runs in its own worker (`bun run test` is `--parallel`). Do not rely on cross-file state; `resetTurnBuffers()` / `logBuffer.clear()` in `beforeEach`/`afterAll` where you touch shared module singletons.
- **Out of scope (do not change):** group-context visibility stays disabled (intended privacy); the redundant `turn:end` + `turn:summary` double-broadcast (#7) is left as-is.
- The branch `fix/debug-observability-privacy` already exists and holds the design-spec commit; keep committing onto it.
