<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# FU2 · pipelineJobTrackList Parity — nerv Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore nerv's dead CI-fix loop by (A) letting operators configure a per-repo CI job whitelist and actually seeding it onto tasks instead of the current hardcoded `[]`, (B) enriching the failed-job data nerv already reads from GitLab with stage/status/URL metadata and threading it into the fix prompt, and (C) posting a best-effort chat notification when a CI failure is detected, so the loop is no longer fully silent.

**Architecture:** Three independent, stacked slices, all inside `nerv` (repo: `/Users/ki/Projects/yourpapai/nerv`, branch `main`). Component A (config → seeding) is the load-bearing fix: `ProjectRepoConfig` gains an optional `pipelineJobTrackList`, and `TaskService` gains an optional `ProjectService` dependency it uses to resolve that list at task-creation time — threaded via constructor injection so the ~18 existing `new TaskService()` call sites keep compiling untouched. Component B widens the `FailedPipelineJob` domain type to carry the metadata GitLab's `JobSchema` already exposes, maps it in `GitlabForgeClient`, and threads it into `generatePipelineFixPrompt`. Component C wires the already-existing `PapaiTaskNotifier.notifyReply` into `makePipelineFailureHandler` behind a try/catch so a notify failure never blocks the magi dispatch. Component D (the papai importer un-drop) is **out of scope** for this plan — it is a separate papai-side plan.

**Tech Stack:** TypeScript (strict), Bun-free — nerv runs on plain Node/tsx; Mongoose (MongoDB models); vitest + `mongodb-memory-server` (`startTestDb`/`stopTestDb`/`clearDb` helpers); `@gitbeaker/core`/`@gitbeaker/rest` (GitLab API types/client). Type-check: `npm run type-check`. Test: `npx vitest run <path>`.

---

## Resolved open assumptions (read before starting)

The spec (`docs/superpowers/specs/2026-07-13-followups-fu2-pipeline-job-tracklist-parity-design.md`) flagged four open assumptions "to resolve during planning." All four were resolved by reading the real nerv code (2026-07-13), not guessed:

1. **How `TaskService` obtains Project config.** `TaskService` currently has **no constructor at all** and no dependency on `ProjectService` (`nerv/src/services/TaskService.ts`, original). `ProjectService.getByForgeProject(projectPath)` already exists (`nerv/src/services/ProjectService.ts:58-64`) — a reverse lookup over the in-memory project cache, exactly what's needed to go `projectPath → Project → matching repo entry`. Decision: thread the **minimal** dependency as an **optional** constructor param, `constructor(private readonly projects?: ProjectService) {}`. Optional (not required) specifically so none of the ~18 existing `new TaskService()` call sites across the codebase (production `src/index.ts` plus every test file) need to change. Verified: after wiring, `npm run type-check` and the full `npx vitest run` suite (39 files / 359 tests) pass with zero required edits to unrelated call sites.

2. **`PapaiTaskNotifier` method surface.** The spec's Component C text claims _"the existing notifier renders only generic `TaskStatus` lines, which cannot carry job detail"_ and implies a new dedicated method is needed. **This is factually stale against the real code.** `PapaiTaskNotifier.notifyReply(task, markdown)` already exists (`nerv/src/services/PapaiTaskNotifier.ts:96-103`) — a plain-markdown post with no status dedupe, which is precisely the non-status-line message Component C needs. `makeReconcileHandler` (`nerv/src/supervisor/foundationHandlers.ts:53-55`) already shows the established call pattern: construct `new PapaiTaskNotifier(papai)` locally inside a handler from the `papai: PapaiNotifier` already present on `HandlerCtx` (`nerv/src/supervisor/handlers.ts:12-23`), rather than adding a new field to `HandlerCtx`. Decision: **reuse `notifyReply`** — no new `PapaiTaskNotifier` method. Only a new pure formatter, `formatCiFailureMarkdown(job)`, is added to `ciHandlers.ts` to build the markdown string. **Spec inaccuracy flagged**: Component C's stated premise ("existing notifier renders only generic TaskStatus lines") does not match `PapaiTaskNotifier.ts`'s real shape as of 2026-07-13.

3. **GitLab `JobSchema` nullability.** Read directly from `@gitbeaker/core`'s shipped type declarations (`nerv/node_modules/@gitbeaker/core/dist/index.d.ts:5052-5083`):

   ```ts
   interface JobSchema extends Record<string, unknown> {
     id: number
     name: string
     stage: string // required, never null
     status: string // required, never null
     // ...
     failure_reason?: string // optional, never null
     duration?: number // optional, never null
     web_url: string // required, never null
   }
   ```

   `stage`, `status`, `web_url` are **required** (`string`, no `?`). `duration` and `failure_reason` are **optional** (`?:`) but the type never reports `null` — only present-or-absent. Decision: the widened `FailedPipelineJob` types `stage`/`status`/`webUrl` as required `string`, and `duration`/`failureReason` as optional (`?:` — not nullable `| null`), matching GitLab's actual shape exactly. See Task 4 below.

4. **Where the failed job matching `payload.jobId` is available.** `makePipelineFailureHandler` (`nerv/src/supervisor/ciHandlers.ts:23-67`, original) already re-fetches `forge.getFailedPipelineJobLogs(...)` and does `const job = failedJobs?.jobs.find((j) => j.id === payload.jobId)` (original line 45) — `job` (typed `FailedPipelineJob`) is in scope from that point through the end of the handler, i.e. exactly where both the prompt is built (`generatePipelineFixPrompt(job.name, ...)`, original line 53) and where the new notification call needs to sit (right after the prompt is built, before the `magi.followUp` dispatch — the fix dispatch must not depend on the notify outcome).

---

## Task 1: Config surface — `ProjectRepoConfig.pipelineJobTrackList`

**Files:**

- Modify: `nerv/src/db/models/Project.ts:10-16` (interface), `:46-52` (schema)
- Test: `nerv/tests/db/models/projectFields.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block to `nerv/tests/db/models/projectFields.test.ts` (after the existing `Project.notifyContextId field` block):

```ts
describe('ProjectRepoConfig.pipelineJobTrackList field', () => {
  beforeAll(async () => {
    await startTestDb()
  })
  afterAll(async () => {
    await stopTestDb()
  })
  afterEach(async () => {
    await clearDb()
  })

  it('round-trips pipelineJobTrackList when set on a repo entry', async () => {
    const created = await Project.create({
      contextIds: ['ctx-1'],
      repositories: [
        {
          projectPath: 'group/repo',
          repoUrl: 'https://forge.example.com/group/repo.git',
          pipelineJobTrackList: ['test_unit', 'lint'],
        },
      ],
    })

    const reloaded = await Project.findById(created._id)
    expect(reloaded!.repositories[0].pipelineJobTrackList).toEqual(['test_unit', 'lint'])
  })

  it('leaves pipelineJobTrackList undefined when omitted (dormant, kiss-parity opt-in)', async () => {
    const created = await Project.create({
      contextIds: ['ctx-1'],
      repositories: [{ projectPath: 'group/repo', repoUrl: 'https://forge.example.com/group/repo.git' }],
    })

    const reloaded = await Project.findById(created._id)
    expect(reloaded!.repositories[0].pipelineJobTrackList).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db/models/projectFields.test.ts` (from `/Users/ki/Projects/yourpapai/nerv`)
Expected: FAIL on the first new test — `pipelineJobTrackList` is not in the Mongoose schema, so Mongoose silently drops the field on save; `reloaded!.repositories[0].pipelineJobTrackList` is `undefined`, not `['test_unit', 'lint']`.

- [ ] **Step 3: Add the field to the interface and schema**

In `nerv/src/db/models/Project.ts`, extend `ProjectRepoConfig`:

```ts
export interface ProjectRepoConfig {
  projectPath: string
  repoUrl: string
  baseBranch?: string
  worktreeSubdir?: string
  description?: string
  /**
   * CI job names to watch for failures on this repo. Opt-in (kiss parity): empty/absent means
   * the CI-fix loop stays dormant for this repo — no global default whitelist.
   */
  pipelineJobTrackList?: string[]
}
```

And the Mongoose schema:

```ts
const projectRepoConfigSchema = new Schema<ProjectRepoConfig>(
  {
    projectPath: { type: String, required: true },
    repoUrl: { type: String, required: true },
    baseBranch: String,
    worktreeSubdir: String,
    description: String,
    pipelineJobTrackList: { type: [String], default: undefined },
  },
  { _id: false },
)
```

(`default: undefined`, not `default: []`, matching the existing `notifyContextId`/`mcpServers` convention in this file — absence stays absence, not an empty array, so "opt-in dormant" is distinguishable from "explicitly configured empty".)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/db/models/projectFields.test.ts`
Expected: PASS (4 tests: 2 existing `notifyContextId` + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/db/models/Project.ts tests/db/models/projectFields.test.ts
git commit -m "feat(project): add pipelineJobTrackList to ProjectRepoConfig (FU2 Component A config surface)"
```

---

## Task 2: Task seeding — `TaskService.create`/`.createForgeEvent`

**Files:**

- Modify: `nerv/src/services/TaskService.ts:1,28-71` (add DI + seeding), `nerv/src/index.ts:42-50` (production wiring)
- Test: `nerv/tests/services/TaskService.test.ts`

- [ ] **Step 1: Write the failing tests**

Rewrite the top of `nerv/tests/services/TaskService.test.ts` to construct `TaskService` with a `ProjectService`, and add 4 new tests:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { startTestDb, stopTestDb, clearDb } from '../helpers/db.js'
import { TaskService } from '../../src/services/TaskService.js'
import { ProjectService } from '../../src/services/ProjectService.js'
import { Project } from '../../src/db/models/Project.js'

const projects = new ProjectService()
const svc = new TaskService(projects)

const sampleInput = {
  kind: 'gitlab-mr-supervision',
  contextRef: { contextId: 'chan-1' },
  source: 'chat' as const,
  prompt: 'do the thing',
  repos: [{ projectPath: 'group/repo' }],
}

describe('TaskService', () => {
  beforeAll(async () => {
    await startTestDb()
  })
  afterAll(async () => {
    await stopTestDb()
  })
  afterEach(async () => {
    await clearDb()
    await projects.loadProjects()
  })

  // ... existing 7 tests unchanged (creates/gets/transitions/lists) ...

  it('create() seeds pipelineJobTrackList from the matching Project repo config', async () => {
    await Project.create({
      contextIds: ['ctx-1'],
      repositories: [
        {
          projectPath: 'group/repo',
          repoUrl: 'https://forge.example.com/group/repo.git',
          pipelineJobTrackList: ['test_unit', 'lint'],
        },
      ],
    })
    await projects.loadProjects()

    const t = await svc.create(sampleInput)
    expect(t.taskRepositories[0].pipelineJobTrackList).toEqual(['test_unit', 'lint'])
  })

  it('create() seeds [] (dormant) when no Project has a matching repo entry', async () => {
    const t = await svc.create(sampleInput)
    expect(t.taskRepositories[0].pipelineJobTrackList).toEqual([])
  })

  it('create() seeds [] (dormant) when the matching Project repo entry has no list configured', async () => {
    await Project.create({
      contextIds: ['ctx-1'],
      repositories: [{ projectPath: 'group/repo', repoUrl: 'https://forge.example.com/group/repo.git' }],
    })
    await projects.loadProjects()

    const t = await svc.create(sampleInput)
    expect(t.taskRepositories[0].pipelineJobTrackList).toEqual([])
  })

  it('createForgeEvent() seeds pipelineJobTrackList from the matching Project repo config', async () => {
    await Project.create({
      contextIds: ['ctx-1'],
      repositories: [
        {
          projectPath: 'group/repo',
          repoUrl: 'https://forge.example.com/group/repo.git',
          pipelineJobTrackList: ['build'],
        },
      ],
    })
    await projects.loadProjects()

    const t = await svc.createForgeEvent({
      contextId: 'ctx-notify',
      projectPath: 'group/repo',
      mrIid: 42,
      mrUrl: 'https://gitlab.example.com/group/repo/-/merge_requests/42',
      branchName: 'feat/widget',
      prompt: 'adopt this MR',
    })

    expect(t.taskRepositories[0].pipelineJobTrackList).toEqual(['build'])
  })
})
```

(The `afterEach`'s added `await projects.loadProjects()` resets the in-memory `ProjectService` cache to empty after `clearDb()`, so tests that don't create a `Project` — e.g. the "no matching repo entry" case, and all 7 pre-existing tests — aren't polluted by a stale cache from an earlier test.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/services/TaskService.test.ts`
Expected: FAIL to even compile/run — `new TaskService(projects)` errors with "Expected 0 arguments, but got 1" (`TaskService` has no constructor yet).

- [ ] **Step 3: Add the optional `ProjectService` dependency and seed from it**

In `nerv/src/services/TaskService.ts`:

```ts
import { Task, type ITask, type TaskStatus, type ContextRef } from '../db/models/Task.js'
import { canTransition } from '../domain/stateMachine.js'
import type { HydratedDocument } from 'mongoose'
import type { ProjectService } from './ProjectService.js'

export interface CreateTaskInput {
  kind: string
  contextRef: ContextRef
  source: 'chat' | 'forge-event'
  prompt: string
  repos: { projectPath: string }[]
  costBudgetUsd?: number | null
  outputLanguage?: string
}

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

const ACTIVE_STATUSES: TaskStatus[] = ['new', 'coding', 'review', 'ci_wait']

export class TaskService {
  constructor(private readonly projects?: ProjectService) {}

  /**
   * Resolves the CI job whitelist for a repo from its Project config (via the reverse
   * `getByForgeProject` lookup). No matching Project, no matching repo entry, or no list
   * configured all fall back to `[]` — the opt-in "dormant" behavior (FU2 Component A).
   */
  private resolvePipelineJobTrackList(projectPath: string): string[] {
    const project = this.projects?.getByForgeProject(projectPath)
    const repoConfig = project?.repositories.find((r) => r.projectPath === projectPath)
    return repoConfig?.pipelineJobTrackList ?? []
  }

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
        pipelineJobTrackList: this.resolvePipelineJobTrackList(r.projectPath),
        processedNoteIds: [],
        processedJobIds: [],
      })),
    })
  }

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
      taskRepositories: [
        {
          projectPath: input.projectPath,
          mrIid: input.mrIid,
          mrUrl: input.mrUrl,
          branchName: input.branchName,
          pipelineJobTrackList: this.resolvePipelineJobTrackList(input.projectPath),
          processedNoteIds: [],
          processedJobIds: [],
        },
      ],
    })
  }

  async get(id: string): Promise<HydratedDocument<ITask> | null> {
    return Task.findById(id)
  }

  async transition(id: string, to: TaskStatus): Promise<HydratedDocument<ITask>> {
    const task = await Task.findById(id)
    if (!task) throw new Error(`task not found: ${id}`)
    if (!canTransition(task.status, to)) {
      throw new Error(`illegal transition ${task.status} -> ${to}`)
    }
    task.status = to
    task.lastActivity = new Date()
    await task.save()
    return task
  }

  async getActive(): Promise<HydratedDocument<ITask>[]> {
    return Task.find({ status: { $in: ACTIVE_STATUSES } }).sort({ createdAt: 1 })
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/services/TaskService.test.ts`
Expected: PASS (11 tests: 7 existing + 4 new).

- [ ] **Step 5: Wire the dependency in production (`src/index.ts`)**

`ProjectService` is currently constructed _after_ `TaskService` (original: `tasks` at line 42, `projects` at line 48). Reorder so `projects` exists before `tasks`, and pass it in:

```ts
const projects = new ProjectService()
await projects.loadProjects()
projects.startCacheRefresh(PROJECT_REFRESH_MS)

const tasks = new TaskService(projects)
const queue = new WorkQueue({ leaseMs: cfg.leaseMs, maxAttempts: cfg.maxAttempts })
const magi = new MagiClient({ baseUrl: cfg.magiBaseUrl, token: cfg.magiToken })
const papai = new PapaiNotifier({ url: cfg.papaiNotifyUrl, token: cfg.papaiNotifyToken })
const notifier = new PapaiTaskNotifier(papai)
```

(This replaces the original block where `tasks`/`queue`/`magi`/`papai`/`notifier` were constructed first, then `projects` after. Nothing else in `main()` changes — `projects` was already referenced later by `SupervisorService`, `assigneeWatchSweep`, etc.)

- [ ] **Step 6: Verify the production wiring compiles**

`src/index.ts` has no dedicated unit test (it's the process entrypoint) — verify via the type-checker, since a wrong construction order there would be a `ReferenceError`/TDZ at runtime.

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/services/TaskService.ts src/index.ts tests/services/TaskService.test.ts
git commit -m "feat(tasks): seed pipelineJobTrackList from Project config in create/createForgeEvent (FU2 Component A seeding)"
```

---

## Task 3: Regression guard — real seeding path reaches `forgePollSweep`

This is the exact test the spec calls out as "the test that should have caught this": `forgePollSweep`'s existing tests fake `getFailedPipelineJobLogs` and never assert on its whitelist _argument_ — only on the enqueue outcome — so they'd pass regardless of whether seeding actually worked. This task closes that gap using the real `TaskService` + `ProjectService`, not a stub.

**Files:**

- Modify: `nerv/tests/periodic/forgePollSweep.test.ts` (construct `TaskService` with a real `ProjectService`; add one new test)

- [ ] **Step 1: Wire a real `ProjectService` into the test file's `TaskService`**

Near the top of `nerv/tests/periodic/forgePollSweep.test.ts`, add imports and replace the module-level `tasks` construction:

```ts
import { ProjectService } from '../../src/services/ProjectService.js'
import { Project } from '../../src/db/models/Project.js'
```

```ts
const projects = new ProjectService()
const tasks = new TaskService(projects)
```

(was: `const tasks = new TaskService()`)

In the `describe('forgePollSweep', ...)` block, add cache resets alongside the existing `beforeAll`/`afterEach`:

```ts
beforeAll(async () => {
  await startTestDb()
  await WorkItem.syncIndexes()
})
afterAll(async () => {
  await stopTestDb()
})
afterEach(async () => {
  await clearDb()
  await projects.loadProjects()
})
```

- [ ] **Step 2: Write the regression-guard test**

Add to the end of the `describe('forgePollSweep', ...)` block:

```ts
it('regression guard: a non-empty pipelineJobTrackList configured on the Project actually reaches getFailedPipelineJobLogs via the real TaskService.create seeding path', async () => {
  await Project.create({
    contextIds: ['ctx-1'],
    repositories: [
      {
        projectPath: 'g/r',
        repoUrl: 'https://forge.example.com/g/r.git',
        pipelineJobTrackList: ['test_unit', 'lint'],
      },
    ],
  })
  await projects.loadProjects()

  const t = await tasks.create({
    kind: 'k',
    contextRef: { contextId: 'c' },
    source: 'chat',
    prompt: 'p',
    repos: [{ projectPath: 'g/r' }],
  })
  expect(t.taskRepositories[0].pipelineJobTrackList).toEqual(['test_unit', 'lint'])

  t.taskRepositories[0].mrIid = 1
  t.taskRepositories[0].mrSyncSnapshot = SNAP_A
  await t.save()

  const failedJobs: FailedPipelineJobLogs = {
    pipelineId: 55,
    jobs: [{ id: 7, name: 'test_unit', log: 'boom' }],
  }
  const forge = fakeForge({
    getMRSyncSnapshot: vi.fn(async () => SNAP_B),
    getMRView: vi.fn(async () => emptyMrView()),
    getFailedPipelineJobLogs: vi.fn(async () => failedJobs),
  })
  const queue = new WorkQueue({ leaseMs: 1000, maxAttempts: 3 })

  await forgePollSweep(tasks, queue, forge, { botUsername: BOT })

  expect(forge.getFailedPipelineJobLogs).toHaveBeenCalledWith('g/r', '1', ['test_unit', 'lint'])
})
```

- [ ] **Step 3: Run the test — it should already pass (Tasks 1+2 already implement the fix)**

Run: `npx vitest run tests/periodic/forgePollSweep.test.ts`
Expected: PASS, all tests including the new one. This is a _characterization_/regression test, not a red-then-green step — its purpose is to fail on any future regression of the seeding chain, which today's fake-based tests would silently let through (they still pass unmodified, since they never assert on the whitelist argument).

- [ ] **Step 4: Commit**

```bash
git add tests/periodic/forgePollSweep.test.ts
git commit -m "test(forge-poll): add regression guard for pipelineJobTrackList real-seeding path (FU2 Component A)"
```

---

## Task 4: Widen `FailedPipelineJob` + map GitLab job metadata

**Files:**

- Modify: `nerv/src/domain/forge.ts:98-102`
- Modify: `nerv/src/services/GitlabForgeClient.ts:180-223`
- Test: `nerv/tests/services/GitlabForgeClient.test.ts`
- Fixup (type-check only, see Step 4): `nerv/tests/periodic/forgePollSweep.test.ts`, `nerv/tests/supervisor/pipelineFailureHandler.test.ts`

- [ ] **Step 1: Write the failing tests**

Add two new tests to the `describe('GitlabForgeClient.getFailedPipelineJobLogs', ...)` block in `nerv/tests/services/GitlabForgeClient.test.ts` (after the existing 5 tests, before the closing `})`):

```ts
it('maps GitLab stage/status/web_url/duration/failure_reason onto the widened FailedPipelineJob', async () => {
  const api = fakeApi({
    MergeRequests: {
      allPipelines: vi.fn().mockResolvedValue([{ id: 10, created_at: '2026-07-01T00:00:00.000Z' }]),
    },
    Jobs: {
      all: vi.fn().mockResolvedValue([
        {
          id: 1,
          name: 'test',
          stage: 'test',
          status: 'failed',
          web_url: 'https://gitlab.example.com/group/proj/-/jobs/1',
          duration: 12.5,
          failure_reason: 'script_failure',
        },
      ]),
      showLog: vi.fn().mockResolvedValue('log output'),
    },
  })
  const client = new GitlabForgeClient(api, silentLog)

  const result = await client.getFailedPipelineJobLogs('group/proj', '42', ['test'])

  expect(result?.jobs[0]).toEqual({
    id: 1,
    name: 'test',
    log: 'log output',
    stage: 'test',
    status: 'failed',
    webUrl: 'https://gitlab.example.com/group/proj/-/jobs/1',
    duration: 12.5,
    failureReason: 'script_failure',
  })
})

it('maps a job with stage/status/webUrl but no duration/failure_reason, leaving those two fields undefined', async () => {
  const api = fakeApi({
    MergeRequests: {
      allPipelines: vi.fn().mockResolvedValue([{ id: 10, created_at: '2026-07-01T00:00:00.000Z' }]),
    },
    Jobs: {
      all: vi.fn().mockResolvedValue([
        {
          id: 1,
          name: 'test',
          stage: 'test',
          status: 'failed',
          web_url: 'https://gitlab.example.com/group/proj/-/jobs/1',
        },
      ]),
      showLog: vi.fn().mockResolvedValue('log output'),
    },
  })
  const client = new GitlabForgeClient(api, silentLog)

  const result = await client.getFailedPipelineJobLogs('group/proj', '42', ['test'])

  expect(result?.jobs[0]).toEqual({
    id: 1,
    name: 'test',
    log: 'log output',
    stage: 'test',
    status: 'failed',
    webUrl: 'https://gitlab.example.com/group/proj/-/jobs/1',
  })
  expect(result?.jobs[0].duration).toBeUndefined()
  expect(result?.jobs[0].failureReason).toBeUndefined()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/services/GitlabForgeClient.test.ts`
Expected: FAIL on both new tests — `getFailedPipelineJobLogs` currently only pushes `{ id, name, log }`, so `result?.jobs[0]` lacks `stage`/`status`/`webUrl` (the `toEqual` assertions expecting those keys present fail; the 5 pre-existing tests in this `describe` block still pass, since they use `toEqual` against `{id,name,log}`-only literals and vitest's `toEqual` ignores extra `undefined`-valued keys).

- [ ] **Step 3: Widen `FailedPipelineJob` and update the mapping**

In `nerv/src/domain/forge.ts`, replace the `FailedPipelineJob` interface:

```ts
/**
 * A failed CI job, with metadata sourced from GitLab's `JobSchema` (`@gitbeaker/core`).
 * `stage`/`status`/`webUrl` are required — GitLab's `JobSchema` always reports them (non-optional,
 * never null). `duration`/`failureReason` are optional on `JobSchema` (present once GitLab has
 * computed them) but never reported as `null` — so both are typed `?:`, not `| null`.
 */
export interface FailedPipelineJob {
  id: number
  name: string
  log: string
  stage: string
  status: string
  webUrl: string
  duration?: number
  failureReason?: string
}
```

In `nerv/src/services/GitlabForgeClient.ts`, update the job-mapping loop inside `getFailedPipelineJobLogs` (the `FailedPipelineJobLogs` import already exists at the top of this file):

```ts
const jobResults: FailedPipelineJobLogs['jobs'] = []
for (const job of matchedJobs) {
  try {
    const logResponse = await this.client.Jobs.showLog(projectPath, job.id)
    const log = typeof logResponse === 'string' ? logResponse : String(logResponse)
    jobResults.push({
      id: job.id,
      name: job.name,
      log,
      stage: job.stage,
      status: job.status,
      webUrl: job.web_url,
      duration: job.duration,
      failureReason: job.failure_reason,
    })
  } catch (logError) {
    this.log.warn(`Failed to get log for job ${job.name} (id: ${job.id}), skipping: ${logError}`)
  }
}
```

(was: `const jobResults: { id: number; name: string; log: string }[] = []` and `jobResults.push({ id: job.id, name: job.name, log })`.)

- [ ] **Step 4: Fix type-check fallout in test files that construct `FailedPipelineJob` literals**

Run: `npm run type-check`
Expected: FAIL — two test files build `FailedPipelineJobLogs`/`FailedPipelineJob` object literals with only `{id, name, log}`, and TS now requires `stage`/`status`/`webUrl` on every element (unlike `GitlabForgeClient.test.ts`'s fixtures above, which go through a loosely-typed `vi.fn()` mock and don't hit this check):

- `nerv/tests/periodic/forgePollSweep.test.ts` — the existing `'change with no review groups but a failed job'` test (Task 3's baseline, pre-existing) and Task 3's new regression-guard test both declare `const failedJobs: FailedPipelineJobLogs = { pipelineId: 55, jobs: [{ id: 7, name: 'test'|'test_unit', log: 'boom' }] }`.
- `nerv/tests/supervisor/pipelineFailureHandler.test.ts` — the `makeFailedJobLogs()` helper's default fixture.

Fix by adding `stage`/`status`/`webUrl` to each literal. In `nerv/tests/periodic/forgePollSweep.test.ts`, both spots become:

```ts
const failedJobs: FailedPipelineJobLogs = {
  pipelineId: 55,
  jobs: [
    {
      id: 7,
      name: 'test',
      log: 'boom',
      stage: 'test',
      status: 'failed',
      webUrl: 'https://gitlab.example.com/g/r/-/jobs/7',
    },
  ],
}
```

(for the pre-existing `'change with no review groups but a failed job'` test — `name: 'test'`), and

```ts
const failedJobs: FailedPipelineJobLogs = {
  pipelineId: 55,
  jobs: [
    {
      id: 7,
      name: 'test_unit',
      log: 'boom',
      stage: 'test',
      status: 'failed',
      webUrl: 'https://gitlab.example.com/g/r/-/jobs/7',
    },
  ],
}
```

(for Task 3's regression-guard test — `name: 'test_unit'`).

In `nerv/tests/supervisor/pipelineFailureHandler.test.ts`, update `makeFailedJobLogs`:

```ts
function makeFailedJobLogs(overrides: Partial<FailedPipelineJobLogs['jobs'][number]> = {}): FailedPipelineJobLogs {
  return {
    pipelineId: 55,
    jobs: [
      {
        id: 999,
        name: 'test_unit',
        log: 'Error: something failed\n2 tests failed',
        stage: 'test',
        status: 'failed',
        webUrl: 'https://gitlab.example.com/g/r/-/jobs/999',
        ...overrides,
      },
    ],
  }
}
```

- [ ] **Step 5: Run the tests and type-check to verify everything passes**

Run: `npm run type-check`
Expected: no errors.

Run: `npx vitest run tests/services/GitlabForgeClient.test.ts tests/periodic/forgePollSweep.test.ts tests/supervisor/pipelineFailureHandler.test.ts`
Expected: PASS, all tests (including the 2 new `GitlabForgeClient` tests and Task 3's regression guard).

- [ ] **Step 6: Commit**

```bash
git add src/domain/forge.ts src/services/GitlabForgeClient.ts tests/services/GitlabForgeClient.test.ts tests/periodic/forgePollSweep.test.ts tests/supervisor/pipelineFailureHandler.test.ts
git commit -m "feat(forge): widen FailedPipelineJob with stage/status/webUrl/duration/failureReason (FU2 Component B)"
```

---

## Task 5: Thread job metadata into the pipeline-fix prompt

**Files:**

- Modify: `nerv/src/services/prompts.ts:431-478` (`generatePipelineFixPrompt`)
- Modify: `nerv/src/supervisor/ciHandlers.ts` (call-site update, line 53 original)
- Test: `nerv/tests/services/prompts.test.ts`

- [ ] **Step 1: Write the failing tests**

In `nerv/tests/services/prompts.test.ts`, add the import:

```ts
import type { FailedPipelineJob } from '../../src/domain/forge.js'
```

Replace the `describe('generatePipelineFixPrompt', ...)` block:

```ts
describe('generatePipelineFixPrompt', () => {
  const job: FailedPipelineJob = {
    id: 999,
    name: 'build',
    log: 'error: something broke\nline 2',
    stage: 'build',
    status: 'failed',
    webUrl: 'https://gitlab.example.com/g/r/-/jobs/999',
  }

  it('includes the job name, truncated job log, and [RESULT] pipeline-fix format', () => {
    const prompt = generatePipelineFixPrompt(job, 'error: something broke\nline 2', 'repo_dir')
    expect(prompt).toContain('CI job **build** failed.')
    expect(prompt).toContain('error: something broke')
    expect(prompt).toContain('repo_dir/')
    expect(prompt).toContain(resultFormatPipelineFix())
  })

  it('defaults to English and honors a given output language', () => {
    const en = generatePipelineFixPrompt(job, 'log', 'repo_dir')
    expect(en).toContain(proseDirective('English'))
    expect(en).toContain('Reply: <brief summary of what was fixed, in English>')

    const ru = generatePipelineFixPrompt(job, 'log', 'repo_dir', 'Russian')
    expect(ru).toContain(proseDirective('Russian'))
    expect(ru).not.toContain(proseDirective('English'))
    expect(ru).toContain('Reply: <brief summary of what was fixed, in Russian>')
    // The Commit field follows CONTRIBUTING.md's naming convention and is deliberately not localized.
    expect(ru).toContain('Commit: <commit title describing the fix, in English>')
  })

  it('includes stage/status/webUrl, and failureReason only when present', () => {
    const withoutReason = generatePipelineFixPrompt(job, 'log', 'repo_dir')
    expect(withoutReason).toContain('- Stage: build')
    expect(withoutReason).toContain('- Status: failed')
    expect(withoutReason).toContain('- Pipeline job URL: https://gitlab.example.com/g/r/-/jobs/999')
    expect(withoutReason).not.toContain('Failure reason:')

    const withReason = generatePipelineFixPrompt({ ...job, failureReason: 'script_failure' }, 'log', 'repo_dir')
    expect(withReason).toContain('- Failure reason: script_failure')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/services/prompts.test.ts`
Expected: FAIL to compile — `generatePipelineFixPrompt(job, ...)` passes a `FailedPipelineJob` object where the current signature expects a bare `jobName: string` first argument.

- [ ] **Step 3: Update `generatePipelineFixPrompt`'s signature and body**

In `nerv/src/services/prompts.ts`, add the import (alongside the other `import type` block near the top):

```ts
import type { FailedPipelineJob } from '../domain/forge.js'
```

Replace the function:

```ts
/**
 * Generates the prompt for fixing a failed CI pipeline. Includes stage/status/failureReason/webUrl
 * job metadata (FU2 Component B enrichment) so the coding agent gets more failure context up front.
 *
 * @param job — the failed job (name/log plus stage/status/webUrl/duration/failureReason metadata)
 * @param language — output language for user-facing prose (the Reply field, etc.); defaults to
 *   `DEFAULT_OUTPUT_LANGUAGE`
 */
export function generatePipelineFixPrompt(
  job: FailedPipelineJob,
  jobLog: string,
  worktreeSubdir: string,
  language: string = DEFAULT_OUTPUT_LANGUAGE,
): string {
  const repoContext = `\n⚠️ **Repository context:** The changes must be applied in the working directory \`${worktreeSubdir}/\`. Do NOT modify files outside this subdirectory unless the fix requires it.\n`
  const metadataLines = [
    `- Stage: ${job.stage}`,
    `- Status: ${job.status}`,
    job.failureReason ? `- Failure reason: ${job.failureReason}` : null,
    `- Pipeline job URL: ${job.webUrl}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')

  return `
CI job **${job.name}** failed.
${repoContext}
${buildEngineeringOperatingInstructions('pipeline-fix', language)}

Job metadata:
${metadataLines}

Here is the job log:

\`\`\`
${jobLog}
\`\`\`
Please analyze the log, find the root cause, and fix the code so the pipeline passes.
Make only the necessary changes to address this specific failure.
Keep all existing functionality that wasn't related to the failure.

⚠️ **Determine causality first.**
The pipeline failure may be caused by one of the recent commits in this branch —
or it may have nothing to do with them. Before attempting any fix:

1. Inspect recent commits in the current branch first; you may inspect other branches only for comparison.
2. Identify which (if any) commits could plausibly have caused this specific failure.
3. If no commit is obviously related — do NOT make any changes.
   Set Status=no_changes, FailureType=unrelated, and explain in Reply that the failure
   appears unrelated to any recent commits in this branch.
4. The failure could also be a pre-existing issue, flaky test, or infrastructure problem —
   in all these cases, avoid code changes.

⚠️ **AGENTS.md priority:** Before attempting to fix the failure yourself, check if the project
contains an \`AGENTS.md\` file (and any \`AGENTS.md\` files in subdirectories). These files often
contain project-specific instructions for fixing common pipeline issues — especially code formatting,
linting, and style-check failures. Always prioritize guidance from \`AGENTS.md\` over self-directed
solutions. For formatting/linting failures in particular, the correct fix (formatter config,
auto-fix commands, etc.) is almost always documented in \`AGENTS.md\`.

**Important:** ${GIT_PUBLISHING_INSTRUCTION}

If you make changes — provide a commit title describing the fix.
Append a result block at the very end of your response:
${buildResultBlock(resultFormatPipelineFix(language))}
  `.trim()
}
```

- [ ] **Step 4: Update the call site in `ciHandlers.ts`**

In `nerv/src/supervisor/ciHandlers.ts`, change the call from `job.name` (a string) to `job` (the whole object):

```ts
const prompt = generatePipelineFixPrompt(job, truncateJobLog(job.log), worktreeSubdir, task.outputLanguage)
```

(was: `generatePipelineFixPrompt(job.name, truncateJobLog(job.log), worktreeSubdir, task.outputLanguage)`. `job` here is already typed `FailedPipelineJob` — it comes from `failedJobs?.jobs.find((j) => j.id === payload.jobId)`, `failedJobs: FailedPipelineJobLogs | null` returned by `forge.getFailedPipelineJobLogs`.)

- [ ] **Step 5: Run the tests and type-check to verify everything passes**

Run: `npm run type-check`
Expected: no errors.

Run: `npx vitest run tests/services/prompts.test.ts tests/supervisor/pipelineFailureHandler.test.ts`
Expected: PASS (the pipeline-failure-handler happy-path test still asserts `prompt` contains `'test_unit'` and `'Error: something failed'`, which still holds — `job.name`/`job.log` are unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/services/prompts.ts src/supervisor/ciHandlers.ts tests/services/prompts.test.ts
git commit -m "feat(prompts): thread failed-job metadata into the pipeline-fix prompt (FU2 Component B)"
```

---

## Task 6: CI-failure chat notification

**Files:**

- Modify: `nerv/src/supervisor/ciHandlers.ts` (whole file, original 67 lines)
- Test: `nerv/tests/supervisor/pipelineFailureHandler.test.ts`

- [ ] **Step 1: Write the failing tests**

Update the `makeCtx` test helper in `nerv/tests/supervisor/pipelineFailureHandler.test.ts` to accept an optional `papai` stub, defaulting to a no-op notifier:

```ts
function makeCtx(
  task: Awaited<ReturnType<TaskService['create']>>,
  payload: PipelineFailurePayload,
  forge: Partial<Record<string, unknown>>,
  magi: Partial<Record<string, unknown>>,
  papai: Partial<Record<string, unknown>> = { notify: vi.fn(async () => {}) },
) {
  return { task, item: { payload }, forge, magi, papai } as unknown as HandlerCtx
}
```

(was: `function makeCtx(task, payload, forge, magi) { return { task, item: { payload }, forge, magi } as unknown as HandlerCtx }` — no `papai`. The default param keeps all 5 pre-existing call sites, which pass only 4 args, compiling and running unchanged.)

Add two new tests to the end of the `describe('pipeline_failure handler', ...)` block:

```ts
it('notifies papai with the CI-failure markdown (name/stage/status/webUrl), never the log body', async () => {
  const t = await tasks.create({
    kind: 'gitlab-mr-supervision',
    contextRef: { contextId: 'c' },
    source: 'chat',
    prompt: 'p',
    repos: [{ projectPath: 'g/r' }],
  })
  t.taskRepositories[0].magiSessionId = 'sess-1'
  t.taskRepositories[0].pipelineJobTrackList = ['test_unit']
  await t.save()

  const forge = {
    getFailedPipelineJobLogs: vi.fn(async () => makeFailedJobLogs()),
  }
  const magi = { followUp: vi.fn(async () => ({})) }
  const notify = vi.fn(async () => {})
  const papai = { notify }

  const payload: PipelineFailurePayload = {
    projectPath: 'g/r',
    mrIid: 1,
    pipelineId: 55,
    jobId: 999,
  }

  const handler = makePipelineFailureHandler('nerv-agent')
  await handler(makeCtx(t, payload, forge, magi, papai))

  expect(notify).toHaveBeenCalledOnce()
  const [msg] = notify.mock.calls[0] as unknown as [{ contextId: string; markdown: string }]
  expect(msg.contextId).toBe('c')
  expect(msg.markdown).toContain('CI failed:** `test_unit` (stage: `test`)')
  expect(msg.markdown).toContain('status: failed')
  expect(msg.markdown).toContain('https://gitlab.example.com/g/r/-/jobs/999')
  expect(msg.markdown).not.toContain('Error: something failed')
})

it('best-effort notification: a throwing papai notify is logged and does not block the fix dispatch', async () => {
  const t = await tasks.create({
    kind: 'gitlab-mr-supervision',
    contextRef: { contextId: 'c' },
    source: 'chat',
    prompt: 'p',
    repos: [{ projectPath: 'g/r' }],
  })
  t.taskRepositories[0].magiSessionId = 'sess-1'
  t.taskRepositories[0].pipelineJobTrackList = ['test_unit']
  await t.save()

  const forge = {
    getFailedPipelineJobLogs: vi.fn(async () => makeFailedJobLogs()),
  }
  const magi = { followUp: vi.fn(async () => ({})) }
  const papai = {
    notify: vi.fn(async () => {
      throw new Error('papai down')
    }),
  }

  const payload: PipelineFailurePayload = {
    projectPath: 'g/r',
    mrIid: 1,
    pipelineId: 55,
    jobId: 999,
  }

  const handler = makePipelineFailureHandler('nerv-agent')
  await expect(handler(makeCtx(t, payload, forge, magi, papai))).resolves.toBeUndefined()

  expect(magi.followUp).toHaveBeenCalledOnce()
  const reloaded = await tasks.get(t._id.toString())
  expect(reloaded?.taskRepositories[0].processedJobIds).toEqual(['999'])
})
```

(`makeFailedJobLogs()`'s default fixture already carries `stage: 'test'`, `status: 'failed'`, `webUrl: 'https://gitlab.example.com/g/r/-/jobs/999'` from Task 4.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/supervisor/pipelineFailureHandler.test.ts`
Expected: FAIL on both new tests — the handler never calls `papai.notify` today, so `notify` in the first test is never invoked (`toHaveBeenCalledOnce()` fails); the second test's assertions on `magi.followUp`/`processedJobIds` would incidentally still pass today (nothing throws pre-implementation), but the notify-call expectation in the first test fails, which is the load-bearing red here.

- [ ] **Step 3: Wire `PapaiTaskNotifier.notifyReply` into the handler, best-effort**

Replace `nerv/src/supervisor/ciHandlers.ts` in full:

```ts
/**
 * pipeline_failure: a tracked CI job failed on a task's MR (detected/enqueued by the Wave-6
 * forge-poll sweep — see `domain/workPayloads.ts#PipelineFailurePayload`). This handler re-reads
 * the MR's latest pipeline via the read-only ForgeClient (the job may have since been retried,
 * superseded by a newer pipeline, or fallen out of the tracked whitelist since this work item was
 * enqueued), builds a pipeline-fix prompt from the failed job's log, and forwards it to the repo's
 * magi session as a follow-up. magi does the actual root-cause fix + push.
 *
 * Idempotent via `repo.processedJobIds`: a jobId already recorded there is a no-op (no forge/magi
 * call). Mirrors `makeReviewCommentHandler`'s structure/conventions exactly.
 *
 * Also posts a best-effort chat notification (FU2 Component C) so a detected CI failure is
 * visible — previously this handler only called `magi.followUp`, making a real failure a fully
 * silent no-op from the user's perspective. The notification never blocks or fails the fix
 * dispatch: it's advisory, the fix is the load-bearing action.
 */

import { generatePipelineFixPrompt, truncateJobLog } from '../services/prompts.js'
import { createLogger } from '../logger.js'
import { resolveWorktreeSubdir } from './reviewHandlers.js'
import { resolveMagiCredentials } from './magiCredentials.js'
import { ciFixIdempotencyKey } from '../domain/idempotencyKeys.js'
import { PapaiTaskNotifier } from '../services/PapaiTaskNotifier.js'
import type { Handler } from './handlers.js'
import type { PipelineFailurePayload } from '../domain/workPayloads.js'
import type { FailedPipelineJob } from '../domain/forge.js'

const log = createLogger('pipeline-failure-handler')

/** Builds the CI-failure chat notification markdown. Never includes the job log body or any token. */
export function formatCiFailureMarkdown(job: FailedPipelineJob): string {
  return [
    `⚠️ **CI failed:** \`${job.name}\` (stage: \`${job.stage}\`)`,
    `status: ${job.status} · [view pipeline](${job.webUrl})`,
    `→ attempting a fix…`,
  ].join('\n')
}

export function makePipelineFailureHandler(gitlabUserName: string = 'nerv-agent'): Handler {
  return async ({ task, item, forge, magi, papai, projects, magiDefaults }) => {
    const payload = item.payload as PipelineFailurePayload
    const repo = task.taskRepositories.find((r) => r.projectPath === payload.projectPath)
    if (!repo || !repo.magiSessionId) {
      log.info(`no repo/session for ${payload.projectPath} on task ${task._id} — skipping`)
      return
    }

    const processedJobIds = new Set(repo.processedJobIds)
    if (processedJobIds.has(String(payload.jobId))) {
      log.debug(`job ${payload.jobId} on ${payload.projectPath} already processed — skipping`)
      return
    }

    // Re-fetch: the failed job may have been retried/resolved, or the pipeline superseded, since
    // this work item was enqueued.
    const failedJobs = await forge.getFailedPipelineJobLogs(
      payload.projectPath,
      String(payload.mrIid),
      repo.pipelineJobTrackList,
    )
    const job = failedJobs?.jobs.find((j) => j.id === payload.jobId)
    if (!job) {
      log.debug(
        `job ${payload.jobId} no longer among failed jobs for ${payload.projectPath}!${payload.mrIid} — skipping`,
      )
      return
    }

    const worktreeSubdir = resolveWorktreeSubdir(projects, task.contextRef.contextId, payload.projectPath)
    log.info(
      `forwarding pipeline fix for job "${job.name}" (${job.id}) as @${gitlabUserName} to session ${repo.magiSessionId}`,
    )
    const prompt = generatePipelineFixPrompt(job, truncateJobLog(job.log), worktreeSubdir, task.outputLanguage)

    try {
      const notifier = new PapaiTaskNotifier(papai)
      await notifier.notifyReply(task, formatCiFailureMarkdown(job))
    } catch (error) {
      log.warn('failed to notify papai of CI failure — continuing with the fix dispatch', {
        taskId: task._id.toString(),
        projectPath: repo.projectPath,
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    const credentials = resolveMagiCredentials(projects?.getByContextId(task.contextRef.contextId), magiDefaults ?? {})
    const idempotencyKey = ciFixIdempotencyKey(task._id.toString(), repo.projectPath, payload.jobId)
    await magi.followUp(repo.magiSessionId, prompt, credentials, idempotencyKey)

    processedJobIds.add(String(payload.jobId))
    repo.processedJobIds = [...processedJobIds]
    task.lastActivity = new Date()
    await task.save()
  }
}
```

Notes on this change vs. the original:

- Added `papai` to the destructured handler params (`HandlerCtx.papai: PapaiNotifier` already exists — no `handlers.ts` change needed).
- The notify call sits **after** the prompt is built and **before** `resolveMagiCredentials`/`magi.followUp` — so a notify failure can never prevent the fix dispatch, and `job`/`prompt` are already in scope (Resolved assumption 4).
- `new PapaiTaskNotifier(papai)` constructed locally, matching the existing `makeReconcileHandler` pattern (Resolved assumption 2) — no new field on `HandlerCtx`.
- `log.warn(msg, meta)` matches nerv's own `Logger` interface (`warn(msg: string, ...args: unknown[])`, `nerv/src/logger.ts:3`) — message first, metadata object second.

- [ ] **Step 4: Run the tests and type-check to verify everything passes**

Run: `npm run type-check`
Expected: no errors.

Run: `npx vitest run tests/supervisor/pipelineFailureHandler.test.ts`
Expected: PASS, all 7 tests (5 pre-existing + 2 new).

- [ ] **Step 5: Run the full nerv test suite as a final regression check**

Run: `npx vitest run`
Expected: PASS, all files/tests (no regressions in unrelated suites from the `TaskService`/`HandlerCtx.papai` changes threaded through Tasks 2–6).

- [ ] **Step 6: Commit**

```bash
git add src/supervisor/ciHandlers.ts tests/supervisor/pipelineFailureHandler.test.ts
git commit -m "feat(ci-handlers): notify papai chat on detected CI failure (FU2 Component C)"
```

---

## Out of scope (confirmed, do not implement here)

- **Component D** (papai importer un-drop: `papai/tools/import-kiss-projects-mapping.ts`) — separate papai-side plan, not part of this nerv plan.
- `MRViewContext.pipelines: unknown[]` typing/population (dead field, per spec).
- A global `DEFAULT_PIPELINE_JOB_TRACK_LIST` fallback (opt-in was decided; kiss's default was never actually built).
- Resurrecting `generateAgentsMdContent` / `promptTypes.ProjectRef` (bypassed by design — Task 2 wires straight `ProjectRepoConfig → TaskRepo`).
- Full `ci_wait` status wiring (Task 6's notification carries the user-facing signal; a status-line rework is a separate concern per the spec).
- Any magi change (magi has no pipeline/CI vocabulary and is not touched by any task above).
