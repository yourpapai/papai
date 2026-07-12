<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# nerv — Migration Phase 2 (Crash Auto-Resume) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach nerv to detect a magi session that reports `interrupted` (crashed/hung mid-turn but
magi itself stayed alive) and automatically resume it, bounded by a per-repo retry budget, falling
back to `failed` + chat notification once that budget is exhausted — closing the gap where a dead
coding session today stalls forever with `lastActivity` still ticking (see
`docs/superpowers/specs/2026-07-12-migration-p2-crash-resume-design.md`, "Key findings"). Also closes
the pre-existing review/CI ledger-write-after-dispatch race by threading a deterministic
`idempotencyKey` through every `magi.followUp`/`resumeSession` dispatch nerv makes.

**Architecture:** `MagiClient` grows a `resumeSession` method mirroring `followUp` (same
credential-resupply contract, POST to a new magi endpoint) and both `followUp`/`resumeSession` grow
an optional `idempotencyKey` parameter. `magiStatus.ts` maps magi's new `interrupted` status onto
nerv's `coding` `TaskStatus` (still "working", not terminal). `makeReconcileHandler` — the
already-existing per-repo poll loop in `foundationHandlers.ts` — gets a resume-policy branch: on
`interrupted`, increment+persist `TaskRepo.resumeAttempts` _before_ dispatching the resume call (so
a crash mid-dispatch still consumes budget on retry), call `magi.resumeSession` with a deterministic
key, and swap in the returned child session id; once the configurable `maxResumeAttempts` budget is
exhausted, force the task to `failed` and notify chat. A small pure `domain/idempotencyKeys.ts`
module derives the three deterministic key shapes (review-fix / CI-fix / resume) from stable ids,
consumed by `reviewHandlers.ts`, `ciHandlers.ts`, and the new reconcile resume branch.

**Tech Stack:** Bun-free TypeScript service (Node ≥24), Mongoose, Fastify, vitest (`npx vitest run
<path>`), `tsc --noEmit` for typecheck.

**Repo:** `/Users/ki/Projects/yourpapai/nerv`

**Cross-repo note:** This plan implements nerv-side Components 5–7 of the P2 design only. The
**magi** plan (Components 1–4: `interrupted` `SessionStatus`, the two detection triggers, the
`POST /sessions/:id/resume` endpoint, and `idempotencyKey` dedupe) is a separate plan and **must
land first** — every nerv task in this plan calls a magi contract (`interrupted` status on
`GET /sessions/:id`, `POST /sessions/:id/resume`, `idempotencyKey` acceptance on
`follow-up`/`resume`) that does not yet exist on the magi side. nerv's own test suite mocks
`MagiClient`/`magi.getSession`/`magi.resumeSession` throughout, so this plan's tasks are individually
buildable and testable in isolation before magi ships — but end-to-end crash-resume only works once
both plans are deployed.

---

## File Structure

| File                                              | Change                                                                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/MagiClient.ts`                      | Add `resumeSession(sessionId, opts?, idempotencyKey?)`; add optional 4th `idempotencyKey` param to `followUp`                                                 |
| `tests/services/MagiClient.test.ts`               | Tests for the above                                                                                                                                           |
| `src/domain/magiStatus.ts`                        | Map magi's `interrupted` status onto `coding`                                                                                                                 |
| `tests/domain/magiStatus.test.ts`                 | Test for the above                                                                                                                                            |
| `src/db/models/Task.ts`                           | Add `TaskRepo.resumeAttempts?: number` (+ schema field)                                                                                                       |
| `tests/db/models/taskFields.test.ts`              | Round-trip test for the above                                                                                                                                 |
| `src/config.ts`                                   | Add `NervConfig.maxResumeAttempts`, `MAX_RESUME_ATTEMPTS` env var (default 3)                                                                                 |
| `tests/config.test.ts`                            | Test for the above                                                                                                                                            |
| `src/domain/idempotencyKeys.ts` (new)             | Pure helpers: `reviewFixIdempotencyKey`, `ciFixIdempotencyKey`, `resumeIdempotencyKey`                                                                        |
| `tests/domain/idempotencyKeys.test.ts` (new)      | Tests for the above                                                                                                                                           |
| `src/supervisor/reviewHandlers.ts`                | Pass a deterministic `idempotencyKey` on the review-fix `magi.followUp` call                                                                                  |
| `tests/supervisor/reviewCommentHandler.test.ts`   | Assert the key on the happy-path test                                                                                                                         |
| `src/supervisor/ciHandlers.ts`                    | Pass a deterministic `idempotencyKey` on the CI-fix `magi.followUp` call                                                                                      |
| `tests/supervisor/pipelineFailureHandler.test.ts` | Assert the key on the happy-path test                                                                                                                         |
| `src/supervisor/foundationHandlers.ts`            | `makeReconcileHandler` grows the resume policy (budget check, persist-then-dispatch, adopt child id, budget-exhausted → `failed` + notify, reset-on-progress) |
| `tests/supervisor/foundationHandlers.test.ts`     | 4 new `reconcile handler` tests                                                                                                                               |
| `src/index.ts`                                    | Wire `makeReconcileHandler(cfg.maxResumeAttempts)`                                                                                                            |

---

### Task 1: `MagiClient.resumeSession` + `idempotencyKey` on `followUp`

**Files:**

- Modify: `src/services/MagiClient.ts:90-105`
- Test: `tests/services/MagiClient.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/services/MagiClient.test.ts`, just above the `'cancels a session via POST /sessions/:id/cancel'` test:

```ts
it('includes idempotencyKey on the follow-up body when supplied', async () => {
  const f = fakeFetch(200, { ok: true })
  const client = new MagiClient(cfg, f)
  await client.followUp('sess-1', 'fix it', { forgeToken: 'forge-tok' }, 'task-1:g/r:note:101')
  const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({
    prompt: 'fix it',
    forgeToken: 'forge-tok',
    idempotencyKey: 'task-1:g/r:note:101',
  })
})

it('omits idempotencyKey from the follow-up body when not supplied', async () => {
  const f = fakeFetch(200, { ok: true })
  const client = new MagiClient(cfg, f)
  await client.followUp('sess-1', 'fix it')
  const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
  expect(JSON.parse((init as RequestInit).body as string)).not.toHaveProperty('idempotencyKey')
})

it('resumes a session via POST /sessions/:id/resume with credentials + idempotencyKey, and returns the parsed child session', async () => {
  const f = fakeFetch(200, { id: 'sess-1-r1', status: 'preparing' })
  const client = new MagiClient(cfg, f)
  const res = await client.resumeSession(
    'sess-1',
    { forgeToken: 'forge-tok', secrets: { A: 'b' } },
    'task-1:g/r:resume:sess-1',
  )
  const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
  expect(url).toBe('http://magi/sessions/sess-1/resume')
  expect((init as RequestInit).method).toBe('POST')
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({
    forgeToken: 'forge-tok',
    secrets: { A: 'b' },
    idempotencyKey: 'task-1:g/r:resume:sess-1',
  })
  expect(res).toEqual({ id: 'sess-1-r1', status: 'preparing' })
})

it('resumes a session with no credentials/idempotencyKey supplied (empty body)', async () => {
  const f = fakeFetch(200, { id: 'sess-1-r1', status: 'preparing' })
  const client = new MagiClient(cfg, f)
  await client.resumeSession('sess-1')
  const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({})
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/services/MagiClient.test.ts`
Expected: FAIL — `client.resumeSession is not a function`, and the `idempotencyKey` assertions fail because `followUp` doesn't accept a 4th argument.

- [ ] **Step 3: Implement**

In `src/services/MagiClient.ts`, replace the `followUp` method and insert `resumeSession` right after it (before `getSession`):

```ts
  followUp(
    sessionId: string,
    prompt: string,
    opts?: { forgeToken?: string; mcpToken?: string; secrets?: Record<string, string> },
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.call('POST', `/sessions/${sessionId}/follow-up`, {
      prompt,
      ...(opts?.secrets !== undefined ? { secrets: opts.secrets } : {}),
      ...(opts?.forgeToken !== undefined ? { forgeToken: opts.forgeToken } : {}),
      ...(opts?.mcpToken !== undefined ? { mcpToken: opts.mcpToken } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    })
  }

  /**
   * `POST /sessions/:id/resume` (magi/src/server/router.ts#handleResume) — resumes an
   * `interrupted` session onto a fresh worktree/container on its original branch. Mirrors
   * `followUp`'s credential-resupply contract (magi does not inherit forgeToken/mcpToken/secrets
   * across turns) but takes no `prompt`: magi drives a standard "continue the interrupted work"
   * continuation via ACP `session/load`. Returns the new child session (same shape as `startSession`).
   */
  async resumeSession(
    sessionId: string,
    opts?: { forgeToken?: string; mcpToken?: string; secrets?: Record<string, string> },
    idempotencyKey?: string,
  ): Promise<MagiSession> {
    return (await this.call('POST', `/sessions/${sessionId}/resume`, {
      ...(opts?.secrets !== undefined ? { secrets: opts.secrets } : {}),
      ...(opts?.forgeToken !== undefined ? { forgeToken: opts.forgeToken } : {}),
      ...(opts?.mcpToken !== undefined ? { mcpToken: opts.mcpToken } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    })) as MagiSession
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/services/MagiClient.test.ts`
Expected: PASS (10 tests: 6 pre-existing + 4 new)

- [ ] **Step 5: Commit**

```bash
git add src/services/MagiClient.ts tests/services/MagiClient.test.ts
git commit -m "feat(nerv): add MagiClient.resumeSession + idempotencyKey on followUp"
```

---

### Task 2: `interrupted` → `coding` status mapping

**Files:**

- Modify: `src/domain/magiStatus.ts:33-40`
- Test: `tests/domain/magiStatus.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/domain/magiStatus.test.ts`, add a row to the `it.each` table (right after `['finishing', 'coding'],`):

```ts
    ['interrupted', 'coding'],
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/magiStatus.test.ts`
Expected: FAIL — `maps magi status interrupted -> coding`: `statusForMagiStatus('interrupted')` returns `null`, not `'coding'`.

- [ ] **Step 3: Implement**

In `src/domain/magiStatus.ts`, add `'interrupted'` to `IN_PROGRESS_MAGI_STATUSES`:

```ts
const IN_PROGRESS_MAGI_STATUSES: ReadonlySet<string> = new Set([
  'queued',
  'preparing',
  'running',
  'waiting_permission',
  'waiting_input',
  'finishing',
  // Died/hung mid-turn but magi is still alive and the session is resumable (P2 magi
  // Component 1). Not a terminal `failed` — nerv's reconcile resume policy (foundationHandlers.ts)
  // decides whether to resume it or, once its retry budget is exhausted, force `failed` itself.
  'interrupted',
])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/magiStatus.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/magiStatus.ts tests/domain/magiStatus.test.ts
git commit -m "feat(nerv): map magi's interrupted session status onto coding"
```

---

### Task 3: `TaskRepo.resumeAttempts` field

**Files:**

- Modify: `src/db/models/Task.ts:21-34` (interface), `:68-79` (schema)
- Test: `tests/db/models/taskFields.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/db/models/taskFields.test.ts`, in the `'round-trips the new optional fields when set'` test, add `resumeAttempts: 2` to the `taskRepositories[0]` object literal (alongside `sessionStatus: 'running'`), and add an assertion right after `expect(reloaded!.taskRepositories[0].sessionStatus).toBe('running')`:

```ts
expect(reloaded!.taskRepositories[0].resumeAttempts).toBe(2)
```

Then in the `'leaves the new fields undefined/defaulted when omitted'` test, add right after `expect(reloaded!.taskRepositories[0].sessionStatus).toBeUndefined()`:

```ts
expect(reloaded!.taskRepositories[0].resumeAttempts).toBeUndefined()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/models/taskFields.test.ts`
Expected: FAIL — TypeScript error, `resumeAttempts` does not exist on the `taskRepositories[0]` create input / on `TaskRepo`.

- [ ] **Step 3: Implement**

In `src/db/models/Task.ts`, add the field to the `TaskRepo` interface:

```ts
  /** Last known magi session status for this repo's session. */
  sessionStatus?: string
  /**
   * Consecutive resume attempts made against this repo's magi session while it has been
   * `interrupted` (P2 Component 6 retry budget). Persisted BEFORE each `magi.resumeSession`
   * dispatch (so a crash mid-dispatch still consumes budget on the next reconcile tick), reset
   * to 0 once the session reaches a non-`interrupted` live/terminal state.
   */
  resumeAttempts?: number
}
```

And to `repoSchema`:

```ts
  mrSyncSnapshot: { type: Schema.Types.Mixed, default: undefined },
  sessionStatus: String,
  resumeAttempts: Number,
}, { _id: false })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/models/taskFields.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/models/Task.ts tests/db/models/taskFields.test.ts
git commit -m "feat(nerv): add TaskRepo.resumeAttempts for the P2 resume retry budget"
```

---

### Task 4: `maxResumeAttempts` config

**Files:**

- Modify: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/config.test.ts`, add right after the `'applies the assigneeWatchMs default and allows override via ASSIGNEE_WATCH_MS'` test:

```ts
it('applies the maxResumeAttempts default and allows override via MAX_RESUME_ATTEMPTS', () => {
  expect(loadConfig(base).maxResumeAttempts).toBe(3)
  expect(loadConfig({ ...base, MAX_RESUME_ATTEMPTS: '5' }).maxResumeAttempts).toBe(5)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — TypeScript error, `maxResumeAttempts` does not exist on `NervConfig` (or, if that's loosened, `expect(undefined).toBe(3)` fails at runtime).

- [ ] **Step 3: Implement**

In `src/config.ts`, add the field to `NervConfig` right after `maxAttempts: number`:

```ts
maxAttempts: number
/** Resume retry budget (P2 Component 6): how many consecutive `interrupted` resumes reconcile will attempt on a repo's magi session before giving up and failing the task. */
maxResumeAttempts: number
```

And load it in `loadConfig`, right after `maxAttempts: num('MAX_ATTEMPTS', 5),`:

```ts
    maxAttempts: num('MAX_ATTEMPTS', 5),
    maxResumeAttempts: num('MAX_RESUME_ATTEMPTS', 3),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (19 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat(nerv): add MAX_RESUME_ATTEMPTS config (default 3)"
```

---

### Task 5: Deterministic idempotency-key helpers

**Files:**

- Create: `src/domain/idempotencyKeys.ts`
- Test: `tests/domain/idempotencyKeys.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/domain/idempotencyKeys.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { reviewFixIdempotencyKey, ciFixIdempotencyKey, resumeIdempotencyKey } from '../../src/domain/idempotencyKeys.js'

describe('idempotency keys', () => {
  it('derives a stable review-fix key from taskId/projectPath/noteIds, independent of noteIds order', () => {
    expect(reviewFixIdempotencyKey('task-1', 'g/r', ['101'])).toBe('task-1:g/r:note:101')
    expect(reviewFixIdempotencyKey('task-1', 'g/r', ['102', '101'])).toBe('task-1:g/r:note:101,102')
    expect(reviewFixIdempotencyKey('task-1', 'g/r', ['101', '102'])).toBe(
      reviewFixIdempotencyKey('task-1', 'g/r', ['102', '101']),
    )
  })

  it('derives a CI-fix key from taskId/projectPath/jobId', () => {
    expect(ciFixIdempotencyKey('task-1', 'g/r', 999)).toBe('task-1:g/r:job:999')
  })

  it('derives a resume key from taskId/projectPath/interruptedSessionId', () => {
    expect(resumeIdempotencyKey('task-1', 'g/r', 'sess-9')).toBe('task-1:g/r:resume:sess-9')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/idempotencyKeys.test.ts`
Expected: FAIL — cannot find module `../../src/domain/idempotencyKeys.js`.

- [ ] **Step 3: Implement**

Create `src/domain/idempotencyKeys.ts`:

```ts
/**
 * Deterministic magi `idempotencyKey`s (P2 Component 7) — re-derived from the same stable ids on
 * every retry of the same logical dispatch (a review-fix note group, a CI-fix job, or a session
 * resume), so magi's `(parentId, idempotencyKey)` dedupe (P2 magi Component 4) returns the
 * existing child session instead of minting a duplicate on a crash-then-retry. This closes the
 * pre-existing ledger-write-after-dispatch race in reviewHandlers.ts/ciHandlers.ts, where
 * `processedNoteIds`/`processedJobIds` are written AFTER the `magi.followUp` dispatch, non-atomically.
 */

/**
 * review-fix follow-up key. `noteIds` is the exact set of note ids the fix addresses for this
 * work item — sorted here so the key is independent of array order (the same underlying group
 * always re-derives the same key on retry).
 */
export function reviewFixIdempotencyKey(taskId: string, projectPath: string, noteIds: readonly string[]): string {
  return `${taskId}:${projectPath}:note:${[...noteIds].sort().join(',')}`
}

/** CI-fix follow-up key. */
export function ciFixIdempotencyKey(taskId: string, projectPath: string, jobId: number | string): string {
  return `${taskId}:${projectPath}:job:${jobId}`
}

/** Resume key, keyed by the interrupted session's own id (stable across retried resume attempts targeting that same crash). */
export function resumeIdempotencyKey(taskId: string, projectPath: string, interruptedSessionId: string): string {
  return `${taskId}:${projectPath}:resume:${interruptedSessionId}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/idempotencyKeys.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/idempotencyKeys.ts tests/domain/idempotencyKeys.test.ts
git commit -m "feat(nerv): add deterministic idempotencyKey helpers for review/CI/resume dispatch"
```

---

### Task 6: Wire the review-fix idempotency key

**Files:**

- Modify: `src/supervisor/reviewHandlers.ts:1-19` (imports), `:80` (the `magi.followUp` call)
- Test: `tests/supervisor/reviewCommentHandler.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/supervisor/reviewCommentHandler.test.ts`, in the `'happy path: sends a follow-up prompt including the comment text, and records the processed note ids'` test, replace:

```ts
    expect(forge.getMRView).toHaveBeenCalledWith('g/r', '1')
    expect(magi.followUp).toHaveBeenCalledOnce()
    const [sessionId, prompt] = magi.followUp.mock.calls[0] as unknown as [string, string]
    expect(sessionId).toBe('sess-1')
    expect(prompt).toContain('Please fix this null check.')
    expect(prompt).toContain('alice')

    const reloaded = await tasks.get(t._id.toString())
    expect(reloaded?.taskRepositories[0].processedNoteIds).toEqual(['101'])
  })
```

with:

```ts
    expect(forge.getMRView).toHaveBeenCalledWith('g/r', '1')
    expect(magi.followUp).toHaveBeenCalledOnce()
    const [sessionId, prompt, , idempotencyKey] = magi.followUp.mock.calls[0] as unknown as [
      string,
      string,
      unknown,
      string,
    ]
    expect(sessionId).toBe('sess-1')
    expect(prompt).toContain('Please fix this null check.')
    expect(prompt).toContain('alice')
    expect(idempotencyKey).toBe(`${t._id.toString()}:g/r:note:101`)

    const reloaded = await tasks.get(t._id.toString())
    expect(reloaded?.taskRepositories[0].processedNoteIds).toEqual(['101'])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/supervisor/reviewCommentHandler.test.ts`
Expected: FAIL — `idempotencyKey` is `undefined`, not `'<taskId>:g/r:note:101'` (the handler doesn't pass a 4th arg to `followUp` yet).

- [ ] **Step 3: Implement**

In `src/supervisor/reviewHandlers.ts`, add the import (after the existing `resolveMagiCredentials` import):

```ts
import { generateFixPrompt } from '../services/prompts.js'
import { createLogger } from '../logger.js'
import { resolveMagiCredentials } from './magiCredentials.js'
import { reviewFixIdempotencyKey } from '../domain/idempotencyKeys.js'
```

Then replace the dispatch (line ~80):

```ts
const idempotencyKey = reviewFixIdempotencyKey(task._id.toString(), repo.projectPath, payload.noteIds)
await magi.followUp(repo.magiSessionId, prompt, credentials, idempotencyKey)

for (const id of payload.noteIds) processedNoteIds.add(id)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/supervisor/reviewCommentHandler.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/supervisor/reviewHandlers.ts tests/supervisor/reviewCommentHandler.test.ts
git commit -m "feat(nerv): pass a deterministic idempotencyKey on review-fix follow-ups"
```

---

### Task 7: Wire the CI-fix idempotency key

**Files:**

- Modify: `src/supervisor/ciHandlers.ts:1-18` (imports), `:58` (the `magi.followUp` call)
- Test: `tests/supervisor/pipelineFailureHandler.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/supervisor/pipelineFailureHandler.test.ts`, in the `'happy path: sends a follow-up prompt with the job name/log, and records the jobId as processed'` test, replace:

```ts
    expect(forge.getFailedPipelineJobLogs).toHaveBeenCalledWith('g/r', '1', ['test_unit'])
    expect(magi.followUp).toHaveBeenCalledOnce()
    const [sessionId, prompt] = magi.followUp.mock.calls[0] as unknown as [string, string]
    expect(sessionId).toBe('sess-1')
    expect(prompt).toContain('test_unit')
    expect(prompt).toContain('Error: something failed')

    const reloaded = await tasks.get(t._id.toString())
    expect(reloaded?.taskRepositories[0].processedJobIds).toEqual(['999'])
  })
```

with:

```ts
    expect(forge.getFailedPipelineJobLogs).toHaveBeenCalledWith('g/r', '1', ['test_unit'])
    expect(magi.followUp).toHaveBeenCalledOnce()
    const [sessionId, prompt, , idempotencyKey] = magi.followUp.mock.calls[0] as unknown as [
      string,
      string,
      unknown,
      string,
    ]
    expect(sessionId).toBe('sess-1')
    expect(prompt).toContain('test_unit')
    expect(prompt).toContain('Error: something failed')
    expect(idempotencyKey).toBe(`${t._id.toString()}:g/r:job:999`)

    const reloaded = await tasks.get(t._id.toString())
    expect(reloaded?.taskRepositories[0].processedJobIds).toEqual(['999'])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/supervisor/pipelineFailureHandler.test.ts`
Expected: FAIL — `idempotencyKey` is `undefined`.

- [ ] **Step 3: Implement**

In `src/supervisor/ciHandlers.ts`, add the import:

```ts
import { generatePipelineFixPrompt, truncateJobLog } from '../services/prompts.js'
import { createLogger } from '../logger.js'
import { resolveWorktreeSubdir } from './reviewHandlers.js'
import { resolveMagiCredentials } from './magiCredentials.js'
import { ciFixIdempotencyKey } from '../domain/idempotencyKeys.js'
```

Then replace the dispatch (line ~58):

```ts
const idempotencyKey = ciFixIdempotencyKey(task._id.toString(), repo.projectPath, payload.jobId)
await magi.followUp(repo.magiSessionId, prompt, credentials, idempotencyKey)

processedJobIds.add(String(payload.jobId))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/supervisor/pipelineFailureHandler.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/supervisor/ciHandlers.ts tests/supervisor/pipelineFailureHandler.test.ts
git commit -m "feat(nerv): pass a deterministic idempotencyKey on CI-fix follow-ups"
```

---

### Task 8: Reconcile resume policy

This is the core policy task. It touches one function (`makeReconcileHandler` in
`src/supervisor/foundationHandlers.ts:36-122`) across three red→green cycles: resume-under-budget,
budget-exhausted, and reset-on-progress, plus a fourth cycle for the resume-call-failure path.

**Files:**

- Modify: `src/supervisor/foundationHandlers.ts:1-59` (imports/docblock/per-repo loop), `:152-155` (notify extraParts)
- Test: `tests/supervisor/foundationHandlers.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/supervisor/foundationHandlers.test.ts`, add these 4 tests at the end of the `describe('reconcile handler', ...)` block (just before its closing `})`, i.e. right after the `'transitioning to review with no Project registry available...'` test):

```ts
it('resumes an interrupted session under budget: persists resumeAttempts before dispatch, calls resumeSession with the deterministic key, adopts the new session id, and keeps the task coding', async () => {
  const t = await makeCodingTask()
  let attemptsSeenByResume: number | undefined
  const magi = {
    getSession: vi.fn(async () => ({ id: 'sess-9', status: 'interrupted' })),
    resumeSession: vi.fn(async () => {
      const mid = await tasks.get(t._id.toString())
      attemptsSeenByResume = mid?.taskRepositories[0].resumeAttempts
      return { id: 'sess-9-r1', status: 'preparing' }
    }),
  }
  const { papai } = makePapai()

  const handler = makeReconcileHandler(3)
  await handler({ task: t, item: { payload: {} }, magi, papai, magiDefaults: {} } as unknown as HandlerCtx)

  expect(attemptsSeenByResume).toBe(1) // proves the increment was persisted BEFORE dispatch
  expect(magi.resumeSession).toHaveBeenCalledWith('sess-9', {}, `${t._id.toString()}:g/r:resume:sess-9`)
  const reloaded = await tasks.get(t._id.toString())
  expect(reloaded?.status).toBe('coding')
  expect(reloaded?.taskRepositories[0].magiSessionId).toBe('sess-9-r1')
  expect(reloaded?.taskRepositories[0].resumeAttempts).toBe(1)
  expect(papai.notify).not.toHaveBeenCalled()
})

it('transitions the task to failed and notifies papai once the resume budget is exhausted', async () => {
  const t = await makeCodingTask()
  t.taskRepositories[0].resumeAttempts = 3
  await t.save()
  const magi = {
    getSession: vi.fn(async () => ({ id: 'sess-9', status: 'interrupted' })),
    resumeSession: vi.fn(async () => ({ id: 'sess-9-r99', status: 'preparing' })),
  }
  const { papai } = makePapai()

  const handler = makeReconcileHandler(3)
  await handler({ task: t, item: { payload: {} }, magi, papai, magiDefaults: {} } as unknown as HandlerCtx)

  expect(magi.resumeSession).not.toHaveBeenCalled()
  const reloaded = await tasks.get(t._id.toString())
  expect(reloaded?.status).toBe('failed')
  expect(reloaded?.taskRepositories[0].magiSessionId).toBe('sess-9') // untouched — no resume dispatched
  expect(papai.notify).toHaveBeenCalledTimes(1)
  const body = papai.notify.mock.calls[0][0] as { markdown: string }
  expect(body.markdown).toContain("couldn't be resumed after 3 attempts")
  expect(reloaded?.notificationState?.lastNotifiedStatus).toBe('failed')
})

it('resets resumeAttempts to 0 once the (resumed) session reports a non-interrupted status', async () => {
  const t = await makeCodingTask('sess-9-r1')
  t.taskRepositories[0].resumeAttempts = 2
  await t.save()
  const magi = { getSession: vi.fn(async () => ({ id: 'sess-9-r1', status: 'running' })) }
  const { papai } = makePapai()

  const handler = makeReconcileHandler(3)
  await handler({ task: t, item: { payload: {} }, magi, papai, magiDefaults: {} } as unknown as HandlerCtx)

  const reloaded = await tasks.get(t._id.toString())
  expect(reloaded?.taskRepositories[0].resumeAttempts).toBe(0)
  expect(reloaded?.status).toBe('coding')
})

it('leaves the repo pointing at the still-interrupted session and does not throw when resumeSession itself fails (retried on the next reconcile tick)', async () => {
  const t = await makeCodingTask()
  const magi = {
    getSession: vi.fn(async () => ({ id: 'sess-9', status: 'interrupted' })),
    resumeSession: vi.fn(async () => {
      throw new Error('magi unreachable')
    }),
  }
  const { papai } = makePapai()

  const handler = makeReconcileHandler(3)
  await expect(
    handler({ task: t, item: { payload: {} }, magi, papai, magiDefaults: {} } as unknown as HandlerCtx),
  ).resolves.not.toThrow()

  const reloaded = await tasks.get(t._id.toString())
  expect(reloaded?.taskRepositories[0].magiSessionId).toBe('sess-9')
  expect(reloaded?.taskRepositories[0].resumeAttempts).toBe(1) // still consumed — persisted pre-dispatch
  expect(reloaded?.status).toBe('coding')
})
```

(`makeCodingTask` is the existing local helper in this test file's `reconcile handler` describe block —
`async function makeCodingTask(magiSessionId = 'sess-9')`, reused unchanged.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/supervisor/foundationHandlers.test.ts`
Expected: FAIL — `magi.resumeSession` is never called (`makeReconcileHandler` doesn't accept an arg
or branch on `interrupted` yet); `resumeAttempts` never changes; budget-exhausted task never reaches
`failed`.

- [ ] **Step 3: Implement**

In `src/supervisor/foundationHandlers.ts`, update the imports (add `resumeIdempotencyKey` and a
module logger):

```ts
import { applyMagiSession } from '../domain/magiSession.js'
import { statusForMagiStatus } from '../domain/magiStatus.js'
import { canTransition } from '../domain/stateMachine.js'
import { resumeIdempotencyKey } from '../domain/idempotencyKeys.js'
import {
  parsePromptResult,
  formatResultFieldsForReply,
  hasValidResultFields,
  prependOperatingInstructions,
} from '../services/prompts.js'
import { PapaiTaskNotifier } from '../services/PapaiTaskNotifier.js'
import { resolveMagiCredentials } from './magiCredentials.js'
import { createLogger } from '../logger.js'
import type { TaskStatus } from '../db/models/Task.js'
import type { Handler } from './handlers.js'
import type { ChatInstructionPayload } from '../domain/workPayloads.js'

const log = createLogger('reconcile-handler')
```

Then update the `makeReconcileHandler` docblock + signature + per-repo loop:

```ts
 * Also enqueues a one-shot `self_review` work item on the transition INTO `review` (not on repeat
 * polls that merely re-observe `review`), when the task's Project has `selfReviewEnabled`. Scoped
 * to the task's first repo only (single-repo-first — multi-repo self-review is a follow-up);
 * idempotent via a task-scoped dedupeKey.
 *
 * P2 resume policy: a repo whose magi session is `interrupted` (died/hung mid-turn, magi still
 * alive) is, under budget (`repo.resumeAttempts < maxResumeAttempts`), resumed automatically —
 * `resumeAttempts` is incremented and PERSISTED BEFORE the `magi.resumeSession` dispatch (so a
 * crash mid-dispatch still consumes budget on the next reconcile tick; no partial state), then
 * `resumeSession` is called with a deterministic idempotencyKey keyed on the interrupted session's
 * own id, and `repo.magiSessionId` is swapped to the returned child. The task stays `coding`
 * (`interrupted` maps to `coding` — see domain/magiStatus.ts). Once budget is exhausted the task
 * is forced to `failed` and papai is notified, bounding the retry loop. `resumeAttempts` resets to
 * 0 once a repo's session reports any non-`interrupted` status, so a later, unrelated crash gets a
 * fresh budget. A `resumeSession` call that itself throws leaves the repo's `magiSessionId`
 * pointing at the (still) interrupted session — it's picked up again on the next reconcile tick,
 * still under whatever budget remains.
 */
export function makeReconcileHandler(maxResumeAttempts = 3): Handler {
  return async ({ task, magi, papai, queue, projects, magiDefaults }) => {
    const notifier = new PapaiTaskNotifier(papai)

    const mappedStatuses: TaskStatus[] = []
    let resultMessage: string | undefined
    let resultMrUrl: string | undefined
    const resumeExhaustedMessages: string[] = []

    for (const repo of task.taskRepositories) {
      if (!repo.magiSessionId) continue
      const session = await magi.getSession(repo.magiSessionId)
      applyMagiSession(repo, session)
      repo.sessionStatus = session.status

      let mapped = statusForMagiStatus(session.status)

      if (session.status === 'interrupted') {
        const attempts = repo.resumeAttempts ?? 0
        if (attempts < maxResumeAttempts) {
          const interruptedSessionId = repo.magiSessionId
          repo.resumeAttempts = attempts + 1
          await task.save() // pre-dispatch intent — persist the attempt BEFORE calling magi
          try {
            const credentials = resolveMagiCredentials(
              projects?.getByContextId(task.contextRef.contextId),
              magiDefaults ?? {},
            )
            const idempotencyKey = resumeIdempotencyKey(task._id.toString(), repo.projectPath, interruptedSessionId)
            const child = await magi.resumeSession(interruptedSessionId, credentials, idempotencyKey)
            repo.magiSessionId = child.id
          } catch (err) {
            log.warn(`resumeSession failed for repo ${repo.projectPath} on task ${task._id.toString()} — will retry next reconcile tick`, {
              error: err instanceof Error ? err.message : String(err),
            })
          }
        } else {
          mapped = 'failed'
          resumeExhaustedMessages.push(
            `⚠️ The coding session for \`${repo.projectPath}\` crashed and couldn't be resumed after ${maxResumeAttempts} attempts.`,
          )
        }
      } else if (repo.resumeAttempts) {
        repo.resumeAttempts = 0
      }

      if (mapped) mappedStatuses.push(mapped)

      if (!resultMessage && session.lastMessage) resultMessage = session.lastMessage
      if (!resultMrUrl && repo.mrUrl) resultMrUrl = repo.mrUrl
    }
```

Finally, thread the exhausted-budget notification into the existing notify block — replace:

```ts
const extraParts: string[] = []
if (replyMarkdown) extraParts.push(replyMarkdown)
if (resultMrUrl) extraParts.push(`**Merge Request:** ${resultMrUrl}`)
```

with:

```ts
const extraParts: string[] = []
if (replyMarkdown) extraParts.push(replyMarkdown)
if (resultMrUrl) extraParts.push(`**Merge Request:** ${resultMrUrl}`)
if (resumeExhaustedMessages.length > 0) extraParts.push(...resumeExhaustedMessages)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/supervisor/foundationHandlers.test.ts`
Expected: PASS (28 tests — 24 pre-existing + 4 new)

- [ ] **Step 5: Run the full nerv suite and typecheck**

Run: `npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: `Test Files 38 passed (38)`, `Tests 334 passed (334)`; typecheck produces no output (clean).

- [ ] **Step 6: Commit**

```bash
git add src/supervisor/foundationHandlers.ts tests/supervisor/foundationHandlers.test.ts
git commit -m "feat(nerv): resume interrupted sessions in reconcile, bounded by a retry budget"
```

---

### Task 9: Wire `maxResumeAttempts` into the reconcile handler registration

**Files:**

- Modify: `src/index.ts:62`

- [ ] **Step 1: Update the registration**

In `src/index.ts`, replace:

```ts
registry.register('reconcile', makeReconcileHandler())
```

with:

```ts
registry.register('reconcile', makeReconcileHandler(cfg.maxResumeAttempts))
```

(This is composition-root wiring with no dedicated test — `src/index.ts` has none in this codebase,
consistent with e.g. `cfg.botUsername`'s wiring a few lines below. It's exercised transitively by
Task 8's `makeReconcileHandler(3)`-style unit tests and by the typecheck below.)

- [ ] **Step 2: Typecheck and run the full suite**

Run: `npx tsc -p tsconfig.json --noEmit && npx vitest run`
Expected: typecheck clean; `Test Files 38 passed (38)`, `Tests 334 passed (334)`.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(nerv): wire MAX_RESUME_ATTEMPTS into the reconcile handler"
```

---

## Post-implementation

Once the magi plan has also landed (see Cross-repo note above) and both are deployed together,
smoke-test end-to-end per the spec's testing strategy: kill a session's container mid-turn, confirm
`GET /sessions/:id` reports `interrupted`, confirm nerv's next `reconcile-sweep` tick resumes it
(`taskRepositories[0].resumeAttempts` increments, `magiSessionId` swaps to a new child, task stays
`coding`), and confirm that exhausting `MAX_RESUME_ATTEMPTS` flips the task to `failed` with a chat
notification.
