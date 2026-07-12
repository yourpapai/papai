<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# nerv — Migration Phase 3 (Rollout & Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let nerv's `/api/notify` calls carry the repo's magi session id so papai can mint a
live-transcript link and append it to the delivered chat message (Component 3 "nerv surfacing" of
`docs/superpowers/specs/2026-07-12-migration-p3-rollout-design.md`) — a single, additive field, no
behavior change when it's absent.

**Architecture:** `PapaiNotifier.notify(...)`'s body (`NotifyMessage`) grows one optional field,
`magiSessionId?: string`. `PapaiTaskNotifier` — the task-level adapter that calls
`papai.notify(...)` from both `notifyStatus` (status-change notifications) and `notifyReply` (plain
chat replies) — resolves which magi session to surface via a new private helper,
`magiSessionIdFor(task)`, and passes its result through on every `notify(...)` call. A task can
span multiple repos (multi-repo MR fanout), but `/api/notify` is task-level, not repo-level, so the
helper picks **the first repo that has recorded a `magiSessionId`** — this exactly mirrors the
existing `task.taskRepositories.find((r) => r.magiSessionId)` convention already used in
`src/supervisor/foundationHandlers.ts`'s `chat_instruction` handler (line 184) to pick "the" live
session for a task. Since `JSON.stringify` drops object properties whose value is `undefined`, a
task with no repo session simply omits the field from the wire body — no conditional serialization
needed.

**Tech Stack:** Node/TypeScript service, Mongoose, vitest (`npx vitest run <path>`), `tsc --noEmit`
for typecheck.

**Repo:** `/Users/ki/Projects/yourpapai/nerv`

**Cross-repo note:** This is the nerv half of cross-repo contract #4 (`/api/notify` payload gains
optional `magiSessionId`). The papai half — `notify-route.ts`'s `NotifyBodySchema` accepting the
field and minting/appending the `/t/<token>` link — is a separate (papai-side) plan. Because the
field is **optional** on both ends, this plan is purely additive and safe to land **in either order**
relative to the papai plan: land this first and papai ignores the extra field until it's taught to
read it; land papai's plan first and it simply never sees the field until this lands. No deploy
ordering constraint.

---

## File Structure

- `src/services/PapaiNotifier.ts` — modify: add `magiSessionId?: string` to the `NotifyMessage`
  interface (the wire body posted to papai's `/api/notify`).
- `src/services/PapaiTaskNotifier.ts` — modify: add a private `magiSessionIdFor(task)` helper and
  thread its result through both `notifyStatus` and `notifyReply`'s `this.papai.notify({...})` calls.
- `tests/services/PapaiNotifier.test.ts` — modify: add a test asserting `magiSessionId` is forwarded
  in the POST body when provided.
- `tests/services/PapaiTaskNotifier.test.ts` — modify: add tests asserting `notifyStatus` and
  `notifyReply` include `magiSessionId` when the task has a repo with one, and omit it otherwise.

---

### Task 1: `PapaiNotifier` — accept an optional `magiSessionId` in the notify body

**Files:**

- Modify: `src/services/PapaiNotifier.ts:8-13`
- Test: `tests/services/PapaiNotifier.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/services/PapaiNotifier.test.ts`, immediately before the existing `'forwards
contextType when provided'` test:

```ts
it('forwards magiSessionId when provided', async () => {
  const f = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch
  const n = new PapaiNotifier({ url: 'http://papai/api/notify', token: 'p' }, f)
  await n.notify({ contextId: 'c1', markdown: 'hi', magiSessionId: 'sess-1' })
  const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({
    contextId: 'c1',
    markdown: 'hi',
    magiSessionId: 'sess-1',
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/services/PapaiNotifier.test.ts`
Expected: FAIL — TypeScript error, `Object literal may only specify known properties, and
'magiSessionId' does not exist in type 'NotifyMessage'` (the `notify({...})` call in the new test
doesn't type-check yet, since `NotifyMessage` has no `magiSessionId` field).

- [ ] **Step 3: Add `magiSessionId` to `NotifyMessage`**

In `src/services/PapaiNotifier.ts`, change:

```ts
export interface NotifyMessage {
  contextId: string
  contextType?: 'dm' | 'group'
  threadId?: string
  markdown: string
}
```

to:

```ts
export interface NotifyMessage {
  contextId: string
  contextType?: 'dm' | 'group'
  threadId?: string
  markdown: string
  /** magi session id for the task's active repo — lets papai mint + append a live-transcript link. */
  magiSessionId?: string
}
```

No change to `notify()`'s body — `body: JSON.stringify(msg)` already forwards whatever fields `msg`
carries, and `JSON.stringify` drops a property whose value is `undefined`, so callers that don't set
`magiSessionId` produce an identical wire body to today.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/services/PapaiNotifier.test.ts`
Expected: PASS — 4 tests passed (the 3 pre-existing plus the new one).

- [ ] **Step 5: Commit**

```bash
git add src/services/PapaiNotifier.ts tests/services/PapaiNotifier.test.ts
git commit -m "feat(nerv): accept optional magiSessionId in PapaiNotifier notify body"
```

---

### Task 2: `PapaiTaskNotifier` — thread the task's repo `magiSessionId` through every notify

**Files:**

- Modify: `src/services/PapaiTaskNotifier.ts:46-91`
- Test: `tests/services/PapaiTaskNotifier.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/services/PapaiTaskNotifier.test.ts`, immediately before the existing `'notifyReply
sends markdown without touching notificationState'` test:

```ts
it('includes magiSessionId from the first repo that has one', async () => {
  const { papai, notify } = makePapaiNotifier()
  const notifier = new PapaiTaskNotifier(papai)
  const task = await taskSvc.create(sampleInput)
  task.taskRepositories[0].magiSessionId = 'sess-abc'
  await task.save()

  await notifier.notifyStatus(task, 'coding')

  const body = JSON.parse((notify.mock.calls[0][1] as RequestInit).body as string)
  expect(body.magiSessionId).toBe('sess-abc')
})

it('omits magiSessionId when no repo has one', async () => {
  const { papai, notify } = makePapaiNotifier()
  const notifier = new PapaiTaskNotifier(papai)
  const task = await taskSvc.create(sampleInput)

  await notifier.notifyStatus(task, 'coding')

  const body = JSON.parse((notify.mock.calls[0][1] as RequestInit).body as string)
  expect(body.magiSessionId).toBeUndefined()
})

it('notifyReply includes magiSessionId from the first repo that has one', async () => {
  const { papai, notify } = makePapaiNotifier()
  const notifier = new PapaiTaskNotifier(papai)
  const task = await taskSvc.create(sampleInput)
  task.taskRepositories[0].magiSessionId = 'sess-xyz'
  await task.save()

  await notifier.notifyReply(task, 'here is your answer')

  const body = JSON.parse((notify.mock.calls[0][1] as RequestInit).body as string)
  expect(body.magiSessionId).toBe('sess-xyz')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/services/PapaiTaskNotifier.test.ts`
Expected: FAIL — the two `'includes magiSessionId...'` tests fail with `expected undefined to be
'sess-abc'` (resp. `'sess-xyz'`); the `'omits magiSessionId...'` test passes vacuously today (there's
nothing to strip yet) but must be re-verified after Step 3 so it isn't a false-positive pass — treat
all three as red until Step 3 lands.

- [ ] **Step 3: Add the helper and thread it through both notify calls**

In `src/services/PapaiTaskNotifier.ts`, add a private helper right after the constructor:

```ts
  constructor(
    private readonly papai: PapaiNotifier,
    private readonly log: Logger = createLogger('papai-task-notifier'),
  ) {}

  /**
   * Picks the magi session to surface a transcript link for. `/api/notify` is task-level,
   * not repo-level, but a task can span multiple repos — mirrors the existing
   * `taskRepositories.find((r) => r.magiSessionId)` convention used elsewhere to pick "the"
   * live session for a task (see `foundationHandlers.ts`'s chat_instruction handler): the
   * first repo that has recorded a magi session wins.
   */
  private magiSessionIdFor(task: HydratedDocument<ITask>): string | undefined {
    return task.taskRepositories.find((r) => r.magiSessionId)?.magiSessionId
  }
```

Then pass it through in `notifyStatus` — change:

```ts
await this.papai.notify({
  contextId: task.contextRef.contextId,
  threadId: task.contextRef.threadId,
  markdown: parts.join('\n\n'),
})

task.notificationState = { lastNotifiedStatus: status, lastNotifiedAt: new Date() }
```

to:

```ts
await this.papai.notify({
  contextId: task.contextRef.contextId,
  threadId: task.contextRef.threadId,
  markdown: parts.join('\n\n'),
  magiSessionId: this.magiSessionIdFor(task),
})

task.notificationState = { lastNotifiedStatus: status, lastNotifiedAt: new Date() }
```

And in `notifyReply` — change:

```ts
  async notifyReply(task: HydratedDocument<ITask>, markdown: string): Promise<void> {
    await this.papai.notify({
      contextId: task.contextRef.contextId,
      threadId: task.contextRef.threadId,
      markdown,
    })
  }
```

to:

```ts
  async notifyReply(task: HydratedDocument<ITask>, markdown: string): Promise<void> {
    await this.papai.notify({
      contextId: task.contextRef.contextId,
      threadId: task.contextRef.threadId,
      markdown,
      magiSessionId: this.magiSessionIdFor(task),
    })
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/services/PapaiTaskNotifier.test.ts`
Expected: PASS — 10 tests passed (the 7 pre-existing plus the 3 new).

- [ ] **Step 5: Run the full nerv notifier test pair + typecheck**

Run: `npx vitest run tests/services/PapaiNotifier.test.ts tests/services/PapaiTaskNotifier.test.ts`
Expected: PASS — `Test Files 2 passed (2)`, `Tests 14 passed (14)`.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no output (clean typecheck).

- [ ] **Step 6: Commit**

```bash
git add src/services/PapaiTaskNotifier.ts tests/services/PapaiTaskNotifier.test.ts
git commit -m "feat(nerv): surface the task's magi session id on every papai notify"
```

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-12-migration-p3-nerv.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
