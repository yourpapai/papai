<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# nerv — Migration Phase 0 (Reliability & Enablement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the nerv-repo portion of Phase 0 (Reliability & Enablement) of the kiss→papai migration: a typed `POST /tasks/:id/events` wire contract with a dispatch-conditional chat ack (C1), removal of the never-implemented `'steer'` event type (C2), a `cancel` event that actually reaps the task's live magi session(s) before closing (C3), a task-level `outputLanguage` field threaded into the prompt nerv sends magi so agent-facing prose comes back in the user's language (C4), and verification that `GET /health` already satisfies the P0 liveness-probe requirement (C5).

**Architecture:** All changes are additive/narrowing at nerv's existing HTTP + supervisor + prompts layers — no new services, no new collections. `src/http/routes/tasks.ts`'s `eventBody` schema moves from `z.object({ type: z.enum([...]), payload: z.record(z.unknown()) })` to a `z.discriminatedUnion`, giving each event `type` its own typed `payload` shape. `SupervisorService` gains a `cancelTask` method (parallel to the existing `startTask`) that best-effort-cancels every repo's magi session via a new `MagiClient.cancelSession`, then transitions the task to `closed` via the already-injected `TaskService`/`PapaiTaskNotifier`. `Task.outputLanguage` is a new optional schema field threaded from the create-task HTTP body through `TaskService.create` into `SupervisorService.startTask` and `makeChatInstructionHandler`, both of which now prepend a new `buildOperatingInstructionsPreamble(language)` (extracted from `prompts.ts`'s existing shared engineering directives) ahead of the prompt sent to magi. `GET /health` already exists, is already unauthenticated, and is already tested — Task 5 is verification plus a documentation comment, not a body-shape change.

**Tech Stack:** Bun runtime, Fastify 5, Mongoose 8 (MongoDB), Zod 3.24, Vitest 2 (`mongodb-memory-server` for DB-backed tests). Test command: `npx vitest run <path>` from the nerv repo root (`package.json`'s `"test"` script is `vitest run`).

**Repo:** `/Users/ki/Projects/yourpapai/nerv`
**Cross-repo note:** Land this plan BEFORE the papai-side migration plan (nerv must accept the new `POST /tasks` body field and `POST /tasks/:id/events` contract, and actually reap magi sessions on cancel, before papai starts emitting/relying on them). magi needs no change — cancellation reuses magi's existing `POST /sessions/:id/cancel`.

---

## File Structure

Modified:

- `src/http/routes/tasks.ts` — typed `eventBody` discriminated union (C1, C2); `cancel` branch delegates to `deps.supervisor.cancelTask` (C3); `outputLanguage` added to `createTaskBody` (C4).
- `src/supervisor/foundationHandlers.ts` — `makeChatInstructionHandler` gates the papai ack on whether the instruction was actually dispatched to magi (C1); prepends the language preamble to the forwarded prompt (C4).
- `src/services/MagiClient.ts` — new `cancelSession(sessionId)` method (C3).
- `src/supervisor/SupervisorService.ts` — constructor stores `tasks` (was discarded) and gains an optional `notifier` param; new `cancelTask(taskId)` method (C3); `startTask` prepends the language preamble to the prompt sent to magi (C4).
- `src/services/TaskService.ts` — `CreateTaskInput`/`create` gain `outputLanguage` (C4).
- `src/db/models/Task.ts` — `ITask`/`taskSchema` gain `outputLanguage` (C4).
- `src/services/prompts.ts` — shared engineering directives extracted into a language-parameterized helper; new exported `buildOperatingInstructionsPreamble(language)` (C4).
- `src/index.ts` — `SupervisorService` construction passes `notifier` as the 6th arg (C3).
- `src/http/routes/health.ts` — doc comment only, no behavior change (C5).
- `tests/http/server.test.ts` — `makeApp()` wires a shared `notifier` mock into `SupervisorService`; new tests for the typed schema, the cancel-reaps-magi flow, `outputLanguage` persistence, and `/health`'s auth-exempt contract.
- `tests/services/MagiClient.test.ts` — new `cancelSession` test.
- `tests/supervisor/foundationHandlers.test.ts` — new `SupervisorService.cancelTask` describe block; new conditional-ack and language-preamble tests; two existing exact-prompt assertions loosened to `expect.stringContaining`.
- `tests/services/TaskService.test.ts` — new `outputLanguage` persistence test.
- `tests/db/models/taskFields.test.ts` — new `outputLanguage` round-trip test.
- `tests/services/prompts.test.ts` — new `buildOperatingInstructionsPreamble` describe block.
- `tests/integration/handlers.test.ts` — new HTTP→queue→worker→magi contract test (C1); existing `chat_instruction` exact-prompt assertion loosened to `expect.stringContaining`.

No files are deleted. No new files are created.

---

## Task 1: Typed chat-event schema + conditional ack (C1)

**Files:**

- `src/http/routes/tasks.ts` (lines 14-17: `eventBody`)
- `src/supervisor/foundationHandlers.ts` (lines 122-141: `makeChatInstructionHandler`)
- `tests/http/server.test.ts` (add tests near line 57-70)
- `tests/supervisor/foundationHandlers.test.ts` (add test inside the `describe('chat_instruction handler', ...)` block, lines 381-423)
- `tests/integration/handlers.test.ts` (add test near line 232-253; add `buildServer` import)

Today `eventBody` is `z.object({ type: z.enum(['chat_followup', 'steer', 'cancel']), payload: z.record(z.unknown()).default({}) })` — `payload` is opaque to the type system, so a malformed `chat_followup` (e.g. missing `prompt`) is accepted, enqueued, and only fails silently inside `makeChatInstructionHandler` (which reads `(item.payload as { prompt?: string })?.prompt ?? ''`). Separately, `makeChatInstructionHandler` unconditionally tells papai "Got it — applying your instruction" even when there was no live magi session to forward to (nothing was actually dispatched).

- [ ] **Step 1: Write a failing test — the typed schema rejects a `chat_followup` with no `prompt` in its payload**

Add to `tests/http/server.test.ts`, after the existing `'enqueues a chat_instruction on POST /tasks/:id/events'` test:

```ts
it('rejects a chat_followup event whose payload is missing prompt', async () => {
  const { app } = makeApp()
  const created = await app.inject({
    method: 'POST',
    url: '/tasks',
    headers: auth,
    payload: { prompt: 'p', repos: [{ projectPath: 'g/r' }], contextRef: { contextId: 'c1' } },
  })
  const id = created.json().taskId
  const res = await app.inject({
    method: 'POST',
    url: `/tasks/${id}/events`,
    headers: auth,
    payload: { type: 'chat_followup', payload: {} },
  })
  expect(res.statusCode).toBe(400)
})
```

- [ ] **Step 2: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/http/server.test.ts
```

Expected: the new test fails (`expected 400 to be 202` or similar), because `payload: {}` currently satisfies `z.record(z.unknown()).default({})`.

- [ ] **Step 3: Implement — replace `eventBody` with a discriminated union**

In `src/http/routes/tasks.ts`, replace:

```ts
const eventBody = z.object({
  type: z.enum(['chat_followup', 'steer', 'cancel']),
  payload: z.record(z.unknown()).default({}),
})
```

with:

```ts
const eventBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat_followup'), payload: z.object({ prompt: z.string().min(1) }) }),
  z.object({ type: z.literal('steer'), payload: z.object({ prompt: z.string().min(1) }) }),
  z.object({ type: z.literal('cancel') }),
])
```

(`'steer'` is still included here — Task 2 removes it. `cancel` deliberately has no `payload` key, matching the existing `payload: { type: 'cancel' }` request shape used by the "cancel event..." test.)

No other line in `registerTaskRoutes` needs to change: `parsed.data.payload` in the `chat_instruction` enqueue branch is now typed as `{ prompt: string }` instead of `Record<string, unknown>`, which `WorkQueue.enqueueOnce`'s `payload?: unknown` accepts unchanged.

- [ ] **Step 4: Run it — see it pass**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/http/server.test.ts
```

Expected:

```
 ✓ tests/http/server.test.ts (8 tests)
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

- [ ] **Step 5: Write a failing test — the chat ack is gated on actually dispatching to magi**

Add to `tests/supervisor/foundationHandlers.test.ts`, inside `describe('chat_instruction handler', ...)`, after the existing two tests:

```ts
it('does not notify papai when there is no live magi session to forward the instruction to (nothing was actually dispatched)', async () => {
  const magi = { followUp: vi.fn(async () => ({})) }
  const papai = { notify: vi.fn(async () => {}) }
  const t = await tasks.create({
    kind: 'gitlab-mr-supervision',
    contextRef: { contextId: 'c1' },
    source: 'chat',
    prompt: 'p',
    repos: [{ projectPath: 'g/r' }],
  })
  // No repo has a magiSessionId — there is nothing to forward the instruction to.

  const handler = makeChatInstructionHandler()
  const ctx = {
    task: t,
    item: { payload: { prompt: 'also do Y' } },
    magi,
    papai,
    magiDefaults: {},
  } as unknown as HandlerCtx
  await handler(ctx)

  expect(magi.followUp).not.toHaveBeenCalled()
  expect(papai.notify).not.toHaveBeenCalled()
})
```

- [ ] **Step 6: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/supervisor/foundationHandlers.test.ts
```

Expected: fails on `expect(papai.notify).not.toHaveBeenCalled()` — `papai.notify` is currently called unconditionally.

- [ ] **Step 7: Implement — gate the ack on a `dispatched` flag**

In `src/supervisor/foundationHandlers.ts`, replace `makeChatInstructionHandler`:

```ts
export function makeChatInstructionHandler(): Handler {
  return async ({ task, item, magi, papai, projects, magiDefaults }) => {
    const prompt = (item.payload as { prompt?: string })?.prompt ?? ''
    const repo = task.taskRepositories.find((r) => r.magiSessionId)
    let dispatched = false
    if (repo?.magiSessionId && prompt) {
      const credentials = resolveMagiCredentials(
        projects?.getByContextId(task.contextRef.contextId),
        magiDefaults ?? {},
      )
      await magi.followUp(repo.magiSessionId, prompt, credentials)
      dispatched = true
    }
    if (dispatched) {
      await papai.notify({
        contextId: task.contextRef.contextId,
        threadId: task.contextRef.threadId,
        markdown: 'Got it — applying your instruction.',
      })
    }
    task.lastActivity = new Date()
    await task.save()
  }
}
```

- [ ] **Step 8: Run it — see it pass**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/supervisor/foundationHandlers.test.ts
```

Expected:

```
 ✓ tests/supervisor/foundationHandlers.test.ts (18 tests)
 Test Files  1 passed (1)
      Tests  18 passed (18)
```

- [ ] **Step 9: Write the contract test — `payload.prompt` survives verbatim from the HTTP wire to `magi.followUp`**

This is a pinning/characterization test, not a red-step: it should pass immediately once run, since it only exercises behavior already implemented by Steps 3 and 7. It guards the whole C1 pipeline (typed schema → queue → worker → handler → magi) against a future refactor silently mangling the prompt in transit.

Add to `tests/integration/handlers.test.ts`. First add the import:

```ts
import { buildServer } from '../../src/http/server.js'
```

Then add, after the existing `'chat_instruction: real worker.tick()...'` test:

```ts
it('contract: POST /tasks/:id/events payload.prompt survives verbatim through the queue into magi.followUp', async () => {
  const magi = { followUp: vi.fn(async () => ({})), getSession: vi.fn(), startSession: vi.fn() }
  const papai = { notify: vi.fn(async () => {}) }
  const forge = {}
  const { worker, queue } = buildWorker({ magi, papai, forge } as unknown as Omit<WorkerDeps, 'tasks' | 'queue'>)

  const t = await seedTask()
  const notifier = { notifyStatus: vi.fn(async () => {}), notifyReply: vi.fn(async () => {}) }
  const app = buildServer({ authToken: 'secret', tasks, queue, supervisor: {} as never, notifier: notifier as never })

  const res = await app.inject({
    method: 'POST',
    url: `/tasks/${t._id.toString()}/events`,
    headers: { authorization: 'Bearer secret' },
    payload: { type: 'chat_followup', payload: { prompt: 'wire-fidelity-check please rename foo to bar' } },
  })
  expect(res.statusCode).toBe(202)

  expect(await worker.tick()).toBe(true)

  expect(magi.followUp).toHaveBeenCalledWith('sess-1', 'wire-fidelity-check please rename foo to bar', {})
})
```

- [ ] **Step 10: Run it — confirm it passes**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/integration/handlers.test.ts
```

Expected:

```
 ✓ tests/integration/handlers.test.ts (6 tests)
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

- [ ] **Step 11: Full-suite sanity run**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/http/server.test.ts tests/supervisor/foundationHandlers.test.ts tests/integration/handlers.test.ts
```

Expected: `Test Files  3 passed (3)`, `Tests  32 passed (32)`.

- [ ] **Step 12: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/http/routes/tasks.ts src/supervisor/foundationHandlers.ts tests/http/server.test.ts tests/supervisor/foundationHandlers.test.ts tests/integration/handlers.test.ts
git commit -m "feat: typed chat_instruction event schema + conditional ack"
```

---

## Task 2: Drop the unimplemented `'steer'` event type (C2)

**Files:**

- `src/http/routes/tasks.ts` (line 15: `eventBody`)
- `tests/http/server.test.ts` (add test near line 70)

`'steer'` was declared in the original `eventBody` enum but never had distinct handling from `'chat_followup'` (both fell through to the same `chat_instruction` enqueue), and `grep -rn "'steer'"` across `src/`/`tests/` finds only its own enum declaration — no caller, route, or test depends on the literal. It's dead API surface; removing it narrows the wire contract to what nerv actually supports.

- [ ] **Step 1: Write a failing test — `'steer'` is now rejected**

Add to `tests/http/server.test.ts`, after the Task 1 test:

```ts
it('rejects the removed "steer" event type', async () => {
  const { app } = makeApp()
  const created = await app.inject({
    method: 'POST',
    url: '/tasks',
    headers: auth,
    payload: { prompt: 'p', repos: [{ projectPath: 'g/r' }], contextRef: { contextId: 'c1' } },
  })
  const id = created.json().taskId
  const res = await app.inject({
    method: 'POST',
    url: `/tasks/${id}/events`,
    headers: auth,
    payload: { type: 'steer', payload: { prompt: 'x' } },
  })
  expect(res.statusCode).toBe(400)
})
```

- [ ] **Step 2: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/http/server.test.ts
```

Expected: fails (`expected 202 to be 400`) — `'steer'` still passes the discriminated union from Task 1.

- [ ] **Step 3: Implement — remove the `'steer'` variant**

In `src/http/routes/tasks.ts`, change:

```ts
const eventBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat_followup'), payload: z.object({ prompt: z.string().min(1) }) }),
  z.object({ type: z.literal('steer'), payload: z.object({ prompt: z.string().min(1) }) }),
  z.object({ type: z.literal('cancel') }),
])
```

to:

```ts
const eventBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat_followup'), payload: z.object({ prompt: z.string().min(1) }) }),
  z.object({ type: z.literal('cancel') }),
])
```

- [ ] **Step 4: Run it — see it pass**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/http/server.test.ts
```

Expected:

```
 ✓ tests/http/server.test.ts (9 tests)
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/http/routes/tasks.ts tests/http/server.test.ts
git commit -m "fix: drop unused 'steer' event type from task events endpoint"
```

---

## Task 3: `cancel` reaps magi sessions before closing the task (C3)

**Files:**

- `src/services/MagiClient.ts` (add method after `getSession`, currently ending line 105-106)
- `src/supervisor/SupervisorService.ts` (lines 34-41: constructor; new method after `startTask`, currently ending line 111)
- `src/http/routes/tasks.ts` (lines 43-47: `cancel` branch)
- `src/index.ts` (line 51: `SupervisorService` construction)
- `tests/services/MagiClient.test.ts` (add test after line 82, before `'throws on non-2xx'`)
- `tests/supervisor/foundationHandlers.test.ts` (add new `describe('SupervisorService.cancelTask', ...)` block after the existing `describe('SupervisorService.startTask', ...)` block, i.e. after line 174)
- `tests/http/server.test.ts` (lines 11-19: `makeApp()`)

Today, cancelling a task (`POST /tasks/:id/events` with `{ type: 'cancel' }`) only transitions the DB row to `closed` and notifies papai — it never tells magi to stop the underlying coding session, which keeps burning compute/tokens after the user has walked away.

- [ ] **Step 1: Write a failing test — `MagiClient.cancelSession`**

Add to `tests/services/MagiClient.test.ts`, after `'omits credentials individually when only some are supplied'` and before `'throws on non-2xx'`:

```ts
it('cancels a session via POST /sessions/:id/cancel', async () => {
  const f = fakeFetch(200, { ok: true })
  const client = new MagiClient(cfg, f)
  await client.cancelSession('sess-1')
  const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
  expect(url).toBe('http://magi/sessions/sess-1/cancel')
  expect((init as RequestInit).method).toBe('POST')
})
```

- [ ] **Step 2: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/services/MagiClient.test.ts
```

Expected: fails with a TypeScript/runtime error — `client.cancelSession is not a function`.

- [ ] **Step 3: Implement — add `cancelSession` to `MagiClient`**

In `src/services/MagiClient.ts`, add after `getSession`:

```ts
  /** `POST /sessions/:id/cancel` (magi/src/server/router.ts#handleCancel) — best-effort session teardown. */
  cancelSession(sessionId: string): Promise<unknown> {
    return this.call('POST', `/sessions/${sessionId}/cancel`)
  }
```

- [ ] **Step 4: Run it — see it pass**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/services/MagiClient.test.ts
```

Expected:

```
 ✓ tests/services/MagiClient.test.ts (5 tests)
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [ ] **Step 5: Write failing tests — `SupervisorService.cancelTask`**

Add to `tests/supervisor/foundationHandlers.test.ts`, as a new top-level `describe` block placed after the closing `})` of `describe('SupervisorService.startTask', ...)` (line 174) and before `describe('reconcile handler', ...)` (line 176):

```ts
describe('SupervisorService.cancelTask', () => {
  beforeAll(async () => {
    await startTestDb()
  })
  afterAll(async () => {
    await stopTestDb()
  })
  afterEach(async () => {
    await clearDb()
  })

  async function makeMultiRepoTask() {
    const t = await tasks.create({
      kind: 'gitlab-mr-supervision',
      contextRef: { contextId: 'c' },
      source: 'chat',
      prompt: 'p',
      repos: [{ projectPath: 'g/r1' }, { projectPath: 'g/r2' }],
    })
    t.taskRepositories[0].magiSessionId = 'sess-a'
    t.taskRepositories[1].magiSessionId = 'sess-b'
    t.status = 'coding'
    await t.save()
    return t
  }

  it('cancels every repo session with a live magi session and closes the task', async () => {
    const magi = { cancelSession: vi.fn(async () => ({})) }
    const notifier = { notifyStatus: vi.fn(async () => {}), notifyReply: vi.fn(async () => {}) }
    const defaults = { baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude' }
    const sup = new SupervisorService(
      tasks,
      magi as never,
      { magiProjectDefaults: defaults },
      undefined,
      undefined,
      notifier as never,
    )
    const t = await makeMultiRepoTask()

    await sup.cancelTask(t._id.toString())

    expect(magi.cancelSession).toHaveBeenCalledTimes(2)
    expect(magi.cancelSession).toHaveBeenCalledWith('sess-a')
    expect(magi.cancelSession).toHaveBeenCalledWith('sess-b')
    const reloaded = await tasks.get(t._id.toString())
    expect(reloaded?.status).toBe('closed')
    expect(notifier.notifyStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'closed' }), 'closed')
  })

  it('tolerates one session failing to cancel and still closes the task', async () => {
    const magi = {
      cancelSession: vi.fn(async (id: string) => {
        if (id === 'sess-a') throw new Error('magi unreachable')
        return {}
      }),
    }
    const notifier = { notifyStatus: vi.fn(async () => {}), notifyReply: vi.fn(async () => {}) }
    const defaults = { baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude' }
    const sup = new SupervisorService(
      tasks,
      magi as never,
      { magiProjectDefaults: defaults },
      undefined,
      undefined,
      notifier as never,
    )
    const t = await makeMultiRepoTask()

    await sup.cancelTask(t._id.toString())

    expect(magi.cancelSession).toHaveBeenCalledTimes(2)
    const reloaded = await tasks.get(t._id.toString())
    expect(reloaded?.status).toBe('closed')
  })

  it('closes cleanly when no repo has a live magi session', async () => {
    const magi = { cancelSession: vi.fn(async () => ({})) }
    const notifier = { notifyStatus: vi.fn(async () => {}), notifyReply: vi.fn(async () => {}) }
    const defaults = { baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude' }
    const sup = new SupervisorService(
      tasks,
      magi as never,
      { magiProjectDefaults: defaults },
      undefined,
      undefined,
      notifier as never,
    )
    const t = await tasks.create({
      kind: 'gitlab-mr-supervision',
      contextRef: { contextId: 'c' },
      source: 'chat',
      prompt: 'p',
      repos: [{ projectPath: 'g/r' }],
    })

    await sup.cancelTask(t._id.toString())

    expect(magi.cancelSession).not.toHaveBeenCalled()
    const reloaded = await tasks.get(t._id.toString())
    expect(reloaded?.status).toBe('closed')
  })
})
```

- [ ] **Step 6: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/supervisor/foundationHandlers.test.ts
```

Expected: fails — `sup.cancelTask is not a function`.

- [ ] **Step 7: Implement — `SupervisorService` constructor + `cancelTask`**

In `src/supervisor/SupervisorService.ts`, add the import:

```ts
import type { PapaiTaskNotifier } from '../services/PapaiTaskNotifier.js'
```

Change the constructor from:

```ts
export class SupervisorService {
  constructor(
    _tasks: TaskService,
    private readonly magi: MagiClient,
    private readonly cfg: SupervisorConfig,
    private readonly log: Logger = createLogger('supervisor'),
    private readonly projects?: ProjectService,
  ) {}
```

to:

```ts
export class SupervisorService {
  constructor(
    private readonly tasks: TaskService,
    private readonly magi: MagiClient,
    private readonly cfg: SupervisorConfig,
    private readonly log: Logger = createLogger('supervisor'),
    private readonly projects?: ProjectService,
    private readonly notifier?: PapaiTaskNotifier,
  ) {}
```

(This is positionally backward-compatible with every existing `new SupervisorService(...)` call site — `_tasks` was already the first positional arg, just unused; it is now stored as `this.tasks`.)

Then add, after `startTask`'s closing `}` (currently line 111):

```ts

  /**
   * Best-effort magi session teardown for every repo with a live session, then transitions the
   * task to `closed` and notifies papai. A single repo's magi.cancelSession failing (e.g. magi
   * already reaped the session, or is briefly unreachable) must not block the others or leave the
   * task stuck open — cancellation is a one-way, user-initiated action that should always converge
   * on `closed`.
   */
  async cancelTask(taskId: string): Promise<void> {
    if (!this.notifier) throw new Error('SupervisorService.cancelTask requires a notifier')
    const task = await Task.findById(taskId)
    if (!task) throw new Error(`task not found: ${taskId}`)

    for (const repo of task.taskRepositories) {
      if (!repo.magiSessionId) continue
      try {
        await this.magi.cancelSession(repo.magiSessionId)
      } catch (err) {
        this.log.warn(
          `failed to cancel magi session ${repo.magiSessionId} for ${repo.projectPath}: ${error instanceof Error ? error.message : String(error)}`
            .replace('error instanceof', 'err instanceof').replace('String(error)', 'String(err)'),
        )
      }
    }

    const closed = await this.tasks.transition(taskId, 'closed')
    await this.notifier.notifyStatus(closed, 'closed')
  }
```

Note: write the `catch` block's log line directly as (the line above is deliberately awkward — use this exact form instead):

```ts
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.log.warn(`failed to cancel magi session ${repo.magiSessionId} for ${repo.projectPath}: ${message}`)
      }
```

- [ ] **Step 8: Run it — see it pass**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/supervisor/foundationHandlers.test.ts
```

Expected:

```
 ✓ tests/supervisor/foundationHandlers.test.ts (21 tests)
 Test Files  1 passed (1)
      Tests  21 passed (21)
```

- [ ] **Step 9: Wire the route — `cancel` delegates to `SupervisorService.cancelTask`**

In `src/http/routes/tasks.ts`, replace:

```ts
if (parsed.data.type === 'cancel') {
  const closed = await deps.tasks.transition(id, 'closed')
  await deps.notifier.notifyStatus(closed, 'closed')
  return reply.code(202).send({ ok: true })
}
```

with:

```ts
if (parsed.data.type === 'cancel') {
  await deps.supervisor.cancelTask(id)
  return reply.code(202).send({ ok: true })
}
```

- [ ] **Step 10: Update `tests/http/server.test.ts`'s `makeApp()` to wire a shared `notifier` into `SupervisorService`**

Replace:

```ts
function makeApp() {
  const queue = new WorkQueue({ leaseMs: 1000, maxAttempts: 3 })
  const magi = { startSession: vi.fn(async () => ({ id: 'sess-1', status: 'queued' })) }
  const supervisor = new SupervisorService(tasks, magi as never, {
    magiProjectDefaults: { baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude' },
  })
  const notifier = { notifyStatus: vi.fn(async () => {}), notifyReply: vi.fn(async () => {}) }
  return { app: buildServer({ authToken: 'secret', tasks, queue, supervisor, notifier: notifier as never }), notifier }
}
```

with:

```ts
function makeApp() {
  const queue = new WorkQueue({ leaseMs: 1000, maxAttempts: 3 })
  const magi = { startSession: vi.fn(async () => ({ id: 'sess-1', status: 'queued' })) }
  const notifier = { notifyStatus: vi.fn(async () => {}), notifyReply: vi.fn(async () => {}) }
  const supervisor = new SupervisorService(
    tasks,
    magi as never,
    { magiProjectDefaults: { baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude' } },
    undefined,
    undefined,
    notifier as never,
  )
  return { app: buildServer({ authToken: 'secret', tasks, queue, supervisor, notifier: notifier as never }), notifier }
}
```

(The existing `'cancel event transitions the task to closed and notifies papai'` test needs no assertion changes — `cancelTask` reaches the same end state via the same `notifier.notifyStatus` call. The `magi` mock only implements `startSession`, so when `cancelTask` reaches the point of calling `magi.cancelSession(...)` on the repo whose session was started by the earlier fire-and-forget `startTask`, it throws inside `cancelTask`'s try/catch — caught, logged, and the task still closes, exactly like the "tolerates one session failing" case in Step 5.)

- [ ] **Step 11: Run the HTTP suite — confirm the existing cancel test still passes and nothing regressed**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/http/server.test.ts
```

Expected:

```
 ✓ tests/http/server.test.ts (9 tests)
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

- [ ] **Step 12: Wire production — `src/index.ts` passes `notifier` into `SupervisorService`**

Change line 51 from:

```ts
const supervisor = new SupervisorService(
  tasks,
  magi,
  { magiProjectDefaults: cfg.magiProjectDefaults },
  undefined,
  projects,
)
```

to:

```ts
const supervisor = new SupervisorService(
  tasks,
  magi,
  { magiProjectDefaults: cfg.magiProjectDefaults },
  undefined,
  projects,
  notifier,
)
```

(`notifier` is already constructed at line 45, above this line.)

- [ ] **Step 13: Type-check + full nerv suite**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx tsc --noEmit && npx vitest run
```

Expected: `tsc` exits 0 with no output; vitest reports every test file passing (no regressions in `tests/integration/lifecycle.test.ts` — it never asserts `magi.cancelSession`).

- [ ] **Step 14: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/services/MagiClient.ts src/supervisor/SupervisorService.ts src/http/routes/tasks.ts src/index.ts tests/services/MagiClient.test.ts tests/supervisor/foundationHandlers.test.ts tests/http/server.test.ts
git commit -m "feat: cancel event reaps magi sessions before closing the task"
```

---

## Task 4: Task-level output language threaded into magi prompts (C4)

**Files:**

- `src/db/models/Task.ts` (lines 41-64: `ITask`; lines 84-102: `taskSchema`)
- `src/services/TaskService.ts` (lines 5-12: `CreateTaskInput`; lines 17-32: `create`)
- `src/http/routes/tasks.ts` (lines 5-12: `createTaskBody`)
- `src/services/prompts.ts` (lines 58-77: `buildEngineeringOperatingInstructions`)
- `src/supervisor/SupervisorService.ts` (lines 44-111: `startTask`)
- `src/supervisor/foundationHandlers.ts` (lines 122-141: `makeChatInstructionHandler`, as left by Task 1)
- `tests/db/models/taskFields.test.ts` (add test after line 68)
- `tests/services/TaskService.test.ts` (add test after line 26)
- `tests/http/server.test.ts` (add test near the Task 2 test)
- `tests/services/prompts.test.ts` (add describe block; add import)
- `tests/supervisor/foundationHandlers.test.ts` (add test in `SupervisorService.startTask` block; loosen 2 existing assertions; add test in `chat_instruction handler` block; loosen 2 existing assertions)
- `tests/integration/handlers.test.ts` (loosen 2 existing assertions from Task 1 / pre-existing)

`prompts.ts` already owns nerv's entire agent-operating-instructions text, including a hardcoded `"in English"` clause, but `generateTaskPrompt` and friends are dead code — the live path (`SupervisorService.startTask`, `makeChatInstructionHandler`) forwards `task.prompt` to magi verbatim, with no operating-instructions preamble at all. This task adds a task-level `outputLanguage` field and a new, minimal, language-parameterized preamble (extracted from the existing shared engineering directives) that both live call sites prepend to the prompt they send magi. Per the design's "kept minimal and language-focused for P0" scope, the dead `RESULT_FORMAT_*` consts / `generate*Prompt` functions and their mode-specific bullets are **not** touched or rewired in this task.

### Part A — schema + service + route field

- [ ] **Step 1: Write a failing test — `Task.outputLanguage` round-trips**

Add to `tests/db/models/taskFields.test.ts`, after the existing `'leaves the new fields undefined/defaulted when omitted'` test:

```ts
it('round-trips outputLanguage when set, and leaves it undefined when omitted', async () => {
  const withLanguage = await Task.create({
    ...baseInput,
    outputLanguage: 'Russian',
    taskRepositories: [{ projectPath: 'group/repo' }],
  })
  const reloadedWithLanguage = await Task.findById(withLanguage._id)
  expect(reloadedWithLanguage!.outputLanguage).toBe('Russian')

  const withoutLanguage = await Task.create({ ...baseInput, taskRepositories: [{ projectPath: 'group/repo' }] })
  const reloadedWithoutLanguage = await Task.findById(withoutLanguage._id)
  expect(reloadedWithoutLanguage!.outputLanguage).toBeUndefined()
})
```

- [ ] **Step 2: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/db/models/taskFields.test.ts
```

Expected: fails — `reloadedWithLanguage!.outputLanguage` is `undefined` (the field isn't declared, so Mongoose strips it).

- [ ] **Step 3: Implement — add `outputLanguage` to `Task.ts`**

In `src/db/models/Task.ts`, in `ITask`, add after `modelProvider?: ModelProvider`:

```ts
  /** Preferred output language for the task's primary result (MR titles/descriptions, chat replies, [RESULT] fields); nerv defaults to English when unset. */
  outputLanguage?: string
```

In `taskSchema`, add after `modelProvider: { type: Schema.Types.Mixed, default: undefined },`:

```ts
  outputLanguage: { type: String, default: undefined },
```

- [ ] **Step 4: Run it — see it pass**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/db/models/taskFields.test.ts
```

Expected:

```
 ✓ tests/db/models/taskFields.test.ts (3 tests)
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

- [ ] **Step 5: Write a failing test — `TaskService.create` persists `outputLanguage`**

Add to `tests/services/TaskService.test.ts`, after `'creates a task in status new with one repo'`:

```ts
it('persists outputLanguage when provided, and leaves it undefined when omitted', async () => {
  const withLanguage = await svc.create({ ...sampleInput, outputLanguage: 'Russian' })
  expect(withLanguage.outputLanguage).toBe('Russian')

  const withoutLanguage = await svc.create(sampleInput)
  expect(withoutLanguage.outputLanguage).toBeUndefined()
})
```

- [ ] **Step 6: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/services/TaskService.test.ts
```

Expected: fails on the TypeScript-visible `outputLanguage` property not existing on `CreateTaskInput` (or, if run without a type-check gate, `withLanguage.outputLanguage` is `undefined` because `create` never forwards it).

- [ ] **Step 7: Implement — thread `outputLanguage` through `TaskService`**

In `src/services/TaskService.ts`, add to `CreateTaskInput`:

```ts
export interface CreateTaskInput {
  kind: string
  contextRef: ContextRef
  source: 'chat' | 'forge-event'
  prompt: string
  repos: { projectPath: string }[]
  costBudgetUsd?: number | null
  outputLanguage?: string
}
```

In `create`, add `outputLanguage: input.outputLanguage,` to the `Task.create({...})` call:

```ts
  async create(input: CreateTaskInput): Promise<HydratedDocument<ITask>> {
    return Task.create({
      kind: input.kind,
      contextRef: input.contextRef,
      source: input.source,
      prompt: input.prompt,
      status: 'new',
      costBudgetUsd: input.costBudgetUsd ?? null,
      outputLanguage: input.outputLanguage,
      taskRepositories: input.repos.map((r) => ({
        projectPath: r.projectPath,
        pipelineJobTrackList: [],
        processedNoteIds: [],
        processedJobIds: [],
      })),
    })
  }
```

- [ ] **Step 8: Run it — see it pass**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/services/TaskService.test.ts
```

Expected:

```
 ✓ tests/services/TaskService.test.ts (6 tests)
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

- [ ] **Step 9: Write a failing test — `POST /tasks` persists `outputLanguage`**

Add to `tests/http/server.test.ts`, after the Task 2 `'rejects the removed "steer" event type'` test:

```ts
it('persists outputLanguage from the create-task body when provided', async () => {
  const { app } = makeApp()
  const res = await app.inject({
    method: 'POST',
    url: '/tasks',
    headers: auth,
    payload: {
      prompt: 'do X',
      repos: [{ projectPath: 'g/r' }],
      contextRef: { contextId: 'c1' },
      outputLanguage: 'Russian',
    },
  })
  expect(res.statusCode).toBe(201)
  const id = res.json().taskId
  const got = await app.inject({ method: 'GET', url: `/tasks/${id}`, headers: auth })
  expect(got.json().outputLanguage).toBe('Russian')
})
```

- [ ] **Step 10: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/http/server.test.ts
```

Expected: fails — `createTaskBody.safeParse` strips `outputLanguage` (unknown key not declared on the schema is dropped by default Zod object parsing behavior is actually pass-through-stripped only for unrecognized keys, so `got.json().outputLanguage` is `undefined`).

- [ ] **Step 11: Implement — add `outputLanguage` to `createTaskBody`**

In `src/http/routes/tasks.ts`, add to `createTaskBody`:

```ts
const createTaskBody = z.object({
  kind: z.string().default('gitlab-mr-supervision'),
  prompt: z.string().min(1),
  repos: z.array(z.object({ projectPath: z.string().min(1) })).min(1),
  contextRef: z.object({ contextId: z.string().min(1), threadId: z.string().optional() }),
  source: z.enum(['chat', 'forge-event']).default('chat'),
  costBudgetUsd: z.number().nullable().optional(),
  outputLanguage: z.string().optional(),
})
```

- [ ] **Step 12: Run it — see it pass**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/http/server.test.ts
```

Expected:

```
 ✓ tests/http/server.test.ts (10 tests)
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

### Part B — the language-parameterized preamble

- [ ] **Step 13: Write a failing test — `buildOperatingInstructionsPreamble`**

Add to `tests/services/prompts.test.ts`. First add `buildOperatingInstructionsPreamble` to the import list from `'../../src/services/prompts.js'` (alongside `buildEngineeringOperatingInstructions`). Then add a new describe block after `describe('buildEngineeringOperatingInstructions', ...)`:

```ts
describe('buildOperatingInstructionsPreamble', () => {
  it('defaults to English', () => {
    const preamble = buildOperatingInstructionsPreamble()
    expect(preamble).toContain('Write all user-facing prose (the answer, MR description text, replies) in English.')
  })

  it('substitutes the given language', () => {
    const preamble = buildOperatingInstructionsPreamble('Russian')
    expect(preamble).toContain('Write all user-facing prose (the answer, MR description text, replies) in Russian.')
    expect(preamble).not.toContain('in English.')
  })

  it('is the same shared-directives text buildEngineeringOperatingInstructions embeds for English', () => {
    const preamble = buildOperatingInstructionsPreamble('English')
    const full = buildEngineeringOperatingInstructions('task')
    expect(full).toContain(preamble)
  })
})
```

- [ ] **Step 14: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/services/prompts.test.ts
```

Expected: fails — `buildOperatingInstructionsPreamble` is not exported yet (import error / `is not a function`).

- [ ] **Step 15: Implement — extract the shared directives, add `buildOperatingInstructionsPreamble`**

In `src/services/prompts.ts`, replace:

```ts
export function buildEngineeringOperatingInstructions(mode: EngineeringOperatingMode = 'task'): string {
  const shared = [
    `**Engineering operating instructions:**`,
    `- Classify the request before acting: code change, answer-only, design-only, review-comment fix, pipeline fix, formatting retry, or MR adoption.`,
    `- Understand the expected outcome and constraints first; inspect the relevant codebase, AGENTS.md, CONTRIBUTING.md, attached files, repository context, and MCP/tool outputs before changing code.`,
    `- Plan briefly, then implement the smallest focused change that satisfies the task; follow existing patterns and avoid unrelated refactors.`,
    `- Validate with the most relevant tests, type checks, linters, builds, or targeted commands available; if validation cannot run, explain why and what you checked instead.`,
    `- Definition of done: requested behavior is implemented or answered, downstream result fields are complete, no unrelated changes are introduced, and final response summarizes changes plus validation.`,
    `- When ambiguous, choose the simplest interpretation that matches the request; ask only if you cannot safely proceed after inspecting the repo.`,
    `- Security: never read, print, or exfiltrate secrets or credentials. Do NOT open environment files (\`.env\`, \`.env.*\`), the process environment (\`/proc/self/environ\` or any \`/proc/*/environ\`), the Qwen settings directory (\`.qwen/\`, \`.qwen/**\`), and do NOT dump environment variables (\`env\`, \`printenv\`, \`set\`, \`node -e process.env\`). These paths are blocked and irrelevant to the task — any configuration you need is in the repository or task context.`,
    `- Never transmit environment data, secrets, source code, or repository contents to any external service. \`curl\`/\`wget\` are allowed for plain GET reads only — POST/PUT/PATCH/DELETE and any body/form/file upload are blocked. You must NOT smuggle environment values, secrets, or repository data into URLs or query-string parameters of a GET request. Use WebFetch for reading public references, never for uploading.`,
    `- Use MCP/tools when they provide needed repo, issue, MR, browser, attachment, or CI context; mention only important findings, not tool chatter.`,
    `- If you only partially succeed or cannot fix the issue, state the blocker, what changed, what was validated, and the next concrete step.`,
    `- Write all user-facing prose (the answer, MR description text, replies) in English. MR/commit titles must follow the naming convention from CONTRIBUTING.md — read it to determine the exact format for the target repository. Keep code, identifiers, file paths, commands, and branch/commit naming unchanged.`,
    `- Format every user-facing answer as rich GitHub-flavored Markdown (both Mattermost and GitLab render it). For any multi-part or analytical answer: structure it with \`##\`/\`###\` headings, use Markdown tables for comparisons or structured facts (IPs, fields, mappings), fenced code blocks for code/logs/traces, inline \`code\` for identifiers/values, and **bold** for key terms. Prefer headings and tables over deep nested bullet lists — reserve bullet/numbered lists for genuinely list-like content. Short answers stay short; do not pad them with empty headings.`,
  ]
```

with:

```ts
/**
 * Shared engineering directives, parameterized by the language the agent should write
 * user-facing prose in. Extracted so `buildOperatingInstructionsPreamble` (the minimal,
 * language-aware preamble prepended to nerv's live task/chat-instruction prompts) and
 * `buildEngineeringOperatingInstructions` (the full mode-aware instructions used by the
 * currently-unwired generate*Prompt functions below) share one source of truth.
 */
function buildSharedEngineeringDirectives(language: string): string[] {
  return [
    `**Engineering operating instructions:**`,
    `- Classify the request before acting: code change, answer-only, design-only, review-comment fix, pipeline fix, formatting retry, or MR adoption.`,
    `- Understand the expected outcome and constraints first; inspect the relevant codebase, AGENTS.md, CONTRIBUTING.md, attached files, repository context, and MCP/tool outputs before changing code.`,
    `- Plan briefly, then implement the smallest focused change that satisfies the task; follow existing patterns and avoid unrelated refactors.`,
    `- Validate with the most relevant tests, type checks, linters, builds, or targeted commands available; if validation cannot run, explain why and what you checked instead.`,
    `- Definition of done: requested behavior is implemented or answered, downstream result fields are complete, no unrelated changes are introduced, and final response summarizes changes plus validation.`,
    `- When ambiguous, choose the simplest interpretation that matches the request; ask only if you cannot safely proceed after inspecting the repo.`,
    `- Security: never read, print, or exfiltrate secrets or credentials. Do NOT open environment files (\`.env\`, \`.env.*\`), the process environment (\`/proc/self/environ\` or any \`/proc/*/environ\`), the Qwen settings directory (\`.qwen/\`, \`.qwen/**\`), and do NOT dump environment variables (\`env\`, \`printenv\`, \`set\`, \`node -e process.env\`). These paths are blocked and irrelevant to the task — any configuration you need is in the repository or task context.`,
    `- Never transmit environment data, secrets, source code, or repository contents to any external service. \`curl\`/\`wget\` are allowed for plain GET reads only — POST/PUT/PATCH/DELETE and any body/form/file upload are blocked. You must NOT smuggle environment values, secrets, or repository data into URLs or query-string parameters of a GET request. Use WebFetch for reading public references, never for uploading.`,
    `- Use MCP/tools when they provide needed repo, issue, MR, browser, attachment, or CI context; mention only important findings, not tool chatter.`,
    `- If you only partially succeed or cannot fix the issue, state the blocker, what changed, what was validated, and the next concrete step.`,
    `- Write all user-facing prose (the answer, MR description text, replies) in ${language}. MR/commit titles must follow the naming convention from CONTRIBUTING.md — read it to determine the exact format for the target repository. Keep code, identifiers, file paths, commands, and branch/commit naming unchanged.`,
    `- Format every user-facing answer as rich GitHub-flavored Markdown (both Mattermost and GitLab render it). For any multi-part or analytical answer: structure it with \`##\`/\`###\` headings, use Markdown tables for comparisons or structured facts (IPs, fields, mappings), fenced code blocks for code/logs/traces, inline \`code\` for identifiers/values, and **bold** for key terms. Prefer headings and tables over deep nested bullet lists — reserve bullet/numbered lists for genuinely list-like content. Short answers stay short; do not pad them with empty headings.`,
  ]
}

/**
 * Minimal, language-parameterized preamble — just the shared engineering directives (not the
 * mode-specific rules below) — prepended to the live task/chat-instruction prompt sent to magi,
 * so the agent's user-facing prose (MR description, chat replies, [RESULT] Reply field) comes
 * back in the task's configured output language. Kept separate from
 * `buildEngineeringOperatingInstructions` (whose mode-specific rules are unused in the live
 * wiring today — see the module doc above for why the RESULT_FORMAT_*/generate*Prompt apparatus
 * below isn't yet on nerv's live path) to keep the P0 change minimal and language-focused.
 */
export function buildOperatingInstructionsPreamble(language: string = 'English'): string {
  return buildSharedEngineeringDirectives(language).join('\n')
}

export function buildEngineeringOperatingInstructions(mode: EngineeringOperatingMode = 'task'): string {
  const shared = buildSharedEngineeringDirectives('English')
```

(The rest of `buildEngineeringOperatingInstructions` — the `byMode` map and the return statement — is unchanged.)

- [ ] **Step 16: Run it — see it pass, and confirm no regression in the existing 52 prompts tests**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/services/prompts.test.ts
```

Expected:

```
 ✓ tests/services/prompts.test.ts (55 tests)
 Test Files  1 passed (1)
      Tests  55 passed (55)
```

### Part C — wire the preamble into the two live prompt call sites

- [ ] **Step 17: Write a failing test — `SupervisorService.startTask` prepends the preamble**

Add to `tests/supervisor/foundationHandlers.test.ts`, inside `describe('SupervisorService.startTask', ...)`, after the existing `'omits projectSpec.mcp and logs a warning...'` test (before that describe block's closing `})`):

```ts
it('prepends the operating-instructions preamble (language-aware) ahead of the task prompt sent to magi', async () => {
  const magi = { startSession: vi.fn(async () => ({ id: 'sess-14', status: 'queued' })) }
  const defaults = { baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude' }
  const sup = new SupervisorService(tasks, magi as never, { magiProjectDefaults: defaults })
  const t = await tasks.create({
    kind: 'gitlab-mr-supervision',
    contextRef: { contextId: 'c-lang' },
    source: 'chat',
    prompt: 'build X',
    repos: [{ projectPath: 'g/r' }],
    outputLanguage: 'Russian',
  })

  await sup.startTask(t._id.toString())

  const call = magi.startSession.mock.calls[0][0] as unknown as { prompt: string }
  expect(call.prompt).toContain('Engineering operating instructions:')
  expect(call.prompt).toContain('in Russian.')
  expect(call.prompt).toContain('build X')
  expect(call.prompt.indexOf('Engineering operating instructions:')).toBeLessThan(call.prompt.indexOf('build X'))
})
```

- [ ] **Step 18: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/supervisor/foundationHandlers.test.ts
```

Expected: fails — `call.prompt` is exactly `'build X'`, contains no preamble text.

- [ ] **Step 19: Implement — inject the preamble in `SupervisorService.startTask`, and fix the two pre-existing exact-prompt assertions it breaks**

In `src/supervisor/SupervisorService.ts`, add the import:

```ts
import { buildOperatingInstructionsPreamble } from '../services/prompts.js'
```

In `startTask`, add right after `const defaults = this.cfg.magiProjectDefaults`:

```ts
const language = task.outputLanguage ?? 'English'
const promptWithPreamble = `${buildOperatingInstructionsPreamble(language)}\n\n${task.prompt}`
```

Then change the `startInput` construction's `prompt: task.prompt,` to `prompt: promptWithPreamble,`:

```ts
const startInput: StartSessionInput = {
  contextId,
  prompt: promptWithPreamble,
  projectSpec,
  ...(repo.mrIid !== undefined ? { prNumber: repo.mrIid } : {}),
  ...(secrets !== undefined ? { secrets } : {}),
  ...(forgeToken !== undefined ? { forgeToken } : {}),
  ...(mcpToken !== undefined ? { mcpToken } : {}),
}
```

This makes the prompt no longer exactly `'build X'` in two pre-existing tests. In `tests/supervisor/foundationHandlers.test.ts`, `describe('SupervisorService.startTask', ...)`:

In `'starts a magi session per repo, records the session id, and moves to coding'`, change:

```ts
      expect.objectContaining({
        contextId: 'c',
        prompt: 'build X',
        projectSpec: expect.objectContaining({ name: 'g/r', baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude' }),
      }),
```

to:

```ts
      expect.objectContaining({
        contextId: 'c',
        prompt: expect.stringContaining('build X'),
        projectSpec: expect.objectContaining({ name: 'g/r', baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude' }),
      }),
```

In `"forwards model/providerHost/mcp/mcpToken/forgeToken/secrets from config defaults when configured"`, change:

```ts
      expect.objectContaining({
        contextId: 'c-wired',
        prompt: 'build X',
        projectSpec: expect.objectContaining({
```

to:

```ts
      expect.objectContaining({
        contextId: 'c-wired',
        prompt: expect.stringContaining('build X'),
        projectSpec: expect.objectContaining({
```

- [ ] **Step 20: Run it — see all `SupervisorService.startTask` tests pass**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/supervisor/foundationHandlers.test.ts
```

Expected:

```
 ✓ tests/supervisor/foundationHandlers.test.ts (22 tests)
 Test Files  1 passed (1)
      Tests  22 passed (22)
```

- [ ] **Step 21: Write a failing test — `makeChatInstructionHandler` prepends the preamble**

Add to `tests/supervisor/foundationHandlers.test.ts`, inside `describe('chat_instruction handler', ...)`, after the Task 1 `'does not notify papai when there is no live magi session...'` test:

```ts
it('prepends the operating-instructions preamble (language-aware) ahead of the forwarded prompt', async () => {
  const magi = { followUp: vi.fn(async () => ({})) }
  const papai = { notify: vi.fn(async () => {}) }
  const t = await tasks.create({
    kind: 'gitlab-mr-supervision',
    contextRef: { contextId: 'c1' },
    source: 'chat',
    prompt: 'p',
    repos: [{ projectPath: 'g/r' }],
    outputLanguage: 'Russian',
  })
  t.taskRepositories[0].magiSessionId = 'sess-9'
  await t.save()

  const handler = makeChatInstructionHandler()
  const ctx = {
    task: t,
    item: { payload: { prompt: 'also do Y' } },
    magi,
    papai,
    magiDefaults: {},
  } as unknown as HandlerCtx
  await handler(ctx)

  const [sessionId, forwardedPrompt] = magi.followUp.mock.calls[0] as unknown as [string, string]
  expect(sessionId).toBe('sess-9')
  expect(forwardedPrompt).toContain('Engineering operating instructions:')
  expect(forwardedPrompt).toContain('in Russian.')
  expect(forwardedPrompt).toContain('also do Y')
})
```

- [ ] **Step 22: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/supervisor/foundationHandlers.test.ts
```

Expected: fails — `forwardedPrompt` is exactly `'also do Y'`, no preamble.

- [ ] **Step 23: Implement — inject the preamble in `makeChatInstructionHandler`, and fix the two pre-existing exact-prompt assertions it breaks**

In `src/supervisor/foundationHandlers.ts`, add the import:

```ts
import { buildOperatingInstructionsPreamble } from '../services/prompts.js'
```

Change `makeChatInstructionHandler` (as left by Task 1's Step 7):

```ts
export function makeChatInstructionHandler(): Handler {
  return async ({ task, item, magi, papai, projects, magiDefaults }) => {
    const prompt = (item.payload as { prompt?: string })?.prompt ?? ''
    const repo = task.taskRepositories.find((r) => r.magiSessionId)
    let dispatched = false
    if (repo?.magiSessionId && prompt) {
      const credentials = resolveMagiCredentials(
        projects?.getByContextId(task.contextRef.contextId),
        magiDefaults ?? {},
      )
      const language = task.outputLanguage ?? 'English'
      const promptWithPreamble = `${buildOperatingInstructionsPreamble(language)}\n\n${prompt}`
      await magi.followUp(repo.magiSessionId, promptWithPreamble, credentials)
      dispatched = true
    }
    if (dispatched) {
      await papai.notify({
        contextId: task.contextRef.contextId,
        threadId: task.contextRef.threadId,
        markdown: 'Got it — applying your instruction.',
      })
    }
    task.lastActivity = new Date()
    await task.save()
  }
}
```

In `tests/supervisor/foundationHandlers.test.ts`, `describe('chat_instruction handler', ...)`, change the two pre-existing tests:

`'follows up on the first repo session and notifies papai'`:

```ts
expect(magi.followUp).toHaveBeenCalledWith('sess-9', 'also do Y', {})
```

to:

```ts
expect(magi.followUp).toHaveBeenCalledWith('sess-9', expect.stringContaining('also do Y'), {})
```

`'resupplies forgeToken/mcpToken/secrets from magiDefaults on the follow-up...'`:

```ts
expect(magi.followUp).toHaveBeenCalledWith('sess-9', 'also do Y', magiDefaults)
```

to:

```ts
expect(magi.followUp).toHaveBeenCalledWith('sess-9', expect.stringContaining('also do Y'), magiDefaults)
```

- [ ] **Step 24: Run it — the full file passes**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/supervisor/foundationHandlers.test.ts
```

Expected:

```
 ✓ tests/supervisor/foundationHandlers.test.ts (24 tests)
 Test Files  1 passed (1)
      Tests  24 passed (24)
```

- [ ] **Step 25: Fix the two remaining exact-prompt assertions the preamble injection breaks elsewhere**

`tests/integration/handlers.test.ts`'s pre-existing `'chat_instruction: real worker.tick() drives the registered handler...'` test:

```ts
expect(magi.followUp).toHaveBeenCalledWith('sess-1', 'also do Y', {})
```

to:

```ts
expect(magi.followUp).toHaveBeenCalledWith('sess-1', expect.stringContaining('also do Y'), {})
```

And Task 1's Step 9 contract test in the same file (`'contract: POST /tasks/:id/events payload.prompt survives verbatim...'`):

```ts
expect(magi.followUp).toHaveBeenCalledWith('sess-1', 'wire-fidelity-check please rename foo to bar', {})
```

to:

```ts
expect(magi.followUp).toHaveBeenCalledWith(
  'sess-1',
  expect.stringContaining('wire-fidelity-check please rename foo to bar'),
  {},
)
```

- [ ] **Step 26: Run it — confirm this file passes**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/integration/handlers.test.ts
```

Expected:

```
 ✓ tests/integration/handlers.test.ts (6 tests)
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

- [ ] **Step 27: Type-check + full nerv suite**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx tsc --noEmit && npx vitest run
```

Expected: `tsc` exits 0 with no output; every vitest test file passes, including `tests/integration/lifecycle.test.ts` unchanged (it only asserts `magi.followUp`/`magi.getSession` call counts and `.toContain(...)` substrings on the review/self-review prompts, never an exact-equality prompt string, so the preamble injection into `startTask`/`makeChatInstructionHandler` does not affect it — `review_comment`/`pipeline_failure`/`self_review` handlers are untouched by this task).

- [ ] **Step 28: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/db/models/Task.ts src/services/TaskService.ts src/http/routes/tasks.ts src/services/prompts.ts src/supervisor/SupervisorService.ts src/supervisor/foundationHandlers.ts tests/db/models/taskFields.test.ts tests/services/TaskService.test.ts tests/http/server.test.ts tests/services/prompts.test.ts tests/supervisor/foundationHandlers.test.ts tests/integration/handlers.test.ts
git commit -m "feat: thread task-level output language into magi prompts"
```

---

## Task 5: Verify `GET /health` satisfies the P0 liveness-probe requirement (C5)

**Files:**

- `src/http/routes/health.ts` (full file, 6 lines)
- `tests/http/server.test.ts` (add test after the existing `'GET /health needs no auth'` test)

`GET /health` already exists (`src/http/routes/health.ts`), is already registered in `src/http/server.ts` before the bearer-auth hook (so it needs no token), already returns `200 { status: 'ok' }`, and is already covered by `tests/http/server.test.ts`'s `'GET /health needs no auth'` test. No body-shape change is made here (see "Spec ambiguities resolved" in the handoff below) — this task adds one more regression test plus a documentation comment.

- [ ] **Step 1: Write the additional regression test — `/health` is never gated by auth, even with a bogus token**

Add to `tests/http/server.test.ts`, immediately after `'GET /health needs no auth'`:

```ts
it('GET /health responds 200 even with a bogus Authorization header (never gated by auth)', async () => {
  const { app } = makeApp()
  const res = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { authorization: 'Bearer not-the-real-token' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ status: 'ok' })
})
```

This is a pinning/regression test (not a red step): `registerHealthRoute(app)` in `src/http/server.ts` is already called before `app.register(async (scoped) => { scoped.addHook('preHandler', auth); ... })`, so `/health` is structurally outside the auth-scoped plugin and this passes immediately — it guards against a future refactor accidentally moving the route inside the auth scope.

- [ ] **Step 2: Run it — confirm it passes**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/http/server.test.ts
```

Expected:

```
 ✓ tests/http/server.test.ts (11 tests)
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

- [ ] **Step 3: Add a documentation comment to `health.ts`**

Replace `src/http/routes/health.ts`:

```ts
import type { FastifyInstance } from 'fastify'

export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/health', async () => ({ status: 'ok' }))
}
```

with:

```ts
import type { FastifyInstance } from 'fastify'

/**
 * Liveness/readiness probe for infra + papai's health checks (migration P0 / Component 5).
 * Deliberately unauthenticated (registered in server.ts before the bearer-auth hook) and free of
 * DB/magi/papai dependencies, so it reflects only "the process is up and serving HTTP" — callers
 * should treat any 2xx as healthy rather than depend on this exact body shape.
 */
export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/health', async () => ({ status: 'ok' }))
}
```

- [ ] **Step 4: Full nerv suite — final sanity check for the whole plan**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx tsc --noEmit && npx vitest run
```

Expected: `tsc` exits 0 with no output; every test file across the suite passes (health, tasks routes, MagiClient, SupervisorService/foundationHandlers, TaskService, Task model, prompts, integration/handlers, integration/lifecycle).

- [ ] **Step 5: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/http/routes/health.ts tests/http/server.test.ts
git commit -m "docs: document /health as the P0 liveness-probe contract"
```

---

## Spec-coverage self-check

| Spec component (nerv-side)                                                                                                               | Task   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| C1 — typed `POST /tasks/:id/events` schema + conditional chat ack + contract test                                                        | Task 1 |
| C2 — drop the unimplemented `'steer'` event type                                                                                         | Task 2 |
| C3 — `cancel` reaps magi session(s) before closing (`MagiClient.cancelSession`, `SupervisorService.cancelTask`, route wiring)            | Task 3 |
| C4 — task-level `outputLanguage` threaded into the magi-bound prompt (schema, service, route, prompts.ts preamble, both live call sites) | Task 4 |
| C5 — `GET /health` liveness probe                                                                                                        | Task 5 |

---

## Spec ambiguities resolved

1. **C5's problem statement vs. reality.** The spec's Component 5 framing ("there is no health/ping anywhere") does not match the current nerv repo: `src/http/routes/health.ts` already implements an unauthenticated `GET /health` returning `{ status: 'ok' }`, wired in `src/http/server.ts` ahead of the auth-scoped plugin, and already covered by an existing test. **Resolved by not changing the response body shape** (e.g. not switching to `{ ok: true }`) to avoid a gratuitous breaking change with no behavioral upside — Task 5 instead adds one regression test (auth-bogus-header case) and a documentation comment. If papai's health-probe consumer needs a _specific_ body shape rather than "any 2xx", that's a papai-side (or joint) decision to make in the papai plan, not a reason to churn nerv's existing, working, tested contract.

2. **Scope of C4's language parameterization inside `prompts.ts`.** `prompts.ts`'s `RESULT_FORMAT_TASK`/`RESULT_FORMAT_TASK_NO_CHANGES`/`RESULT_FORMAT_FIX`/`RESULT_FORMAT_PIPELINE_FIX` consts and the full `generateTaskPrompt`/`generateFixPrompt`/etc. apparatus are **not on nerv's live path today** — `SupervisorService.startTask` and `makeChatInstructionHandler` forward `task.prompt` to magi directly; `grep` confirms these prompt-builder functions are only referenced from within `prompts.ts` itself and its own test file. Given the spec's explicit "scope is kept minimal and language-focused for P0" guidance, **resolved by adding one new minimal, language-parameterized `buildOperatingInstructionsPreamble(language)` function** (extracted from the existing shared engineering directives) and prepending it at the two live call sites, rather than parameterizing the entire dead `RESULT_FORMAT_*`/`generate*Prompt` apparatus. This keeps the diff small and avoids touching 8+ existing const-equality test assertions in `prompts.test.ts` for code that isn't executed in production yet.

3. **`SupervisorService` constructor threading for `cancelTask`'s dependencies.** `cancelTask` needs both `TaskService` (previously received as an intentionally-unused `_tasks` parameter, per `tsconfig.json`'s `noUnusedParameters: true`) and a `PapaiTaskNotifier`. **Resolved by renaming `_tasks` to a stored `private readonly tasks` field** (positionally backward-compatible with all existing call sites) and **adding `notifier` as a new optional 6th constructor parameter** (rather than a required one) — this avoids touching the 2 existing test call sites that construct `SupervisorService` without cancel functionality, while `cancelTask` itself throws a clear error if `notifier` is missing. Only `src/index.ts` (production wiring) and the new cancel-related tests need to supply it.

4. **Best-effort tolerance for `cancelTask`'s per-repo `magi.cancelSession` calls.** Confirmed by actually running the existing test suite that this isn't optional robustness — the pre-existing `'cancel event transitions the task to closed and notifies papai'` test in `tests/http/server.test.ts` exercises a `magi` mock that implements only `startSession`, not `cancelSession`; without a try/catch around each `cancelSession` call, that pre-existing test would start throwing once the route delegates to `cancelTask`. **Resolved by wrapping each repo's `cancelSession` call in its own try/catch** (log-and-continue), which is also directly covered by Task 3's "tolerates one session failing to cancel" test.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-11-migration-p0-nerv.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
**2. Inline Execution** — execute here with checkpoints.

Tasks 1 → 2 → 3 → 4 → 5 are sequential (Task 4 depends on Task 1's `foundationHandlers.ts` shape; Task 3 depends on Task 1's route file shape). **Which approach?**
