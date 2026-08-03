<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# F5 Scheduling Story Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 8 scheduling scenarios real — 3 `SCN-reminder-*` (recurring tasks) and 5 `SCN-deferred-*` (scheduled prompts + alerts) — moving the catalog ledger from 87 to 95 executable, with two small production seams (12 capability ids; an injectable recurring-notification chat provider) and one harness seam (`scheduler-due-seed`).

**Architecture:** Two production seams land first, each reviewed alone (rule 2): 12 `CORE_TOOL_CAPABILITIES` entries so the scripted model can address the recurring/deferred tools, and a `chat?` field on `SchedulerDeps` so a directly-driven `tick()` can deliver its notification to the world chat. Then the `scheduler-due-seed` harness seam (recurring, then deferred) seeds past-due DB rows and drives the already-exported single-pass `tick()`/`pollScheduledOnce()`/`pollAlertsOnce()` — no timers, no clock seam. Then two story files, the ledger + totals update, a spec reconciliation, and a verification gate.

**Tech Stack:** Bun, TypeScript (strict), bun:test, drizzle (SQLite), Zod v4, Vercel AI SDK.

**Spec:** `docs/superpowers/specs/2026-07-21-f5-scheduling-story-family-design.md`

**Ledger after this plan:** 128 ids, 95 executable, 33 pending (1 `executable-as-is`, 10 `needs-seam`, 22 `blocked`). Story suite grows by 8 scenarios.

**Frozen-tree note:** this plan changes frozen inputs (harness `fixtures.ts`, `scenario.ts`, catalog `coverage.ts`, `tests/stories/harness/catalog-coverage.test.ts`, `tests/utils/test-helpers.ts`, two new story files) **and** two production `src/` files (`src/tools/core-capabilities.ts`, `src/scheduler.ts`/`src/scheduler-recurring.ts`). Re-record the compat baseline after landing. Stories run sandboxed (`bun test:stories`, Docker required); contract/unit files run via `bun test:stories:contracts` and `bun test`.

## Global Constraints

- Strict TypeScript; **use `.js` extension in import paths** (repo convention).
- **Never add lint-disable or type-ignore comments** — the write hook blocks them; fix the underlying issue.
- Error extraction: `error instanceof Error ? error.message : String(error)`.
- Prefer DI over module mocking. Harness DB access is "import the real `src/*` function" or a `getTestDb().insert(...)` helper in `tests/utils/test-helpers.ts` — there is no `world.db`.
- Every new file keeps the BUSL license header present in its siblings (see any `tests/stories/harness/*.ts`).
- Run `bun run format && bun run typecheck && bun run lint` before every commit that touches source/test files.
- Roadmap rules: (2) each seam lands first and is reviewed independently; (3) no assertion-only stories — every scenario qualifies through a delivered reply, a durable change on a following turn, or a captured proactive delivery; (5) ledger updates ride in this PR; (6) reclassification records its rationale.

## Domain facts (verified against source) — read before writing any task

- **No clock seam needed.** Every fire path reads "now" internally and compares `<=` a stored due-column: recurring `getDueRecurringTasks()` selects `lte(recurringTasks.nextRun, now)` with `enabled='1'` (`src/recurring.ts:268,273`); scheduled `getScheduledPromptsDue()` selects `lte(scheduledPrompts.fireAt, now)` with `status='active'` (`src/deferred-prompts/scheduled.ts:210,215`); alerts are condition+cooldown driven with **no `fireAt`** — a row with `lastTriggeredAt=null` is always eligible (`src/deferred-prompts/alerts.ts:187-195`). Seed a row safely in the past and the next single-pass call fires it.
- **Single-pass exports, no timers.** `tick(deps?: SchedulerDeps)` (`src/scheduler.ts:110`), `pollScheduledOnce(chat, buildProviderFn)` (`src/deferred-prompts/poller.ts:99`), `pollAlertsOnce(chat, buildProviderFn)` (`src/deferred-prompts/poller.ts:230`) are all exported and callable directly. The harness disables the background scheduler (`world.test.ts:183`), so call these — never `startScheduler`/`startPollers`/`startProductionBackground`.
- **`SchedulerDeps` is `{ resolve }` today** (`src/scheduler.ts:23-29`): `resolve(contextId) => TaskProvider | null`. `tick()` creates the fired task through `deps.resolve` (`executeRecurringTask`, `src/scheduler.ts:39-62`), so the created task is observable via the world provider.
- **Recurring notification is gated but task creation is not.** `executeRecurringTask` early-returns only if `!canRouteRecurringNotification(chatProviderRef, task.userId)` (`src/scheduler.ts:42`). `canRouteRecurringNotification` returns **`true` when `chatProviderRef===null`** (`src/scheduler-recurring.ts:38`), so a directly-driven `tick()` (null module ref) still creates the task. The _notification_ (`notifyUser`, `src/scheduler-recurring.ts:79-106`) is skipped on a null ref — that is what Task 2's seam fixes.
- **Notification route.** `getRecurringNotificationRoute(userId)` (`src/scheduler-recurring.ts:24-36`) does `parseScopedContextId(userId)` → `{ platformInstanceId, target: dmTarget(nativeContextId) }`. So the seeded `recurring_tasks.userId` must be a **scoped context id** (`toScopedContextId({platformInstanceId, nativeContextId})`). The notification is captured at `contextId = nativeContextId`. `ScenarioChat` exposes no `isInstanceActive`, so `canRouteRecurringNotification` returns true after the non-null route check (`scheduler-recurring.ts:40`).
- **Proactive delivery = one `ChatProvider.sendMessage`.** Scheduled/alert firing calls `sendProactiveMessage(chat, target, markdown)` → `chat.sendMessage(platformInstanceId, target, markdown)` (`src/deferred-prompts/proactive-delivery.ts:29-38`); recurring notification calls `chatProviderRef.sendMessage(...)` (`scheduler-recurring.ts:91`). The `ScenarioChat.sendMessage` (`chat.ts:244-257`) captures it as `kind:'proactive'`, readable via `then.replyTo(user)` / `then.replyIn(context)`.
- **Delivery platform resolution.** `resolveDeliveryPlatformInstanceId(target)` (`src/chat/delivery-routing.ts:23`) recovers the platform instance from the scoped storage context id when no `context_settings` row exists. So a seeded scheduled/alert prompt's `deliveryContextId` must be a **scoped storage context id** (`world.scopedStorageContextId(dm)`).
- **A lightweight fire = exactly one `/chat/completions` call.** Firing runs the real `dispatchExecution` (`proactive-llm.ts:284`); `invokeLightweight` (`proactive-llm.ts:96-131`) builds a model from the seeded LLM config (`https://llm.invalid/v1`, from `given.seedSystemLlmConfig`) and calls `generateText` once. `finalizeAndLog` runs a **second** verification call only if the result `isRisky` (empty text / `finish_reason:'tool-calls'` / tool failure) (`proactive-llm-helpers.ts:130-142`). A canned completion with non-empty `content` and `finish_reason:'stop'` and no tool calls is **not** risky → exactly one outbound call, declared via `world.http.expect` (the F3 `history-lookup` precedent, `tests/stories/context/history-lookup.story.test.ts:27-38`).
- **Fire scenarios are story-mode-only.** The proactive `generateText` fetch is intercepted only under `bun test:stories`' global-fetch patch, not `--contracts` (the same footnote F3/F4 recorded for `memory-capture-sweep` / `transcript-viewer`).
- **Alert task fetch.** `pollAlertsOnce` → `executeAlertsForUser` → `buildProviderFn(contextId)` → `fetchAllTasks(provider)` = `provider.listProjects()` + `provider.listTasks(projectId)` (`fetch-tasks.ts:41-49`); the `overdue` op reads `task.dueDate` (not in `FIELDS_REQUIRING_FULL_TASK`) from the list item and checks `new Date(dueDate) < now` (`condition-eval.ts:45-48`). Seed an overdue task in the world provider.
- **Create tools reject past fire dates in the handler**, not the schema: `validateFutureFireAt` rejects `fireDate.getTime() <= Date.now()` against the **real** wall clock (`tool-handlers.ts:76-82`). So _create_ scenarios use a far-future date (e.g. `2099-01-01`); _fire_ scenarios seed past-due rows directly.
- **Capability resolution.** `CORE_TOOL_CAPABILITIES` (`src/tools/core-capabilities.ts:10`) is a flat `Readonly<Record<capabilityId, wireName>>`. `registerOfferedCoreToolCapabilities(tools, catalog)` registers each pair **only when `tools[wireName] !== undefined`** (`core-capabilities.ts:73`). The scripted model's `callCapability(id, input)` resolves `id → wireName` via `runtime.resolveToolCapability` → `toolCapabilityCatalog.resolve` (`scripted-llm.ts:270`, `world.ts:407-409`, `capability-catalog.ts:26-30`); an unadvertised tool auto-hops through `load_tool` first (`scripted-llm.ts:272-282`).
- **Tool wire names.** Recurring (offered when the chat user id is defined, `provider-independent-tools-builder.ts:62-71`): `create_recurring_task`, `list_recurring_tasks`, `update_recurring_task`, `pause_recurring_task`, `resume_recurring_task`, `skip_recurring_task`, `delete_recurring_task`. Deferred (offered in `mode==='normal'`, `deferred-tools-builder.ts:39-45`): `create_deferred_prompt`, `list_deferred_prompts`, `get_deferred_prompt`, `update_deferred_prompt`, `cancel_deferred_prompt`.
- **Fixture wiring pattern.** A `given.*` DB seed is a three-layer add: a raw `getTestDb().insert(...)` helper in `tests/utils/test-helpers.ts`, a method on `ScenarioFixtures` in `fixtures.ts` that calls it, and a `given.*`/`when.*` DSL member in `scenario.ts` that scopes ids and calls `prerequisite('given.<name>')` (unstarted-world guard) or `world.events.setPhase('when.<name>')`. The `when.captureSweep`/`when.promotionSweep` primitives (`scenario.ts:730-777`) are the template for the fire drives: call the production single-pass function directly with world-provided deps.
- **Observation model.** Scripted `answer(text)` is emitted unconditionally, so asserting reply text alone does not observe real behavior. Read/list scenarios assert on the real tool result via `world.model.inspections().at(-1)?.promptToolResultTokenFingerprints` containing `promptTextFingerprint('<distinctive token>')` (F3 precedent, `scripted-llm.ts:95-103`, `history-lookup.story.test.ts:47-48`); mutations assert a token appearing/disappearing (`.not.toContain`) on a following list turn. Fire scenarios assert the captured proactive delivery via `then.replyTo`/`then.replyIn`.

---

### Task 1: `capability-ids` production seam (12 entries)

**Files:**

- Modify: `src/tools/core-capabilities.ts` (`CORE_TOOL_CAPABILITIES`)
- Test: `tests/tools/core-capabilities-scheduling.test.ts` (new)

**Interfaces:**

- Produces: 12 capability ids resolvable through `registerOfferedCoreToolCapabilities` → `ToolCapabilityCatalog.resolve`: `recurring.create|list|update|pause|resume|skip|delete` and `deferred.create|list|get|update|cancel`.

- [ ] **Step 1: Write the failing test** — create `tests/tools/core-capabilities-scheduling.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { createToolCapabilityCatalog } from '../../src/runtime/capability-catalog.js'
import { CORE_TOOL_CAPABILITIES, registerOfferedCoreToolCapabilities } from '../../src/tools/core-capabilities.js'

const stub = tool({
  description: 'stub',
  inputSchema: z.object({}),
  execute: () => Promise.resolve('ok'),
})

const SCHEDULING_WIRE_NAMES = [
  'create_recurring_task',
  'list_recurring_tasks',
  'update_recurring_task',
  'pause_recurring_task',
  'resume_recurring_task',
  'skip_recurring_task',
  'delete_recurring_task',
  'create_deferred_prompt',
  'list_deferred_prompts',
  'get_deferred_prompt',
  'update_deferred_prompt',
  'cancel_deferred_prompt',
] as const

describe('scheduling capability ids', () => {
  test('every scheduling tool resolves from its capability id when offered', () => {
    const tools: ToolSet = Object.fromEntries(SCHEDULING_WIRE_NAMES.map((name) => [name, stub]))
    const catalog = createToolCapabilityCatalog()
    registerOfferedCoreToolCapabilities(tools, catalog)

    expect(catalog.resolve('recurring.create')).toBe('create_recurring_task')
    expect(catalog.resolve('recurring.pause')).toBe('pause_recurring_task')
    expect(catalog.resolve('recurring.delete')).toBe('delete_recurring_task')
    expect(catalog.resolve('deferred.create')).toBe('create_deferred_prompt')
    expect(catalog.resolve('deferred.cancel')).toBe('cancel_deferred_prompt')
  })

  test('the 12 scheduling ids are all present in the capability map', () => {
    const wireNames = new Set(Object.values(CORE_TOOL_CAPABILITIES))
    for (const name of SCHEDULING_WIRE_NAMES) expect(wireNames.has(name)).toBe(true)
  })

  test('an unoffered scheduling tool is not registered', () => {
    const catalog = createToolCapabilityCatalog()
    registerOfferedCoreToolCapabilities({}, catalog)
    expect(() => catalog.resolve('recurring.create')).toThrow(/Unknown tool capability id/u)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/tools/core-capabilities-scheduling.test.ts`
Expected: FAIL — `catalog.resolve('recurring.create')` throws `Unknown tool capability id` (the ids are not in the map yet).

- [ ] **Step 3: Add the 12 entries** — in `src/tools/core-capabilities.ts`, append to the `CORE_TOOL_CAPABILITIES` object (after `'history.lookup': 'lookup_group_history',`, before the closing `} as const)`):

```ts
  'recurring.create': 'create_recurring_task',
  'recurring.list': 'list_recurring_tasks',
  'recurring.update': 'update_recurring_task',
  'recurring.pause': 'pause_recurring_task',
  'recurring.resume': 'resume_recurring_task',
  'recurring.skip': 'skip_recurring_task',
  'recurring.delete': 'delete_recurring_task',
  'deferred.create': 'create_deferred_prompt',
  'deferred.list': 'list_deferred_prompts',
  'deferred.get': 'get_deferred_prompt',
  'deferred.update': 'update_deferred_prompt',
  'deferred.cancel': 'cancel_deferred_prompt',
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/tools/core-capabilities-scheduling.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add src/tools/core-capabilities.ts tests/tools/core-capabilities-scheduling.test.ts
git commit -m "feat(tools): register capability ids for recurring and deferred-prompt tools"
```

---

### Task 2: `scheduler-chat-di` production seam (`SchedulerDeps.chat`)

**Files:**

- Modify: `src/scheduler.ts` (`SchedulerDeps`, `executeRecurringTask`)
- Test: `tests/scheduler-chat-di.test.ts` (new)

**Interfaces:**

- Consumes: `SchedulerDeps.resolve` (existing).
- Produces: `SchedulerDeps.chat?: ChatProvider | null` — when set, `tick(deps)` delivers the recurring notification to `deps.chat` instead of the module-level `chatProviderRef`.

- [ ] **Step 1: Write the failing test** — create `tests/scheduler-chat-di.test.ts`. It seeds one due recurring row, injects a fake chat + resolver into `tick`, and asserts the notification `sendMessage` fired:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, expect, test } from 'bun:test'

import { toScopedContextId } from '../src/chat/scoped-context.js'
import type { ChatProvider, DeferredDeliveryTarget } from '../src/chat/types.js'
import { tick } from '../src/scheduler.js'
import { createMockProvider } from './tools/mock-provider.js'
import { getTestDb, mockLogger, schema, setupTestDb } from './utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
})

test('tick delivers the recurring notification to the injected chat provider', async () => {
  const userId = toScopedContextId({
    platformInstanceId: 'pi-1',
    nativeContextId: 'alice',
  })
  getTestDb()
    .insert(schema.recurringTasks)
    .values({
      id: 'rec-1',
      userId,
      projectId: 'project-1',
      title: 'Water the plants',
      triggerType: 'cron',
      rrule: 'FREQ=DAILY',
      dtstartUtc: '2020-01-01T09:00:00.000Z',
      enabled: '1',
      nextRun: '2020-01-01T09:00:00.000Z',
    })
    .run()

  const sends: Array<{
    platformInstanceId: string
    target: DeferredDeliveryTarget
    markdown: string
  }> = []
  const chat: ChatProvider = {
    sendMessage: (platformInstanceId, target, markdown) => {
      sends.push({ platformInstanceId, target, markdown })
      return Promise.resolve(true)
    },
  } as unknown as ChatProvider

  const provider = createMockProvider()
  await tick({ resolve: () => provider, chat })

  expect(sends).toHaveLength(1)
  expect(sends[0]?.markdown).toContain('Water the plants')
})
```

(`createMockProvider()` returns a `TaskProvider` whose `createTask` resolves a `Task`; if its default `createTask` needs a title/return, pass `{ createTask: async (input) => ({ id: 'task-1', title: input.title, url: '' }) }` — check `tests/tools/mock-provider.ts` for the exact shape.)

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/scheduler-chat-di.test.ts`
Expected: FAIL — `SchedulerDeps` has no `chat`, so the object literal `{ resolve, chat }` is a type error and no notification fires (the module `chatProviderRef` is null).

- [ ] **Step 3: Add the seam** — in `src/scheduler.ts`, extend `SchedulerDeps` (lines 23-25):

```ts
export interface SchedulerDeps {
  resolve: (contextId: string) => Promise<TaskProvider | null> | TaskProvider | null
  chat?: ChatProvider | null
}
```

(Import `ChatProvider` if not already imported: `import type { ChatProvider } from './chat/types.js'`.) Then in `executeRecurringTask` (lines 39-62), replace both reads of the module-level `chatProviderRef` with an injected-or-fallback value. Change the first line of the body to resolve the effective chat, and use it in the guard and the finalize call:

```ts
const executeRecurringTask = async (task: RecurringTaskRecord, deps: SchedulerDeps): Promise<void> => {
  log.debug({ taskId: task.id, title: task.title, userId: task.userId }, 'Executing recurring task')

  const chat = deps.chat ?? chatProviderRef
  if (!canRouteRecurringNotification(chat, task.userId)) {
    log.warn({ taskId: task.id, contextId: task.userId }, 'Skipping recurring task: notification route unavailable')
    return
  }

  const provider = await deps.resolve(task.userId)
  if (provider === null) {
    log.warn({ taskId: task.id, contextId: task.userId }, 'Skipping recurring task: task provider unavailable')
    return
  }

  try {
    const created = await provider.createTask(buildRecurringTaskInput(task))
    await finalizeCreatedRecurringTask(task, provider, created, chat)
  } catch (error) {
    log.error(
      {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to create recurring task instance',
    )
  }
}
```

(`defaultSchedulerDeps` is unchanged — it sets no `chat`, so `deps.chat ?? chatProviderRef` preserves production behavior exactly. `startScheduler` still sets `chatProviderRef`.)

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/scheduler-chat-di.test.ts`
Expected: PASS — one `sendMessage` with the task title. Diagnosis: if 0 sends, confirm the seeded `rrule`/`dtstartUtc` round-trips through `markExecuted` (`src/recurring.ts` `computeNextRun`) — `notifyUser` runs _after_ `markExecuted` in `finalizeCreatedRecurringTask`, so a throwing `markExecuted` suppresses the notification. If `markExecuted` rejects `'FREQ=DAILY'`, log what `recurrenceSpecToRrule({ freq: 'DAILY' })` produces (`src/recurrence.ts`) and seed that exact string.

- [ ] **Step 5: Confirm no production regression** — run the existing scheduler suite:

Run: `bun test tests/scheduler.test.ts` (or whichever file already covers `tick`/`startScheduler` — `grep -l "from '../src/scheduler.js'" tests/*.ts`)
Expected: PASS unchanged (the `?? chatProviderRef` fallback preserves the module-ref path).

- [ ] **Step 6: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add src/scheduler.ts tests/scheduler-chat-di.test.ts
git commit -m "feat(scheduler): allow injecting the recurring-notification chat provider via SchedulerDeps"
```

---

### Task 3: `scheduler-due-seed` harness seam — recurring

**Files:**

- Modify: `tests/utils/test-helpers.ts` (`seedTestRecurringTask`)
- Modify: `tests/stories/harness/fixtures.ts` (`seedRecurringTask` + type)
- Modify: `tests/stories/harness/scenario.ts` (`given.recurringTask`, `when.recurringTick` + types, imports)
- Test: `tests/stories/harness/scenario.test.ts`

**Interfaces:**

- Consumes: `getTestDb()`, `schema` (`tests/utils/test-helpers.ts`); `tick`, `SchedulerDeps` (`src/scheduler.js`); `toScopedContextId` (`src/chat/scoped-context.js`).
- Produces:
  - `seedTestRecurringTask(input: RecurringTaskSeed): void`.
  - `ScenarioFixtures.seedRecurringTask(input: RecurringTaskSeed): void`.
  - `given.recurringTask(context: ContextHandle, input: { title: string; projectId?: string; nextRun: string; id?: string; rrule?: string; dtstartUtc?: string; enabled?: '0' | '1' }): { id: string; userId: string }`.
  - `when.recurringTick(): Promise<void>` — drives `tick({ resolve: () => world provider, chat: world.chat })`.

- [ ] **Step 1: Write the failing contract test** — in `tests/stories/harness/scenario.test.ts`:

```ts
test('given.recurringTask + when.recurringTick fires a due recurrence into the world provider and notifies', async () => {
  await executeScenario('recurring-fire-seam', async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance())
    given.recurringTask(dm, {
      title: 'Water the plants',
      nextRun: '2020-01-01T09:00:00.000Z',
      rrule: 'FREQ=DAILY',
      dtstartUtc: '2020-01-01T09:00:00.000Z',
    })
    await when.recurringTick()
    await then.task('Water the plants').exists()
    then.replyTo(alice).contains('Water the plants')
  })
})
```

(`given.assign`/`given.taskInstance` are the existing task-provider fixtures — confirm the exact names against `scenario.ts` `ScenarioGiven`; if the world already exposes a default provider without assignment, drop that line and rely on `when.recurringTick` resolving `world.fixtures.taskProvider`.)

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/stories/harness/scenario.test.ts`
Expected: FAIL — `given.recurringTask is not a function`.

- [ ] **Step 3: Add the raw seed helper** — in `tests/utils/test-helpers.ts`, mirror `seedTestPlatformInstance`:

```ts
export type RecurringTaskSeed = {
  id: string
  userId: string
  projectId: string
  title: string
  nextRun: string
  rrule?: string | null
  dtstartUtc?: string | null
  enabled?: string
  triggerType?: string
}

export function seedTestRecurringTask(input: RecurringTaskSeed): void {
  getTestDb()
    .insert(schema.recurringTasks)
    .values({
      id: input.id,
      userId: input.userId,
      projectId: input.projectId,
      title: input.title,
      triggerType: input.triggerType ?? 'cron',
      rrule: input.rrule ?? null,
      dtstartUtc: input.dtstartUtc ?? null,
      enabled: input.enabled ?? '1',
      nextRun: input.nextRun,
    })
    .run()
}
```

- [ ] **Step 4: Add the fixture method** — in `tests/stories/harness/fixtures.ts`: import `seedTestRecurringTask` and `RecurringTaskSeed` alongside the other `seedTest*` imports; add to the `ScenarioFixtures` type `seedRecurringTask(input: RecurringTaskSeed): void`; add to the factory return object:

```ts
    seedRecurringTask(input): void {
      seedTestRecurringTask(input)
    },
```

- [ ] **Step 5: Add the DSL** — in `tests/stories/harness/scenario.ts`:

Import at the top: `import { tick } from '../../../src/scheduler.js'` and `import { toScopedContextId } from '../../../src/chat/scoped-context.js'` (if not already imported — `toScopedContextId` is already used by `scopedConfigContextId`).

Add to `ScenarioGiven` (type) and `createGiven` (return object):

```ts
    recurringTask(context, input): { id: string; userId: string } {
      prerequisite('given.recurringTask')
      const id = input.id ?? world.ids.next('recurring-task')
      const userId = toScopedContextId({
        platformInstanceId: context.platformInstanceId,
        nativeContextId: contextId(context),
      })
      world.fixtures.seedRecurringTask({
        id,
        userId,
        projectId: input.projectId ?? 'project-1',
        title: input.title,
        nextRun: input.nextRun,
        rrule: input.rrule ?? 'FREQ=DAILY',
        dtstartUtc: input.dtstartUtc ?? '2020-01-01T09:00:00.000Z',
        enabled: input.enabled ?? '1',
      })
      return { id, userId }
    },
```

Type member: `recurringTask(context: ContextHandle, input: Readonly<{ title: string; projectId?: string; nextRun: string; id?: string; rrule?: string; dtstartUtc?: string; enabled?: '0' | '1' }>): { id: string; userId: string }`.

Add to `ScenarioWhen` (type) and `createWhen` (return object):

```ts
    async recurringTick(): Promise<void> {
      world.events.setPhase('when.recurringTick')
      await tick({ resolve: () => world.fixtures.taskProvider, chat: world.chat })
    },
```

Type member: `recurringTick(): Promise<void>`.

(`world.chat` is the `ScenarioChat`; its `sendMessage(platformInstanceId, target, markdown)` matches `ChatProvider`. `world.fixtures.taskProvider` is the `MemoryTaskProvider`. `contextId(context)` for a DM returns the user id, so `userId` round-trips through `parseScopedContextId` in `getRecurringNotificationRoute` and the notification is captured at that native id — `then.replyTo(alice)`.)

- [ ] **Step 6: Run to verify it passes**

Run: `bun test tests/stories/harness/scenario.test.ts`
Expected: PASS. Diagnosis: if the task exists but no reply is captured, the notification route failed — verify `given.assign` seeded a provider whose `createTask` returns a `Task`, and that the seeded `rrule` round-trips `markExecuted` (Task 2 Step 4 diagnosis). If `then.task().exists()` fails, confirm `world.fixtures.taskProvider.createTask` persists to the searchable store the assertion queries.

- [ ] **Step 7: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add tests/utils/test-helpers.ts tests/stories/harness/fixtures.ts tests/stories/harness/scenario.ts tests/stories/harness/scenario.test.ts
git commit -m "test(stories): seed due recurring tasks and drive a single scheduler tick"
```

---

### Task 4: `scheduler-due-seed` harness seam — deferred

**Files:**

- Modify: `tests/utils/test-helpers.ts` (`seedTestScheduledPrompt`, `seedTestAlertPrompt`)
- Modify: `tests/stories/harness/fixtures.ts` (`seedScheduledPrompt`, `seedAlertPrompt` + types)
- Modify: `tests/stories/harness/scenario.ts` (`given.scheduledPrompt`, `given.alertPrompt`, `when.scheduledPoll`, `when.alertPoll` + types, imports)
- Test: `tests/stories/harness/scenario.test.ts`

**Interfaces:**

- Consumes: `getTestDb()`, `schema` (`test-helpers.ts`); `pollScheduledOnce`, `pollAlertsOnce` (`src/deferred-prompts/poller.js`).
- Produces:
  - `seedTestScheduledPrompt(input: ScheduledPromptSeed): void`, `seedTestAlertPrompt(input: AlertPromptSeed): void`.
  - `ScenarioFixtures.seedScheduledPrompt`/`seedAlertPrompt`.
  - `given.scheduledPrompt(context, input): { id: string }`, `given.alertPrompt(context, input): { id: string }`.
  - `when.scheduledPoll(): Promise<void>`, `when.alertPoll(): Promise<void>` — drive `pollScheduledOnce`/`pollAlertsOnce` with `world.chat` and `() => world.fixtures.taskProvider`.

- [ ] **Step 1: Write the failing contract test** — in `tests/stories/harness/scenario.test.ts`:

```ts
test('given.scheduledPrompt + when.scheduledPoll fires a due prompt and delivers a proactive message', async () => {
  await executeScenario('scheduled-fire-seam', async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.seedSystemLlmConfig()
    world.http.expect({ method: 'POST', url: 'https://llm.invalid/v1/chat/completions' }, () =>
      Response.json({
        id: 'chatcmpl-sched-1',
        choices: [
          {
            message: { role: 'assistant', content: 'Stand-up starts now.' },
            finish_reason: 'stop',
          },
        ],
      }),
    )
    given.scheduledPrompt(dm, {
      prompt: 'Remind me: stand-up',
      fireAt: '2020-01-01T09:00:00.000Z',
    })
    await when.scheduledPoll()
    then.replyTo(alice).contains('Stand-up')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/stories/harness/scenario.test.ts`
Expected: FAIL — `given.scheduledPrompt is not a function`.

- [ ] **Step 3: Add the raw seed helpers** — in `tests/utils/test-helpers.ts`:

```ts
export type ScheduledPromptSeed = {
  id: string
  createdByUserId: string
  deliveryContextId: string
  deliveryContextType: string
  prompt: string
  fireAt: string
  rrule?: string | null
  status?: string
  executionMetadata?: string
}

export function seedTestScheduledPrompt(input: ScheduledPromptSeed): void {
  getTestDb()
    .insert(schema.scheduledPrompts)
    .values({
      id: input.id,
      createdByUserId: input.createdByUserId,
      deliveryContextId: input.deliveryContextId,
      deliveryContextType: input.deliveryContextType,
      prompt: input.prompt,
      fireAt: input.fireAt,
      rrule: input.rrule ?? null,
      status: input.status ?? 'active',
      executionMetadata:
        input.executionMetadata ??
        JSON.stringify({
          mode: 'lightweight',
          delivery_brief: '',
          context_snapshot: null,
        }),
    })
    .run()
}

export type AlertPromptSeed = {
  id: string
  createdByUserId: string
  deliveryContextId: string
  deliveryContextType: string
  prompt: string
  condition: string
  status?: string
  cooldownMinutes?: number
  lastTriggeredAt?: string | null
  executionMetadata?: string
}

export function seedTestAlertPrompt(input: AlertPromptSeed): void {
  getTestDb()
    .insert(schema.alertPrompts)
    .values({
      id: input.id,
      createdByUserId: input.createdByUserId,
      deliveryContextId: input.deliveryContextId,
      deliveryContextType: input.deliveryContextType,
      prompt: input.prompt,
      condition: input.condition,
      status: input.status ?? 'active',
      cooldownMinutes: input.cooldownMinutes ?? 60,
      lastTriggeredAt: input.lastTriggeredAt ?? null,
      executionMetadata:
        input.executionMetadata ??
        JSON.stringify({
          mode: 'lightweight',
          delivery_brief: '',
          context_snapshot: null,
        }),
    })
    .run()
}
```

- [ ] **Step 4: Add the fixture methods** — in `tests/stories/harness/fixtures.ts`: import the two helpers and their seed types; add `seedScheduledPrompt(input: ScheduledPromptSeed): void` and `seedAlertPrompt(input: AlertPromptSeed): void` to the `ScenarioFixtures` type; add to the factory return object:

```ts
    seedScheduledPrompt(input): void {
      seedTestScheduledPrompt(input)
    },
    seedAlertPrompt(input): void {
      seedTestAlertPrompt(input)
    },
```

- [ ] **Step 5: Add the DSL** — in `tests/stories/harness/scenario.ts`: import `import { pollAlertsOnce, pollScheduledOnce } from '../../../src/deferred-prompts/poller.js'`. Add to `ScenarioGiven`/`createGiven`:

```ts
    scheduledPrompt(context, input): { id: string } {
      prerequisite('given.scheduledPrompt')
      const id = input.id ?? world.ids.next('scheduled-prompt')
      world.fixtures.seedScheduledPrompt({
        id,
        createdByUserId: scopedStorageContextId(context),
        deliveryContextId: scopedStorageContextId(context),
        deliveryContextType: context.kind === 'dm' ? 'dm' : 'group',
        prompt: input.prompt,
        fireAt: input.fireAt,
        ...(input.executionMetadata === undefined ? {} : { executionMetadata: input.executionMetadata }),
      })
      return { id }
    },
    alertPrompt(context, input): { id: string } {
      prerequisite('given.alertPrompt')
      const id = input.id ?? world.ids.next('alert-prompt')
      world.fixtures.seedAlertPrompt({
        id,
        createdByUserId: scopedStorageContextId(context),
        deliveryContextId: scopedStorageContextId(context),
        deliveryContextType: context.kind === 'dm' ? 'dm' : 'group',
        prompt: input.prompt,
        condition: JSON.stringify(input.condition),
      })
      return { id }
    },
```

Type members: `scheduledPrompt(context: ContextHandle, input: Readonly<{ prompt: string; fireAt: string; id?: string; executionMetadata?: string }>): { id: string }`; `alertPrompt(context: ContextHandle, input: Readonly<{ prompt: string; condition: unknown; id?: string }>): { id: string }`.

Add to `ScenarioWhen`/`createWhen`:

```ts
    async scheduledPoll(): Promise<void> {
      world.events.setPhase('when.scheduledPoll')
      await pollScheduledOnce(world.chat, () => world.fixtures.taskProvider)
    },
    async alertPoll(): Promise<void> {
      world.events.setPhase('when.alertPoll')
      await pollAlertsOnce(world.chat, () => world.fixtures.taskProvider)
    },
```

Type members: `scheduledPoll(): Promise<void>`; `alertPoll(): Promise<void>`.

- [ ] **Step 6: Run to verify it passes**

Run: `bun test tests/stories/harness/scenario.test.ts`
Expected: PASS. Diagnosis: if the chat route is never hit (undeclared-request or unconsumed-expectation error), confirm `given.seedSystemLlmConfig()` ran (so `getLlmConfig` resolves and `invokeLightweight` fires the call) and that `deliveryContextId` resolves to a platform instance via `resolveDeliveryPlatformInstanceId` (it recovers the instance from the scoped storage id — so a bare `given.dm` with no explicit platform assignment should still resolve; if it returns null, add `given.assign(dm, given.taskInstance())` to seed the mapping). If a _second_ `/chat/completions` call is demanded, the canned completion was treated as risky — ensure `content` is non-empty and `finish_reason:'stop'`.

- [ ] **Step 7: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add tests/utils/test-helpers.ts tests/stories/harness/fixtures.ts tests/stories/harness/scenario.ts tests/stories/harness/scenario.test.ts
git commit -m "test(stories): seed due deferred prompts and drive single scheduled/alert polls"
```

---

### Task 5: recurring stories (3 scenarios)

**Files:**

- Create: `tests/stories/scheduling/recurring.story.test.ts`

- [ ] **Step 1: Write the three scenarios**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../harness/scripted-llm.js'

scenario(
  'SCN-reminder-recurring-create: creating a recurrence persists it for a following list',
  async ({ given, when, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance())
    given.llm([
      callCapability('recurring.create', {
        title: 'Standup reminder',
        projectId: 'project-1',
        triggerType: 'cron',
        schedule: { freq: 'DAILY', byHour: [9], byMinute: [0] },
      }),
      callCapability('recurring.list', {}),
      answer('Created your daily standup reminder.'),
    ])
    await when.message(alice, dm, 'Remind me about standup every day at 9')
    const last = world.model.inspections().at(-1)
    expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('Standup'))
  },
)

scenario(
  'SCN-reminder-recurring-manage: pausing a recurrence is observable on a following list',
  async ({ given, when, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance())
    const { id } = given.recurringTask(dm, {
      title: 'Weekly report',
      nextRun: '2099-01-01T09:00:00.000Z',
    })
    given.llm([
      callCapability('recurring.pause', { id }),
      callCapability('recurring.list', {}),
      answer('Paused your weekly report reminder.'),
    ])
    await when.message(alice, dm, 'Pause the weekly report reminder')
    const last = world.model.inspections().at(-1)
    // The list result still contains the recurrence, now flagged paused/disabled.
    expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('Weekly'))
  },
)

scenario(
  'SCN-reminder-recurring-fire: a due recurrence creates a task and notifies the user',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance())
    given.recurringTask(dm, {
      title: 'Water the plants',
      nextRun: '2020-01-01T09:00:00.000Z',
      rrule: 'FREQ=DAILY',
      dtstartUtc: '2020-01-01T09:00:00.000Z',
    })
    await when.recurringTick()
    await then.task('Water the plants').exists()
    then.replyTo(alice).contains('Water the plants')
  },
)
```

- [ ] **Step 2: Run the stories sandboxed**

Run: `bun test:stories 2>&1 | grep -iE "recurring-create|recurring-manage|recurring-fire|fail|pass"`
Expected: the three scenarios PASS.

- [ ] **Step 3: Diagnose real failures** (keep rule 3 — never weaken to a bare success):
  - **create:** if `recurring.create` rejects the schedule, adjust the `schedule` object to satisfy `rruleInputSchema` (`src/deferred-prompts/types.ts:142-176` — `freq` required; `byHour`/`byMinute` optional arrays). If `project-1` is not a real project in the world provider, seed it (or call `callCapability('tasks.projects.list', {})` first and pass a real id). The list-result fingerprint (`'Standup'`) is the durable-write proof — do not drop it.
  - **manage:** if the list tool result does not surface the title after a pause (e.g. paused recurrences are hidden from the default list), switch the mutation to `recurring.update` renaming the title and assert the **new** title token present and the old absent, or use `recurring.delete` and assert the token **absent** (`.not.toContain`) — any appearing/disappearing pair satisfies rule 3. Pick the shape the real list output supports.
  - **fire:** see Task 3 Step 6 diagnosis (provider `createTask` return; `rrule` round-trip for the notification).

- [ ] **Step 4: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add tests/stories/scheduling/recurring.story.test.ts
git commit -m "test(stories): cover recurring-task create, manage, and fire"
```

---

### Task 6: deferred stories (5 scenarios)

**Files:**

- Create: `tests/stories/scheduling/deferred.story.test.ts`

- [ ] **Step 1: Write the five scenarios**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../harness/scripted-llm.js'

const CHAT_COMPLETIONS = 'https://llm.invalid/v1/chat/completions'

scenario(
  'SCN-deferred-schedule-create: scheduling a prompt persists it for a following list',
  async ({ given, when, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.llm([
      callCapability('deferred.create', {
        prompt: 'Tell me to submit the report',
        schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
        execution: {
          mode: 'lightweight',
          delivery_brief: 'remind about the report',
        },
      }),
      callCapability('deferred.list', {}),
      answer('Scheduled your report reminder for Jan 1.'),
    ])
    await when.message(alice, dm, 'Remind me on Jan 1 to submit the report')
    const last = world.model.inspections().at(-1)
    expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('report'))
  },
)

scenario(
  'SCN-deferred-alert-create: creating a task-condition alert persists it for a following list',
  async ({ given, when, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance())
    given.llm([
      callCapability('deferred.create', {
        prompt: 'Nudge me about overdue tasks',
        condition: { field: 'task.dueDate', op: 'overdue' },
        execution: {
          mode: 'lightweight',
          delivery_brief: 'nudge about overdue work',
        },
      }),
      callCapability('deferred.list', {}),
      answer('I will alert you when a task goes overdue.'),
    ])
    await when.message(alice, dm, 'Alert me when a task is overdue')
    const last = world.model.inspections().at(-1)
    expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('overdue'))
  },
)

scenario(
  'SCN-deferred-manage: cancelling a scheduled prompt is observable on a following list',
  async ({ given, when, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const { id } = given.scheduledPrompt(dm, {
      prompt: 'Submit the report',
      fireAt: '2099-01-01T09:00:00.000Z',
    })
    given.llm([
      callCapability('deferred.cancel', { id }),
      callCapability('deferred.list', {}),
      answer('Cancelled your report reminder.'),
    ])
    await when.message(alice, dm, 'Cancel the report reminder')
    const last = world.model.inspections().at(-1)
    expect(last?.promptToolResultTokenFingerprints).not.toContain(promptTextFingerprint('Submit'))
  },
)

scenario(
  'SCN-deferred-fire-scheduled: a due scheduled prompt delivers a proactive message',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.seedSystemLlmConfig()
    world.http.expect({ method: 'POST', url: CHAT_COMPLETIONS }, () =>
      Response.json({
        id: 'chatcmpl-fire-sched',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Time to submit the report.',
            },
            finish_reason: 'stop',
          },
        ],
      }),
    )
    given.scheduledPrompt(dm, {
      prompt: 'Submit the report',
      fireAt: '2020-01-01T09:00:00.000Z',
    })
    await when.scheduledPoll()
    then.replyTo(alice).contains('submit the report')
  },
)

scenario('SCN-deferred-fire-alert: an overdue task fires a proactive alert', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.assign(dm, given.taskInstance())
  await world.tasks.createTask({
    projectId: 'project-1',
    title: 'Overdue task',
    dueDate: '2020-01-01',
  })
  given.seedSystemLlmConfig()
  world.http.expect({ method: 'POST', url: CHAT_COMPLETIONS }, () =>
    Response.json({
      id: 'chatcmpl-fire-alert',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Heads up: a task is overdue.',
          },
          finish_reason: 'stop',
        },
      ],
    }),
  )
  given.alertPrompt(dm, {
    prompt: 'Nudge me about overdue tasks',
    condition: { field: 'task.dueDate', op: 'overdue' },
  })
  await when.alertPoll()
  then.replyTo(alice).contains('overdue')
})
```

- [ ] **Step 2: Run the stories sandboxed**

Run: `bun test:stories 2>&1 | grep -iE "schedule-create|alert-create|deferred-manage|fire-scheduled|fire-alert|fail|pass"`
Expected: the five scenarios PASS.

- [ ] **Step 3: Diagnose real failures** (keep rule 3):
  - **schedule/alert create:** if `deferred.create` rejects the input, reconcile against `create-deferred-prompt.ts` — the alert branch (`condition`) is only accepted when task conditions are available, which needs a provider (`given.assign(dm, given.taskInstance())`, already present for alert-create). Confirm `execution` matches `executionInputSchema` (`mode`, `delivery_brief`). If the list result does not surface the token, assert on the exact field `list_deferred_prompts` returns (prompt text vs id).
  - **manage:** if a cancelled prompt still appears in the default list, switch the assertion to the status field the list surfaces (e.g. token `cancelled` present) — an appearing/disappearing pair is required, not a bare success.
  - **fire-scheduled:** see Task 4 Step 6 diagnosis (LLM config seeded; delivery target resolves; single non-risky completion).
  - **fire-alert:** if no delivery, confirm the world provider's `listTasks` returns the seeded task **with `dueDate`** (the `overdue` op reads `task.dueDate` off the list item, `condition-eval.ts:45-48`); if `MemoryTaskProvider` omits `dueDate` from list items, seed the task so the field is present (or set the task's due via the provider's update path) — this is the one provider-surface dependency, flagged in the spec risks. Keep the delivered-alert assertion.

- [ ] **Step 4: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add tests/stories/scheduling/deferred.story.test.ts
git commit -m "test(stories): cover deferred schedule/alert create, manage, and fire"
```

---

### Task 7: Ledger + totals update

**Files:**

- Modify: `tests/stories/catalog/coverage.ts` (`EXECUTABLE_STORY_MAPPINGS`, `AUDIT_RECORDS`, `STORY_SEAM_IDS`)
- Modify: `tests/stories/harness/catalog-coverage.test.ts` (counts)
- Modify: `tests/scripts/story-coverage-totals.test.ts` (totals)

**Interfaces:**

- Consumes: the 8 story ids exactly as they appear in the two new files (`<relative path>#<scenario name>`).

- [ ] **Step 1: Update the failing contract totals first** — in `tests/stories/harness/catalog-coverage.test.ts`: the executable total `toHaveLength(87)` → `95`; the pending/audit total `toHaveLength(41)` → `33`; the `needs-seam` readiness `toHaveLength(18)` → `10` (`executable-as-is` stays `1`, `blocked` stays `22`). In `tests/scripts/story-coverage-totals.test.ts`: `executable: 87` → `95`, `pending: 41` → `33`, `readiness: { 'executable-as-is': 1, 'needs-seam': 10, blocked: 22 }`, and the formatted line to:

```ts
'story catalog: 95/128 executable; pending 33 (1 executable-as-is, 10 needs-seam, 22 blocked)',
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test:stories:contracts 2>&1 | grep -iE "coverage|fail"` and `bun test tests/scripts/story-coverage-totals.test.ts`
Expected: FAIL — mapping/audit counts don't match yet.

- [ ] **Step 3: Add `scheduler-chat-di` to the seam id list** — in `tests/stories/catalog/coverage.ts`, add `'scheduler-chat-di',` to the `STORY_SEAM_IDS` array (beside `'scheduler-due-seed',`).

- [ ] **Step 4: Move the 8 entries to `EXECUTABLE_STORY_MAPPINGS`** — add (each `verifiedAt: '2026-07-21'`, `storyIds` matching the exact scenario names from Tasks 5-6):

```ts
  'SCN-reminder-recurring-create': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/scheduling/recurring.story.test.ts#SCN-reminder-recurring-create: creating a recurrence persists it for a following list',
    ],
  },
  'SCN-reminder-recurring-manage': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/scheduling/recurring.story.test.ts#SCN-reminder-recurring-manage: pausing a recurrence is observable on a following list',
    ],
  },
  'SCN-reminder-recurring-fire': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/scheduling/recurring.story.test.ts#SCN-reminder-recurring-fire: a due recurrence creates a task and notifies the user',
    ],
  },
  'SCN-deferred-schedule-create': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/scheduling/deferred.story.test.ts#SCN-deferred-schedule-create: scheduling a prompt persists it for a following list',
    ],
  },
  'SCN-deferred-alert-create': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/scheduling/deferred.story.test.ts#SCN-deferred-alert-create: creating a task-condition alert persists it for a following list',
    ],
  },
  'SCN-deferred-manage': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/scheduling/deferred.story.test.ts#SCN-deferred-manage: cancelling a scheduled prompt is observable on a following list',
    ],
  },
  'SCN-deferred-fire-scheduled': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/scheduling/deferred.story.test.ts#SCN-deferred-fire-scheduled: a due scheduled prompt delivers a proactive message',
    ],
  },
  'SCN-deferred-fire-alert': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/scheduling/deferred.story.test.ts#SCN-deferred-fire-alert: an overdue task fires a proactive alert',
    ],
  },
```

Delete those 8 keys from `AUDIT_RECORDS` (the `// F5 — reminders and deferred work` block). No `GAP_SCENARIO_IDS` change (none of the 8 are gaps).

- [ ] **Step 5: Run the ledger contract tests**

Run: `bun test:stories:contracts 2>&1 | grep -iE "coverage|fail|pass"` and `bun test tests/scripts/story-coverage-totals.test.ts`
Expected: PASS — 95 executable / 33 pending / 10 needs-seam; the `storyIds`-unique and audit-cover-exactly-pending checks pass; the totals-line test matches. Diagnosis: the exact scenario-name strings must match the `scenario('...')` titles in Tasks 5-6 byte-for-byte (the manifest derives ids from the literal call).

- [ ] **Step 6: Format, typecheck, lint, commit**

```bash
bun run format && bun run typecheck && bun run lint
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts
git commit -m "test(stories): map F5 scheduling scenarios and update the ledger totals"
```

---

### Task 8: Spec reconciliation

**Files:**

- Modify: `docs/superpowers/specs/2026-07-21-f5-scheduling-story-family-design.md`

- [ ] **Step 1: Reconcile the learnings** — add a dated `## Post-implementation deviations (2026-07-21)` section (mirroring the F1/F3/F4 precedent) recording whatever diverged during implementation, at minimum: (a) the correction that `canRouteRecurringNotification` returns `true` on a null chat ref, so `scheduler-chat-di` proves the notification specifically (task creation was never gated on it); (b) `SchedulerDeps.chat` chosen over a module-ref setter (no cross-scenario state); (c) the exact `rrule`/`dtstartUtc` seed values that round-trip `markExecuted`; (d) the final manage-scenario mutation shapes (pause vs update vs delete) chosen after diagnosis; (e) the `MemoryTaskProvider` list-item `dueDate` behavior the alert fire relies on; (f) any create-tool input adjustments needed to satisfy the zod schemas.

- [ ] **Step 2: Format + commit**

```bash
bun run format
git add docs/superpowers/specs/2026-07-21-f5-scheduling-story-family-design.md
git commit -m "docs(testing): reconcile F5 spec with implementation learnings"
```

---

### Task 9: Final verification gate

- [ ] **Step 1: Sandboxed story suite** — `bun test:stories` → all stories pass, including the 8 new scheduling scenarios, 0 fail.
- [ ] **Step 2: Sandboxed contract suites** — `bun test:stories:contracts` → all pass (catalog coverage, scenario seams).
- [ ] **Step 3: Touched unit suites** — `bun test tests/tools/core-capabilities-scheduling.test.ts tests/scheduler-chat-di.test.ts tests/scripts/story-coverage-totals.test.ts` and the existing scheduler suite → pass.
- [ ] **Step 4: Typecheck, lint, format** — `bun run typecheck && bun run lint && bun run format:check` → clean.
- [ ] **Step 5: Stress once** — `bun test:stories:stress` → no flakes (the fire scenarios' single-pass drives and the one declared chat route per fire are the determinism surface under scrutiny).
- [ ] **Step 6: Totals line + clean tree + compat** — `bun test:stories:manifest 2>&1 | grep "story catalog"` prints `story catalog: 95/128 executable; pending 33 (1 executable-as-is, 10 needs-seam, 22 blocked)`; then `git status --short` (clean). Because this plan changed frozen harness inputs **and** two production `src/` files, re-record the compat baseline per the repo procedure and confirm `BASE_REF=<new-baseline-sha> bun test:stories:compat --manifest-only` reports the intended delta (the two production seams + harness additions), not an accidental one.

## Self-Review

- **Spec coverage:** `capability-ids` seam = 12 entries (Task 1) ✓; `scheduler-chat-di` seam (Task 2) ✓; `scheduler-due-seed` recurring (Task 3) + deferred (Task 4) ✓; recurring create/manage/fire (Task 5) ✓; deferred schedule-create/alert-create/manage/fire-scheduled/fire-alert (Task 6) ✓; `deferred-fire-alert` rationale correction lands via its executable mapping + spec reconciliation (Tasks 7-8) ✓; new seam id added to `STORY_SEAM_IDS` (Task 7) ✓; ledger 87→95 / 41→33, readiness needs-seam 18→10 (Task 7) ✓; story-mode-only fire footnote honored (declared chat route, Tasks 4/6) ✓; no clock seam (all fires seed past-due rows, Tasks 3-6) ✓; verification incl. compat rebaseline (Task 9) ✓.
- **Placeholder scan:** every code step carries real code or an exact command. The genuine discovery points are flagged with diagnosis steps that preserve rule 3, never silent: the `rrule` round-trip for the recurring notification (Tasks 2/3/5), the create-tool zod inputs (Tasks 5/6), the manage-scenario appearing/disappearing shape (Tasks 5/6), the delivery-target platform resolution (Task 4), and the `MemoryTaskProvider` list-item `dueDate` for the alert fire (Task 6).
- **Type consistency:** `given.recurringTask(context, input) → { id, userId }`, `when.recurringTick()`, `given.scheduledPrompt/alertPrompt(context, input) → { id }`, `when.scheduledPoll()/alertPoll()`, `SchedulerDeps.chat`, and the `callCapability('recurring.*'|'deferred.*', input)` ids are used identically across the seam tasks and the story tasks. `RecurringTaskSeed`/`ScheduledPromptSeed`/`AlertPromptSeed` are produced in `test-helpers.ts` (Tasks 3-4) and consumed by `fixtures.ts` and the DSL. The 12 capability ids produced in Task 1 are the exact ids the stories call in Tasks 5-6.
