<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# FU3 Components A/B/C — nerv Scheduler Overlap Guard + Atomic Ledger + Idempotency Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three related reliability gaps in nerv's periodic-sweep → work-queue → magi-dispatch pipeline:
(A) `Scheduler.register` can run the same named job's handler concurrently with itself if a tick outlives its
interval; (B) `reviewHandlers.ts`/`ciHandlers.ts` persist their processed-id ledgers via whole-document
`task.save()`, which throws a mongoose `VersionError` (and wastes a retry) under concurrent handler invocations on
the same `Task`; (C) two magi-dispatch call sites (`chat_instruction`, `self_review`) pass no `idempotencyKey`,
so a retried work item can double-dispatch instead of hitting magi's `(parent_session_id, idempotency_key)` dedupe.
Component D (magi's dedupe-error handling) is a separate plan/repo and is out of scope here.

**Architecture:** T1 wraps `Scheduler.register`'s existing `run` closure in a per-name `running` boolean guard
(skip-and-debug-log if still running — safe because skipped sweeps just re-observe current state next tick). T2
adds two new atomic `TaskService` methods (`addProcessedNoteIds`, `addProcessedJobId`) built on
`Task.updateOne({_id, 'taskRepositories.projectPath': projectPath}, {$addToSet: {...}, $set: {lastActivity}})`,
which mutate only the matching repo subdocument and are safe to call from two overlapping handler invocations
without racing. T3 wires those two methods into `reviewHandlers.ts` and `ciHandlers.ts` in place of their trailing
`task.save()` calls, each proven by a dedicated concurrent-invocation regression test. T4 adds two new deterministic
idempotency-key derivation functions (`chatInstructionIdempotencyKey`, `selfReviewIdempotencyKey`), each keyed on
the dispatching `WorkItem`'s own `_id` (not the task), and threads them as the 4th arg to the two currently-bare
`magi.followUp(...)` calls in `foundationHandlers.ts` and `selfReviewHandlers.ts`.

**Tech Stack:** Bun-free Node/TypeScript (nerv uses `npm`/`tsc`/`vitest`, not Bun), Mongoose (`Task.updateOne`,
default `__v` document versioning), `mongodb-memory-server` for DB-backed tests, `vitest` (`vi.useFakeTimers()` /
`vi.advanceTimersByTimeAsync()` for the scheduler test), strict TypeScript (`tsc --noEmit`).

**Repo:** `/Users/ki/Projects/yourpapai/nerv`, branch `main`. Commands: `npx vitest run <path>` (or `npx vitest run`
for the full suite — currently 371 tests across 39 files before this plan's new tests are added), `npm run
type-check` (`tsc -p tsconfig.json --noEmit`).

---

## Ground truth established by direct verification (2026-07-13)

This plan was written by actually applying every change below to a real nerv checkout, writing and running the
tests (confirming genuine RED before each implementation), running the full suite + `npm run type-check` GREEN, and
then reverting every file via `git restore` — not by reading the spec's pseudocode alone. `git status --short` in
`/Users/ki/Projects/yourpapai/nerv` is confirmed empty as of writing this plan. The following facts resolve the
spec's four open assumptions (spec lines 245-254) and are confirmed, not assumed:

**Assumption 1 — exactly which fields the trailing `task.save()` persists.** Read in full:
`src/supervisor/reviewHandlers.ts` (167 lines) and `src/supervisor/ciHandlers.ts` (105 lines), current/original
content, unmodified. `makeReviewCommentHandler`'s trailing block sets only `repo.processedNoteIds` (via
`repo.processedNoteIds.push(...)` / dedupe) and `task.lastActivity = new Date()` before `await task.save()`.
`makePipelineFailureHandler`'s trailing block sets only `repo.processedJobIds` (same push/dedupe pattern) and
`task.lastActivity = new Date()` before `await task.save()`, followed by a best-effort papai-notify `try`/`catch`
block that must stay strictly _after_ the save (per FU2 — unchanged by this plan). **No other field is written by
either trailing block.** This means an atomic `$addToSet` + `$set: { lastActivity }` update fully replaces both
saves with zero dropped fields — confirmed by re-reading both files' full original bodies.

**Assumption 2 — the `TaskService` atomic-update method shape, and what it actually fixes.** The positional `$`
operator update (`Task.updateOne({ _id: taskId, 'taskRepositories.projectPath': projectPath }, { $addToSet: {
'taskRepositories.$.processedNoteIds': { $each: noteIds } }, $set: { lastActivity: new Date() } })`) was verified
against the real `taskRepositories` schema via a dedicated multi-repo `TaskService` test: it mutates only the
repo subdocument matching `projectPath`, leaves sibling repos' arrays untouched, is idempotent under
`$addToSet` (calling it twice with an overlapping id set does not duplicate), and bumps `lastActivity`. **The
concurrency failure mode under the OLD code is not silent data loss — it's a thrown `mongoose.Error.VersionError`.**
`Task`'s schema uses mongoose's _default_ `__v` document versioning (no explicit `optimisticConcurrency: true`
needed — it's on by default). `Worker.tick()` loads `task` **fresh per invocation** (`const task = await
Task.findById(item.taskId)`, `src/supervisor/worker.ts:47`), so two concurrent handler invocations for the same
`Task` (e.g. two review-comment work items or two CI-failure work items on the same task, claimed in the same
poll window) each hold an independently-loaded, pre-mutation document snapshot. The first `.save()` succeeds and
bumps `__v`; the **second** `.save()` — built from a now-stale `__v` — throws:

```
VersionError: No matching document found for id "<id>" version 0 modifiedPaths "taskRepositories,
taskRepositories.0, taskRepositories.0.processedNoteIds, lastActivity"
```

This was confirmed empirically by writing the T3 concurrent-invocation regression test below and running it
against the _unmodified_ `task.save()` code path — it fails with exactly this `VersionError`, not with a silently
overwritten array. The practical consequence: the `VersionError` propagates out of the handler, `Worker.tick`'s
catch block logs it and calls `queue.fail(item._id.toString(), ...)`, which **consumes that work item's retry
budget** (`MAX_ATTEMPTS`) even though the corresponding magi dispatch (`magi.followUp`) already succeeded before
the save was attempted. If attempts are exhausted, the work item can end up permanently `failed` despite the
magi-side effect having already landed. **This is a more precise description than the spec's "can lose an
update" (spec line ~???, Component B rationale) — the plan's T3 tests and docstrings reflect the `VersionError` /
wasted-retry mechanism, not silent overwrite.** The atomic `$addToSet` update eliminates this: both concurrent
updates succeed, independent of order, without touching `__v`-guarded whole-document state.

**Assumption 3 — `item._id` availability and type.** `Worker.tick()` (`src/supervisor/worker.ts:43-67`) calls
`const item = await this.queue.claimNext()` — a real hydrated `WorkItem` Mongoose document — then `await
handler({ task, item, ...this.deps })`. So in every production and integration-test code path, `item._id` is a
real, populated `mongoose.Types.ObjectId` end-to-end; no plan changes are needed there beyond the 2 assertion
updates in `tests/integration/handlers.test.ts` (adding the expected 4th `idempotencyKey` arg — `item._id` is
already real in that test since it flows through the real queue). Isolated unit tests
(`foundationHandlers.test.ts`'s `chat_instruction handler` block, `selfReviewHandler.test.ts`) build a synthetic
`ctx` object directly (`{ task, item: { payload }, magi, ... } as unknown as HandlerCtx`) and do **not** have a
real `item._id` unless the test explicitly adds one — those tests each need `_id: new Types.ObjectId()` added to
their `item` mock (from `import { Types } from 'mongoose'`).

**Assumption 4 — `Scheduler` internals.** `src/periodic/scheduler.ts` (39 lines, original) confirmed: the
constructor takes a `Logger` (`this.log`) — `src/logger.ts`'s `Logger` interface (`debug`/`info`/`warn`/`error`,
each `(msg: string, ...args: unknown[]): void`). `register(name: string, intervalMs: number, handler: () =>
Promise<void>): void` builds a `run` closure that calls `handler()` inside a `try`/`catch` that logs via
`this.log.error` on throw, then schedules itself via `setInterval`. Test harness style (confirmed via
`tests/periodic/scheduler.test.ts`, 33 lines original, 2 tests): `vi.useFakeTimers()` +
`vi.advanceTimersByTimeAsync(ms)`, a hand-rolled fake `Logger` object (`{ debug: vi.fn(), error: vi.fn(), info:
vi.fn(), warn: vi.fn() }`), and `s.stopAll()` + `vi.useRealTimers()` at the end of each test.

---

## Task T1: Scheduler overlap guard

**Files:**

- Modify: `src/periodic/scheduler.ts`
- Test: `tests/periodic/scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/periodic/scheduler.test.ts`. First add the missing type import at the top of the file (the existing
2 tests don't need it, this one does):

```ts
import type { Logger } from '../../src/logger.js'
```

Then add this test inside the existing `describe` block:

```ts
it('never runs a handler concurrently with itself when a tick outlives its interval, and debug-logs the skipped tick', async () => {
  vi.useFakeTimers()
  let inFlight = 0
  let maxInFlight = 0
  const releasers: Array<() => void> = []
  const handler = vi.fn(async () => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise<void>((resolve) => releasers.push(resolve))
    inFlight--
  })
  const log: Logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
  const s = new Scheduler(log)
  s.register('slow-job', 100, handler)

  await vi.advanceTimersByTimeAsync(100)
  expect(handler).toHaveBeenCalledTimes(1)

  await vi.advanceTimersByTimeAsync(200)
  expect(handler).toHaveBeenCalledTimes(1)
  expect(maxInFlight).toBe(1)
  expect(log.debug).toHaveBeenCalledWith('scheduled job "slow-job" still running; skipping this tick')

  releasers.shift()?.()
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(100)
  expect(handler).toHaveBeenCalledTimes(2)
  expect(maxInFlight).toBe(1)

  releasers.shift()?.()
  s.stopAll()
  vi.useRealTimers()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/periodic/scheduler.test.ts`

Expected: FAIL — `expected "spy" to be called 1 times, but got 3 times` (the handler currently fires on every
tick regardless of whether the previous invocation is still in flight, since fake timers advance past 100ms three
times in a row before the first invocation's promise resolves).

- [ ] **Step 3: Write minimal implementation**

Open `src/periodic/scheduler.ts`. Inside `register`, wrap the existing `run` closure body with a per-name
`running` guard:

```ts
  register(name: string, intervalMs: number, handler: () => Promise<void>): void {
    let running = false
    const run = async (): Promise<void> => {
      if (running) {
        this.log.debug(`scheduled job "${name}" still running; skipping this tick`)
        return
      }
      running = true
      try {
        await handler()
      } catch (err) {
        this.log.error(`scheduled job "${name}" failed`, err)
      } finally {
        running = false
      }
    }
    const timer = setInterval(() => {
      void run()
    }, intervalMs)
    this.timers.push(timer)
  }
```

(Keep the rest of the file — constructor, `this.log`, `this.timers`, `stopAll()` — unchanged; only the body of
`register`'s `run` closure and its error handling move inside the new guard as shown.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/periodic/scheduler.test.ts`

Expected: PASS — all 3 tests (the 2 original + the new overlap-guard test) green.

- [ ] **Step 5: Type-check**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npm run type-check`

Expected: clean, no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/periodic/scheduler.ts tests/periodic/scheduler.test.ts
git commit -m "fix(scheduler): guard against overlapping runs of the same named job"
```

---

## Task T2: TaskService atomic ledger methods

**Files:**

- Modify: `src/services/TaskService.ts`
- Test: `tests/services/TaskService.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/services/TaskService.test.ts` (existing file style: `const projects = new ProjectService(); const
svc = new TaskService(projects)`). Add these two tests inside the existing `describe` block:

```ts
it('addProcessedNoteIds atomically $addToSets onto the matching repo only, idempotently, and bumps lastActivity', async () => {
  const t = await svc.create({
    kind: 'gitlab-mr-supervision',
    contextRef: { contextId: 'c' },
    source: 'chat',
    prompt: 'p',
    repos: [{ projectPath: 'g/r1' }, { projectPath: 'g/r2' }],
  })
  const before = t.lastActivity

  await svc.addProcessedNoteIds(t._id, 'g/r1', ['101', '102'])
  await svc.addProcessedNoteIds(t._id, 'g/r1', ['102', '103'])

  const reloaded = await svc.get(t._id.toString())
  const repo1 = reloaded?.taskRepositories.find((r) => r.projectPath === 'g/r1')
  const repo2 = reloaded?.taskRepositories.find((r) => r.projectPath === 'g/r2')
  expect([...(repo1?.processedNoteIds ?? [])].sort()).toEqual(['101', '102', '103'])
  expect(repo2?.processedNoteIds).toEqual([])
  expect(reloaded?.lastActivity.getTime()).toBeGreaterThan(before.getTime())
})

it('addProcessedJobId atomically $addToSets onto the matching repo only, idempotently, and bumps lastActivity', async () => {
  const t = await svc.create({
    kind: 'gitlab-mr-supervision',
    contextRef: { contextId: 'c' },
    source: 'chat',
    prompt: 'p',
    repos: [{ projectPath: 'g/r1' }, { projectPath: 'g/r2' }],
  })
  const before = t.lastActivity

  await svc.addProcessedJobId(t._id, 'g/r1', '999')
  await svc.addProcessedJobId(t._id, 'g/r1', '999')

  const reloaded = await svc.get(t._id.toString())
  const repo1 = reloaded?.taskRepositories.find((r) => r.projectPath === 'g/r1')
  const repo2 = reloaded?.taskRepositories.find((r) => r.projectPath === 'g/r2')
  expect(repo1?.processedJobIds).toEqual(['999'])
  expect(repo2?.processedJobIds).toEqual([])
  expect(reloaded?.lastActivity.getTime()).toBeGreaterThan(before.getTime())
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/services/TaskService.test.ts`

Expected: FAIL — `TypeError: svc.addProcessedNoteIds is not a function` (method does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Open `src/services/TaskService.ts`. Add `Types` to the existing mongoose import (the file already imports from
`'mongoose'` for `HydratedDocument`):

```ts
import type { HydratedDocument } from 'mongoose'
import { Types } from 'mongoose'
```

Then add the two methods to the `TaskService` class, alongside the existing `create`/`get`/`transition` methods:

```ts
  async addProcessedNoteIds(taskId: Types.ObjectId, projectPath: string, noteIds: string[]): Promise<void> {
    await Task.updateOne(
      { _id: taskId, 'taskRepositories.projectPath': projectPath },
      {
        $addToSet: { 'taskRepositories.$.processedNoteIds': { $each: noteIds } },
        $set: { lastActivity: new Date() },
      },
    )
  }

  async addProcessedJobId(taskId: Types.ObjectId, projectPath: string, jobId: string): Promise<void> {
    await Task.updateOne(
      { _id: taskId, 'taskRepositories.projectPath': projectPath },
      {
        $addToSet: { 'taskRepositories.$.processedJobIds': jobId },
        $set: { lastActivity: new Date() },
      },
    )
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/services/TaskService.test.ts`

Expected: PASS — all `TaskService` tests green, including the 2 new ones.

- [ ] **Step 5: Type-check**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npm run type-check`

Expected: clean, no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/services/TaskService.ts tests/services/TaskService.test.ts
git commit -m "feat(TaskService): add atomic per-repo processed-id ledger methods"
```

---

## Task T3a: Wire atomic ledger into reviewHandlers.ts + concurrent-invocation regression test

**Files:**

- Modify: `src/supervisor/reviewHandlers.ts`
- Test: `tests/supervisor/reviewCommentHandler.test.ts`

- [ ] **Step 1: Write the failing test**

Open `tests/supervisor/reviewCommentHandler.test.ts`. Update the existing `makeCtx` helper to accept and pass
through a `tasks: TaskService` argument (it currently returns `{ task, item: { payload }, forge, magi }` with no
`tasks`), and import `TaskService`:

```ts
import { TaskService } from '../../src/services/TaskService.js'
```

```ts
function makeCtx(
  task: Awaited<ReturnType<TaskService['create']>>,
  payload: ReviewCommentPayload,
  forge: Partial<Record<string, unknown>>,
  magi: Partial<Record<string, unknown>>,
  tasks: TaskService,
) {
  return { task, item: { payload }, forge, magi, tasks } as unknown as HandlerCtx
}
```

Update every existing call site of `makeCtx(...)` in this file to pass the module-level `tasks` instance (the
file already has `const tasks = new TaskService()` at module scope for seeding — reuse it) as the 5th argument.

Then add this new test inside the `describe` block:

```ts
it("concurrent-invocation race: two handler invocations for different discussions on the same task, using independently-loaded task docs, both persist processedNoteIds without losing each other's write", async () => {
  const t = await tasks.create({
    kind: 'gitlab-mr-supervision',
    contextRef: { contextId: 'c' },
    source: 'chat',
    prompt: 'p',
    repos: [{ projectPath: 'g/r' }],
  })
  t.taskRepositories[0].magiSessionId = 'sess-1'
  await t.save()

  // Simulate Worker.tick() loading the task fresh per invocation (worker.ts:47).
  const taskA = await tasks.get(t._id.toString())
  const taskB = await tasks.get(t._id.toString())
  if (!taskA || !taskB) throw new Error('seed task missing')

  const mrViewA = makeMrView({
    id: 'disc-a',
    notes: [
      {
        id: 201,
        body: 'fix a',
        author: { name: 'A', username: 'a' },
        createdAt: '2026-07-06T10:00:00.000Z',
        type: 'DiffNote',
      },
    ],
  })
  const mrViewB = makeMrView({
    id: 'disc-b',
    notes: [
      {
        id: 202,
        body: 'fix b',
        author: { name: 'B', username: 'b' },
        createdAt: '2026-07-06T10:00:00.000Z',
        type: 'DiffNote',
      },
    ],
  })

  const payloadA: ReviewCommentPayload = { projectPath: 'g/r', mrIid: 1, discussionId: 'disc-a', noteIds: ['201'] }
  const payloadB: ReviewCommentPayload = { projectPath: 'g/r', mrIid: 1, discussionId: 'disc-b', noteIds: ['202'] }

  const forgeA = { getMRView: vi.fn(async () => mrViewA), getFileContent: vi.fn(async () => 'line') }
  const forgeB = { getMRView: vi.fn(async () => mrViewB), getFileContent: vi.fn(async () => 'line') }
  const magiA = { followUp: vi.fn(async () => ({})) }
  const magiB = { followUp: vi.fn(async () => ({})) }

  const handler = makeReviewCommentHandler('nerv-agent')
  await Promise.all([
    handler(makeCtx(taskA, payloadA, forgeA, magiA, tasks)),
    handler(makeCtx(taskB, payloadB, forgeB, magiB, tasks)),
  ])

  expect(magiA.followUp).toHaveBeenCalledOnce()
  expect(magiB.followUp).toHaveBeenCalledOnce()

  const reloaded = await tasks.get(t._id.toString())
  expect([...(reloaded?.taskRepositories[0].processedNoteIds ?? [])].sort()).toEqual(['201', '202'])
})
```

(This test uses the file's existing `makeMrView(overrides)` helper, which spreads `overrides` onto the single
discussion object — `id`/`notes` are overridable per the file's established pattern.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/supervisor/reviewCommentHandler.test.ts`

Expected: FAIL — the new concurrent-invocation test throws `VersionError: No matching document found for id
"<id>" version 0 modifiedPaths "taskRepositories, taskRepositories.0, taskRepositories.0.processedNoteIds,
lastActivity"` from the second `task.save()` call inside the still-unmodified `reviewHandlers.ts` (see the
"Assumption 2" ground-truth note above for why).

- [ ] **Step 3: Write minimal implementation**

Open `src/supervisor/reviewHandlers.ts`. Change the handler's destructured context to include `tasks`, and replace
the trailing block (which currently pushes onto `repo.processedNoteIds`, sets `task.lastActivity`, and calls
`await task.save()`) with a call to the new atomic method:

```ts
export function makeReviewCommentHandler(botUsername: string): Handler {
  return async ({ task, item, tasks, forge, magi, projects, magiDefaults }) => {
    // ...unchanged body above...

    await tasks.addProcessedNoteIds(task._id, repo.projectPath, payload.noteIds)
  }
}
```

(Only the destructured params — adding `tasks` — and the trailing persistence line change. Everything above it in
the function body, including the `magi.followUp(...)` dispatch, is unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/supervisor/reviewCommentHandler.test.ts`

Expected: PASS — all tests in the file green, including the new concurrent-invocation test.

- [ ] **Step 5: Run the full suite and type-check**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run && npm run type-check`

Expected: full suite green (integration tests exercising `review_comment` via the real `Worker` still pass
unchanged, since `Worker.tick()` already passes `tasks` into every handler's `HandlerCtx`), type-check clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/supervisor/reviewHandlers.ts tests/supervisor/reviewCommentHandler.test.ts
git commit -m "fix(reviewHandlers): persist processedNoteIds via atomic update instead of task.save()"
```

---

## Task T3b: Wire atomic ledger into ciHandlers.ts + concurrent-invocation and retry-key regression tests

**Files:**

- Modify: `src/supervisor/ciHandlers.ts`
- Test: `tests/supervisor/pipelineFailureHandler.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `tests/supervisor/pipelineFailureHandler.test.ts`. Update the existing `makeCtx` helper the same way as T3a
(add a `tasks: TaskService` parameter, thread it into the returned object, import `TaskService`, update all
existing `makeCtx` call sites to pass the module-level `tasks` instance).

Add two new tests inside the `describe` block:

```ts
it("concurrent-invocation race: two handler invocations for different jobs on the same task, using independently-loaded task docs, both persist processedJobIds without losing each other's write", async () => {
  const t = await tasks.create({
    kind: 'gitlab-mr-supervision',
    contextRef: { contextId: 'c' },
    source: 'chat',
    prompt: 'p',
    repos: [{ projectPath: 'g/r' }],
  })
  t.taskRepositories[0].magiSessionId = 'sess-1'
  t.taskRepositories[0].pipelineJobTrackList = ['job_a', 'job_b']
  await t.save()

  const taskA = await tasks.get(t._id.toString())
  const taskB = await tasks.get(t._id.toString())
  if (!taskA || !taskB) throw new Error('seed task missing')

  const logsA = makeFailedJobLogs({ jobs: [{ id: 111, name: 'job_a', log: 'Error: a failed' }] })
  const logsB = makeFailedJobLogs({ jobs: [{ id: 222, name: 'job_b', log: 'Error: b failed' }] })

  const payloadA: PipelineFailurePayload = { projectPath: 'g/r', mrIid: 1, pipelineId: 55, jobId: 111 }
  const payloadB: PipelineFailurePayload = { projectPath: 'g/r', mrIid: 1, pipelineId: 55, jobId: 222 }

  const forgeA = { getFailedPipelineJobLogs: vi.fn(async () => logsA) }
  const forgeB = { getFailedPipelineJobLogs: vi.fn(async () => logsB) }
  const magiA = { followUp: vi.fn(async () => ({})) }
  const magiB = { followUp: vi.fn(async () => ({})) }

  const handler = makePipelineFailureHandler('nerv-agent')
  await Promise.all([
    handler(makeCtx(taskA, payloadA, forgeA, magiA, tasks)),
    handler(makeCtx(taskB, payloadB, forgeB, magiB, tasks)),
  ])

  expect(magiA.followUp).toHaveBeenCalledOnce()
  expect(magiB.followUp).toHaveBeenCalledOnce()

  const reloaded = await tasks.get(t._id.toString())
  expect([...(reloaded?.taskRepositories[0].processedJobIds ?? [])].sort()).toEqual(['111', '222'])
})

it('retry after a crash between dispatch and ledger persist: the retry carries the SAME idempotencyKey (magi backstop), and the ledger ends up correct', async () => {
  const t = await tasks.create({
    kind: 'gitlab-mr-supervision',
    contextRef: { contextId: 'c' },
    source: 'chat',
    prompt: 'p',
    repos: [{ projectPath: 'g/r' }],
  })
  t.taskRepositories[0].magiSessionId = 'sess-1'
  t.taskRepositories[0].pipelineJobTrackList = ['job']
  await t.save()

  const logs = makeFailedJobLogs({ jobs: [{ id: 999, name: 'job', log: 'Error: failed' }] })
  const payload: PipelineFailurePayload = { projectPath: 'g/r', mrIid: 1, pipelineId: 55, jobId: 999 }
  const forge = { getFailedPipelineJobLogs: vi.fn(async () => logs) }
  const magi = { followUp: vi.fn(async () => ({})) }

  const handler = makePipelineFailureHandler('nerv-agent')
  const firstLoad = await tasks.get(t._id.toString())
  if (!firstLoad) throw new Error('seed task missing')
  await handler(makeCtx(firstLoad, payload, forge, magi, tasks))

  const calls = magi.followUp.mock.calls as unknown as [string, string, unknown, string][]
  const [, , , keyFirst] = calls[0]
  expect(keyFirst).toBe(`${t._id.toString()}:g/r:job:999`)

  // Retry of the same work item (e.g. after a crash between dispatch and ledger persist): the
  // guard already sees jobId 999 in processedJobIds, so it short-circuits and does not re-dispatch.
  const secondLoad = await tasks.get(t._id.toString())
  if (!secondLoad) throw new Error('seed task missing')
  await handler(makeCtx(secondLoad, payload, forge, magi, tasks))

  expect(magi.followUp).toHaveBeenCalledOnce()
  const reloaded = await tasks.get(t._id.toString())
  expect(reloaded?.taskRepositories[0].processedJobIds).toEqual(['999'])
})
```

(This uses the file's existing `makeFailedJobLogs(overrides)` helper.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/supervisor/pipelineFailureHandler.test.ts`

Expected: the concurrent-invocation test FAILs with the same `VersionError` pattern as T3a (second `task.save()`
throws). The retry-key test's outcome depends on whether `ciHandlers.ts` already short-circuits on
`processedJobIds` before dispatching (it does, per the existing dedupe-before-dispatch guard already in the
handler) — if so this second test may already pass; either way, run it now to establish the true baseline before
touching the implementation, and confirm the concurrent-invocation test is the one that's genuinely RED.

- [ ] **Step 3: Write minimal implementation**

Open `src/supervisor/ciHandlers.ts`. Change the handler's destructured context to include `tasks`, and replace the
trailing block (which currently pushes onto `repo.processedJobIds`, sets `task.lastActivity`, and calls `await
task.save()`) with a call to the new atomic method — keeping the existing best-effort papai-notify `try`/`catch`
block strictly _after_ it, unchanged (per FU2):

```ts
export function makePipelineFailureHandler(botUsername: string): Handler {
  return async ({ task, item, tasks, forge, magi, papai, projects, magiDefaults }) => {
    // ...unchanged body above, including the magi.followUp(...) dispatch...

    await tasks.addProcessedJobId(task._id, repo.projectPath, String(payload.jobId))

    // ...unchanged best-effort papai notify try/catch block, still strictly after...
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/supervisor/pipelineFailureHandler.test.ts`

Expected: PASS — all tests in the file green, including both new tests.

- [ ] **Step 5: Run the full suite and type-check**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run && npm run type-check`

Expected: full suite green, type-check clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/supervisor/ciHandlers.ts tests/supervisor/pipelineFailureHandler.test.ts
git commit -m "fix(ciHandlers): persist processedJobIds via atomic update instead of task.save()"
```

---

## Task T4a: Deterministic per-dispatch idempotency keys (chat_instruction, self_review)

**Files:**

- Modify: `src/domain/idempotencyKeys.ts`
- Test: `tests/domain/idempotencyKeys.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `tests/domain/idempotencyKeys.test.ts`. Update the import to add the two new functions:

```ts
import {
  reviewFixIdempotencyKey,
  ciFixIdempotencyKey,
  resumeIdempotencyKey,
  chatInstructionIdempotencyKey,
  selfReviewIdempotencyKey,
} from '../../src/domain/idempotencyKeys.js'
```

Add these two tests inside the `describe` block:

```ts
it('derives a chat_instruction key from taskId/projectPath/workItemId, stable across the same WorkItem and distinct across different ones', () => {
  expect(chatInstructionIdempotencyKey('task-1', 'g/r', 'item-1')).toBe('task-1:g/r:chat:item-1')
  expect(chatInstructionIdempotencyKey('task-1', 'g/r', 'item-1')).toBe(
    chatInstructionIdempotencyKey('task-1', 'g/r', 'item-1'),
  )
  expect(chatInstructionIdempotencyKey('task-1', 'g/r', 'item-1')).not.toBe(
    chatInstructionIdempotencyKey('task-1', 'g/r', 'item-2'),
  )
})

it('derives a self_review key from taskId/projectPath/workItemId, stable across the same WorkItem and distinct across different review cycles', () => {
  expect(selfReviewIdempotencyKey('task-1', 'g/r', 'item-1')).toBe('task-1:g/r:selfreview:item-1')
  expect(selfReviewIdempotencyKey('task-1', 'g/r', 'item-1')).toBe(selfReviewIdempotencyKey('task-1', 'g/r', 'item-1'))
  expect(selfReviewIdempotencyKey('task-1', 'g/r', 'item-1')).not.toBe(
    selfReviewIdempotencyKey('task-1', 'g/r', 'item-2'),
  )
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/domain/idempotencyKeys.test.ts`

Expected: FAIL — `chatInstructionIdempotencyKey`/`selfReviewIdempotencyKey` are not exported (TypeScript/module
resolution error, or `is not a function` depending on how vitest reports the missing import).

- [ ] **Step 3: Write minimal implementation**

Open `src/domain/idempotencyKeys.ts`. Add the two new functions, following the file's existing pattern (each
existing function is `${taskId}:${projectPath}:<tag>:<value>`):

```ts
/**
 * chat_instruction follow-up key, keyed on the dispatching WorkItem's own id (`item._id`) — NOT
 * the task — so it re-derives identically on a retry of the SAME WorkItem (magi dedupes the
 * duplicate) while two distinct chat instructions (two distinct WorkItems) get distinct keys.
 */
export function chatInstructionIdempotencyKey(taskId: string, projectPath: string, workItemId: string): string {
  return `${taskId}:${projectPath}:chat:${workItemId}`
}

/**
 * self_review follow-up key, keyed on the dispatching WorkItem's own id. Per-dispatch (not
 * per-task): a `review -> coding -> review` cycle re-enqueues a FRESH WorkItem for each self-review
 * pass, and each one legitimately needs its own key — a per-task key would wrongly swallow the
 * second review at magi's dedupe layer.
 */
export function selfReviewIdempotencyKey(taskId: string, projectPath: string, workItemId: string): string {
  return `${taskId}:${projectPath}:selfreview:${workItemId}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/domain/idempotencyKeys.test.ts`

Expected: PASS — all tests in the file green, including the 2 new ones.

- [ ] **Step 5: Type-check**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npm run type-check`

Expected: clean, no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/domain/idempotencyKeys.ts tests/domain/idempotencyKeys.test.ts
git commit -m "feat(idempotencyKeys): add per-dispatch keys for chat_instruction and self_review"
```

---

## Task T4b: Wire idempotencyKey into chat_instruction dispatch

**Files:**

- Modify: `src/supervisor/foundationHandlers.ts`
- Test: `tests/supervisor/foundationHandlers.test.ts`
- Test: `tests/integration/handlers.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `tests/supervisor/foundationHandlers.test.ts`. In the `chat_instruction handler` describe block, import
`Types` from `mongoose`:

```ts
import { Types } from 'mongoose'
```

Every test in that block builds a ctx with an `item: { payload: {...} }` mock — add `_id: new Types.ObjectId()`
to each one, e.g.:

```ts
      item: { _id: new Types.ObjectId(), payload: { prompt: 'also do Y' } },
```

Update the existing exact `toHaveBeenCalledWith` assertions in that block (there are 3: the base happy-path test
for repo `g/r`, and — in the "picks the repo with a live magi session" test — 2 more, both against a
`stringContaining` pattern for whichever repo path is expected) to add a 4th arg:

```ts
expect(magi.followUp).toHaveBeenCalledWith(
  'sess-1',
  expect.stringContaining('also do Y'),
  {},
  expect.stringContaining('g/r:chat:'),
)
```

(Apply the analogous 4th-arg addition to the other 2 pre-existing assertions in that block, each using the
`stringContaining` pattern for its own repo path, e.g. `g/r2:chat:` for the "picks the repo with a live magi
session" test's second assertion.)

Then add this new test inside the `chat_instruction handler` describe block:

```ts
it('re-derives the same idempotencyKey for a retry of the same WorkItem, and a different key for a distinct WorkItem', async () => {
  const t = await tasks.create({
    kind: 'gitlab-mr-supervision',
    contextRef: { contextId: 'c' },
    source: 'chat',
    prompt: 'p',
    repos: [{ projectPath: 'g/r' }],
  })
  t.taskRepositories[0].magiSessionId = 'sess-9'
  await t.save()

  const magi = { followUp: vi.fn(async () => ({})) }
  const papai = { notify: vi.fn(async () => {}) }
  const itemIdA = new Types.ObjectId()
  const ctxA = { task: t, item: { _id: itemIdA, payload: { prompt: 'do X' } }, magi, papai } as unknown as HandlerCtx
  const ctxARetry = {
    task: t,
    item: { _id: itemIdA, payload: { prompt: 'do X' } },
    magi,
    papai,
  } as unknown as HandlerCtx
  const ctxB = {
    task: t,
    item: { _id: new Types.ObjectId(), payload: { prompt: 'do X' } },
    magi,
    papai,
  } as unknown as HandlerCtx

  const handler = makeChatInstructionHandler()
  await handler(ctxA)
  await handler(ctxARetry)
  await handler(ctxB)

  expect(magi.followUp).toHaveBeenCalledTimes(3)
  const calls = magi.followUp.mock.calls as unknown as [string, string, unknown, string][]
  const [, , , keyA1] = calls[0]
  const [, , , keyA2] = calls[1]
  const [, , , keyB] = calls[2]
  expect(keyA1).toBe(keyA2)
  expect(keyA1).not.toBe(keyB)
})
```

Also open `tests/integration/handlers.test.ts` and update the two existing assertions that check
`magi.followUp` calls for `chat_instruction`:

In `'chat_instruction: real worker.tick() drives the registered handler...'`:

```ts
expect(magi.followUp).toHaveBeenCalledWith(
  'sess-1',
  expect.stringContaining('also do Y'),
  {},
  expect.stringContaining(`${t._id.toString()}:g/r:chat:`),
)
```

In `'contract: POST /tasks/:id/events payload.prompt survives verbatim...'`:

```ts
expect(magi.followUp).toHaveBeenCalledWith(
  'sess-1',
  expect.stringContaining('wire-fidelity-check please rename foo to bar'),
  {},
  expect.stringContaining(`${t._id.toString()}:g/r:chat:`),
)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/supervisor/foundationHandlers.test.ts tests/integration/handlers.test.ts`

Expected: FAIL — the updated exact-4-arg assertions fail because `magi.followUp` is currently called with only 3
args (`toHaveBeenCalledWith` requires an exact arg-count match), and the new
"re-derives the same idempotencyKey..." test's `calls[0]` destructure of a 4th element is `undefined` (assertion
`keyA1).toBe(keyA2)` — both `undefined` — actually passes trivially, but `keyA1).not.toBe(keyB)` also passes
trivially since both are `undefined`; the load-bearing failures are the `toHaveBeenCalledWith` 4-arg assertions in
this file and in `handlers.test.ts`, both of which are genuinely RED against the unmodified handler).

- [ ] **Step 3: Write minimal implementation**

Open `src/supervisor/foundationHandlers.ts`. Update the import to add `chatInstructionIdempotencyKey`:

```ts
import { resumeIdempotencyKey, chatInstructionIdempotencyKey } from '../domain/idempotencyKeys.js'
```

In `makeChatInstructionHandler`, derive and pass the key:

```ts
const promptWithPreamble = prependOperatingInstructions(task.outputLanguage, prompt)
const idempotencyKey = chatInstructionIdempotencyKey(task._id.toString(), repo.projectPath, item._id.toString())
await magi.followUp(repo.magiSessionId, promptWithPreamble, credentials, idempotencyKey)
```

(Only these 3 lines change inside the existing `if (repo?.magiSessionId && prompt) { ... }` branch; everything
else in the function — including the `else` branch's "no live session" papai notify — is unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/supervisor/foundationHandlers.test.ts tests/integration/handlers.test.ts`

Expected: PASS — all tests in both files green.

- [ ] **Step 5: Run the full suite and type-check**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run && npm run type-check`

Expected: full suite green, type-check clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/supervisor/foundationHandlers.ts tests/supervisor/foundationHandlers.test.ts tests/integration/handlers.test.ts
git commit -m "feat(chat_instruction): pass a per-dispatch idempotencyKey to magi.followUp"
```

---

## Task T4c: Wire idempotencyKey into self_review dispatch

**Files:**

- Modify: `src/supervisor/selfReviewHandlers.ts`
- Test: `tests/supervisor/selfReviewHandler.test.ts`

- [ ] **Step 1: Write the failing test**

Open `tests/supervisor/selfReviewHandler.test.ts`. Import `Types` from `mongoose`:

```ts
import { Types } from 'mongoose'
```

Update `makeCtx` to accept an optional `itemId` (defaulting to a fresh `ObjectId` so the 3 existing tests, which
don't care about the id, need no other changes) and thread it into `item._id`:

```ts
function makeCtx(
  task: Awaited<ReturnType<TaskService['create']>>,
  payload: SelfReviewPayload,
  magi: Partial<Record<string, unknown>>,
  itemId: Types.ObjectId = new Types.ObjectId(),
) {
  return { task, item: { _id: itemId, payload }, magi } as unknown as HandlerCtx
}
```

Add this new test inside the `describe` block:

```ts
it('passes a per-dispatch idempotencyKey keyed on item._id as the 4th arg to followUp, distinct across two self-review cycles (two WorkItems)', async () => {
  const t = await tasks.create({
    kind: 'gitlab-mr-supervision',
    contextRef: { contextId: 'c' },
    source: 'chat',
    prompt: 'Implement the widget feature',
    repos: [{ projectPath: 'g/r' }],
  })
  t.taskRepositories[0].magiSessionId = 'sess-1'
  await t.save()

  const magi = { followUp: vi.fn(async () => ({})) }
  const payload: SelfReviewPayload = { projectPath: 'g/r', mrIid: 1 }
  const itemId = new Types.ObjectId()

  const handler = makeSelfReviewHandler()
  await handler(makeCtx(t, payload, magi, itemId))
  await handler(makeCtx(t, payload, magi, itemId))
  await handler(makeCtx(t, payload, magi, new Types.ObjectId()))

  expect(magi.followUp).toHaveBeenCalledTimes(3)
  const calls = magi.followUp.mock.calls as unknown as [string, string, unknown, string][]
  const [, , , keyFirst] = calls[0]
  const [, , , keyRetry] = calls[1]
  const [, , , keyOther] = calls[2]
  expect(keyFirst).toBe(`${t._id.toString()}:g/r:selfreview:${itemId.toString()}`)
  expect(keyRetry).toBe(keyFirst)
  expect(keyOther).not.toBe(keyFirst)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/supervisor/selfReviewHandler.test.ts`

Expected: FAIL — `keyFirst` is `undefined` (the handler currently calls `magi.followUp(repo.magiSessionId,
prompt, credentials)` with only 3 args), so `expect(keyFirst).toBe(\`${t.\_id.toString()}:g/r:selfreview:...\`)`
fails (`undefined` !== the expected string).

- [ ] **Step 3: Write minimal implementation**

Open `src/supervisor/selfReviewHandlers.ts`. Add the import:

```ts
import { selfReviewIdempotencyKey } from '../domain/idempotencyKeys.js'
```

In `makeSelfReviewHandler`, derive and pass the key:

```ts
const idempotencyKey = selfReviewIdempotencyKey(task._id.toString(), repo.projectPath, item._id.toString())
await magi.followUp(repo.magiSessionId, prompt, credentials, idempotencyKey)
```

(Replaces the existing `await magi.followUp(repo.magiSessionId, prompt, credentials)` call; everything else in
the function is unchanged, including the trailing `task.lastActivity = new Date(); await task.save()` — the
self-review handler does not touch any per-repo processed-id ledger, so it is out of scope for T2/T3's atomic
update and keeps its whole-document save.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/supervisor/selfReviewHandler.test.ts`

Expected: PASS — all tests in the file green, including the new one.

- [ ] **Step 5: Run the full suite and type-check**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run && npm run type-check`

Expected: full suite green (372 → 383 tests: +3 T1, +2 T2, +2 T3a, +2 T3b, +2 T4a, +2 T4b, +1 T4c — actual final
count may differ slightly by ±1 depending on how vitest reports parameterized/nested blocks; the important
invariant is zero failures), type-check clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/supervisor/selfReviewHandlers.ts tests/supervisor/selfReviewHandler.test.ts
git commit -m "feat(self_review): pass a per-dispatch idempotencyKey to magi.followUp"
```

---

## Final verification

- [ ] **Run the full suite and type-check one more time after all 7 commits**

Run: `cd /Users/ki/Projects/yourpapai/nerv && npx vitest run && npm run type-check`

Expected: full suite green, type-check clean, no skipped/pending tests.

- [ ] **Confirm a clean working tree**

Run: `cd /Users/ki/Projects/yourpapai/nerv && git status --short`

Expected: empty (everything from T1-T4c has already been committed task-by-task; nothing left uncommitted).
