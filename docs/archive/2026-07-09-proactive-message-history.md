<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proactive Message History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bot's content-bearing proactive messages (announcements, "recurring task created" pings, external `notify` pushes, deferred-alert error notices) visible to the LLM on the next turn by recording them into the correct thread-scoped `conversation_history` bucket, and stop the turn-error path from discarding the user's own triggering message.

**Architecture:** Introduce one small unit, `recordProactiveInHistory(storageContextId, markdown)`, that appends a faithful `assistant` `ModelMessage` to history, best-effort (a persist failure is logged and swallowed, never affecting delivery). Every proactive send site calls it **only after a confirmed successful delivery** and **only with a correctly-scoped `pi:...` storage context id**. We do NOT reroute or unify the existing delivery / platform-instance-resolution code — that differs per site and is risky to change; we only add the record step. Separately, fix `handleLlmTurnError` so its rollback preserves the user's just-appended turn message.

> **Note on the approved spec.** The spec named a `sendRecordedProactive` send-and-record wrapper. Investigation revealed two things that make a _persist-only_ unit the correct realization of the spec's intent (Approach B): (1) delivery paths and platform-instance resolution genuinely differ across call sites, so unifying delivery risks regressions; (2) the `getStorageContextId` fallback does not reproduce the scoped `pi:...` history key, so persistence must use an explicitly-scoped id, computed at each site. The centralized concern — faithful framing + best-effort + correct bucket — lives in `recordProactiveInHistory`. This is a within-Approach-B refinement, not a design change.

**Tech Stack:** TypeScript (strict, `.js` import extensions), Bun runtime, `bun:test` test runner, Vercel AI SDK `ModelMessage` type, pino logging.

---

## Background facts (verified against the codebase)

- History key ("storage context id") for every real message is the scoped form built by `toScopedContextId({ platformInstanceId, nativeContextId })` → `pi:<base64url(instance)>:ctx:<base64url(native)>`, or `toScopedThreadContextId(...)` with a `:thread:<base64url(threadId)>` suffix. Source: `src/chat/scoped-context.ts:16-35`, `src/auth.ts:24-41`.
- `appendHistory(storageContextId, ModelMessage[])` (`src/history.ts:29-32`) is the persistence primitive; `getCachedHistory` reads it back next turn. An assistant text message is `{ role: 'assistant', content: '<string>' }` (Vercel AI SDK `ModelMessage`, imported from `'ai'`).
- `getStorageContextId(target)` (`src/deferred-prompts/proactive-llm-helpers.ts:163-167`) returns `target.storageContextId` when set, else falls back to the **bare** `target.contextId` — which is NOT the scoped `pi:...` key. Only trust it when `target.storageContextId` is set (poller targets always set it; `dmTarget(...)` never does).
- Trimming: `recordProactiveInHistory` intentionally does not trigger history-trim. Proactive messages are infrequent, and the next normal turn's `appendAssistantTurnHistory` runs the trim check over the combined history. No `mainModel`/`configContextId` is available at most proactive call sites, so wiring trim here would add coupling for no benefit.

## File Structure

- **Create:** `src/proactive-history.ts` — the single record unit `recordProactiveInHistory`. One responsibility: turn a delivered proactive message into a faithful, best-effort history append at a caller-supplied scoped context id.
- **Create:** `tests/proactive-history.test.ts` — unit tests for the record unit.
- **Modify:** `src/deferred-prompts/poller.ts` — record the error-branch notices (both `executeScheduledPromptsForGroup` and `executeSingleAlert`).
- **Modify:** `src/debug/notify-route.ts` — record after a successful `notify` delivery.
- **Modify:** `src/scheduler-recurring.ts` — record the "recurring task created" notification.
- **Modify:** `src/commands/announce-broadcast.ts` — record each admin free-text broadcast DM.
- **Modify:** `src/announcements/broadcast.ts` — record each release-notes DM and group send (in `defaultDeps`).
- **Modify:** `src/announcements.ts` — record the admin review notice.
- **Modify:** `src/llm-orchestrator-support.ts` + `src/llm-orchestrator.ts` — turn-error rollback fix.
- **Modify (tests):** one test file per modified source file, adding a focused case that asserts the record wiring.

## Testing convention (applies to every task)

- Runner: `bun:test`. Import `{ describe, test, expect, spyOn, beforeEach }` from `'bun:test'`.
- Run a single file: `bun test <path>` (honors the `tests/setup.ts` + `tests/mock-reset.ts` preload automatically).
- Mock module functions with `spyOn(moduleNamespace, 'exportName').mockImplementation(...)`, tracked and restored in `afterEach` (see Task 1 and the existing `tests/deferred-prompts/proactive-llm-helpers.test.ts` idiom). ESM live bindings mean a SUT that does `import { recordProactiveInHistory } from '...'` will call the spied version.
- Always `mockLogger()` (from `tests/utils/test-helpers.js`) in tests that exercise code paths which log.

---

### Task 1: The `recordProactiveInHistory` unit

**Files:**

- Create: `src/proactive-history.ts`
- Test: `tests/proactive-history.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/proactive-history.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import type { ModelMessage } from 'ai'
import { recordProactiveInHistory } from '../src/proactive-history.js'
import { mockLogger } from './utils/test-helpers.js'

describe('recordProactiveInHistory', () => {
  test('appends a faithful assistant message at the given scoped context id', () => {
    mockLogger()
    const calls: Array<{ id: string; msgs: readonly ModelMessage[] }> = []
    recordProactiveInHistory('pi:inst:ctx:user', 'Release v6.8.0 is out', {
      persist: (id, msgs) => calls.push({ id, msgs }),
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.id).toBe('pi:inst:ctx:user')
    expect(calls[0]!.msgs).toEqual([{ role: 'assistant', content: 'Release v6.8.0 is out' }])
  })

  test('is best-effort: swallows a persist failure and does not throw', () => {
    mockLogger()
    expect(() =>
      recordProactiveInHistory('pi:inst:ctx:user', 'hi', {
        persist: () => {
          throw new Error('db down')
        },
      }),
    ).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/proactive-history.test.ts`
Expected: FAIL — cannot resolve `../src/proactive-history.js` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `src/proactive-history.ts`:

```ts
import type { ModelMessage } from 'ai'

import { appendHistory } from './history.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'proactive-history' })

export interface RecordProactiveDeps {
  persist: (storageContextId: string, messages: readonly ModelMessage[]) => void
}

const defaultDeps: RecordProactiveDeps = { persist: appendHistory }

/**
 * Record a proactively-sent bot message into the thread's conversation history
 * so the LLM sees it on the next turn.
 *
 * Call ONLY after the message was successfully delivered, and ONLY with a
 * correctly-scoped storage context id (the `pi:<inst>:ctx:<native>[:thread:...]`
 * form produced by `toScopedContextId` / `getThreadScopedStorageContextId` — the
 * same bucket the user's normal conversation uses). Never pass a bare native id.
 *
 * Best-effort: a persistence failure is logged and swallowed so it can never
 * affect delivery. Does not trigger history trimming — the next normal turn does.
 */
export function recordProactiveInHistory(
  storageContextId: string,
  markdown: string,
  deps: RecordProactiveDeps = defaultDeps,
): void {
  try {
    deps.persist(storageContextId, [{ role: 'assistant', content: markdown }])
    log.debug({ storageContextId }, 'proactive message recorded to history')
  } catch (error) {
    log.warn(
      { storageContextId, error: error instanceof Error ? error.message : String(error) },
      'failed to record proactive message to history',
    )
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/proactive-history.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/proactive-history.ts tests/proactive-history.test.ts
git commit -m "feat(proactive): add recordProactiveInHistory unit"
```

---

### Task 2: Record deferred-prompt / alert error-branch notices

**Files:**

- Modify: `src/deferred-prompts/poller.ts` (error branches at ~L76-90 and ~L169-182)
- Test: `tests/deferred-prompts/poller.test.ts` (add cases; create the file if it does not exist, mirroring the existing deferred-prompts test harness)

Context: the success path already persists inside `dispatchExecution`. Only the `catch` branches (where `dispatchExecution` threw before any persist) send an unpersisted error notice. `execCtx.deliveryTarget` / `alert.deliveryTarget` always carry an explicit scoped `storageContextId`, so `getStorageContextId(...)` returns the correct bucket.

- [ ] **Step 1: Write the failing test**

Add to `tests/deferred-prompts/poller.test.ts`. Mirror the file's existing setup for building `chat`, `prompts`, and `buildProviderFn`; the new assertions are:

```ts
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import * as proactiveHistory from '../../src/proactive-history.js'
import * as delivery from '../../src/deferred-prompts/proactive-delivery.js'
import * as dispatch from '../../src/deferred-prompts/proactive-llm.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('poller error-branch history recording', () => {
  const spies: Array<{ mockRestore: () => void }> = []
  afterEach(() => {
    for (const s of spies) s.mockRestore()
    spies.length = 0
  })
  const track = <T extends { mockRestore: () => void }>(s: T): T => {
    spies.push(s)
    return s
  }

  test('records the error notice at the delivery target bucket when execution throws', async () => {
    mockLogger()
    track(spyOn(dispatch, 'dispatchExecution').mockRejectedValue(new Error('boom')))
    track(spyOn(delivery, 'sendProactiveMessage').mockResolvedValue(true))
    const recorded: Array<[string, string]> = []
    track(
      spyOn(proactiveHistory, 'recordProactiveInHistory').mockImplementation((id, md) => {
        recorded.push([id, md])
      }),
    )

    // <-- Call executeScheduledPromptsForGroup(...) using the harness this file
    //     already establishes for its other tests (chat, prompts with a
    //     deliveryTarget whose storageContextId === 'pi:inst:ctx:grp', timezone).

    expect(recorded).toHaveLength(1)
    expect(recorded[0]![0]).toBe('pi:inst:ctx:grp')
    expect(recorded[0]![1]).toContain('I ran into an error while working on that:')
  })

  test('does not record when the error notice fails to deliver', async () => {
    mockLogger()
    track(spyOn(dispatch, 'dispatchExecution').mockRejectedValue(new Error('boom')))
    track(spyOn(delivery, 'sendProactiveMessage').mockResolvedValue(false))
    const recorded: unknown[] = []
    track(
      spyOn(proactiveHistory, 'recordProactiveInHistory').mockImplementation(() => {
        recorded.push(1)
      }),
    )

    // <-- Same harness call as above.

    expect(recorded).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/poller.test.ts`
Expected: FAIL — `recordProactiveInHistory` is never called (assertions on `recorded` fail).

- [ ] **Step 3: Add the import and edit both error branches**

At the top of `src/deferred-prompts/poller.ts`, add:

```ts
import { recordProactiveInHistory } from '../proactive-history.js'
```

(`getStorageContextId` is already imported in this file.)

In `executeScheduledPromptsForGroup`, replace the catch branch:

```ts
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    log.error({ userId: createdByUserId, promptIds, error: errMsg }, 'Scheduled prompt execution failed before delivery')
    const errText = `I ran into an error while working on that: ${errMsg}`
    const delivered = await sendProactiveMessage(chat, execCtx.deliveryTarget, errText)
    if (!delivered) return
    recordProactiveInHistory(getStorageContextId(execCtx.deliveryTarget), errText)
    finalizeAllPrompts(prompts, new Date().toISOString(), timezone)
    return
  }
```

In `executeSingleAlert`, replace the catch branch:

```ts
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    log.error({ id: alert.id, userId: alert.createdByUserId, error: errMsg }, 'Alert prompt execution failed before delivery')
    const errText = `Sorry, something went wrong while preparing this update: ${errMsg}`
    const delivered = await sendProactiveMessage(chat, alert.deliveryTarget, errText)
    if (!delivered) return { matched: true, delivered: false }
    recordProactiveInHistory(getStorageContextId(alert.deliveryTarget), errText)
    return markAlertDelivered(alert, matchedTasks.length, false)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/poller.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/deferred-prompts/poller.ts tests/deferred-prompts/poller.test.ts
git commit -m "feat(deferred): record error-branch notices in history"
```

---

### Task 3: Record external `notify` webhook pushes

**Files:**

- Modify: `src/debug/notify-route.ts` (`sendNotify`, success path at ~L128-133)
- Test: `tests/debug/notify-route.test.ts` (add a case; mirror existing harness if present)

Context: `buildNotifyTarget` sets `storageContextId = body.contextId`, which is contractually the scoped `pi:...` id (see the route's docstring). `sendNotify` receives `contextId` (= `body.contextId`) and `markdown` as params. Persist only after `sent === true`.

- [ ] **Step 1: Write the failing test**

Add to `tests/debug/notify-route.test.ts`:

```ts
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import * as proactiveHistory from '../../src/proactive-history.js'
import { handleNotifyRoute } from '../../src/debug/notify-route.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('notify-route history recording', () => {
  const spies: Array<{ mockRestore: () => void }> = []
  afterEach(() => {
    for (const s of spies) s.mockRestore()
    spies.length = 0
  })

  test('records the delivered notify message at the scoped context id', async () => {
    mockLogger()
    const recorded: Array<[string, string]> = []
    spies.push(
      spyOn(proactiveHistory, 'recordProactiveInHistory').mockImplementation((id, md) => {
        recorded.push([id, md])
      }),
    )

    // <-- Build the Request + runtime chat router exactly as the existing
    //     notify-route tests do (bearer auth, a chat whose sendMessage resolves
    //     true, body.contextId === 'pi:inst:ctx:user', markdown 'Milestone hit').
    //     const res = await handleNotifyRoute(req)
    //     expect(res.status).toBe(200)

    expect(recorded).toEqual([['pi:inst:ctx:user', 'Milestone hit']])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/notify-route.test.ts`
Expected: FAIL — `recorded` is empty.

- [ ] **Step 3: Add the import and record after successful delivery**

At the top of `src/debug/notify-route.ts`, add:

```ts
import { recordProactiveInHistory } from '../proactive-history.js'
```

In `sendNotify`, after the failed-delivery guard and before returning success:

```ts
if (!sent) {
  log.warn({ platformInstanceId, contextId }, 'notify delivery failed')
  return jsonResponse({ error: 'delivery failed' }, { status: 502 })
}
recordProactiveInHistory(contextId, markdown)
return jsonResponse({ sent: true })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/notify-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/notify-route.ts tests/debug/notify-route.test.ts
git commit -m "feat(notify): record delivered notify pushes in history"
```

---

### Task 4: Record "recurring task created" notifications

**Files:**

- Modify: `src/scheduler-recurring.ts` (`notifyUser`, L78-106)
- Test: `tests/scheduler-recurring.test.ts` (add cases; mirror existing harness if present)

Context: `userId` here is `task.userId`, stored as the scoped config-context id (`pi:...`). Persist at `userId` directly, guarded by `parseScopedContextId(userId) !== null` so legacy bare ids are skipped (never written to a wrong bucket). `parseScopedContextId` is already imported in this file.

- [ ] **Step 1: Write the failing test**

Add to `tests/scheduler-recurring.test.ts`:

```ts
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { ChatProvider } from '../src/chat/types.js'
import * as proactiveHistory from '../src/proactive-history.js'
import { notifyUser } from '../src/scheduler-recurring.js'
import { mockLogger } from './utils/test-helpers.js'

describe('notifyUser history recording', () => {
  const spies: Array<{ mockRestore: () => void }> = []
  afterEach(() => {
    for (const s of spies) s.mockRestore()
    spies.length = 0
  })

  const createdTask = { id: 't1', title: 'Weekly report' } as unknown as Parameters<typeof notifyUser>[2]

  test('records the notification at the scoped userId after successful delivery', async () => {
    mockLogger()
    const recorded: Array<[string, string]> = []
    spies.push(
      spyOn(proactiveHistory, 'recordProactiveInHistory').mockImplementation((id, md) => {
        recorded.push([id, md])
      }),
    )
    const chat = {
      sendMessage: async () => true,
    } as unknown as ChatProvider

    // getRecurringNotificationRoute must resolve for this userId; use a scoped id
    // whose platform instance resolves in the test env, matching existing tests.
    await notifyUser(chat, 'pi:inst:ctx:user', createdTask)

    expect(recorded).toEqual([['pi:inst:ctx:user', 'Recurring task created: **Weekly report** in project.']])
  })

  test('does not record when delivery is refused', async () => {
    mockLogger()
    const recorded: unknown[] = []
    spies.push(
      spyOn(proactiveHistory, 'recordProactiveInHistory').mockImplementation(() => {
        recorded.push(1)
      }),
    )
    const chat = { sendMessage: async () => false } as unknown as ChatProvider

    await notifyUser(chat, 'pi:inst:ctx:user', createdTask)

    expect(recorded).toHaveLength(0)
  })
})
```

> If `getRecurringNotificationRoute` returns `null` in the test env for the chosen id (no resolvable platform instance), mirror however the existing scheduler-recurring tests stub route resolution / instance registry, then use the same scoped id here.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scheduler-recurring.test.ts`
Expected: FAIL — `recorded` empty in the success case.

- [ ] **Step 3: Add import and record after successful delivery**

At the top of `src/scheduler-recurring.ts`, add:

```ts
import { recordProactiveInHistory } from './proactive-history.js'
```

Rewrite the body of `notifyUser` (from the `try` block) to extract the message and record on success:

```ts
try {
  const message = `Recurring task created: **${created.title}** in project.`
  const delivered = await chatProviderRef.sendMessage(route.platformInstanceId, route.target, message)
  if (delivered === false) {
    log.warn(
      { userId, platformInstanceId: route.platformInstanceId, taskId: created.id },
      'Recurring task notification refused',
    )
    return
  }
  if (parseScopedContextId(userId) !== null) recordProactiveInHistory(userId, message)
} catch (notifyError) {
  log.warn(
    { userId, error: notifyError instanceof Error ? notifyError.message : String(notifyError) },
    'Failed to notify user about recurring task',
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scheduler-recurring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scheduler-recurring.ts tests/scheduler-recurring.test.ts
git commit -m "feat(scheduler): record recurring-task notifications in history"
```

---

### Task 5: Record admin free-text broadcasts

**Files:**

- Modify: `src/commands/announce-broadcast.ts` (`broadcastMessage`, L24-53)
- Test: `tests/commands/announce-broadcast.test.ts` (add a case; mirror existing harness if present)

Context: each recipient is a `listUsers(platformInstanceId)` row with a native `platform_user_id`. The correct history bucket is `toScopedContextId({ platformInstanceId, nativeContextId: user.platform_user_id })`. Delivery stays exactly as-is (`chat.sendMessage`); only add the record on success.

- [ ] **Step 1: Write the failing test**

Add to `tests/commands/announce-broadcast.test.ts`:

```ts
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { ChatProvider } from '../../src/chat/types.js'
import * as proactiveHistory from '../../src/proactive-history.js'
import * as users from '../../src/users.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { broadcastMessage } from '../../src/commands/announce-broadcast.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('broadcastMessage history recording', () => {
  const spies: Array<{ mockRestore: () => void }> = []
  afterEach(() => {
    for (const s of spies) s.mockRestore()
    spies.length = 0
  })

  test('records each delivered broadcast at the scoped DM bucket', async () => {
    mockLogger()
    spies.push(
      spyOn(users, 'listUsers').mockReturnValue([
        { platform_user_id: 'u1' },
        { platform_user_id: 'u2' },
      ] as unknown as ReturnType<typeof users.listUsers>),
    )
    const recorded: Array<[string, string]> = []
    spies.push(
      spyOn(proactiveHistory, 'recordProactiveInHistory').mockImplementation((id, md) => {
        recorded.push([id, md])
      }),
    )
    const chat = { sendMessage: async () => true } as unknown as ChatProvider

    await broadcastMessage(chat, 'inst', 'Heads up everyone')

    expect(recorded).toEqual([
      [toScopedContextId({ platformInstanceId: 'inst', nativeContextId: 'u1' }), 'Heads up everyone'],
      [toScopedContextId({ platformInstanceId: 'inst', nativeContextId: 'u2' }), 'Heads up everyone'],
    ])
  })
})
```

> `listUsers` filters out `platform_user_id` starting with `placeholder-`; keep test ids outside that prefix. Assertion order may vary under `pLimit`; if the harness runs sends concurrently, sort both sides before comparing.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/commands/announce-broadcast.test.ts`
Expected: FAIL — `recorded` empty.

- [ ] **Step 3: Add imports and record on successful send**

At the top of `src/commands/announce-broadcast.ts`, add:

```ts
import { toScopedContextId } from '../chat/scoped-context.js'
import { recordProactiveInHistory } from '../proactive-history.js'
```

Edit the per-user send closure:

```ts
    users.map((user) =>
      limit(async () => {
        const result = await chat.sendMessage(platformInstanceId, dmTarget(user.platform_user_id), message)
        const ok = result !== false
        if (ok)
          recordProactiveInHistory(
            toScopedContextId({ platformInstanceId, nativeContextId: user.platform_user_id }),
            message,
          )
        return ok
      }),
    ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/commands/announce-broadcast.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/announce-broadcast.ts tests/commands/announce-broadcast.test.ts
git commit -m "feat(announce): record admin broadcasts in history"
```

---

### Task 6: Record release-notes broadcasts (DM + group)

**Files:**

- Modify: `src/announcements/broadcast.ts` (`defaultDeps.sendDm` and `defaultDeps.sendGroup`, L37-46)
- Test: `tests/announcements/broadcast.test.ts` (add a case; mirror existing harness if present)

Context: `defaultDeps.sendDm` has `platformInstanceId` + native `platformUserId` → scoped via `toScopedContextId`. `defaultDeps.sendGroup` uses `groupTarget(groupId)` whose `storageContextId` is `groupId` (already the scoped config-context id) → record at `groupId`. Record only on successful delivery. Tests that inject their own `deps` will not trigger these, so this task tests `defaultDeps` directly.

- [ ] **Step 1: Write the failing test**

Add to `tests/announcements/broadcast.test.ts`:

```ts
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { ChatProvider } from '../../src/chat/types.js'
import * as proactiveHistory from '../../src/proactive-history.js'
import * as delivery from '../../src/deferred-prompts/proactive-delivery.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { __defaultBroadcastDepsForTest } from '../../src/announcements/broadcast.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('broadcast defaultDeps history recording', () => {
  const spies: Array<{ mockRestore: () => void }> = []
  afterEach(() => {
    for (const s of spies) s.mockRestore()
    spies.length = 0
  })

  test('sendDm records at the scoped DM bucket on success', async () => {
    mockLogger()
    const recorded: Array<[string, string]> = []
    spies.push(
      spyOn(proactiveHistory, 'recordProactiveInHistory').mockImplementation((id, md) => {
        recorded.push([id, md])
      }),
    )
    const chat = { sendMessage: async () => true } as unknown as ChatProvider

    const ok = await __defaultBroadcastDepsForTest.sendDm(chat, 'inst', 'u1', 'Release notes')

    expect(ok).toBe(true)
    expect(recorded).toEqual([
      [toScopedContextId({ platformInstanceId: 'inst', nativeContextId: 'u1' }), 'Release notes'],
    ])
  })

  test('sendGroup records at the group scoped id on success', async () => {
    mockLogger()
    spies.push(spyOn(delivery, 'sendProactiveMessage').mockResolvedValue(true))
    const recorded: Array<[string, string]> = []
    spies.push(
      spyOn(proactiveHistory, 'recordProactiveInHistory').mockImplementation((id, md) => {
        recorded.push([id, md])
      }),
    )
    const chat = {} as unknown as ChatProvider

    const ok = await __defaultBroadcastDepsForTest.sendGroup(chat, 'pi:inst:ctx:grp', 'Release notes')

    expect(ok).toBe(true)
    expect(recorded).toEqual([['pi:inst:ctx:grp', 'Release notes']])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/announcements/broadcast.test.ts`
Expected: FAIL — `__defaultBroadcastDepsForTest` is not exported (import error), then (after Step 3) the recording assertions drive the impl.

- [ ] **Step 3: Add imports, record in defaultDeps, and export deps for testing**

At the top of `src/announcements/broadcast.ts`, add:

```ts
import { toScopedContextId } from '../chat/scoped-context.js'
import { recordProactiveInHistory } from '../proactive-history.js'
```

Replace the `sendDm` and `sendGroup` entries in `defaultDeps`:

```ts
  sendDm: async (chat, platformInstanceId, platformUserId, body) => {
    const result = await chat.sendMessage(platformInstanceId, dmTarget(platformUserId), body)
    const ok = result !== false
    if (ok) recordProactiveInHistory(toScopedContextId({ platformInstanceId, nativeContextId: platformUserId }), body)
    return ok
  },
  sendGroup: async (chat, groupId, body) => {
    const ok = await sendProactiveMessage(chat, groupTarget(groupId), body)
    if (ok) recordProactiveInHistory(groupId, body)
    return ok
  },
```

Immediately after the `const defaultDeps: BroadcastDeps = { ... }` declaration, add a test-only export:

```ts
/** Test-only handle to exercise the real send+record deps. */
export const __defaultBroadcastDepsForTest = defaultDeps
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/announcements/broadcast.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/announcements/broadcast.ts tests/announcements/broadcast.test.ts
git commit -m "feat(announcements): record release-notes broadcasts in history"
```

---

### Task 7: Record the admin review notice

**Files:**

- Modify: `src/announcements.ts` (`sendAnnouncementToAdmin`, L53-75)
- Test: `tests/announcements.test.ts` (add a case; mirror existing harness if present)

Context: `sendAnnouncementToAdmin(platformInstanceId, adminUserId, markdown, chat)` — `adminUserId` is a bare native id, so the scoped bucket is `toScopedContextId({ platformInstanceId, nativeContextId: adminUserId })`. Record only after `result !== false`. Note `sendAnnouncementToAdmin` is a module-private function; test it through its exported caller `announceNewVersion`, or via the existing announcements test harness — assert `recordProactiveInHistory` fires with the scoped admin id on a successful send.

- [ ] **Step 1: Write the failing test**

Add to `tests/announcements.test.ts` a case mirroring the existing harness that drives `announceNewVersion` with a chat whose `sendMessage` resolves truthy and an admin user id, then:

```ts
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import * as proactiveHistory from '../src/proactive-history.js'
import { toScopedContextId } from '../src/chat/scoped-context.js'
import { mockLogger } from './utils/test-helpers.js'

describe('announcement review notice history recording', () => {
  const spies: Array<{ mockRestore: () => void }> = []
  afterEach(() => {
    for (const s of spies) s.mockRestore()
    spies.length = 0
  })

  test('records the admin review notice at the scoped admin bucket', async () => {
    mockLogger()
    const recorded: Array<[string, string]> = []
    spies.push(
      spyOn(proactiveHistory, 'recordProactiveInHistory').mockImplementation((id, md) => {
        recorded.push([id, md])
      }),
    )

    // <-- Drive announceNewVersion(chat, 'inst', 'admin1', ...) using this file's
    //     existing harness (chat.sendMessage resolves true; whatever version/config
    //     the existing tests set up). Capture the markdown actually sent.

    expect(recorded).toHaveLength(1)
    expect(recorded[0]![0]).toBe(toScopedContextId({ platformInstanceId: 'inst', nativeContextId: 'admin1' }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/announcements.test.ts`
Expected: FAIL — `recorded` empty.

- [ ] **Step 3: Add imports and record on successful send**

At the top of `src/announcements.ts`, add:

```ts
import { toScopedContextId } from './chat/scoped-context.js'
import { recordProactiveInHistory } from './proactive-history.js'
```

In `sendAnnouncementToAdmin`, after the successful-send guard:

```ts
const result = await chat.sendMessage(platformInstanceId, dmTarget(adminUserId), markdown)
if (result === false) return false
recordProactiveInHistory(toScopedContextId({ platformInstanceId, nativeContextId: adminUserId }), markdown)
log.debug({ version: VERSION }, 'Announcement review notice sent to admin')
return true
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/announcements.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/announcements.ts tests/announcements.test.ts
git commit -m "feat(announcements): record admin review notice in history"
```

---

### Task 8: Fix the turn-error rollback discarding the user's message

**Files:**

- Modify: `src/llm-orchestrator-support.ts` (`HandleLlmTurnErrorArgs` type + `handleLlmTurnError`, L176-193)
- Modify: `src/llm-orchestrator.ts` (`runTurn` call site, ~L230-240)
- Test: `tests/llm-orchestrator-support.test.ts` (add a case; create/mirror existing harness)

Context: `processMessage` appends the user's `turn.historyMessage` (`src/llm-orchestrator.ts:269`) before the LLM call. On a non-abort error, `handleLlmTurnError` currently does `saveHistory(contextId, baseHistory)` — rewinding past that user message. Fix: pass the user message in and persist `[...baseHistory, userHistoryMessage]`, restoring history to "user turn present, no assistant reply."

- [ ] **Step 1: Write the failing test**

Add to `tests/llm-orchestrator-support.test.ts`:

```ts
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { ModelMessage } from 'ai'
import * as historyModule from '../src/history.js'
import { handleLlmTurnError } from '../src/llm-orchestrator-support.js'
import { createMockReply, mockLogger } from './utils/test-helpers.js'

describe('handleLlmTurnError history preservation', () => {
  const spies: Array<{ mockRestore: () => void }> = []
  afterEach(() => {
    for (const s of spies) s.mockRestore()
    spies.length = 0
  })

  test('preserves the user turn message when rolling back', async () => {
    mockLogger()
    const saved: Array<{ id: string; msgs: readonly ModelMessage[] }> = []
    spies.push(
      spyOn(historyModule, 'saveHistory').mockImplementation((id, msgs) => {
        saved.push({ id, msgs })
      }),
    )
    const baseHistory: ModelMessage[] = [{ role: 'assistant', content: 'earlier reply' }]
    const userHistoryMessage: ModelMessage = { role: 'user', content: 'do the thing' }

    await handleLlmTurnError({
      reply: createMockReply(),
      contextId: 'pi:inst:ctx:user',
      chatUserId: 'user',
      contextType: 'dm',
      mainModel: 'gpt-main',
      startedAt: 0,
      baseHistory,
      userHistoryMessage,
      error: new Error('llm exploded'),
      turnId: 'turn-1',
    })

    expect(saved).toHaveLength(1)
    expect(saved[0]!.id).toBe('pi:inst:ctx:user')
    expect(saved[0]!.msgs).toEqual([...baseHistory, userHistoryMessage])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/llm-orchestrator-support.test.ts`
Expected: FAIL — type error / arg mismatch (`userHistoryMessage` not on `HandleLlmTurnErrorArgs`), and `saveHistory` called with `baseHistory` only.

- [ ] **Step 3: Update the type, the function, and the call site**

In `src/llm-orchestrator-support.ts`, add the field to `HandleLlmTurnErrorArgs`:

```ts
type HandleLlmTurnErrorArgs = {
  reply: ReplyFn
  contextId: string
  chatUserId: string
  contextType: 'dm' | 'group'
  mainModel: string
  startedAt: number
  baseHistory: readonly ModelMessage[]
  userHistoryMessage: ModelMessage
  error: unknown
  turnId: string
}
```

Update `handleLlmTurnError` to restore including the user message:

```ts
export const handleLlmTurnError = async (args: HandleLlmTurnErrorArgs): Promise<void> => {
  const {
    reply,
    contextId,
    chatUserId,
    contextType,
    mainModel,
    startedAt,
    baseHistory,
    userHistoryMessage,
    error,
    turnId,
  } = args
  emitLlmError(contextId, chatUserId, contextType, mainModel, startedAt, baseHistory.length + 1, error, turnId)
  saveHistory(contextId, [...baseHistory, userHistoryMessage])
  await handleOrchestratorMessageError(reply, contextId, error)
}
```

In `src/llm-orchestrator.ts` `runTurn`, add `userHistoryMessage` to the `handleLlmTurnError` call:

```ts
await handleLlmTurnError({
  ...invocationSource,
  mainModel: resolvedLlm.mainModel,
  startedAt,
  baseHistory: turn.baseHistory,
  userHistoryMessage: turn.historyMessage,
  error,
  turnId: resolvedTurnId,
})
```

- [ ] **Step 4: Verify there are no other callers of `handleLlmTurnError`**

Run: `mcp__codeindex__code_symbol` for `handleLlmTurnError` (or `grep -rn "handleLlmTurnError" src/`). Expected: only the definition and the `runTurn` call site. If any other caller exists, add `userHistoryMessage` there too.

- [ ] **Step 5: Run test + typecheck to verify it passes**

Run: `bun test tests/llm-orchestrator-support.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/llm-orchestrator-support.ts src/llm-orchestrator.ts tests/llm-orchestrator-support.test.ts
git commit -m "fix(orchestrator): preserve user message on turn-error rollback"
```

---

### Task 9: Full-suite verification

- [ ] **Step 1: Typecheck, lint, and run the full test suite**

Run: `bun run typecheck`
Run: `bun run lint`
Run: `bun run test`
Expected: all green. (The write hook also enforces format + license headers on changed files; if it complains, run `bun run format` and `bun license:headers`, then re-commit.)

- [ ] **Step 2: Manual sanity note**

Confirm each new `recordProactiveInHistory` call receives a scoped `pi:...` id (search the diff for `recordProactiveInHistory(` and verify the first argument is either an already-scoped value or a `toScopedContextId(...)` expression — never a bare native id).

---

## Self-Review (completed by plan author)

- **Spec coverage:** Content-bearing proactive sites — release-notes broadcast (Task 6), admin free-text broadcast (Task 5), admin review notice (Task 7), recurring-task notification (Task 4), external `notify` push (Task 3), deferred-alert error branch (Task 2). Turn-error rollback fix (Task 8). All spec items mapped.
- **Faithful framing / best-effort / send-then-persist:** centralized in Task 1 and honored at every site (record only after confirmed delivery; record swallows failures).
- **Context-id correctness:** every site records to an explicitly-scoped id (`target.storageContextId` for poller/notify, `userId` guarded by `parseScopedContextId` for recurring, `toScopedContextId({...})` for the DM/admin/broadcast sites, `groupId` for the group broadcast). The `getStorageContextId` bare-id fallback is never relied upon.
- **Type consistency:** the record unit's signature `recordProactiveInHistory(storageContextId: string, markdown: string, deps?: RecordProactiveDeps)` is used identically across Tasks 2-7; `RecordProactiveDeps.persist` matches `appendHistory`'s `(userId, messages)` shape.
- **Deviation from spec (`sendRecordedProactive` → `recordProactiveInHistory`)** documented in the Architecture note with rationale.
