# DRY Duplicate Test Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate clone pairs detected by `jscpd` across the test suite by extracting shared fixtures, factories, and utility modules.

**Architecture:**

1. Extract shared test data factories into `tests/utils/factories.ts`.
2. Extract shared YouTrack fetch mock setup into `tests/providers/youtrack/fetch-mock-utils.ts`.
3. Extract shared review-loop config factory into `tests/review-loop/test-helpers.ts`.
4. Extract shared chat context renderer fixture into `tests/chat/fixtures/context-snapshot.ts`.
5. Extract a minimal `TaskProvider` stub helper into `tests/utils/factories.ts`.
6. Extract shared identity test setup into `tests/tools/test-helpers.ts`.

**Tech Stack:** Bun test runner, TypeScript, `bun:test` mocking, Zod, `jscpd` for verification.

---

## File Structure

| File                                           | Responsibility                                                                                                                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/utils/factories.ts`                     | Shared mock data factories (`createMockKaneoTaskResponse`, `createMinimalTaskProviderStub`, `createReviewLoopConfigFixture`)                                                                                                            |
| `tests/providers/youtrack/fetch-mock-utils.ts` | Shared YouTrack fetch mock helpers (`installFetchMock`, `mockFetchResponse`, `mockFetchSequence`, `mockFetchError`, `mockFetchNoContent`, `FetchCallSchema`, `BodySchema`, `getLastFetchUrl`, `getLastFetchBody`, `getLastFetchMethod`) |
| `tests/chat/fixtures/context-snapshot.ts`      | Shared `ContextSnapshot` test fixture used across renderer tests                                                                                                                                                                        |
| `tests/review-loop/test-helpers.ts`            | Review-loop specific test utilities (`makeTempDir`, `createReviewLoopConfigFixture`)                                                                                                                                                    |
| `tests/tools/test-helpers.ts`                  | Shared minimal `TaskProvider` stub for identity tool tests                                                                                                                                                                              |
| Modified test files                            | Import from new helpers instead of defining inline duplicates                                                                                                                                                                           |

---

## Task 1: Create Shared ContextSnapshot Fixture

**Files:**

- Create: `tests/chat/fixtures/context-snapshot.ts`
- Modify: `tests/chat/telegram/context-renderer.test.ts`
- Modify: `tests/chat/mattermost/context-renderer.test.ts`
- Modify: `tests/chat/discord/context-renderer.test.ts`
- Test: `bun test tests/chat/telegram/context-renderer.test.ts tests/chat/mattermost/context-renderer.test.ts tests/chat/discord/context-renderer.test.ts`

- [ ] **Step 1: Write the fixture file**

  ```typescript
  import type { ContextSnapshot } from '../../src/chat/types.js'

  export const standardContextSnapshot: ContextSnapshot = {
    modelName: 'gpt-4o',
    totalTokens: 6_770,
    maxTokens: 128_000,
    approximate: false,
    sections: [
      {
        label: 'System prompt',
        tokens: 820,
        children: [
          { label: 'Base instructions', tokens: 650 },
          { label: 'Custom instructions', tokens: 120 },
          { label: 'Provider addendum', tokens: 50 },
        ],
      },
      {
        label: 'Memory context',
        tokens: 350,
        children: [
          { label: 'Summary', tokens: 180 },
          { label: 'Known entities', tokens: 170, detail: '12 facts' },
        ],
      },
      { label: 'Conversation history', tokens: 2_400, detail: '34 messages' },
      { label: 'Tools', tokens: 3_200, detail: '18 active, gated by kaneo' },
    ],
  }
  ```

  Save as `tests/chat/fixtures/context-snapshot.ts`.

- [ ] **Step 2: Update each renderer test to import the fixture**

  In `tests/chat/telegram/context-renderer.test.ts`, replace lines 6-31 with:

  ```typescript
  import { standardContextSnapshot } from '../fixtures/context-snapshot.js'
  ```

  And replace all references to `snapshot` with `standardContextSnapshot`.

  Repeat identical changes in:
  - `tests/chat/mattermost/context-renderer.test.ts`
  - `tests/chat/discord/context-renderer.test.ts`

- [ ] **Step 3: Run the tests**

  ```bash
  bun test tests/chat/telegram/context-renderer.test.ts tests/chat/mattermost/context-renderer.test.ts tests/chat/discord/context-renderer.test.ts
  ```

  Expected: All 3 test suites pass.

- [ ] **Step 4: Commit**

  ```bash
  git add tests/chat/fixtures/context-snapshot.ts tests/chat/telegram/context-renderer.test.ts tests/chat/mattermost/context-renderer.test.ts tests/chat/discord/context-renderer.test.ts
  git commit -m "refactor(tests): extract shared ContextSnapshot fixture"
  ```

---

## Task 2: Create Shared TaskProvider Stub for Identity Tool Tests

**Files:**

- Modify: `tests/utils/factories.ts`
- Modify: `tests/tools/clear-my-identity.test.ts`
- Modify: `tests/tools/set-my-identity.test.ts`
- Test: `bun test tests/tools/clear-my-identity.test.ts tests/tools/set-my-identity.test.ts`

- [ ] **Step 1: Add factory to `tests/utils/factories.ts`**

  If the file does not exist, create it. Otherwise, append. Add:

  ```typescript
  import type { TaskProvider } from '../../src/providers/types.js'
  import { localDatetimeToUtc, utcToLocal } from '../../src/utils/datetime.js'

  export function createMinimalTaskProviderStub(overrides?: Partial<TaskProvider>): TaskProvider {
    return {
      name: 'mock',
      capabilities: new Set(),
      configRequirements: [],
      preferredUserIdentifier: 'id',
      buildTaskUrl: () => '',
      buildProjectUrl: () => '',
      classifyError: (e) => {
        throw e
      },
      getPromptAddendum: () => '',
      normalizeDueDateInput: (dueDate, timezone) =>
        dueDate === undefined ? undefined : localDatetimeToUtc(dueDate.date, dueDate.time, timezone),
      formatDueDateOutput: (dueDate, timezone) =>
        dueDate === undefined || dueDate === null ? dueDate : utcToLocal(dueDate, timezone),
      normalizeListTaskParams: (params) => ({ ...params }),
      createTask(): Promise<never> {
        throw new Error('not implemented')
      },
      getTask(): Promise<never> {
        throw new Error('not implemented')
      },
      updateTask(): Promise<never> {
        throw new Error('not implemented')
      },
      listTasks(): Promise<never> {
        throw new Error('not implemented')
      },
      searchTasks(): Promise<never> {
        throw new Error('not implemented')
      },
      ...overrides,
    }
  }
  ```

- [ ] **Step 2: Update `tests/tools/clear-my-identity.test.ts`**

  Remove lines 9-40 (the inline `mockProvider` declaration and imports for `localDatetimeToUtc`/`utcToLocal`), and add:

  ```typescript
  import { createMinimalTaskProviderStub } from '../utils/factories.js'
  ```

  Replace `mockProvider` usages with `createMinimalTaskProviderStub()`.

- [ ] **Step 3: Update `tests/tools/set-my-identity.test.ts`**

  Remove lines 9-48 (the inline `mockProvider` declaration and `localDatetimeToUtc`/`utcToLocal` imports), and add:

  ```typescript
  import { createMinimalTaskProviderStub } from '../utils/factories.js'
  ```

  Replace `mockProvider` usages with:

  ```typescript
  createMinimalTaskProviderStub({
    identityResolver: {
      searchUsers: mock((query: string) => {
        if (query === 'jsmith') {
          return Promise.resolve([{ id: 'user-123', login: 'jsmith', name: 'John Smith' }])
        }
        return Promise.resolve([])
      }),
    },
  })
  ```

- [ ] **Step 4: Run the tests**

  ```bash
  bun test tests/tools/clear-my-identity.test.ts tests/tools/set-my-identity.test.ts
  ```

  Expected: Both suites pass.

- [ ] **Step 5: Commit**

  ```bash
  git add tests/utils/factories.ts tests/tools/clear-my-identity.test.ts tests/tools/set-my-identity.test.ts
  git commit -m "refactor(tests): extract shared minimal TaskProvider stub"
  ```

---

## Task 3: Extract YouTrack Fetch Mock Utilities

**Files:**

- Create: `tests/providers/youtrack/fetch-mock-utils.ts`
- Modify: `tests/providers/youtrack/operations/attachments.test.ts`
- Modify: `tests/providers/youtrack/operations/collaboration.test.ts`
- Modify: `tests/providers/youtrack/operations/commands.test.ts`
- Modify: `tests/providers/youtrack/operations/projects.test.ts`
- Modify: `tests/providers/youtrack/operations/statuses.test.ts`
- Modify: `tests/providers/youtrack/operations/users.test.ts`
- Modify: `tests/providers/youtrack/operations/work-items.test.ts`
- Modify: `tests/providers/youtrack/operations/agiles.test.ts`
- Modify: `tests/providers/youtrack/operations/saved-queries.test.ts`
- Test: `bun test tests/providers/youtrack/operations/attachments.test.ts tests/providers/youtrack/operations/collaboration.test.ts tests/providers/youtrack/operations/statuses.test.ts tests/providers/youtrack/operations/users.test.ts tests/providers/youtrack/operations/work-items.test.ts tests/providers/youtrack/operations/agiles.test.ts tests/providers/youtrack/operations/saved-queries.test.ts`

- [ ] **Step 1: Create the shared utility file**

  ```typescript
  import { mock } from 'bun:test'
  import { z } from 'zod'

  import { setMockFetch } from '../../utils/test-helpers.js'

  export type FetchMockFn = ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>>

  export const defaultConfig = {
    baseUrl: 'https://test.youtrack.cloud',
    token: 'test-token',
  }

  export function installFetchMock(fetchMockRef: { current?: FetchMockFn }, handler: () => Promise<Response>): void {
    const mocked = mock<(url: string, init: RequestInit) => Promise<Response>>(handler)
    fetchMockRef.current = mocked
    setMockFetch((url: string, init: RequestInit) => mocked(url, init))
  }

  export function createJsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  }

  export function mockFetchResponse(fetchMockRef: { current?: FetchMockFn }, data: unknown, status = 200): void {
    installFetchMock(fetchMockRef, () => Promise.resolve(createJsonResponse(data, status)))
  }

  export function mockFetchSequence(
    fetchMockRef: { current?: FetchMockFn },
    responses: Array<{ data: unknown; status?: number }>,
  ): void {
    let callIndex = 0
    installFetchMock(fetchMockRef, () => {
      const response = responses[callIndex]
      callIndex++
      if (response === undefined) {
        return Promise.resolve(createJsonResponse({}, 200))
      }
      if (response.status === 204) {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(createJsonResponse(response.data, response.status ?? 200))
    })
  }

  export function mockFetchNoContent(fetchMockRef: { current?: FetchMockFn }): void {
    installFetchMock(fetchMockRef, () => Promise.resolve(new Response(null, { status: 204 })))
  }

  export function mockFetchError(
    fetchMockRef: { current?: FetchMockFn },
    status: number,
    body: unknown = { error: 'Something went wrong' },
  ): void {
    installFetchMock(fetchMockRef, () => Promise.resolve(createJsonResponse(body, status)))
  }

  export const FetchCallSchema = z.tuple([
    z.string(),
    z.looseObject({ method: z.string().optional(), body: z.string().optional() }),
  ])

  export const BodySchema = z.looseObject({})

  export function getLastFetchUrl(fetchMock: FetchMockFn | undefined): URL {
    const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls.at(-1))
    if (!parsed.success) return new URL('https://empty')
    return new URL(parsed.data[0])
  }

  export function getLastFetchBody(fetchMock: FetchMockFn | undefined): z.infer<typeof BodySchema> {
    const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls.at(-1))
    if (!parsed.success) return {}
    const { body } = parsed.data[1]
    if (body === undefined) return {}
    return BodySchema.parse(JSON.parse(body))
  }

  export function getLastFetchMethod(fetchMock: FetchMockFn | undefined): string {
    const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls.at(-1))
    if (!parsed.success) return ''
    return parsed.data[1].method ?? ''
  }

  export function getFetchUrlAt(fetchMock: FetchMockFn | undefined, index: number): URL {
    const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls[index])
    if (!parsed.success) return new URL('https://empty')
    return new URL(parsed.data[0])
  }

  export function getFetchBodyAt(fetchMock: FetchMockFn | undefined, index: number): z.infer<typeof BodySchema> {
    const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls[index])
    if (!parsed.success) return {}
    const { body } = parsed.data[1]
    if (body === undefined) return {}
    return BodySchema.parse(JSON.parse(body))
  }

  export function getFetchMethodAt(fetchMock: FetchMockFn | undefined, index: number): string {
    const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls[index])
    if (!parsed.success) return ''
    return parsed.data[1].method ?? ''
  }
  ```

  Save as `tests/providers/youtrack/fetch-mock-utils.ts`.

- [ ] **Step 2: Refactor each YouTrack operations test file**

  For **every** file listed in the Files section above:
  1. Remove the inline declarations of:
     - `installFetchMock`
     - `mockFetchResponse`
     - `mockFetchSequence`
     - `mockFetchError`
     - `mockFetchNoContent`
     - `FetchCallSchema`
     - `BodySchema`
     - `getLastFetchUrl`
     - `getLastFetchBody`
     - `getLastFetchMethod`
     - `getFetchUrlAt`
     - `getFetchBodyAt`
     - `getFetchMethodAt`
     - `createJsonResponse`
     - Any local `config` constant if it matches `defaultConfig`

  2. Add import:

     ```typescript
     import {
       defaultConfig as config,
       installFetchMock,
       mockFetchResponse,
       mockFetchSequence,
       mockFetchError,
       mockFetchNoContent,
       getLastFetchUrl,
       getLastFetchBody,
       getLastFetchMethod,
       getFetchUrlAt,
       getFetchBodyAt,
       getFetchMethodAt,
       type FetchMockFn,
     } from '../fetch-mock-utils.js'
     ```

     Import only what each file uses.

  3. Replace `let fetchMock: ...` with:

     ```typescript
     const fetchMock: { current?: FetchMockFn } = {}
     ```

  4. Replace all call sites:
     - `installFetchMock(...)` → `installFetchMock(fetchMock, ...)`
     - `mockFetchResponse(...)` → `mockFetchResponse(fetchMock, ...)` (if helper uses ref)
     - `mockFetchError(...)` → `mockFetchError(fetchMock, ...)` (if helper uses ref)
     - `fetchMock.mock.calls` → `fetchMock.current?.mock.calls`
     - Remove `fetchMock = undefined` in `afterEach`; `setMockFetch` is already reset by `restoreFetch()`.

  Since `jscpd` detected clones across these files, the refactor will be mechanical but must be done file-by-file.

- [ ] **Step 3: Run the full YouTrack operations test suite**

  ```bash
  bun test tests/providers/youtrack/operations/
  ```

  Expected: All suites pass.

- [ ] **Step 4: Commit**

  ```bash
  git add tests/providers/youtrack/fetch-mock-utils.ts tests/providers/youtrack/operations/*.test.ts
  git commit -m "refactor(tests): extract shared YouTrack fetch mock utilities"
  ```

---

## Task 4: Extract Review-Loop Config Fixture and Temp Dir Helpers

**Files:**

- Create: `tests/review-loop/test-helpers.ts`
- Modify: `tests/review-loop/cli.test.ts`
- Modify: `tests/review-loop/loop-controller.test.ts`
- Modify: `tests/review-loop/run-state.test.ts`
- Test: `bun test tests/review-loop/cli.test.ts tests/review-loop/loop-controller.test.ts tests/review-loop/run-state.test.ts`

- [ ] **Step 1: Create the shared helper file**

  ```typescript
  import { mkdtempSync, rmSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import path from 'node:path'

  import type { ReviewLoopConfig } from '../../review-loop/src/config.js'

  const tempDirs: string[] = []

  export function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  export function cleanupTempDirs(): void {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  export function createReviewLoopConfigFixture(
    repoRoot: string,
    overrides?: Partial<ReviewLoopConfig>,
  ): ReviewLoopConfig {
    return {
      repoRoot,
      workDir: path.join(repoRoot, '.review-loop'),
      maxRounds: 5,
      maxNoProgressRounds: 2,
      reviewer: {
        command: '/usr/local/bin/claude-acp-adapter',
        args: [],
        env: {},
        sessionConfig: {},
        invocationPrefix: '/review-code',
        requireInvocationPrefix: false,
      },
      fixer: {
        command: 'opencode',
        args: ['acp'],
        env: {},
        sessionConfig: {},
        verifyInvocationPrefix: '/verify-issue',
        fixInvocationPrefix: null,
        requireVerifyInvocation: false,
      },
      ...overrides,
    }
  }
  ```

  Save as `tests/review-loop/test-helpers.ts`.

- [ ] **Step 2: Update `tests/review-loop/cli.test.ts`**

  Remove inline `tempDirs`, `makeTempDir`, and the duplicated inline JSON config objects. Import from the new helper, and use `createReviewLoopConfigFixture` to produce the JSON written to disk.

- [ ] **Step 3: Update `tests/review-loop/loop-controller.test.ts`**

  Remove inline `tempDirs`, `makeTempDir`, and the inline `ReviewLoopConfig` object. Replace with `createReviewLoopConfigFixture(repoRoot, { maxRounds: 1, fixer: { ... } })`.

- [ ] **Step 4: Update `tests/review-loop/run-state.test.ts`**

  Remove inline `tempDirs`, `makeTempDir`, and the inline `ReviewLoopConfig` object. Replace with `createReviewLoopConfigFixture(repoRoot, { fixer: { ... } })`.

- [ ] **Step 5: Run the tests**

  ```bash
  bun test tests/review-loop/cli.test.ts tests/review-loop/loop-controller.test.ts tests/review-loop/run-state.test.ts
  ```

  Expected: All 3 suites pass.

- [ ] **Step 6: Commit**

  ```bash
  git add tests/review-loop/test-helpers.ts tests/review-loop/cli.test.ts tests/review-loop/loop-controller.test.ts tests/review-loop/run-state.test.ts
  git commit -m "refactor(tests): extract shared review-loop config fixture and temp-dir helpers"
  ```

---

## Task 5: Extract Shared Kakue Search Response Fixture

**Files:**

- Modify: `tests/utils/factories.ts`
- Modify: `tests/providers/kaneo/search-tasks.test.ts`
- Modify: `tests/providers/kaneo/operations/tasks.test.ts`
- Test: `bun test tests/providers/kaneo/search-tasks.test.ts tests/providers/kaneo/operations/tasks.test.ts`

- [ ] **Step 1: Add factory to `tests/utils/factories.ts`**

  Append:

  ```typescript
  export function createMockKaneoTaskSearchResponse(
    overrides?: Partial<Record<string, unknown>>,
  ): Record<string, unknown> {
    return {
      results: [
        {
          id: 'task-1',
          type: 'task',
          title: 'Task 1',
          taskNumber: 1,
          status: 'todo',
          priority: 'medium',
          projectId: 'proj-1',
          userId: 'user-123',
          createdAt: new Date().toISOString(),
          relevanceScore: 1,
        },
        {
          id: 'task-2',
          type: 'task',
          title: 'Task 2',
          taskNumber: 2,
          status: 'done',
          priority: 'high',
          projectId: 'proj-1',
          userId: 'user-456',
          createdAt: new Date().toISOString(),
          relevanceScore: 1,
        },
      ],
      totalCount: 2,
      searchQuery: 'test',
      ...overrides,
    }
  }
  ```

- [ ] **Step 2: Update `tests/providers/kaneo/search-tasks.test.ts`**

  Replace the inline `Response(JSON.stringify({ results: [...] }))` block in the assignee test with:

  ```typescript
  import { createMockKaneoTaskSearchResponse } from '../../utils/factories.js'
  setMockFetch(() =>
    Promise.resolve(new Response(JSON.stringify(createMockKaneoTaskSearchResponse()), { status: 200 })),
  )
  ```

- [ ] **Step 3: Update `tests/providers/kaneo/operations/tasks.test.ts`**

  Same replacement as Step 2 for the inline response in the assigneeId test.

- [ ] **Step 4: Run the tests**

  ```bash
  bun test tests/providers/kaneo/search-tasks.test.ts tests/providers/kaneo/operations/tasks.test.ts
  ```

  Expected: Both suites pass.

- [ ] **Step 5: Commit**

  ```bash
  git add tests/utils/factories.ts tests/providers/kaneo/search-tasks.test.ts tests/providers/kaneo/operations/tasks.test.ts
  git commit -m "refactor(tests): extract shared Kakue search task response fixture"
  ```

---

## Task 6: De-duplicate Interaction Router Test Setup

**Files:**

- Modify: `tests/chat/interaction-router.test.ts`
- Test: `bun test tests/chat/interaction-router.test.ts`

- [ ] **Step 1: Extract a parameterized setup helper in the same file**

  Inside `tests/chat/interaction-router.test.ts`, add after the existing helpers:

  ```typescript
  function setupAuthorizedGroupForUser(userId: string): void {
    upsertKnownGroupContext({
      contextId: 'group-9',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })
    upsertGroupAdminObservation({
      contextId: 'group-9',
      userId,
      username: interaction.user.username,
      isAdmin: true,
    })
    addAuthorizedGroup('group-9', 'admin-1')
  }
  ```

  Note: `interaction.user.username` is available from the top-level `interaction` constant.

- [ ] **Step 2: Replace repeated inline blocks**

  In the 3 tests `'uses the active group target for cfg callbacks received in DM'`, `'clears stale active DM-selected group target when cfg callback access is lost'`, and `'blocks encoded cfg callback target when admin access is removed'`, replace the identical ~20-line `upsertKnownGroupContext` + `upsertGroupAdminObservation` + `addAuthorizedGroup` block with:

  ```typescript
  setupAuthorizedGroupForUser(interaction.user.id)
  ```

- [ ] **Step 3: Run the tests**

  ```bash
  bun test tests/chat/interaction-router.test.ts
  ```

  Expected: Suite passes.

- [ ] **Step 4: Commit**

  ```bash
  git add tests/chat/interaction-router.test.ts
  git commit -m "refactor(tests): extract shared group setup helper in interaction-router tests"
  ```

---

## Task 7: Final Verification

- [ ] **Step 1: Run `jscpd` to confirm duplication reduction**

  ```bash
  bun duplicates
  ```

  Expected: The 16 clone pairs should be eliminated or significantly reduced. The final report should show fewer than 5 clones and a duplicated-lines percentage close to 0%.

- [ ] **Step 2: Run the full test suite**

  ```bash
  bun test
  ```

  Expected: All tests pass (no regressions).

- [ ] **Step 3: Self-review checklist**
  - [ ] All new helper files have clear, single responsibilities.
  - [ ] No inline `let fetchMock` remains in any YouTrack operations test.
  - [ ] `ContextSnapshot` is only defined in one place.
  - [ ] `ReviewLoopConfig` fixture is only defined in one place.
  - [ ] No test imports were broken by path changes.
  - [ ] `bun duplicates` threshold still passes (project target is near-zero duplication).

- [ ] **Step 4: Final commit**

  If any verification fixes were needed, commit them:

  ```bash
  git add -A
  git commit -m "refactor(tests): DRY duplicate test code across suites"
  ```

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-25-dry-duplicate-test-code.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

**Which approach?**
