<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Follow-up Coding Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user continue a prior coding session's branch/PR with a new prompt (add changes, fix build/tests) so the same PR updates in place instead of a new session branching from scratch.

**Architecture:** magi gains a session-centric `POST /sessions/:id/follow-up` endpoint that creates a **child session** reusing the parent's branch, `projectSpec`, and `prUrl` (checking out the existing branch and pushing back to it, skipping duplicate PR creation), with the parent's prompt+answer injected as context. The `plugins/acp/` plugin gains a thin chat-scoped history index and a `continue_session` tool that resolves a target (session id or PR number) to a parent session id and calls the endpoint.

**Tech Stack:** Bun + TypeScript (strict, `.js` import paths), `bun:sqlite`, `bun:test`. Two repos: **magi** at `~/Projects/yourpapai/magi` and **papai** at `~/Projects/yourpapai/papai`. Spec: `docs/superpowers/specs/2026-07-01-follow-up-coding-sessions-design.md`.

> **Repo note:** Tasks 1–6 are in the **magi** repo (run all `git`/`bun` commands from `~/Projects/yourpapai/magi`). Tasks 7–10 are in the **papai** repo (from `~/Projects/yourpapai/papai`). Each repo commits independently.

---

## File Structure

**magi (`~/Projects/yourpapai/magi`)**

- Modify `src/session/state.ts` — add `parentSessionId` to `Session`; add `FollowUpSessionInput`; add `CONTINUABLE` set.
- Modify `src/session/store.ts` — persist `parent_session_id` (create-time + migration + row mapping).
- Modify `src/session/helpers.ts` — `buildFollowUpPrompt`; skip PR creation in `autoPublishDirty` when `prUrl` already set.
- Modify `src/workspace/workspace.ts` — add `prepareContinue` to `WorkspaceManager`.
- Modify `src/workspace/git-workspace.ts` — implement `prepareContinue`.
- Modify `src/session/manager.ts` — `followUpSession`; thread a continue-branch through `runLifecycle`; skip PR reuse in `finishSession`.
- Modify `src/server/router.ts` — `POST /sessions/:id/follow-up`.
- Modify `tests/session/manager.test.ts` — add `prepareContinue` to `FakeWorkspace`; follow-up tests.

**papai (`~/Projects/yourpapai/papai`)**

- Create `plugins/acp/history.ts` — thin `SessionRecord` index over `plugin_kv` (write/read/scan, PR-number parse).
- Modify `plugins/acp/schemas.ts` — `continueSessionSchema`.
- Create `plugins/acp/continue-tool.ts` — `continueSessionTool`.
- Modify `plugins/acp/session-tools.ts` — write history records in `start_session`/`review_pr`; enrich `list_sessions`.
- Modify `plugins/acp/index.ts` — register `continue_session`; update prompt fragment + `/acp` text.
- Modify `src/llm-orchestrator-tools.ts` — add `plugin_acp__continue_session` to the `whoMayUse`-gated set.
- Create/modify tests under `tests/plugins/acp/`.

---

## Task 1: Session model — `parentSessionId` + follow-up input (magi)

**Files:**

- Modify: `src/session/state.ts`
- Modify: `src/session/store.ts`
- Test: `tests/session/store.test.ts`

- [ ] **Step 1: Add the failing store test**

Append inside the top-level `describe` in `tests/session/store.test.ts` (imports `SessionStore`, `Database` already present there):

```ts
test('persists and reads parentSessionId', () => {
  const store = new SessionStore(new Database(':memory:'))
  const spec = {
    name: 'demo',
    repoUrl: 'https://github.com/octo/demo.git',
    baseBranch: 'main',
    permissionPreset: 'autonomous' as const,
    agent: 'claude' as const,
  }
  const parent = store.create({
    id: 'p1',
    project: 'demo',
    agent: 'stub',
    contextId: 'c',
    prompt: 'a',
    cwd: '',
    projectSpec: spec,
  })
  expect(parent.parentSessionId).toBeNull()
  const child = store.create({
    id: 'c1',
    project: 'demo',
    agent: 'stub',
    contextId: 'c',
    prompt: 'b',
    cwd: '',
    projectSpec: spec,
    parentSessionId: 'p1',
  })
  expect(child.parentSessionId).toBe('p1')
  expect(store.get('c1')!.parentSessionId).toBe('p1')
})
```

- [ ] **Step 2: Run it and confirm failure**

Run: `bun test tests/session/store.test.ts`
Expected: FAIL — `parentSessionId` is not a property / `CreateSessionInput` has no `parentSessionId`.

- [ ] **Step 3: Add `parentSessionId` to `Session` and inputs in `src/session/state.ts`**

In the `Session` interface, add after `projectSpec`:

```ts
parentSessionId: string | null
```

At the end of the file, add:

```ts
export interface FollowUpSessionInput {
  parentSessionId: string
  prompt: string
  secrets?: Record<string, string>
  forgeToken?: string
}

// Statuses a session may be continued from (i.e. not still active).
export const CONTINUABLE: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  'waiting_input',
  'done',
  'failed',
  'cancelled',
])
```

- [ ] **Step 4: Persist the column in `src/session/store.ts`**

Add to `CreateSessionInput`:

```ts
  parentSessionId?: string | null
```

Add to `SessionRow`:

```ts
parent_session_id: string | null
```

In the `CREATE TABLE` statement, add a column line after `project_spec TEXT`:

```ts
        parent_session_id TEXT
```

Immediately after the existing `last_message` migration block in the constructor, add:

```ts
if (!columns.some((c): boolean => c.name === 'parent_session_id')) {
  this.db.run('ALTER TABLE sessions ADD COLUMN parent_session_id TEXT')
}
```

In `rowToSession`, add to the returned object (after `projectSpec`):

```ts
    parentSessionId: row.parent_session_id,
```

Add `$parentSessionId` to the `InsertParams` type:

```ts
$parentSessionId: string | null
```

Update the INSERT statement column list + VALUES to include `parent_session_id` / `$parentSessionId`, and pass it in `.run({...})`:

```ts
        `INSERT INTO sessions (id, project, agent, context_id, status, prompt, cwd, branch, pr_url, exit_code, created_at, updated_at, project_spec, parent_session_id)
         VALUES ($id, $project, $agent, $contextId, $status, $prompt, $cwd, NULL, NULL, NULL, $createdAt, $updatedAt, $projectSpec, $parentSessionId)`,
```

```ts
        $projectSpec: JSON.stringify(input.projectSpec),
        $parentSessionId: input.parentSessionId ?? null,
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `bun test tests/session/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `bun run typecheck`
Expected: no errors.

```bash
git add src/session/state.ts src/session/store.ts tests/session/store.test.ts
git commit -m "feat(session): persist parentSessionId + add follow-up input types"
```

---

## Task 2: `buildFollowUpPrompt` helper (magi)

**Files:**

- Modify: `src/session/helpers.ts`
- Test: `tests/session/helpers.test.ts`

- [ ] **Step 1: Add the failing test**

Add to `tests/session/helpers.test.ts` (add `buildFollowUpPrompt` to the existing import from `../../src/session/helpers.js`):

```ts
test('buildFollowUpPrompt embeds branch, prior task, prior outcome, and new task', () => {
  const parent = {
    branch: 'acp/abc',
    prUrl: 'https://forge/pr/7',
    prompt: 'add a health check',
    lastMessage: 'Added /health returning 200.',
  } as unknown as import('../../src/session/state.js').Session
  const out = buildFollowUpPrompt(parent, 'now fix the failing test')
  expect(out).toContain('acp/abc')
  expect(out).toContain('https://forge/pr/7')
  expect(out).toContain('add a health check')
  expect(out).toContain('Added /health returning 200.')
  expect(out).toContain('now fix the failing test')
})

test('buildFollowUpPrompt tolerates a null prior outcome', () => {
  const parent = {
    branch: 'acp/x',
    prUrl: null,
    prompt: 'p',
    lastMessage: null,
  } as unknown as import('../../src/session/state.js').Session
  const out = buildFollowUpPrompt(parent, 'next')
  expect(out).toContain('next')
  expect(out).toContain('(no prior outcome recorded)')
})
```

- [ ] **Step 2: Run it and confirm failure**

Run: `bun test tests/session/helpers.test.ts`
Expected: FAIL — `buildFollowUpPrompt` is not exported.

- [ ] **Step 3: Implement in `src/session/helpers.ts`**

Add the import of `Session` if not already present (the file already imports from `./state.js` — extend that import to include `Session`), then add:

```ts
const FOLLOWUP_FIELD_MAX = 4000

const clip = (s: string): string => (s.length <= FOLLOWUP_FIELD_MAX ? s : `${s.slice(0, FOLLOWUP_FIELD_MAX - 1)}…`)

export function buildFollowUpPrompt(parent: Session, newPrompt: string): string {
  const pr = parent.prUrl === null ? '' : ` (PR: ${parent.prUrl})`
  const outcome =
    parent.lastMessage !== null && parent.lastMessage.length > 0 ? parent.lastMessage : '(no prior outcome recorded)'
  return [
    `Continuation of a prior coding session on branch \`${parent.branch ?? 'unknown'}\`${pr}.`,
    `Prior task: ${clip(parent.prompt)}`,
    `Prior outcome: ${clip(outcome)}`,
    '',
    `New task: ${newPrompt}`,
  ].join('\n')
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test tests/session/helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session/helpers.ts tests/session/helpers.test.ts
git commit -m "feat(session): add buildFollowUpPrompt for follow-up context injection"
```

---

## Task 3: Workspace `prepareContinue` (magi)

**Files:**

- Modify: `src/workspace/workspace.ts`
- Modify: `src/workspace/git-workspace.ts`
- Test: `tests/workspace/git-workspace.test.ts`

- [ ] **Step 1: Add the failing test**

In `tests/workspace/git-workspace.test.ts`, add a test that a branch pushed by one session can be checked out again. Match the file's existing helpers for building a local bare repo + `GitWorkspaceManager` (reuse the surrounding pattern; the assertions below are the new behavior):

```ts
test('prepareContinue checks out an existing branch and finish pushes back to it', async () => {
  const { manager, project, remotePath } = await makeLocalRepoWorkspace() // existing helper pattern in this file
  // First session creates and pushes acp/s1.
  const first = await manager.prepare('s1', project)
  await Bun.write(join(first.worktreePath, 'a.txt'), 'hello')
  await manager.finish(first, 'first change')
  await manager.cleanup(first, project)
  // Continue the same branch in a new session.
  const cont = await manager.prepareContinue('s2', project, 'acp/s1')
  expect(cont.branch).toBe('acp/s1')
  expect(await Bun.file(join(cont.worktreePath, 'a.txt')).text()).toBe('hello')
  await Bun.write(join(cont.worktreePath, 'b.txt'), 'world')
  await manager.finish(cont, 'second change')
  // The remote branch now has both files.
  const files = await runGit(['ls-tree', '--name-only', 'acp/s1'], remotePath)
  expect(files.stdout).toContain('a.txt')
  expect(files.stdout).toContain('b.txt')
})
```

> If `makeLocalRepoWorkspace`/`remotePath` are named differently in this file, use the existing local-repo setup already present and keep the three assertions (branch name, checked-out file, both files on the remote after the second finish). `runGit` and `join` are already imported by this test file.

- [ ] **Step 2: Run it and confirm failure**

Run: `bun test tests/workspace/git-workspace.test.ts`
Expected: FAIL — `manager.prepareContinue` is not a function.

- [ ] **Step 3: Add `prepareContinue` to the `WorkspaceManager` interface in `src/workspace/workspace.ts`**

After the `prepareReview` line:

```ts
  prepareContinue(sessionId: string, project: ProjectConfig, continueBranch: string, auth?: GitAuth): Promise<PreparedWorkspace>
```

- [ ] **Step 4: Implement it in `src/workspace/git-workspace.ts`**

Add this method to `GitWorkspaceManager` (after `prepare`):

```ts
  async prepareContinue(
    sessionId: string,
    project: ProjectConfig,
    continueBranch: string,
    auth?: GitAuth,
  ): Promise<PreparedWorkspace> {
    const cache = await this.ensureMirror(project, auth)
    // Refresh the branch ref from the remote so we build on the latest tip.
    await runGit(['fetch', project.repoUrl, `+refs/heads/${continueBranch}:refs/heads/${continueBranch}`], cache, auth)
    const worktreePath = join(this.options.root, 'worktrees', sessionId)
    await mkdir(dirname(worktreePath), { recursive: true })
    await runGit(['worktree', 'add', worktreePath, continueBranch], cache)
    await runGit(['config', 'user.email', 'magi@local'], worktreePath)
    await runGit(['config', 'user.name', 'magi'], worktreePath)
    return { worktreePath, branch: continueBranch, repoUrl: project.repoUrl }
  }
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `bun test tests/workspace/git-workspace.test.ts`
Expected: PASS.

- [ ] **Step 6: Add `prepareContinue` to test doubles so the suite still typechecks**

In `tests/session/manager.test.ts`, add to `FakeWorkspace` (after `prepareReview`):

```ts
  prepareContinue(sessionId: string, project: ProjectConfig, continueBranch: string): Promise<PreparedWorkspace> {
    const worktreePath = mkdtempSync(join(tmpdir(), `magi-cont-${sessionId}-`))
    return Promise.resolve({ worktreePath, branch: continueBranch, repoUrl: project.repoUrl })
  }
```

Also add the same one-line stub `prepareContinue(...) { return Promise.reject(new Error('unused')) }` to the two inline `WorkspaceManager` literals in that file (the `failingPrepare` object and any other inline implementation) so they satisfy the interface.

- [ ] **Step 7: Typecheck + commit**

Run: `bun run typecheck`
Expected: no errors.

```bash
git add src/workspace/workspace.ts src/workspace/git-workspace.ts tests/workspace/git-workspace.test.ts tests/session/manager.test.ts
git commit -m "feat(workspace): prepareContinue checks out an existing branch"
```

---

## Task 4: PR reuse guard — don't open a duplicate PR (magi)

**Files:**

- Modify: `src/session/helpers.ts`
- Modify: `src/session/manager.ts`
- Test: `tests/session/manager.test.ts`

- [ ] **Step 1: Add the failing test**

In `tests/session/manager.test.ts`, add (uses the existing `stubForgeProvider`/`FakeWorkspace`; the forge stub returns `pr/1`):

```ts
test('finishSession reuses an inherited prUrl and does not open a second PR', async () => {
  const store = new SessionStore(new Database(':memory:'))
  const ws = new FakeWorkspace()
  ws.dirty = true
  let created = 0
  const countingForge: ForgeProvider = {
    forProject: (_p, _t) => ({
      ...stubForge,
      createPullRequest: (_i) => {
        created += 1
        return Promise.resolve({ number: 9, url: 'https://forge/pr/9', headRef: 'h', fetchRef: 'pull/9/head' })
      },
    }),
  }
  const manager = new SessionManager(
    store,
    new StubRuntime(),
    ws,
    new PermissionEngine({}),
    demoDefaults(),
    countingForge,
    new NoopNotifier(),
  )
  const started = manager.startSession({ projectSpec: demoSpec(), agent: 'stub', contextId: 'c', prompt: 'p' })
  expect(await pollTerminal(manager, started.id)).toBe('waiting_input')
  // Simulate an inherited PR on this session.
  store.setPrUrl(started.id, 'https://forge/pr/parent')
  const done = await manager.finishSession(started.id, { message: 'wip', action: 'pr', forgeToken: 'tok' })
  expect(done!.status).toBe('done')
  expect(done!.prUrl).toBe('https://forge/pr/parent')
  expect(created).toBe(0)
})
```

- [ ] **Step 2: Run it and confirm failure**

Run: `bun test tests/session/manager.test.ts`
Expected: FAIL — `created` is `1` (a second PR was opened).

- [ ] **Step 3: Guard the PR creation in `finishSession` (`src/session/manager.ts`)**

Replace the `if (input.action === 'pr') { ... }` block in `finishSession` with:

```ts
if (input.action === 'pr' && session.prUrl === null) {
  const head = session.branch
  const title = input.title ?? session.prompt
  const body = input.body ?? ''
  const token = input.forgeToken ?? ''
  await openPullRequest(this.forges, this.store, project, id, head, title, body, token)
}
```

- [ ] **Step 4: Guard the auto-finish path in `autoPublishDirty` (`src/session/helpers.ts`)**

Replace the body of the `try` block in `autoPublishDirty` with:

```ts
await workspace.finish(prepared, session.prompt, authFrom(project, forgeToken))
const prUrl =
  session.prUrl !== null
    ? session.prUrl
    : await openPullRequest(forges, store, project, id, prepared.branch, session.prompt, answer, forgeToken)
return { kind: 'done', prUrl }
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `bun test tests/session/manager.test.ts`
Expected: PASS (all tests, including the pre-existing ones).

- [ ] **Step 6: Commit**

```bash
git add src/session/manager.ts src/session/helpers.ts tests/session/manager.test.ts
git commit -m "feat(session): skip duplicate PR creation when prUrl is inherited"
```

---

## Task 5: `followUpSession` in the manager (magi)

**Files:**

- Modify: `src/session/manager.ts`
- Test: `tests/session/manager.test.ts`

- [ ] **Step 1: Add the failing tests**

In `tests/session/manager.test.ts`:

```ts
test('followUpSession refuses when the parent is unknown or still active', async () => {
  const manager = makeManager()
  expect(manager.followUpSession('nope', { parentSessionId: 'nope', prompt: 'x' })).toBeNull()
  const active = manager.startSession({ projectSpec: demoSpec(), agent: 'stub', contextId: 'c', prompt: 'p' })
  // Immediately (still queued/preparing/running) → refused.
  expect(manager.followUpSession(active.id, { parentSessionId: active.id, prompt: 'more' })).toBeNull()
  await pollTerminal(manager, active.id)
})

test('followUpSession creates a child that reuses branch + prUrl and injects prior context', async () => {
  const store = new SessionStore(new Database(':memory:'))
  const ws = new FakeWorkspace()
  ws.dirty = true
  const seenPrompts: string[] = []
  const runtime = new StubRuntime({ reply: 'done', onPrompt: (p: string) => seenPrompts.push(p) })
  const manager = new SessionManager(
    store,
    runtime,
    ws,
    new PermissionEngine({}),
    demoDefaults(),
    stubForgeProvider,
    new NoopNotifier(),
  )
  const parent = manager.startSession({
    projectSpec: demoSpec(),
    agent: 'stub',
    contextId: 'c',
    prompt: 'first task',
    forgeToken: 'tok',
  })
  expect(await pollTerminal(manager, parent.id)).toBe('done')
  const parentPr = manager.getSession(parent.id)!.prUrl
  const parentBranch = manager.getSession(parent.id)!.branch
  const child = manager.followUpSession(parent.id, {
    parentSessionId: parent.id,
    prompt: 'second task',
    forgeToken: 'tok',
  })
  expect(child).not.toBeNull()
  expect(child!.parentSessionId).toBe(parent.id)
  expect(child!.prUrl).toBe(parentPr)
  expect(await pollTerminal(manager, child!.id)).toBe('done')
  const doneChild = manager.getSession(child!.id)!
  expect(doneChild.branch).toBe(parentBranch) // pushed the same branch
  const followUpPrompt = seenPrompts[seenPrompts.length - 1]
  expect(followUpPrompt).toContain('first task')
  expect(followUpPrompt).toContain('second task')
})
```

> `StubRuntime`'s `onPrompt` callback: if it doesn't exist yet, add an optional `onPrompt?: (prompt: string) => void` to `StubRuntime`'s options and invoke it where the stub receives the prompt (in `src/runtime/stub/stub-runtime.ts` / the stub agent). If wiring a prompt callback is impractical, assert the child's stored `prompt` instead: the child row stores the raw new prompt, so also expose the composed prompt by asserting on a captured value from a recording runtime as done in the existing `startSession forwards secrets` test.

- [ ] **Step 2: Run it and confirm failure**

Run: `bun test tests/session/manager.test.ts`
Expected: FAIL — `manager.followUpSession` is not a function.

- [ ] **Step 3: Thread a continue-branch through `runLifecycle` (`src/session/manager.ts`)**

Change the `runLifecycle` signature and the prepare line. New signature:

```ts
  private async runLifecycle(
    id: string,
    input: StartSessionInput,
    project: ProjectConfig,
    signal: AbortSignal,
    continueBranch: string | null = null,
  ): Promise<void> {
```

Replace the existing `prepared = await this.workspace.prepare(...)` line with:

```ts
prepared =
  continueBranch === null
    ? await this.workspace.prepare(id, project, authFrom(project, input.forgeToken))
    : await this.workspace.prepareContinue(id, project, continueBranch, authFrom(project, input.forgeToken))
```

- [ ] **Step 4: Implement `followUpSession` (`src/session/manager.ts`)**

Add `FollowUpSessionInput` and `CONTINUABLE` to the import from `./state.js`, and `buildFollowUpPrompt` to the import from `./helpers.js`. Then add this method (after `startSession`):

```ts
  followUpSession(parentId: string, input: FollowUpSessionInput): Session | null {
    const parent = this.store.get(parentId)
    if (parent === null || parent.branch === null || parent.projectSpec === null) {
      logger.warn({ parentId }, 'follow-up refused: parent missing, unbranched, or specless')
      return null
    }
    if (!CONTINUABLE.has(parent.status)) {
      logger.warn({ parentId, status: parent.status }, 'follow-up refused: parent still active')
      return null
    }
    const id = newId()
    const project = buildEphemeralProject(parent.projectSpec, this.defaults)
    this.store.create({
      id,
      project: parent.project,
      agent: parent.agent,
      contextId: parent.contextId,
      prompt: input.prompt,
      cwd: '',
      projectSpec: parent.projectSpec,
      parentSessionId: parentId,
    })
    if (parent.prUrl !== null) {
      this.store.setPrUrl(id, parent.prUrl)
    }
    const startInput: StartSessionInput = {
      projectSpec: parent.projectSpec,
      agent: parent.agent,
      contextId: parent.contextId,
      prompt: buildFollowUpPrompt(parent, input.prompt),
      secrets: input.secrets,
      forgeToken: input.forgeToken,
    }
    const abort = new AbortController()
    const done = this.runLifecycle(id, startInput, project, abort.signal, parent.branch)
    this.running.set(id, { abort, done })
    void done.finally((): void => {
      this.running.delete(id)
    })
    return this.store.get(id)
  }
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `bun test tests/session/manager.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `bun run typecheck`
Expected: no errors.

```bash
git add src/session/manager.ts src/runtime/stub/stub-runtime.ts tests/session/manager.test.ts
git commit -m "feat(session): add followUpSession reusing parent branch/PR"
```

---

## Task 6: Router `POST /sessions/:id/follow-up` (magi)

**Files:**

- Modify: `src/server/router.ts`
- Test: `tests/server/router.test.ts`

- [ ] **Step 1: Add the failing test**

In `tests/server/router.test.ts`, following the file's existing handler-construction pattern (it builds `createFetchHandler(deps)` with a fake/real `SessionManager`), add:

```ts
test('POST /sessions/:id/follow-up starts a child session', async () => {
  const { handler, manager } = makeHandler() // existing helper in this file
  const parent = manager.startSession({ projectSpec: demoSpec(), agent: 'stub', contextId: 'ctx', prompt: 'p' })
  // Drive the parent to a continuable state first (reuse the file's poll helper if present).
  await waitForContinuable(manager, parent.id)
  const res = await handler(
    new Request('http://x/sessions/' + parent.id + '/follow-up', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + TEST_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'keep going', forgeToken: 'tok' }),
    }),
  )
  expect(res.status).toBe(202)
  const body = (await res.json()) as { id: string; status: string; parentSessionId: string }
  expect(body.parentSessionId).toBe(parent.id)
  expect(body.id).not.toBe(parent.id)
})

test('POST /sessions/:id/follow-up 400s without a prompt', async () => {
  const { handler, manager } = makeHandler()
  const parent = manager.startSession({ projectSpec: demoSpec(), agent: 'stub', contextId: 'ctx', prompt: 'p' })
  await waitForContinuable(manager, parent.id)
  const res = await handler(
    new Request('http://x/sessions/' + parent.id + '/follow-up', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + TEST_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ forgeToken: 'tok' }),
    }),
  )
  expect(res.status).toBe(400)
})
```

> Use the existing token constant, `makeHandler`, `demoSpec`, and any poll helper already in `tests/server/router.test.ts`. If there is no continuable-wait helper, poll `manager.getSession(id)` until `status` is one of `waiting_input|done|failed` (the router itself doesn't require it, but a real child run needs a branch on the parent).

- [ ] **Step 2: Run it and confirm failure**

Run: `bun test tests/server/router.test.ts`
Expected: FAIL — follow-up returns 404 (route not handled).

- [ ] **Step 3: Handle the route in `handleSessionScoped` (`src/server/router.ts`)**

Add the `validateRepoSpec` import if not present (from `../project/config.js` — it re-exports; if `validateRepoSpec` lives in `../project/spec-validation.js`, import from there). Add this block inside `handleSessionScoped`, before the final `return json({ error: 'not found' }, 404)`:

```ts
if (request.method === 'POST' && action === 'follow-up') {
  const parent = deps.manager.getSession(id)
  if (parent === null) {
    return json({ error: 'not found' }, 404)
  }
  const body = await readBody(request)
  const prompt = asString(body['prompt'])
  if (prompt === null) {
    return json({ error: 'prompt is required' }, 400)
  }
  if (!deps.rateLimiter.check(parent.contextId)) {
    return json({ error: 'rate limit exceeded; try again later' }, 429)
  }
  if (parent.projectSpec === null) {
    return json({ error: 'parent session has no projectSpec' }, 409)
  }
  try {
    validateRepoSpec(parent.projectSpec, deps.policy)
  } catch (error: unknown) {
    return json({ error: error instanceof Error ? error.message : 'invalid projectSpec' }, 400)
  }
  const child = deps.manager.followUpSession(id, {
    parentSessionId: id,
    prompt,
    secrets: asStringRecord(body['secrets']),
    forgeToken: asString(body['forgeToken']) ?? undefined,
  })
  if (child === null) {
    return json({ error: 'parent session cannot be continued (still active or unbranched)' }, 409)
  }
  return json({ id: child.id, status: child.status, parentSessionId: child.parentSessionId }, 202)
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test tests/server/router.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full magi test run, commit**

Run: `bun run typecheck && bun test`
Expected: all pass.

```bash
git add src/server/router.ts tests/server/router.test.ts
git commit -m "feat(server): add POST /sessions/:id/follow-up route"
```

---

## Task 7: Plugin history index (papai)

**Files:**

- Create: `plugins/acp/history.ts`
- Test: `tests/plugins/acp/history.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/acp/history.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { deriveTitle, parsePrNumber, readRecord, writeRecord } from '../../../plugins/acp/history.js'

function fakeKv() {
  const store = new Map<string, string>()
  return {
    store,
    get: (k: string) => store.get(k),
    set: (k: string, v: string) => {
      store.set(k, v)
    },
    delete: (k: string) => {
      store.delete(k)
    },
    list: (prefix?: string) =>
      Array.from(store.entries())
        .filter(([k]) => prefix === undefined || k.startsWith(prefix))
        .map(([key, value]) => ({ key, value })),
  }
}

describe('acp history index', () => {
  test('writes and reads a session record', () => {
    const kv = fakeKv()
    writeRecord(kv, 's1', { project: 'demo', title: 'add health check', createdAt: '2026-07-01T00:00:00.000Z' })
    expect(kv.store.get('session:s1')).toContain('"project":"demo"')
    const rec = readRecord(kv, 's1')
    expect(rec).not.toBeNull()
    expect(rec!.project).toBe('demo')
    expect(rec!.title).toBe('add health check')
  })

  test('readRecord tolerates the legacy "1" marker', () => {
    const kv = fakeKv()
    kv.set('session:old', '1')
    expect(readRecord(kv, 'old')).toBeNull()
  })

  test('parsePrNumber handles GitHub and GitLab URLs', () => {
    expect(parsePrNumber('https://github.com/a/b/pull/42')).toBe(42)
    expect(parsePrNumber('https://gitlab.com/a/b/-/merge_requests/7')).toBe(7)
    expect(parsePrNumber('https://example.com/nope')).toBeUndefined()
    expect(parsePrNumber(undefined)).toBeUndefined()
  })

  test('deriveTitle takes a trimmed first line', () => {
    expect(deriveTitle('  Fix the build\nand more')).toBe('Fix the build')
    expect(deriveTitle('')).toBe('coding session')
  })
})
```

- [ ] **Step 2: Run it and confirm failure**

Run: `bun test tests/plugins/acp/history.test.ts`
Expected: FAIL — `plugins/acp/history.js` does not exist.

- [ ] **Step 3: Create `plugins/acp/history.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type KvStore = {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
  list(prefix?: string): Array<{ key: string; value: string }>
}

export type SessionRecord = {
  project: string
  title: string
  createdAt: string
  parentSessionId?: string
  prNumber?: number
  prUrl?: string
  status?: string
}

const KEY_PREFIX = 'session:'

export function deriveTitle(prompt: string): string {
  const firstLine = prompt.split('\n').find((line): boolean => line.trim().length > 0)
  const title = firstLine === undefined ? '' : firstLine.trim()
  if (title.length === 0) return 'coding session'
  return title.length <= 120 ? title : `${title.slice(0, 119)}…`
}

export function parsePrNumber(prUrl: string | undefined): number | undefined {
  if (prUrl === undefined) return undefined
  const match = /(?:\/pull\/|\/merge_requests\/)(\d+)/u.exec(prUrl)
  if (match === null) return undefined
  const n = Number.parseInt(match[1] ?? '', 10)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

export function writeRecord(kv: KvStore, sessionId: string, record: SessionRecord): void {
  kv.set(`${KEY_PREFIX}${sessionId}`, JSON.stringify(record))
}

export function readRecord(kv: KvStore, sessionId: string): SessionRecord | null {
  const raw = kv.get(`${KEY_PREFIX}${sessionId}`)
  if (raw === undefined || raw === '1') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const rec = parsed as Partial<SessionRecord>
    if (typeof rec.project !== 'string' || typeof rec.title !== 'string' || typeof rec.createdAt !== 'string')
      return null
    return rec as SessionRecord
  } catch {
    return null
  }
}

export function listRecords(kv: KvStore): Array<{ id: string; record: SessionRecord }> {
  const out: Array<{ id: string; record: SessionRecord }> = []
  for (const row of kv.list(KEY_PREFIX)) {
    const id = row.key.slice(KEY_PREFIX.length)
    const record = readRecord(kv, id)
    if (record !== null) out.push({ id, record })
  }
  return out
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test tests/plugins/acp/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/acp/history.ts tests/plugins/acp/history.test.ts
git commit -m "feat(acp): thin chat-scoped session history index"
```

---

## Task 8: `continue_session` tool (papai)

**Files:**

- Modify: `plugins/acp/schemas.ts`
- Create: `plugins/acp/continue-tool.ts`
- Modify: `plugins/acp/index.ts`
- Test: `tests/plugins/acp/continue-session.test.ts`

- [ ] **Step 1: Add the schema**

In `plugins/acp/schemas.ts`, add:

```ts
export const continueSessionSchema = {
  type: 'object',
  properties: {
    sessionId: { type: 'string', description: 'A prior session id to continue.' },
    prNumber: { type: 'integer', description: 'A prior PR/MR number to continue (with project).' },
    project: { type: 'string', description: 'Project name (required when using prNumber).' },
    prompt: { type: 'string', description: 'What to do next on the existing branch/PR.' },
  },
  required: ['prompt'],
  additionalProperties: false,
} as const
```

- [ ] **Step 2: Write the failing test**

Create `tests/plugins/acp/continue-session.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { writeRecord } from '../../../plugins/acp/history.js'
import { activate, jsonResponse, options, runtimeCtxWithKv } from './support.js'

type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>

describe('acp continue_session tool', () => {
  test('continues by sessionId: POSTs follow-up and records the child', async () => {
    const calls: string[] = []
    const httpFetch: HttpFetch = (url, _init) => {
      calls.push(url)
      if (url.endsWith('/sessions/p1/follow-up'))
        return Promise.resolve(jsonResponse({ id: 'c1', status: 'queued', parentSessionId: 'p1' }, 202))
      return Promise.resolve(jsonResponse({ error: 'unexpected' }, 500))
    }
    const store = new Map<string, string>()
    const kv = runtimeCtxWithKv(store).kv
    writeRecord(kv, 'p1', {
      project: 'demo',
      title: 'first',
      createdAt: '2026-07-01T00:00:00.000Z',
      prUrl: 'https://github.com/a/b/pull/5',
    })
    const { tools } = activate(httpFetch)
    const tool = tools.get('continue_session')!
    const res = (await tool.execute({ sessionId: 'p1', prompt: 'fix tests' }, runtimeCtxWithKv(store), options())) as {
      id?: string
    }
    expect(res.id).toBe('c1')
    expect(calls.some((u) => u.endsWith('/sessions/p1/follow-up'))).toBe(true)
    // child recorded, linked to parent, inheriting the PR
    const child = JSON.parse(store.get('session:c1') ?? '{}')
    expect(child.parentSessionId).toBe('p1')
    expect(child.prUrl).toBe('https://github.com/a/b/pull/5')
  })

  test('refuses not_configured when the forge token is missing', async () => {
    const httpFetch: HttpFetch = () => Promise.resolve(jsonResponse({}, 200))
    const store = new Map<string, string>()
    writeRecord(runtimeCtxWithKv(store).kv, 'p1', { project: 'demo', title: 't', createdAt: 'x' })
    const { tools } = activate(httpFetch)
    const ctx = runtimeCtxWithKv(store)
    // Override forge token to null.
    ;(ctx.codingSecrets as { resolveForgeToken: () => string | null }).resolveForgeToken = () => null
    const res = (await tools.get('continue_session')!.execute({ sessionId: 'p1', prompt: 'x' }, ctx, options())) as {
      error?: string
    }
    expect(res.error).toBe('not_configured')
  })

  test('resolves a prNumber to a known session id via the done list', async () => {
    const httpFetch: HttpFetch = (url, _init) => {
      if (url.includes('/sessions?filter=done'))
        return Promise.resolve(
          jsonResponse([{ id: 'p9', project: 'demo', prUrl: 'https://github.com/a/b/pull/42', status: 'done' }], 200),
        )
      if (url.endsWith('/sessions/p9/follow-up'))
        return Promise.resolve(jsonResponse({ id: 'c9', status: 'queued', parentSessionId: 'p9' }, 202))
      return Promise.resolve(jsonResponse({ error: 'unexpected' }, 500))
    }
    const store = new Map<string, string>()
    writeRecord(runtimeCtxWithKv(store).kv, 'p9', { project: 'demo', title: 't', createdAt: 'x' })
    const { tools } = activate(httpFetch)
    const res = (await tools
      .get('continue_session')!
      .execute({ prNumber: 42, project: 'demo', prompt: 'go' }, runtimeCtxWithKv(store), options())) as { id?: string }
    expect(res.id).toBe('c9')
  })
})
```

- [ ] **Step 3: Run it and confirm failure**

Run: `bun test tests/plugins/acp/continue-session.test.ts`
Expected: FAIL — no `continue_session` tool registered.

- [ ] **Step 4: Implement `plugins/acp/continue-tool.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  asObject,
  asPositiveInt,
  asString,
  callMagi,
  NOT_CONFIGURED,
  optionalString,
  readMagiConfig,
} from './client.js'
import type { HttpFetch } from './client.js'
import { deriveTitle, parsePrNumber, readRecord, writeRecord } from './history.js'
import { continueSessionSchema } from './schemas.js'
import type { RuntimeContext, Tool } from './tools.js'
import { sessionIdOf } from './tools.js'

// Find a locally-known parent session id for a PR number by asking magi for the
// done list and matching on prUrl (scoped to sessions this chat started).
async function resolveByPr(
  httpFetch: HttpFetch,
  cfg: { baseUrl: string; token: string },
  runtimeContext: RuntimeContext,
  prNumber: number,
  project: string | undefined,
): Promise<string | null> {
  const result = await callMagi(httpFetch, cfg, 'GET', '/sessions?filter=done')
  if (!Array.isArray(result)) return null
  for (const row of result) {
    const obj = asObject(row)
    const id = asString(obj, 'id')
    if (id === null || readRecord(runtimeContext.kv, id) === null) continue
    const prUrl = optionalString(obj, 'prUrl')
    if (parsePrNumber(prUrl) !== prNumber) continue
    if (project !== undefined && optionalString(obj, 'project') !== project) continue
    return id
  }
  return null
}

export function continueSessionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'continue_session',
    description:
      'Continue a prior coding session on its existing branch/PR with a new prompt. Identify the target by ' +
      'sessionId, or by prNumber (+project). Updates the existing PR instead of opening a new one.',
    inputSchema: continueSessionSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const prompt = asString(args, 'prompt')
      if (prompt === null) return { error: 'invalid_input', message: 'prompt is required' }

      // Credentials: a follow-up must push to the existing branch.
      const secrets = runtimeContext.codingSecrets.resolve()
      if (secrets === null)
        return {
          error: 'not_configured',
          message:
            "You haven't set up your coding credentials. DM me and open settings → Coding sessions to configure your AI provider key (and code host).",
        }
      const forgeToken = runtimeContext.codingSecrets.resolveForgeToken()
      if (forgeToken === null)
        return {
          error: 'not_configured',
          message: 'Connect a code host in settings → Coding sessions before continuing a session.',
        }

      // Resolve the target to a parent session id.
      let parentId = asString(args, 'sessionId')
      const prNumber = asPositiveInt(args, 'prNumber')
      const project = optionalString(args, 'project')
      if (parentId === null && prNumber !== null) {
        parentId = await resolveByPr(httpFetch, cfg, runtimeContext, prNumber, project)
      }
      if (parentId === null)
        return {
          error: 'not_found',
          message: 'Could not find a prior session to continue. Provide a sessionId or a known PR number.',
        }
      const parentRecord = readRecord(runtimeContext.kv, parentId)
      if (parentRecord === null)
        return { error: 'not_found', message: `Session "${parentId}" is not one this chat started.` }

      const result = await callMagi(httpFetch, cfg, 'POST', `/sessions/${encodeURIComponent(parentId)}/follow-up`, {
        prompt,
        secrets,
        forgeToken,
      })
      const childId = sessionIdOf(result)
      if (childId !== null) {
        writeRecord(runtimeContext.kv, childId, {
          project: parentRecord.project,
          title: deriveTitle(prompt),
          createdAt: new Date().toISOString(),
          parentSessionId: parentId,
          ...(parentRecord.prNumber === undefined ? {} : { prNumber: parentRecord.prNumber }),
          ...(parentRecord.prUrl === undefined ? {} : { prUrl: parentRecord.prUrl }),
        })
      }
      return result
    },
  }
}
```

- [ ] **Step 5: Register it in `plugins/acp/index.ts`**

Add the import:

```ts
import { continueSessionTool } from './continue-tool.js'
```

In `activate`, register after `reviewPrTool`:

```ts
ctx.registerTool(continueSessionTool(ctx.httpFetch))
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `bun test tests/plugins/acp/continue-session.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `bun run typecheck`
Expected: no errors.

```bash
git add plugins/acp/schemas.ts plugins/acp/continue-tool.ts plugins/acp/index.ts tests/plugins/acp/continue-session.test.ts
git commit -m "feat(acp): continue_session tool for follow-up requests"
```

---

## Task 9: Record history on start/review + enrich list_sessions (papai)

**Files:**

- Modify: `plugins/acp/session-tools.ts`
- Modify: `plugins/acp/index.ts`
- Test: `tests/plugins/acp/list-status.test.ts`, `tests/plugins/acp/start-session.test.ts`

- [ ] **Step 1: Add the failing tests**

In `tests/plugins/acp/start-session.test.ts`, add a test asserting a rich record is written (replace the prior `'1'` expectation if one exists):

```ts
test('start_session writes a rich history record', async () => {
  const httpFetch: HttpFetch = () => Promise.resolve(jsonResponse({ id: 's-7', status: 'queued' }, 202))
  const store = new Map<string, string>()
  const { tools } = activate(httpFetch)
  await tools
    .get('start_session')!
    .execute({ project: 'demo', prompt: 'Add a health check\nmore detail' }, runtimeCtxWithKv(store), options())
  const rec = JSON.parse(store.get('session:s-7') ?? '{}')
  expect(rec.project).toBe('demo')
  expect(rec.title).toBe('Add a health check')
})
```

In `tests/plugins/acp/list-status.test.ts`, add:

```ts
test('list_sessions merges local title and prNumber into magi rows', async () => {
  const httpFetch: HttpFetch = (url) => {
    if (url.includes('/sessions?filter=done'))
      return Promise.resolve(
        jsonResponse([{ id: 's-7', project: 'demo', status: 'done', prUrl: 'https://github.com/a/b/pull/12' }], 200),
      )
    return Promise.resolve(jsonResponse([], 200))
  }
  const store = new Map<string, string>()
  const kv = runtimeCtxWithKv(store).kv
  kv.set('session:s-7', JSON.stringify({ project: 'demo', title: 'Add a health check', createdAt: 'x' }))
  const { tools } = activate(httpFetch)
  const out = (await tools
    .get('list_sessions')!
    .execute({ filter: 'done' }, runtimeCtxWithKv(store), options())) as Array<Record<string, unknown>>
  expect(out).toHaveLength(1)
  expect(out[0]!.title).toBe('Add a health check')
  expect(out[0]!.prNumber).toBe(12)
  // and the local record is refreshed with the discovered prUrl/prNumber
  const refreshed = JSON.parse(store.get('session:s-7') ?? '{}')
  expect(refreshed.prNumber).toBe(12)
})
```

- [ ] **Step 2: Run them and confirm failure**

Run: `bun test tests/plugins/acp/start-session.test.ts tests/plugins/acp/list-status.test.ts`
Expected: FAIL — records are still `'1'`; list rows lack `title`/`prNumber`.

- [ ] **Step 3: Write records on start/review in `plugins/acp/session-tools.ts`**

Add imports at the top:

```ts
import { deriveTitle, parsePrNumber, readRecord, writeRecord } from './history.js'
```

In `startSessionTool`, replace `if (id !== null) runtimeContext.kv.set(`session:${id}`, '1')` with:

```ts
if (id !== null)
  writeRecord(runtimeContext.kv, id, {
    project,
    title: deriveTitle(prompt),
    createdAt: new Date().toISOString(),
  })
```

In `reviewPrTool`, replace `if (id !== null) runtimeContext.kv.set(`session:${id}`, '1')` with:

```ts
if (id !== null)
  writeRecord(runtimeContext.kv, id, {
    project,
    title: `review PR #${prNumber}`,
    createdAt: new Date().toISOString(),
    prNumber,
  })
```

- [ ] **Step 4: Enrich `listSessionsTool` in `plugins/acp/session-tools.ts`**

Replace the filtered return in `listSessionsTool` with a version that merges local records and refreshes them:

```ts
const known = new Set(runtimeContext.kv.list('session:').map((row): string => row.key.slice('session:'.length)))
return result
  .filter((s): boolean => {
    const sid = sessionIdOf(s)
    return sid !== null && known.has(sid)
  })
  .map((s): unknown => {
    const sid = sessionIdOf(s)
    if (sid === null) return s
    const row = asObject(s)
    const prUrl = optionalString(row, 'prUrl')
    const prNumber = parsePrNumber(prUrl)
    const record = readRecord(runtimeContext.kv, sid)
    if (record !== null) {
      writeRecord(runtimeContext.kv, sid, {
        ...record,
        status: optionalString(row, 'status') ?? record.status,
        ...(prUrl === undefined ? {} : { prUrl }),
        ...(prNumber === undefined ? {} : { prNumber }),
      })
    }
    return {
      ...row,
      ...(record === null ? {} : { title: record.title, parentSessionId: record.parentSessionId }),
      ...(prNumber === undefined ? {} : { prNumber }),
    }
  })
```

> `asObject` and `optionalString` are already imported in `session-tools.ts`.

- [ ] **Step 5: Update the prompt fragment + `/acp` text in `plugins/acp/index.ts`**

Extend `ACP_PROMPT_FRAGMENT` (append before the closing sentence):

```ts
  'continue_session(sessionId|prNumber, prompt) to keep working on a prior session\'s branch/PR (updates ' +
  'the existing PR). ' +
```

Extend `ACP_COMMAND_TEXT` examples to include:

```ts
' or "continue PR 42 on demo and fix the failing tests".'
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `bun test tests/plugins/acp/start-session.test.ts tests/plugins/acp/list-status.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `bun run typecheck`
Expected: no errors.

```bash
git add plugins/acp/session-tools.ts plugins/acp/index.ts tests/plugins/acp/start-session.test.ts tests/plugins/acp/list-status.test.ts
git commit -m "feat(acp): record history on start/review and enrich list_sessions"
```

---

## Task 10: Gate `continue_session` under the whoMayUse guardrail (papai)

**Files:**

- Modify: `src/llm-orchestrator-tools.ts`
- Test: the existing `applyWhoMayUseFilter` test suite (find it near `src/llm-orchestrator-tools.ts`)

- [ ] **Step 1: Locate the existing test**

Run: `rg -l "applyWhoMayUseFilter" tests`
Expected: a test file exercising the filter. Open it.

- [ ] **Step 2: Add the failing test**

Add a case asserting the new tool is removed for a non-allowlisted actor (mirror an existing `start_session` case in that suite):

```ts
test('applyWhoMayUseFilter strips continue_session for non-allowlisted actors', () => {
  const tools = { plugin_acp__continue_session: {}, plugin_acp__list_sessions: {} } as unknown as ToolSet
  const filtered = applyWhoMayUseFilter(tools, ['someone-else'], 'me')
  expect('plugin_acp__continue_session' in filtered).toBe(false)
  expect('plugin_acp__list_sessions' in filtered).toBe(true)
})
```

- [ ] **Step 3: Run it and confirm failure**

Run: `bun test <that test file>`
Expected: FAIL — `continue_session` survives the filter.

- [ ] **Step 4: Add the tool to the gated set in `src/llm-orchestrator-tools.ts`**

In `ACP_SESSION_ACTION_TOOLS`, add the entry:

```ts
  'plugin_acp__continue_session',
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `bun test <that test file>`
Expected: PASS.

- [ ] **Step 6: Typecheck, full papai check, commit**

Run: `bun run typecheck`
Expected: no errors.

```bash
git add src/llm-orchestrator-tools.ts tests/<that test file>
git commit -m "feat(acp): gate continue_session behind the whoMayUse guardrail"
```

---

## Task 11: Docs + final verification (papai + magi)

**Files:**

- Modify: `docs/architecture/coding-sessions.md` (papai)

- [ ] **Step 1: Document the feature**

Add a short section to `docs/architecture/coding-sessions.md` describing: the `continue_session` tool, the thin `plugin_kv` history record (`session:<id>` now JSON), the magi `POST /sessions/:id/follow-up` endpoint (reuses branch + `projectSpec` + `prUrl`, injects prior context, skips duplicate PR), the required forge token, and the documented limitations (merged/closed PR not detected; arbitrary non-papai PRs and CI-status auto-fetch are future work).

- [ ] **Step 2: Run both test suites + formatters**

In magi (`~/Projects/yourpapai/magi`): `bun run typecheck && bun test && bun run format`
In papai (`~/Projects/yourpapai/papai`): `bun run typecheck && bun test tests/plugins/acp && bun run format`
Expected: all green.

- [ ] **Step 3: Commit docs (papai)**

```bash
git add docs/architecture/coding-sessions.md
git commit -m "docs(coding-sessions): document follow-up coding sessions"
```

---

## Self-Review Notes

**Spec coverage** — every spec section maps to a task:

- Session model (`parentSessionId`, `FollowUpSessionInput`) → Task 1.
- `buildFollowUpPrompt` prior-context injection → Task 2.
- `prepareContinue` (checkout existing branch, push same branch) → Task 3.
- PR reuse guard (skip `openPullRequest` when `prUrl` set) → Task 4.
- `followUpSession` (state guards, inherit branch/prUrl, continue-branch through lifecycle) → Task 5.
- `POST /sessions/:id/follow-up` (auth, rate-limit by parent context, `validateRepoSpec` re-check) → Task 6.
- Thin `plugin_kv` history index → Task 7.
- `continue_session` tool (sessionId + prNumber resolution, not_configured guards) → Task 8.
- Record on start/review + `list_sessions` enrichment + prompt fragment/command text → Task 9.
- Phase-5a `whoMayUse` gating → Task 10.
- Docs + future-work limitations → Task 11.

**Type consistency** — `SessionRecord`, `FollowUpSessionInput`, `CONTINUABLE`, `prepareContinue`, `followUpSession`, `buildFollowUpPrompt`, `writeRecord`/`readRecord`/`parsePrNumber`/`deriveTitle`/`listRecords` are named identically across the tasks that define and consume them. The plugin's `RuntimeContext.kv` structural type matches `history.ts`'s `KvStore`.

**Deferred (per spec, intentionally not built)** — forge `getPullRequest`-based resolution of arbitrary non-papai PRs; auto-fetch of CI/check status; detection of merged/closed PRs.
