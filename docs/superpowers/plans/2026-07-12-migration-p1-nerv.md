<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# nerv — Migration Phase 1 (Assign-the-bot Trigger) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the nerv-repo portion of Phase 1 (Assign-the-bot Trigger) of the kiss→papai migration: a `Project.notifyContextId` field designating which papai context receives forge-triggered notifications (Component 1); a `POST /projects/bind` route that sets it (nerv half of Component 4); a `TaskService.createForgeEvent` path that seeds a `source:'forge-event'` task from an existing MR and lets `SupervisorService.startTask` adopt it via `prNumber` (Component 3); and a new `assigneeWatchSweep` that polls MRs assigned to the bot, adopts newly-assigned ones, and cancels tasks the bot was un-assigned from while their MR is still open (Component 2).

**Architecture:** All changes are additive to nerv's existing Mongoose/Fastify/sweep-scheduler stack — no new services, no new collections. `ProjectService.loadProjects()`'s existing `contextIds[]`→Project cache index is extended to also index `notifyContextId`, and a new `setNotifyContextId(projectPath, notifyContextId)` method persists the field via `Project.findByIdAndUpdate` + cache reload (Projects are ordinary mutable Mongoose documents — see Resolved Assumption 1 below). `TaskService` gains `createForgeEvent`, sibling to the existing `create`, that seeds a single `taskRepositories` entry with `mrIid`/`mrUrl`/`branchName` so the _already-existing_ `repo.mrIid !== undefined ? { prNumber: repo.mrIid } : {}` line in `SupervisorService.startTask` (no change needed there) passes it through to magi, which already knows how to adopt an MR by `prNumber` (see Resolved Assumption 2). A new `POST /projects/bind` route (mirroring the existing `tasks.ts`/`notify.ts` route pattern) resolves the owning Project via the already-implemented (but previously unwired) `getByForgeProject` and calls `setNotifyContextId`. A new `assigneeWatchSweep` (in `periodic/sweeps.ts`, alongside the existing sweeps) polls `ForgeClient.getAllMRsByAssignee` (implemented, previously uncalled), creates forge-event tasks for newly-assigned MRs not already covered by an active task (idempotent by `projectPath!mrIid`), and cancels (`SupervisorService.cancelTask`) any active forge-event task whose MR is no longer in the assigned set but is still open (merged/closed MRs are left untouched for the existing `forgePollSweep` completion path). It's registered in `index.ts` next to `forge-poll`, gated on the same `cfg.forgeRead` config, on a new `assigneeWatchMs` interval.

**Tech Stack:** Bun-adjacent Node runtime (npm-managed, no bun lockfile), Fastify 5, Mongoose 8 (MongoDB), Zod, Vitest 2 (`mongodb-memory-server` for DB-backed tests). Test command: `npx vitest run <path>` from the nerv repo root. Type-check: `npx tsc -p tsconfig.json --noEmit`.

**Repo:** `/Users/ki/Projects/yourpapai/nerv`
**Cross-repo note:** Land this plan BEFORE the papai-side P1 plan — papai's `/nerv bind <projectPath>` command calls this plan's `POST /projects/bind`, and nerv must accept it (and actually persist `notifyContextId`) before papai starts relying on it. No magi changes are needed anywhere in P1 — magi's MR-adoption path (`StartSessionInput.prNumber`) already exists and already works; this plan only wires nerv to use it.

---

## Resolved open assumptions

**1. Are `Project` records mutable DB documents, or config-seeded/immutable?**
Resolved: **mutable Mongoose documents in a real MongoDB collection.** `nerv/src/db/models/Project.ts` defines an ordinary `model<IProject>('Project', projectSchema)`; there is no seed script, no read-only/config-derived construction anywhere in `src/`, and existing tests create Projects directly via `Project.create(...)` against `mongodb-memory-server`. There was, however, **no existing write path** — `ProjectService` (`src/services/ProjectService.ts`) was pure read/cache (`loadProjects`, `getByContextId`, `getRepoConfig`, `resolveRepositories`, `getByForgeProject`, `getAll`) with no update method and no admin route touching `Project`. Task 2 below adds the first one: `ProjectService.setNotifyContextId()` using `Project.findByIdAndUpdate` followed by a cache reload, exercised end-to-end (through `POST /projects/bind`, then re-verified by direct `Project.findOne` in the DB) in Task 4.

**2. The MR's `iid` vs `number` mapping for GitLab — what exact field reaches `StartSessionInput.prNumber`?**
Resolved: **nerv's `mrIid` (GitLab's per-project MR `iid`) is exactly the value that must, and already does, flow into `prNumber` — no change needed in `SupervisorService.startTask`.** Traced end-to-end:

- `GitlabForgeClient.mapMRToInfo` (`src/services/GitlabForgeClient.ts:366-380`) maps gitbeaker's `mr.iid` → `MergeRequestInfo.iid`, so every `ForgeClient` method (including `getAllMRsByAssignee`) surfaces GitLab's `iid`, never the global MR `id`.
- `SupervisorService.startTask` (`src/supervisor/SupervisorService.ts:98-106`) **already contains** `...(repo.mrIid !== undefined ? { prNumber: repo.mrIid } : {})` inside its `StartSessionInput` construction. This line predates P1 and is unconditionally exercised for any repo carrying `mrIid` — chat-created tasks never set it, so this is currently dead in practice, but it needs zero modification.
- On magi's side, `magi/src/session/state.ts:87-96`'s `StartSessionInput.prNumber?: number` flows into `resolveCheckoutBranch` (`magi/src/session/lifecycle.ts:70-85`), which calls `forge.getPullRequest(input.prNumber)`.
- magi's GitLab forge client (`magi/src/forge/gitlab.ts:99-106`) implements `getPullRequest(prNumber)` as `GET ${base}/merge_requests/${prNumber}` — GitLab's `iid`-keyed per-project endpoint.

So the only real gap was that **nothing seeds `repo.mrIid` when creating a forge-event task** — Task 3 (`TaskService.createForgeEvent`) closes that gap; `SupervisorService.startTask` needed no code change at all.

**Bug found and fixed along the way (not one of the two assumptions, but required for Component 3 to actually work):** `ProjectService.loadProjects()` only indexed `cacheByContextId` by `p.contextIds ?? []`, never by `p.notifyContextId`. Since forge-event tasks get `contextRef.contextId = project.notifyContextId` (per Component 3), and `SupervisorService.startTask` resolves the Project via `getByContextId(contextId)` to get `repoConfig.repoUrl`/model/MCP/forge overrides, this would have silently broken repo-URL resolution for every forge-event task (falling back to the bogus `repo.projectPath` as `repoUrl`). Task 2 fixes the indexing loop; Task 5's test explicitly asserts `magi.startSession` receives the real configured `repoUrl`, not the fallback, locking this in.

---

## File Structure

Modified:

- `src/db/models/Project.ts` — `IProject`/`projectSchema` gain optional `notifyContextId` (Component 1).
- `src/services/ProjectService.ts` — `loadProjects()` also indexes `notifyContextId` into the contextId cache (bug fix, above); new `setNotifyContextId(projectPath, notifyContextId)` method (Component 4/nerv half).
- `src/services/TaskService.ts` — new `CreateForgeEventTaskInput` + `createForgeEvent()` method (Component 3).
- `src/http/server.ts` — `ServerDeps` gains `projects: ProjectService`; registers the new project routes.
- `src/periodic/sweeps.ts` — new `AssigneeWatchSweepOpts` + `assigneeWatchSweep()` (Component 2); new imports (`SupervisorService`, `ProjectService`, `generateMRAdoptionPrompt`, `MergeRequestInfo`).
- `src/config.ts` — `NervConfig` gains `assigneeWatchMs` (default 60000 via `ASSIGNEE_WATCH_MS`).
- `src/index.ts` — imports `assigneeWatchSweep`; registers it as the `'assignee-watch'` scheduler entry inside the existing `if (cfg.forgeRead)` block, right after `forge-poll`; passes `projects` into `buildServer(...)`.
- `tests/services/ProjectService.test.ts` — new tests for `notifyContextId` cache indexing and `setNotifyContextId`.
- `tests/services/TaskService.test.ts` — new `createForgeEvent` test.
- `tests/http/server.test.ts` — `makeApp()` gains a `projects` dependency; new `POST /projects/bind` tests (200 + persisted, 404 unknown, 401 unauthenticated).
- `tests/integration/handlers.test.ts` — its standalone `buildServer(...)` call gains `projects: {} as never`.
- `tests/config.test.ts` — new `assigneeWatchMs` default/override test.

Created:

- `src/http/routes/projects.ts` — `registerProjectRoutes`, the `POST /projects/bind` handler (Component 4/nerv half).
- `tests/db/models/projectFields.test.ts` — `notifyContextId` round-trip persistence test (Component 1).
- `tests/periodic/assigneeWatchSweep.test.ts` — discovery, dedupe, cancel, merged-MR-left-alone, unconfigured-repo, and no-notifyContextId tests (Component 2).

No files are deleted.

---

## Task 1: `Project.notifyContextId` field (Component 1)

**Files:**

- `src/db/models/Project.ts` (interface at lines 18-44, schema at lines 54-69)
- Test: `tests/db/models/projectFields.test.ts` (new)

- [ ] **Step 1: Write the failing round-trip test**

Create `tests/db/models/projectFields.test.ts` (this mirrors the existing pattern in `tests/db/models/taskFields.test.ts`):

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { startTestDb, stopTestDb, clearDb } from '../../helpers/db.js'
import { Project } from '../../../src/db/models/Project.js'

describe('Project.notifyContextId field', () => {
  beforeAll(async () => {
    await startTestDb()
  })
  afterAll(async () => {
    await stopTestDb()
  })
  afterEach(async () => {
    await clearDb()
  })

  it('round-trips notifyContextId when set', async () => {
    const created = await Project.create({
      contextIds: ['ctx-1'],
      repositories: [{ projectPath: 'group/repo', repoUrl: 'https://forge.example.com/group/repo.git' }],
      notifyContextId: 'ctx-notify',
    })

    const reloaded = await Project.findById(created._id)
    expect(reloaded).not.toBeNull()
    expect(reloaded!.notifyContextId).toBe('ctx-notify')
  })

  it('leaves notifyContextId undefined when omitted', async () => {
    const created = await Project.create({
      contextIds: ['ctx-1'],
      repositories: [{ projectPath: 'group/repo', repoUrl: 'https://forge.example.com/group/repo.git' }],
    })

    const reloaded = await Project.findById(created._id)
    expect(reloaded!.notifyContextId).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/db/models/projectFields.test.ts
```

Expected: FAIL — Mongoose silently strips unknown fields by default, so `reloaded!.notifyContextId` is `undefined` even in the "round-trips" test (first assertion fails: `expected undefined to be 'ctx-notify'`).

- [ ] **Step 3: Add the field to the interface and schema**

In `src/db/models/Project.ts`, add to `IProject` right after `contextIds: string[]`:

```ts
export interface IProject {
  _id: Types.ObjectId
  /** papai context ids this project serves (replaces kiss's Mattermost channel bindings). */
  contextIds: string[]
  /** Single papai scoped context id that receives forge-triggered notifications (set via `/nerv bind`). */
  notifyContextId?: string
  repositories: ProjectRepoConfig[]
  // ...unchanged fields below
```

And add to `projectSchema` right after `contextIds: { type: [String], default: [], index: true },`:

```ts
const projectSchema = new Schema<IProject>({
  contextIds: { type: [String], default: [], index: true },
  notifyContextId: { type: String, default: undefined },
  repositories: { type: [projectRepoConfigSchema], default: [] },
  // ...unchanged fields below
```

- [ ] **Step 4: Run it — see it pass**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/db/models/projectFields.test.ts
```

Expected:

```
 RUN  v2.1.9 /Users/ki/Projects/yourpapai/nerv

 ✓ tests/db/models/projectFields.test.ts (2 tests) 646ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/db/models/Project.ts tests/db/models/projectFields.test.ts
git commit -m "feat(project): add notifyContextId field for forge-triggered notifications"
```

---

## Task 2: `ProjectService` cache fix + `setNotifyContextId` (Component 4/nerv half, prep for Component 3)

**Files:**

- `src/services/ProjectService.ts` (`loadProjects` at lines 20-37, new method after `getAll` at line 67)
- Test: `tests/services/ProjectService.test.ts` (add after the first `it(...)` block, lines 13-55)

This task does two things: (a) fixes the cache-indexing bug identified above so `notifyContextId` resolves through `getByContextId` exactly like any `contextIds[]` entry, and (b) adds the write path `POST /projects/bind` (Task 4) will call.

- [ ] **Step 1: Write the failing test for cache indexing**

Add to `tests/services/ProjectService.test.ts`, right before the existing `'loadProjects refreshes the cache...'` test:

```ts
it('indexes notifyContextId into the contextId cache alongside contextIds', async () => {
  await Project.create({
    contextIds: ['ctx-1'],
    notifyContextId: 'ctx-notify',
    repositories: [{ projectPath: 'group/repo', repoUrl: 'https://forge.example.com/group/repo.git' }],
  })

  const svc = new ProjectService(quietLogger)
  await svc.loadProjects()

  const byNotify = svc.getByContextId('ctx-notify')
  expect(byNotify).toBeDefined()
  expect(byNotify?.repositories[0]?.projectPath).toBe('group/repo')
})

it('setNotifyContextId persists the field and refreshes the cache; returns false for an unknown projectPath', async () => {
  await Project.create({
    contextIds: ['ctx-1'],
    repositories: [{ projectPath: 'group/repo', repoUrl: 'https://forge.example.com/group/repo.git' }],
  })

  const svc = new ProjectService(quietLogger)
  await svc.loadProjects()

  const ok = await svc.setNotifyContextId('group/repo', 'ctx-notify')
  expect(ok).toBe(true)
  expect(svc.getByContextId('ctx-notify')?.repositories[0]?.projectPath).toBe('group/repo')

  const missing = await svc.setNotifyContextId('nope/nope', 'ctx-other')
  expect(missing).toBe(false)
})
```

- [ ] **Step 2: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/services/ProjectService.test.ts
```

Expected: FAIL — `byNotify` is `undefined` (not indexed), and `svc.setNotifyContextId` doesn't exist (`TypeError: svc.setNotifyContextId is not a function`).

- [ ] **Step 3: Fix the cache-indexing loop and add `setNotifyContextId`**

In `src/services/ProjectService.ts`, replace the `for (const p of projects)` loop inside `loadProjects()`:

```ts
for (const p of projects) {
  this.allProjects.set(p._id.toString(), p)
  const contextIds = [...(p.contextIds ?? [])]
  if (p.notifyContextId) contextIds.push(p.notifyContextId)
  for (const contextId of contextIds) {
    if (this.cacheByContextId.has(contextId)) {
      this.log.warn(
        `duplicate contextId "${contextId}" — project ${p._id} overrides ` +
          `${this.cacheByContextId.get(contextId)?._id} in cache`,
      )
    }
    this.cacheByContextId.set(contextId, p)
  }
}
```

Then add a new method right after `getAll()`:

```ts
  /**
   * Sets `notifyContextId` on the project owning `projectPath` (backs the `POST /projects/bind` route).
   * Returns false if no project has a repo at that path.
   */
  async setNotifyContextId(projectPath: string, notifyContextId: string): Promise<boolean> {
    const project = this.getByForgeProject(projectPath)
    if (!project) return false
    await Project.findByIdAndUpdate(project._id, { notifyContextId })
    await this.loadProjects()
    return true
  }
```

- [ ] **Step 4: Run it — see it pass**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/services/ProjectService.test.ts
```

Expected:

```
 RUN  v2.1.9 /Users/ki/Projects/yourpapai/nerv

 ✓ tests/services/ProjectService.test.ts (5 tests) 675ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/services/ProjectService.ts tests/services/ProjectService.test.ts
git commit -m "fix(project-service): index notifyContextId into the context cache; add setNotifyContextId"
```

---

## Task 3: `TaskService.createForgeEvent` (Component 3)

**Files:**

- `src/services/TaskService.ts` (interface/class at lines 5-55)
- Test: `tests/services/TaskService.test.ts` (add before the `'lists only active tasks'` test)

- [ ] **Step 1: Write the failing test**

Add to `tests/services/TaskService.test.ts`:

```ts
it('createForgeEvent seeds a forge-event task with the MR iid/url/branch on its single repo', async () => {
  const t = await svc.createForgeEvent({
    contextId: 'ctx-notify',
    projectPath: 'group/repo',
    mrIid: 42,
    mrUrl: 'https://gitlab.example.com/group/repo/-/merge_requests/42',
    branchName: 'feat/widget',
    prompt: 'adopt this MR',
  })

  expect(t.source).toBe('forge-event')
  expect(t.status).toBe('new')
  expect(t.contextRef.contextId).toBe('ctx-notify')
  expect(t.taskRepositories).toHaveLength(1)
  expect(t.taskRepositories[0].projectPath).toBe('group/repo')
  expect(t.taskRepositories[0].mrIid).toBe(42)
  expect(t.taskRepositories[0].mrUrl).toBe('https://gitlab.example.com/group/repo/-/merge_requests/42')
  expect(t.taskRepositories[0].branchName).toBe('feat/widget')
})
```

- [ ] **Step 2: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/services/TaskService.test.ts
```

Expected: FAIL — `TypeError: svc.createForgeEvent is not a function`.

- [ ] **Step 3: Implement `createForgeEvent`**

In `src/services/TaskService.ts`, add a new exported interface right before `const ACTIVE_STATUSES`:

```ts
export interface CreateForgeEventTaskInput {
  contextId: string
  projectPath: string
  mrIid: number
  mrUrl: string
  branchName: string
  prompt: string
  costBudgetUsd?: number | null
  outputLanguage?: string
}
```

Then add the method to the `TaskService` class, right after `create()`:

```ts
  /**
   * Creates a `source:'forge-event'` task adopting an existing MR — seeds the repo's mrIid/mrUrl/branchName
   * so `SupervisorService.startTask` passes `prNumber` to magi and adopts the MR instead of opening a new
   * one (migration P1 Component 3).
   */
  async createForgeEvent(input: CreateForgeEventTaskInput): Promise<HydratedDocument<ITask>> {
    return Task.create({
      kind: 'gitlab-mr-adoption',
      contextRef: { contextId: input.contextId },
      source: 'forge-event',
      prompt: input.prompt,
      status: 'new',
      costBudgetUsd: input.costBudgetUsd ?? null,
      outputLanguage: input.outputLanguage,
      taskRepositories: [{
        projectPath: input.projectPath,
        mrIid: input.mrIid,
        mrUrl: input.mrUrl,
        branchName: input.branchName,
        pipelineJobTrackList: [],
        processedNoteIds: [],
        processedJobIds: [],
      }],
    })
  }
```

- [ ] **Step 4: Run it — see it pass**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/services/TaskService.test.ts
```

Expected:

```
 RUN  v2.1.9 /Users/ki/Projects/yourpapai/nerv

 ✓ tests/services/TaskService.test.ts (7 tests) 654ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/services/TaskService.ts tests/services/TaskService.test.ts
git commit -m "feat(task-service): add createForgeEvent for MR-adoption tasks"
```

---

## Task 4: `POST /projects/bind` route (Component 4/nerv half)

**Files:**

- Create: `src/http/routes/projects.ts`
- Modify: `src/http/server.ts` (`ServerDeps` at lines 11-17, `buildServer` at lines 19-31)
- Modify: `src/index.ts` (`buildServer(...)` call, line 123)
- Modify: `tests/integration/handlers.test.ts` (its own `buildServer(...)` call, line 264)
- Test: `tests/http/server.test.ts` (`makeApp()` at lines 11-31; add tests before `'cancel event transitions the task to closed and notifies papai'`)

- [ ] **Step 1: Write the failing tests**

In `tests/http/server.test.ts`, add the `Project` model and `ProjectService` imports, thread `projects` through `makeApp`, and add three new tests.

Replace the top of the file (imports + `makeApp`) with:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js'
import { WorkItem } from '../../src/db/models/WorkItem.js'
import { Project } from '../../src/db/models/Project.js'
import { TaskService } from '../../src/services/TaskService.js'
import { WorkQueue } from '../../src/services/WorkQueue.js'
import { SupervisorService } from '../../src/supervisor/SupervisorService.js'
import { ProjectService } from '../../src/services/ProjectService.js'
import { buildServer } from '../../src/http/server.js'

const tasks = new TaskService()

function makeApp(opts: { projects?: ProjectService } = {}) {
  const queue = new WorkQueue({ leaseMs: 1000, maxAttempts: 3 })
  const magi = {
    startSession: vi.fn(async () => ({ id: 'sess-1', status: 'queued' })),
    cancelSession: vi.fn(async () => ({})),
  }
  const notifier = { notifyStatus: vi.fn(async () => {}), notifyReply: vi.fn(async () => {}) }
  const projects = opts.projects ?? new ProjectService()
  const supervisor = new SupervisorService(
    tasks,
    magi as never,
    { magiProjectDefaults: { baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude' } },
    undefined,
    projects,
    notifier as never,
  )
  return {
    app: buildServer({ authToken: 'secret', tasks, queue, supervisor, notifier: notifier as never, projects }),
    notifier,
    magi,
    projects,
  }
}
```

Then add these three tests right before `'cancel event transitions the task to closed and notifies papai'`:

```ts
it('rejects unauthenticated POST /projects/bind', async () => {
  const { app } = makeApp()
  const res = await app.inject({
    method: 'POST',
    url: '/projects/bind',
    payload: { projectPath: 'group/repo', notifyContextId: 'ctx-1' },
  })
  expect(res.statusCode).toBe(401)
})

it('POST /projects/bind sets notifyContextId on the owning project', async () => {
  await Project.create({
    contextIds: ['ctx-chat'],
    repositories: [{ projectPath: 'group/repo', repoUrl: 'https://forge.example.com/group/repo.git' }],
  })
  const projects = new ProjectService()
  await projects.loadProjects()
  const { app } = makeApp({ projects })

  const res = await app.inject({
    method: 'POST',
    url: '/projects/bind',
    headers: auth,
    payload: { projectPath: 'group/repo', notifyContextId: 'ctx-notify' },
  })
  expect(res.statusCode).toBe(200)

  const updated = await Project.findOne({ 'repositories.projectPath': 'group/repo' })
  expect(updated?.notifyContextId).toBe('ctx-notify')
})

it('POST /projects/bind returns 404 for an unknown projectPath', async () => {
  const { app } = makeApp()
  const res = await app.inject({
    method: 'POST',
    url: '/projects/bind',
    headers: auth,
    payload: { projectPath: 'nope/nope', notifyContextId: 'ctx-notify' },
  })
  expect(res.statusCode).toBe(404)
})
```

- [ ] **Step 2: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/http/server.test.ts
```

Expected: FAIL to even compile/run — `buildServer({...})` is missing the required `projects` property (TS error surfaces as a Vitest collection failure), and `/projects/bind` doesn't exist yet (would 404 from Fastify's default not-found handler once the type error is worked around).

- [ ] **Step 3: Create the route file**

Create `src/http/routes/projects.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ServerDeps } from '../server.js'

const bindBody = z.object({
  projectPath: z.string().min(1),
  notifyContextId: z.string().min(1),
})

/**
 * `POST /projects/bind` — papai's `/nerv bind <projectPath>` calls this to register the papai
 * context that should receive forge-triggered notifications for a Project's repos (migration P1
 * Component 4).
 */
export function registerProjectRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.post('/projects/bind', async (req, reply) => {
    const parsed = bindBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })
    const ok = await deps.projects.setNotifyContextId(parsed.data.projectPath, parsed.data.notifyContextId)
    if (!ok) return reply.code(404).send({ error: 'project not found' })
    return reply.code(200).send({ ok: true })
  })
}
```

- [ ] **Step 4: Wire it into `server.ts`**

In `src/http/server.ts`, replace the full contents:

```ts
import Fastify, { type FastifyInstance } from 'fastify'
import { makeBearerAuth } from './auth.js'
import { registerHealthRoute } from './routes/health.js'
import { registerTaskRoutes } from './routes/tasks.js'
import { registerNotifyRoute } from './routes/notify.js'
import { registerProjectRoutes } from './routes/projects.js'
import type { TaskService } from '../services/TaskService.js'
import type { WorkQueue } from '../services/WorkQueue.js'
import type { SupervisorService } from '../supervisor/SupervisorService.js'
import type { PapaiTaskNotifier } from '../services/PapaiTaskNotifier.js'
import type { ProjectService } from '../services/ProjectService.js'

export interface ServerDeps {
  authToken: string
  tasks: TaskService
  queue: WorkQueue
  supervisor: SupervisorService
  notifier: PapaiTaskNotifier
  projects: ProjectService
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false })
  const auth = makeBearerAuth(deps.authToken)

  registerHealthRoute(app)
  app.register(async (scoped) => {
    scoped.addHook('preHandler', auth)
    registerTaskRoutes(scoped, deps)
    registerNotifyRoute(scoped, deps)
    registerProjectRoutes(scoped, deps)
  })

  return app
}
```

- [ ] **Step 5: Fix the two other `buildServer(...)` call sites so the project type-checks**

In `src/index.ts`, change:

```ts
const app = buildServer({ authToken: cfg.authToken, tasks, queue, supervisor, notifier })
```

to:

```ts
const app = buildServer({ authToken: cfg.authToken, tasks, queue, supervisor, notifier, projects })
```

(`projects` is already constructed earlier in `main()` at line 47.)

In `tests/integration/handlers.test.ts`, change:

```ts
const app = buildServer({ authToken: 'secret', tasks, queue, supervisor: {} as never, notifier: notifier as never })
```

to:

```ts
const app = buildServer({
  authToken: 'secret',
  tasks,
  queue,
  supervisor: {} as never,
  notifier: notifier as never,
  projects: {} as never,
})
```

(This test never exercises `/projects/bind`, so a `never`-cast stub matches the existing `supervisor: {} as never` idiom already used on that line.)

- [ ] **Step 6: Run it — see it pass**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/http/server.test.ts
```

Expected:

```
 RUN  v2.1.9 /Users/ki/Projects/yourpapai/nerv

 ✓ tests/http/server.test.ts (16 tests) 1122ms

 Test Files  1 passed (1)
      Tests  16 passed (16)
```

- [ ] **Step 7: Type-check and run the integration suite to confirm the other call site still compiles**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx tsc -p tsconfig.json --noEmit && npx vitest run tests/integration/handlers.test.ts
```

Expected: `tsc` prints nothing (clean); vitest reports all `tests/integration/handlers.test.ts` tests passing.

- [ ] **Step 8: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/http/routes/projects.ts src/http/server.ts src/index.ts tests/http/server.test.ts tests/integration/handlers.test.ts
git commit -m "feat(http): add POST /projects/bind for notifyContextId binding"
```

---

## Task 5: `assigneeWatchSweep` — discovery + adoption (Component 2, part 1)

**Files:**

- `src/periodic/sweeps.ts` (imports at lines 1-11; new code inserted after `pipelineDedupeKey`, before `StaleReviewNotifySweepOpts`)
- Test: `tests/periodic/assigneeWatchSweep.test.ts` (new)

This task adds discovery + idempotent adoption only. Task 6 extends the same function with the unassign→cancel half.

- [ ] **Step 1: Write the failing tests**

Create `tests/periodic/assigneeWatchSweep.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js'
import { WorkItem } from '../../src/db/models/WorkItem.js'
import { Project } from '../../src/db/models/Project.js'
import { TaskService } from '../../src/services/TaskService.js'
import { ProjectService } from '../../src/services/ProjectService.js'
import { PapaiNotifier } from '../../src/services/PapaiNotifier.js'
import { PapaiTaskNotifier } from '../../src/services/PapaiTaskNotifier.js'
import { SupervisorService } from '../../src/supervisor/SupervisorService.js'
import { assigneeWatchSweep } from '../../src/periodic/sweeps.js'
import type { ForgeClient } from '../../src/services/ForgeClient.js'
import type { MergeRequestInfo, MRViewContext } from '../../src/domain/forge.js'
import type { MagiClient } from '../../src/services/MagiClient.js'

const BOT = 'nerv-agent'

function makePapaiNotifier(): { papai: PapaiNotifier; notify: ReturnType<typeof vi.fn> } {
  const notify = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch
  const papai = new PapaiNotifier({ url: 'http://papai/api/notify', token: 't' }, notify)
  return { papai, notify: notify as unknown as ReturnType<typeof vi.fn> }
}

function fakeMagi(overrides: Partial<MagiClient> = {}): MagiClient {
  return {
    startSession: vi.fn(async () => ({ id: 'sess-1', status: 'queued' })),
    followUp: vi.fn(async () => ({})),
    getSession: vi.fn(async () => ({ id: 'sess-1', status: 'running' })),
    cancelSession: vi.fn(async () => ({})),
    ...overrides,
  } as unknown as MagiClient
}

function fakeMr(overrides: Partial<MergeRequestInfo> = {}): MergeRequestInfo {
  return {
    projectPath: 'group/repo',
    iid: 42,
    webUrl: 'https://gitlab.example.com/group/repo/-/merge_requests/42',
    title: 'Fix the widget',
    description: 'Widget was broken',
    state: 'opened',
    sourceBranch: 'feat/widget',
    targetBranch: 'main',
    ...overrides,
  }
}

function emptyMrView(overrides: Partial<MRViewContext> = {}): MRViewContext {
  return {
    mergeRequest: fakeMr(),
    discussions: [],
    notes: [],
    pipelines: [],
    commits: [],
    ...overrides,
  }
}

/** Minimal fake ForgeClient — only the methods assigneeWatchSweep uses are stubbed with behavior. */
function fakeForge(overrides: Partial<ForgeClient> = {}): ForgeClient {
  return {
    getMRSyncSnapshot: vi.fn(async () => {
      throw new Error('not used by assigneeWatchSweep')
    }),
    getMRView: vi.fn(async () => emptyMrView()),
    getFailedPipelineJobLogs: vi.fn(async () => null),
    getFileContent: vi.fn(async () => ''),
    getDefaultBranch: vi.fn(async () => 'main'),
    getMRsByAssignee: vi.fn(async () => []),
    getAllMRsByAssignee: vi.fn(async () => []),
    ...overrides,
  }
}

async function seedProject(opts: { notifyContextId?: string } = {}): Promise<ProjectService> {
  await Project.create({
    contextIds: ['ctx-chat'],
    notifyContextId: opts.notifyContextId,
    repositories: [{ projectPath: 'group/repo', repoUrl: 'https://gitlab.example.com/group/repo.git' }],
  })
  const projects = new ProjectService()
  await projects.loadProjects()
  return projects
}

describe('assigneeWatchSweep', () => {
  beforeAll(async () => {
    await startTestDb()
    await WorkItem.syncIndexes()
  })
  afterAll(async () => {
    await stopTestDb()
  })
  afterEach(async () => {
    await clearDb()
  })

  it('discovers a newly-assigned MR and adopts it, passing the MR iid as prNumber to startSession', async () => {
    const tasks = new TaskService()
    const projects = await seedProject({ notifyContextId: 'ctx-notify' })
    const magi = fakeMagi()
    const { papai } = makePapaiNotifier()
    const notifier = new PapaiTaskNotifier(papai)
    const supervisor = new SupervisorService(
      tasks,
      magi,
      { magiProjectDefaults: { baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude' } },
      undefined,
      projects,
      notifier,
    )
    const forge = fakeForge({ getAllMRsByAssignee: vi.fn(async () => [fakeMr()]) })

    await assigneeWatchSweep(tasks, supervisor, forge, projects, { botUsername: BOT })

    const active = await tasks.getActive()
    expect(active).toHaveLength(1)
    expect(active[0].source).toBe('forge-event')
    expect(active[0].contextRef.contextId).toBe('ctx-notify')
    expect(active[0].taskRepositories[0].mrIid).toBe(42)
    expect(active[0].status).toBe('coding')

    expect(magi.startSession).toHaveBeenCalledWith(expect.objectContaining({ prNumber: 42 }))
  })

  it('a second tick does not duplicate the task for the same MR', async () => {
    const tasks = new TaskService()
    const projects = await seedProject({ notifyContextId: 'ctx-notify' })
    const magi = fakeMagi()
    const { papai } = makePapaiNotifier()
    const notifier = new PapaiTaskNotifier(papai)
    const supervisor = new SupervisorService(
      tasks,
      magi,
      { magiProjectDefaults: { baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude' } },
      undefined,
      projects,
      notifier,
    )
    const forge = fakeForge({ getAllMRsByAssignee: vi.fn(async () => [fakeMr()]) })

    await assigneeWatchSweep(tasks, supervisor, forge, projects, { botUsername: BOT })
    await assigneeWatchSweep(tasks, supervisor, forge, projects, { botUsername: BOT })

    const active = await tasks.getActive()
    expect(active).toHaveLength(1)
    expect(magi.startSession).toHaveBeenCalledTimes(1)
  })

  it('ignores an MR in a repo with no configured Project', async () => {
    const tasks = new TaskService()
    const projects = new ProjectService()
    await projects.loadProjects()
    const magi = fakeMagi()
    const { papai } = makePapaiNotifier()
    const notifier = new PapaiTaskNotifier(papai)
    const supervisor = new SupervisorService(
      tasks,
      magi,
      { magiProjectDefaults: { baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude' } },
      undefined,
      projects,
      notifier,
    )
    const forge = fakeForge({ getAllMRsByAssignee: vi.fn(async () => [fakeMr({ projectPath: 'unknown/repo' })]) })

    await assigneeWatchSweep(tasks, supervisor, forge, projects, { botUsername: BOT })

    expect(await tasks.getActive()).toHaveLength(0)
    expect(magi.startSession).not.toHaveBeenCalled()
  })

  it('skips a Project with no notifyContextId', async () => {
    const tasks = new TaskService()
    const projects = await seedProject()
    const magi = fakeMagi()
    const { papai } = makePapaiNotifier()
    const notifier = new PapaiTaskNotifier(papai)
    const supervisor = new SupervisorService(
      tasks,
      magi,
      { magiProjectDefaults: { baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude' } },
      undefined,
      projects,
      notifier,
    )
    const forge = fakeForge({ getAllMRsByAssignee: vi.fn(async () => [fakeMr()]) })

    await assigneeWatchSweep(tasks, supervisor, forge, projects, { botUsername: BOT })

    expect(await tasks.getActive()).toHaveLength(0)
    expect(magi.startSession).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/periodic/assigneeWatchSweep.test.ts
```

Expected: FAIL to even compile — `assigneeWatchSweep` doesn't exist in `src/periodic/sweeps.ts` yet (`SyntaxError`/TS import error surfaced by Vitest as a failed test file).

- [ ] **Step 3: Add imports and the discovery half of `assigneeWatchSweep`**

In `src/periodic/sweeps.ts`, replace the import block at the top:

```ts
import type { HydratedDocument } from 'mongoose'
import type { ITask, TaskRepo } from '../db/models/Task.js'
import type { TaskService } from '../services/TaskService.js'
import type { WorkQueue } from '../services/WorkQueue.js'
import type { ForgeClient } from '../services/ForgeClient.js'
import type { PapaiTaskNotifier } from '../services/PapaiTaskNotifier.js'
import type { SupervisorService } from '../supervisor/SupervisorService.js'
import type { ProjectService } from '../services/ProjectService.js'
import { generateMRAdoptionPrompt } from '../services/prompts.js'
import { isSameMRSyncSnapshot } from '../domain/mrSync.js'
import { buildActionableNoteGroups } from '../domain/reviewNotes.js'
import type { ReviewCommentPayload, PipelineFailurePayload } from '../domain/workPayloads.js'
import type { MergeRequestInfo } from '../domain/forge.js'
import { canTransition } from '../domain/stateMachine.js'
import { createLogger } from '../logger.js'
```

Then insert this new code between `pipelineDedupeKey` and `export interface StaleReviewNotifySweepOpts`:

```ts
export interface AssigneeWatchSweepOpts {
  /** Bot's forge username — the sweep polls MRs assigned to it (same identity used by forge-poll/review handlers). */
  botUsername: string
}

/**
 * Assign-the-bot trigger (migration P1 Component 2): discovers MRs newly assigned to the bot and
 * adopts them as `source:'forge-event'` tasks. Discovery is idempotent by `(projectPath, mrIid)` —
 * a repeated tick never creates a duplicate task for the same MR.
 *
 * Resilient by design: a single MR failing to adopt is logged and does not abort the rest of the sweep.
 */
export async function assigneeWatchSweep(
  tasks: TaskService,
  supervisor: SupervisorService,
  forge: ForgeClient,
  projects: ProjectService,
  opts: AssigneeWatchSweepOpts,
): Promise<void> {
  let assignedMRs: MergeRequestInfo[]
  try {
    assignedMRs = await forge.getAllMRsByAssignee(opts.botUsername, 'opened')
  } catch (error) {
    log.warn(`assigneeWatchSweep: failed to fetch assigned MRs, retrying next tick: ${error}`)
    return
  }

  const active = await tasks.getActive()
  const existingKeys = new Set(
    active
      .filter((t) => t.source === 'forge-event')
      .flatMap((t) =>
        t.taskRepositories.filter((r) => r.mrIid !== undefined).map((r) => mrKey(r.projectPath, r.mrIid as number)),
      ),
  )

  for (const mr of assignedMRs) {
    if (!mr.projectPath) {
      log.debug(`assigneeWatchSweep: MR !${mr.iid} has no resolved projectPath, skipping`)
      continue
    }
    const key = mrKey(mr.projectPath, mr.iid)
    if (existingKeys.has(key)) continue

    const project = projects.getByForgeProject(mr.projectPath)
    if (!project) {
      log.debug(`assigneeWatchSweep: no Project configured for ${mr.projectPath}, skipping MR !${mr.iid}`)
      continue
    }
    if (!project.notifyContextId) {
      log.debug(`assigneeWatchSweep: Project for ${mr.projectPath} has no notifyContextId, skipping MR !${mr.iid}`)
      continue
    }

    try {
      const prompt = generateMRAdoptionPrompt(mr.title, mr.description, opts.botUsername)
      const task = await tasks.createForgeEvent({
        contextId: project.notifyContextId,
        projectPath: mr.projectPath,
        mrIid: mr.iid,
        mrUrl: mr.webUrl,
        branchName: mr.sourceBranch,
        prompt,
      })
      await supervisor.startTask(task._id.toString())
    } catch (error) {
      log.warn(`assigneeWatchSweep: failed to adopt MR ${key}: ${error}`)
    }
  }
}

function mrKey(projectPath: string, mrIid: number): string {
  return `${projectPath}!${mrIid}`
}
```

- [ ] **Step 4: Run it — see it pass**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/periodic/assigneeWatchSweep.test.ts
```

Expected (the 2 unassign-related tests from Step 1's file don't exist yet — only these 4 discovery tests run in this task):

```
 RUN  v2.1.9 /Users/ki/Projects/yourpapai/nerv

 ✓ tests/periodic/assigneeWatchSweep.test.ts (4 tests) 620ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/periodic/sweeps.ts tests/periodic/assigneeWatchSweep.test.ts
git commit -m "feat(sweeps): add assigneeWatchSweep discovery — adopt newly-assigned MRs"
```

---

## Task 6: `assigneeWatchSweep` — unassign → cancel (Component 2, part 2)

**Files:**

- `src/periodic/sweeps.ts` (extends `assigneeWatchSweep`, added in Task 5)
- Test: `tests/periodic/assigneeWatchSweep.test.ts` (add two tests)

- [ ] **Step 1: Write the failing tests**

Add to `tests/periodic/assigneeWatchSweep.test.ts`, after the `'a second tick does not duplicate...'` test:

```ts
it('cancels the task when the bot is un-assigned from a still-open MR', async () => {
  const tasks = new TaskService()
  const projects = await seedProject({ notifyContextId: 'ctx-notify' })
  const magi = fakeMagi()
  const { papai, notify } = makePapaiNotifier()
  const notifier = new PapaiTaskNotifier(papai)
  const supervisor = new SupervisorService(
    tasks,
    magi,
    { magiProjectDefaults: { baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude' } },
    undefined,
    projects,
    notifier,
  )
  const forge = fakeForge({ getAllMRsByAssignee: vi.fn(async () => [fakeMr()]) })

  // First tick adopts the MR.
  await assigneeWatchSweep(tasks, supervisor, forge, projects, { botUsername: BOT })

  // Second tick: bot no longer assigned, MR still open.
  const forgeAfterUnassign = fakeForge({
    getAllMRsByAssignee: vi.fn(async () => []),
    getMRView: vi.fn(async () => emptyMrView({ mergeRequest: fakeMr({ state: 'opened' }) })),
  })
  await assigneeWatchSweep(tasks, supervisor, forgeAfterUnassign, projects, { botUsername: BOT })

  const active = await tasks.getActive()
  expect(active).toHaveLength(0)
  expect(magi.cancelSession).toHaveBeenCalledWith('sess-1')
  expect(notify).toHaveBeenCalled()
})

it('does not cancel a task whose MR has been merged (left to forge-poll)', async () => {
  const tasks = new TaskService()
  const projects = await seedProject({ notifyContextId: 'ctx-notify' })
  const magi = fakeMagi()
  const { papai } = makePapaiNotifier()
  const notifier = new PapaiTaskNotifier(papai)
  const supervisor = new SupervisorService(
    tasks,
    magi,
    { magiProjectDefaults: { baseBranch: 'main', permissionPreset: 'cautious', agent: 'claude' } },
    undefined,
    projects,
    notifier,
  )
  const forge = fakeForge({ getAllMRsByAssignee: vi.fn(async () => [fakeMr()]) })
  await assigneeWatchSweep(tasks, supervisor, forge, projects, { botUsername: BOT })

  const forgeAfterMerge = fakeForge({
    getAllMRsByAssignee: vi.fn(async () => []),
    getMRView: vi.fn(async () => emptyMrView({ mergeRequest: fakeMr({ state: 'merged' }) })),
  })
  await assigneeWatchSweep(tasks, supervisor, forgeAfterMerge, projects, { botUsername: BOT })

  const active = await tasks.getActive()
  expect(active).toHaveLength(1)
  expect(magi.cancelSession).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/periodic/assigneeWatchSweep.test.ts
```

Expected: FAIL — the 2 new tests fail (`expected 1 to be 0`, and `expected "spy" to be called with... 0 times` for `cancelSession` never firing), since `assigneeWatchSweep` doesn't yet check for unassigned MRs.

- [ ] **Step 3: Extend `assigneeWatchSweep` with the unassign→cancel check**

In `src/periodic/sweeps.ts`, inside `assigneeWatchSweep`, add this block right before the function's closing `}` (after the discovery `for (const mr of assignedMRs)` loop from Task 5):

```ts
const assignedKeys = new Set(
  assignedMRs.filter((mr) => mr.projectPath).map((mr) => mrKey(mr.projectPath as string, mr.iid)),
)

for (const task of active) {
  if (task.source !== 'forge-event') continue
  for (const repo of task.taskRepositories) {
    if (repo.mrIid === undefined) continue
    const key = mrKey(repo.projectPath, repo.mrIid)
    if (assignedKeys.has(key)) continue
    try {
      const mrView = await forge.getMRView(repo.projectPath, String(repo.mrIid))
      if (mrView.mergeRequest.state === 'opened') {
        await supervisor.cancelTask(task._id.toString())
      }
    } catch (error) {
      log.warn(`assigneeWatchSweep: failed to check unassigned MR ${key}: ${error}`)
    }
  }
}
```

(`active` and `assignedMRs` are already in scope from the top of the function — no new parameters needed.)

- [ ] **Step 4: Run it — see it pass**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/periodic/assigneeWatchSweep.test.ts
```

Expected:

```
 RUN  v2.1.9 /Users/ki/Projects/yourpapai/nerv

 ✓ tests/periodic/assigneeWatchSweep.test.ts (6 tests) 881ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/periodic/sweeps.ts tests/periodic/assigneeWatchSweep.test.ts
git commit -m "feat(sweeps): assigneeWatchSweep cancels tasks un-assigned from a still-open MR"
```

---

## Task 7: `assigneeWatchMs` config + `index.ts` wiring (Component 2, registration)

**Files:**

- `src/config.ts` (`NervConfig` interface at lines 38-64, `loadConfig` return object at lines 145-186)
- `src/index.ts` (imports at lines 22-29, `forgeRead` block at lines 88-106)
- Test: `tests/config.test.ts` (add after the `'coerces numeric env vars'` test)

- [ ] **Step 1: Write the failing config test**

Add to `tests/config.test.ts`:

```ts
it('applies the assigneeWatchMs default and allows override via ASSIGNEE_WATCH_MS', () => {
  expect(loadConfig(base).assigneeWatchMs).toBe(60000)
  expect(loadConfig({ ...base, ASSIGNEE_WATCH_MS: '15000' }).assigneeWatchMs).toBe(15000)
})
```

- [ ] **Step 2: Run it — see it fail**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/config.test.ts
```

Expected: FAIL — `loadConfig(base).assigneeWatchMs` is `undefined`, `expected undefined to be 60000`.

- [ ] **Step 3: Add `assigneeWatchMs` to `NervConfig` and `loadConfig`**

In `src/config.ts`, add to the `NervConfig` interface right after `statusSyncMs: number`:

```ts
/** Status-sync sweep interval (ms). */
statusSyncMs: number
/** Assignee-watch sweep interval (ms); only used when `forgeRead` is configured. */
assigneeWatchMs: number
```

And add to the `loadConfig` return object right after `statusSyncMs: num('STATUS_SYNC_MS', 30000),`:

```ts
    statusSyncMs: num('STATUS_SYNC_MS', 30000),
    assigneeWatchMs: num('ASSIGNEE_WATCH_MS', 60000),
```

- [ ] **Step 4: Run it — see it pass**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx vitest run tests/config.test.ts
```

Expected:

```
 RUN  v2.1.9 /Users/ki/Projects/yourpapai/nerv

 ✓ tests/config.test.ts (17 tests) 4ms

 Test Files  1 passed (1)
      Tests  17 passed (17)
```

- [ ] **Step 5: Wire `assigneeWatchSweep` into `index.ts`**

In `src/index.ts`, add `assigneeWatchSweep` to the sweeps import:

```ts
import {
  reconcileSweep,
  fleetHealthSweep,
  forgePollSweep,
  staleTaskSweep,
  staleReviewNotifySweep,
  statusSyncSweep,
  assigneeWatchSweep,
} from './periodic/sweeps.js'
```

Then, inside the `if (cfg.forgeRead) { ... }` block, right after the existing `forge-poll` `scheduler.register(...)` call, add:

```ts
// `{ immediate: true }` for the same run-at-boot reason as forge-poll: pick up any MR
// (re)assignment that happened while nerv was down (migration P1 Component 2).
scheduler.register(
  'assignee-watch',
  cfg.assigneeWatchMs,
  () => assigneeWatchSweep(tasks, supervisor, forgeClient, projects, { botUsername: cfg.botUsername }),
  { immediate: true },
)
```

(`forgeClient`, `supervisor`, and `projects` are already in scope at this point in `main()` — `forgeClient` is the `const forgeClient = forge` alias defined immediately above the existing `forge-poll` registration; `supervisor` and `projects` are constructed earlier in `main()`.)

- [ ] **Step 6: Type-check and run the full nerv suite**

```bash
cd /Users/ki/Projects/yourpapai/nerv && npx tsc -p tsconfig.json --noEmit && npx vitest run
```

Expected: `tsc` prints nothing (clean). Vitest reports all test files passing, e.g.:

```
 Test Files  37 passed (37)
      Tests  319 passed (319)
```

(If a single run reports a `mongodb-memory-server` `Port "..." already in use` failure in an unrelated suite, that's a known local port-collision flake — rerun `npx vitest run` once; it is not caused by this task's changes.)

- [ ] **Step 7: Commit**

```bash
cd /Users/ki/Projects/yourpapai/nerv
git add src/config.ts src/index.ts tests/config.test.ts
git commit -m "feat(index): register assigneeWatchSweep on the forge-gated scheduler"
```

---

## Verification checklist (run after all 7 tasks)

```bash
cd /Users/ki/Projects/yourpapai/nerv
npx tsc -p tsconfig.json --noEmit
npx vitest run
```

Expected: type-check clean, full suite green (37 test files / 319+ tests, modulo the `mongodb-memory-server` port-collision flake noted in Task 7).

At this point:

- A Project can be bound to a papai context via `POST /projects/bind` (nerv side of Component 4 — papai's `/nerv bind` plugin command, built in the separate papai-side plan, is the only remaining piece needed to drive this from chat).
- `assigneeWatchSweep`, once registered, will adopt any MR assigned to `cfg.botUsername` in a bound Project's repo, and will reap tasks the bot is un-assigned from while the MR is still open.
- No operator-facing behavior changes yet without a bound Project — every code path added here degrades to a no-op (debug-logged skip) until `POST /projects/bind` has been called at least once for a given repo.
