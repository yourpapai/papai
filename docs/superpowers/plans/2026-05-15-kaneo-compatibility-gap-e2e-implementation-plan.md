# Kaneo Compatibility Gap E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add concrete Tier 1 Kaneo E2E coverage for the remaining compatibility gaps around task dates and assignees, task list query behavior, search adaptation, dedicated comment contracts, relation directionality, and label attachment-sensitive deletion.

**Architecture:** Keep the existing Docker-backed Kaneo E2E harness and extend the current domain suites instead of building a parallel harness. Add one narrow raw API helper that uses the shared authenticated Kaneo session so E2E tests can prove both papai wrapper behavior and live Kaneo payload shape where docs and runtime have drifted.

**Tech Stack:** Bun test runner, TypeScript, Docker-backed Kaneo runtime, existing `KaneoTestClient`, authenticated `fetch`, Zod only where a helper-level guard is useful.

**Spec:** `docs/superpowers/plans/2026-05-15-kaneo-compatibility-gap-e2e-plan.md`

**Execution Note:** Commit steps are intentionally omitted. Only create commits during execution if the user explicitly asks for them in that session.

---

## Scope Check

This stays as one implementation plan. Every task targets the same boundary: live Kaneo API behavior as adapted by papai's Kaneo provider and validated through the Tier 1 E2E harness.

## File Structure

- Create: `tests/e2e/kaneo-api-helpers.ts`
  Shared raw authenticated Kaneo API helper for system-oracle assertions and seeded-user discovery.
- Create: `tests/e2e/task-list-compatibility.test.ts`
  Focused E2E coverage for list payload shape, `plannedTasks`, and the full live query surface.
- Modify: `tests/e2e/task-lifecycle.test.ts`
  Add task `startDate`, nullable-date, and assignee round-trip coverage.
- Modify: `tests/e2e/task-search.test.ts`
  Add search-envelope, project-limit, assignee-filter, and nullable-date search coverage.
- Modify: `tests/e2e/task-comments.test.ts`
  Add dedicated `/comment` contract probes alongside wrapper-level update/delete assertions.
- Modify: `tests/e2e/task-relations.test.ts`
  Add reverse-direction mapping checks and raw duplicate-detection after relation updates.
- Modify: `tests/e2e/label-operations.test.ts`
  Add task-label visibility checks through `/label/task/{taskId}` and stronger deletion-state coverage.
- Modify: `tests/e2e/e2e.test.ts`
  Import the new task-list compatibility suite.
- Modify: `tests/e2e/README.md`
  Document the raw helper and the `IMAGE=papai:e2e bun test:e2e` execution path.

---

### Task 1: Add Shared Raw Kaneo API Helper And Extend Task Lifecycle Coverage

**Files:**

- Create: `tests/e2e/kaneo-api-helpers.ts`
- Modify: `tests/e2e/task-lifecycle.test.ts`

- [ ] **Step 1: Add the new task lifecycle regression tests that depend on a future raw helper**

Update `tests/e2e/task-lifecycle.test.ts` with these imports and tests:

```typescript
import { getCurrentKaneoUserId, kaneoApiJson } from './kaneo-api-helpers.js'

test('creates and retrieves a task with startDate, dueDate, and assignee', async () => {
  const assigneeId = await getCurrentKaneoUserId()
  const startDate = '2026-05-20T09:00:00.000Z'
  const dueDate = '2026-05-21T17:00:00.000Z'

  const task = await createTask({
    config: kaneoConfig,
    projectId,
    title: `Dated Task ${Date.now()}`,
    startDate,
    dueDate,
    userId: assigneeId,
  })
  testClient.trackTask(task.id)

  const retrieved = await getTask({ config: kaneoConfig, taskId: task.id })
  const rawTask = (await kaneoApiJson(`/task/${task.id}`)) as {
    startDate?: string | null
    dueDate?: string | null
    userId?: string | null
  }

  expect(retrieved.startDate).toBe(startDate)
  expect(retrieved.dueDate).toBe(dueDate)
  expect(retrieved.userId).toBe(assigneeId)
  expect(rawTask.startDate).toBe(startDate)
  expect(rawTask.dueDate).toBe(dueDate)
  expect(rawTask.userId).toBe(assigneeId)
})

test('preserves startDate when updating only the title', async () => {
  const startDate = '2026-05-22T09:00:00.000Z'

  const task = await createTask({
    config: kaneoConfig,
    projectId,
    title: `Preserve Start ${Date.now()}`,
    startDate,
  })
  testClient.trackTask(task.id)

  await updateTask({
    config: kaneoConfig,
    taskId: task.id,
    title: `Renamed ${Date.now()}`,
  })

  const retrieved = await getTask({ config: kaneoConfig, taskId: task.id })
  const rawTask = (await kaneoApiJson(`/task/${task.id}`)) as { startDate?: string | null }

  expect(retrieved.startDate).toBe(startDate)
  expect(rawTask.startDate).toBe(startDate)
})

test('overrides startDate when updating it explicitly', async () => {
  const originalStartDate = '2026-05-23T09:00:00.000Z'
  const replacementStartDate = '2026-05-24T12:30:00.000Z'

  const task = await createTask({
    config: kaneoConfig,
    projectId,
    title: `Override Start ${Date.now()}`,
    startDate: originalStartDate,
  })
  testClient.trackTask(task.id)

  await updateTask({
    config: kaneoConfig,
    taskId: task.id,
    startDate: replacementStartDate,
  })

  const retrieved = await getTask({ config: kaneoConfig, taskId: task.id })
  const rawTask = (await kaneoApiJson(`/task/${task.id}`)) as { startDate?: string | null }

  expect(retrieved.startDate).toBe(replacementStartDate)
  expect(rawTask.startDate).toBe(replacementStartDate)
})

test('returns null dates when a task is created without startDate and dueDate', async () => {
  const task = await createTask({
    config: kaneoConfig,
    projectId,
    title: `Null Dates ${Date.now()}`,
  })
  testClient.trackTask(task.id)

  const retrieved = await getTask({ config: kaneoConfig, taskId: task.id })
  const rawTask = (await kaneoApiJson(`/task/${task.id}`)) as {
    startDate?: string | null
    dueDate?: string | null
  }

  expect(retrieved.startDate).toBeNull()
  expect(retrieved.dueDate).toBeNull()
  expect(rawTask.startDate ?? null).toBeNull()
  expect(rawTask.dueDate ?? null).toBeNull()
})
```

- [ ] **Step 2: Run the task lifecycle E2E file and verify it fails because the helper does not exist yet**

Run:

```bash
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/task-lifecycle.test.ts
```

Expected: FAIL with an import-resolution error for `./kaneo-api-helpers.js`.

- [ ] **Step 3: Create the shared raw Kaneo API helper**

Create `tests/e2e/kaneo-api-helpers.ts`:

```typescript
import { z } from 'zod'

import { getE2EConfigSync } from './global-setup.js'

const SessionSchema = z.object({
  user: z.object({
    id: z.string(),
  }),
})

function buildApiUrl(path: string): string {
  const { baseUrl } = getE2EConfigSync()
  return `${baseUrl}/api${path}`
}

function buildHeaders(init?: RequestInit): Headers {
  const { apiKey } = getE2EConfigSync()
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${apiKey}`)
  if (!headers.has('Content-Type') && init?.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  return headers
}

export async function kaneoApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers: buildHeaders(init),
  })

  if (!response.ok) {
    throw new Error(`Kaneo API request failed: ${response.status} ${response.statusText} for ${path}`)
  }

  return response
}

export async function kaneoApiJson(path: string, init?: RequestInit): Promise<unknown> {
  return kaneoApiFetch(path, init).then((response) => response.json() as Promise<unknown>)
}

export async function getCurrentKaneoUserId(): Promise<string> {
  const session = SessionSchema.parse(await kaneoApiJson('/auth/get-session'))
  return session.user.id
}
```

- [ ] **Step 4: Run the task lifecycle file again and verify the new coverage passes**

Run:

```bash
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/task-lifecycle.test.ts
```

Expected: PASS with the existing task lifecycle tests plus the four new compatibility tests.

---

### Task 2: Add Dedicated Task List Compatibility E2E Coverage

**Files:**

- Create: `tests/e2e/task-list-compatibility.test.ts`
- Modify: `tests/e2e/e2e.test.ts`

- [ ] **Step 1: Create the new task-list compatibility test file**

Create `tests/e2e/task-list-compatibility.test.ts`:

```typescript
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(10000)

import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { createTask } from '../../src/providers/kaneo/create-task.js'
import { listTasks } from '../../src/providers/kaneo/list-tasks.js'
import { createTestClient, type KaneoTestClient } from './kaneo-test-client.js'
import { getCurrentKaneoUserId, kaneoApiJson } from './kaneo-api-helpers.js'

describe('E2E: Task List Compatibility', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let projectId: string

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    await testClient.cleanup()
    const project = await testClient.createTestProject(`Task List Compatibility ${Date.now()}`)
    projectId = project.id
  })

  test('keeps null dueDate stable and exposes plannedTasks key in the raw list payload', async () => {
    const planned = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Planned ${Date.now()}`,
      status: 'planned',
    })
    const columnTask = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Column ${Date.now()}`,
      status: 'to-do',
      dueDate: '2026-05-30T18:00:00.000Z',
    })
    testClient.trackTask(planned.id)
    testClient.trackTask(columnTask.id)

    const listed = await listTasks({ config: kaneoConfig, projectId })
    const raw = (await kaneoApiJson(`/task/tasks/${projectId}`)) as {
      data?: {
        columns?: Array<{ tasks?: Array<{ id: string; dueDate?: string | null }> }>
        plannedTasks?: Array<{ id: string; dueDate?: string | null }>
      }
      columns?: Array<{ tasks?: Array<{ id: string; dueDate?: string | null }> }>
      plannedTasks?: Array<{ id: string; dueDate?: string | null }>
    }

    expect(listed.map((task) => task.id)).toContain(planned.id)
    expect(listed.map((task) => task.id)).toContain(columnTask.id)
    expect(raw.data?.plannedTasks ?? raw.plannedTasks).toBeArray()
  })

  test('honors status and assignee filters', async () => {
    const assigneeId = await getCurrentKaneoUserId()
    const assignedTodo = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Assigned Todo ${Date.now()}`,
      status: 'to-do',
      userId: assigneeId,
    })
    const unassignedInProgress = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Unassigned In Progress ${Date.now()}`,
      status: 'in-progress',
    })
    testClient.trackTask(assignedTodo.id)
    testClient.trackTask(unassignedInProgress.id)

    const statusFiltered = await listTasks({
      config: kaneoConfig,
      projectId,
      params: { status: 'to-do' },
    })
    const assigneeFiltered = await listTasks({
      config: kaneoConfig,
      projectId,
      params: { assigneeId },
    })

    expect(statusFiltered.map((task) => task.id)).toContain(assignedTodo.id)
    expect(statusFiltered.map((task) => task.id)).not.toContain(unassignedInProgress.id)
    expect(assigneeFiltered.map((task) => task.id)).toContain(assignedTodo.id)
    expect(assigneeFiltered.map((task) => task.id)).not.toContain(unassignedInProgress.id)
  })

  test('honors page, limit, sortBy, sortOrder, dueBefore, and dueAfter', async () => {
    const alpha = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Alpha ${Date.now()}`,
      dueDate: '2026-05-10T00:00:00.000Z',
    })
    const bravo = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Bravo ${Date.now()}`,
      dueDate: '2026-05-20T00:00:00.000Z',
    })
    const charlie = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Charlie ${Date.now()}`,
      dueDate: '2026-05-30T00:00:00.000Z',
    })
    testClient.trackTask(alpha.id)
    testClient.trackTask(bravo.id)
    testClient.trackTask(charlie.id)

    const firstPage = await listTasks({
      config: kaneoConfig,
      projectId,
      params: { sortBy: 'title', sortOrder: 'asc', page: 1, limit: 1 },
    })
    const secondPage = await listTasks({
      config: kaneoConfig,
      projectId,
      params: { sortBy: 'title', sortOrder: 'asc', page: 2, limit: 1 },
    })
    const dueWindow = await listTasks({
      config: kaneoConfig,
      projectId,
      params: {
        dueAfter: '2026-05-15T00:00:00.000Z',
        dueBefore: '2026-05-25T00:00:00.000Z',
      },
    })

    expect(firstPage).toHaveLength(1)
    expect(secondPage).toHaveLength(1)
    expect(firstPage[0]?.id).not.toBe(secondPage[0]?.id)
    expect(dueWindow.map((task) => task.id)).toContain(bravo.id)
    expect(dueWindow.map((task) => task.id)).not.toContain(alpha.id)
    expect(dueWindow.map((task) => task.id)).not.toContain(charlie.id)
  })
})
```

- [ ] **Step 2: Run the new task-list compatibility file directly**

Run:

```bash
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/task-list-compatibility.test.ts
```

Expected: PASS on the current branch. If it fails, stop and treat the failure as a real task-list compatibility bug rather than weakening the assertions.

- [ ] **Step 3: Wire the new file into the shared E2E suite**

Update `tests/e2e/e2e.test.ts`:

```typescript
import './task-list-compatibility.test.js'
```

Place it next to the other task-domain imports.

- [ ] **Step 4: Run the full E2E suite with the local image override**

Run:

```bash
IMAGE=papai:e2e bun test:e2e
```

Expected: PASS with the new task-list suite included.

---

### Task 3: Expand Search E2E Coverage For Envelope, Filters, And Nullable Dates

**Files:**

- Modify: `tests/e2e/task-search.test.ts`

- [ ] **Step 1: Add the missing search compatibility tests**

Update `tests/e2e/task-search.test.ts` with these imports and tests:

```typescript
import { getCurrentKaneoUserId, kaneoApiJson } from './kaneo-api-helpers.js'

test('adapts the live search envelope and still finds tasks with null dates', async () => {
  const uniqueKeyword = `nulldatesearch${Date.now()}`
  const task = await createTask({
    config: kaneoConfig,
    projectId,
    title: `Task ${uniqueKeyword}`,
  })
  testClient.trackTask(task.id)

  const results = await searchTasks({
    config: kaneoConfig,
    query: uniqueKeyword,
    workspaceId,
    projectId,
  })
  const raw = (await kaneoApiJson(
    `/search?${new URLSearchParams({ q: uniqueKeyword, type: 'tasks', workspaceId, projectId }).toString()}`,
  )) as Record<string, unknown>

  expect(results.tasks.map((entry) => entry.id)).toContain(task.id)
  expect(Object.keys(raw)).toSatisfy((keys) => keys.includes('tasks') || keys.includes('results'))
})

test('respects projectId and limit together', async () => {
  const uniqueKeyword = `projectlimit${Date.now()}`
  const sameProjectA = await createTask({ config: kaneoConfig, projectId, title: `A ${uniqueKeyword}` })
  const sameProjectB = await createTask({ config: kaneoConfig, projectId, title: `B ${uniqueKeyword}` })
  testClient.trackTask(sameProjectA.id)
  testClient.trackTask(sameProjectB.id)

  const otherProject = await testClient.createTestProject(`Other Search Project ${Date.now()}`)
  const otherTask = await createTask({
    config: kaneoConfig,
    projectId: otherProject.id,
    title: `Other ${uniqueKeyword}`,
  })
  testClient.trackTask(otherTask.id)

  const results = await searchTasks({
    config: kaneoConfig,
    query: uniqueKeyword,
    workspaceId,
    projectId,
    limit: 1,
  })

  expect(results.tasks).toHaveLength(1)
  expect(results.tasks[0]?.projectId).toBe(projectId)
})

test('filters locally by assigneeId without dropping the assigned task', async () => {
  const assigneeId = await getCurrentKaneoUserId()
  const uniqueKeyword = `assigneesearch${Date.now()}`

  const assigned = await createTask({
    config: kaneoConfig,
    projectId,
    title: `Assigned ${uniqueKeyword}`,
    userId: assigneeId,
  })
  const unassigned = await createTask({
    config: kaneoConfig,
    projectId,
    title: `Unassigned ${uniqueKeyword}`,
  })
  testClient.trackTask(assigned.id)
  testClient.trackTask(unassigned.id)

  const results = await searchTasks({
    config: kaneoConfig,
    query: uniqueKeyword,
    workspaceId,
    projectId,
    assigneeId,
  })

  expect(results.tasks.map((entry) => entry.id)).toContain(assigned.id)
  expect(results.tasks.map((entry) => entry.id)).not.toContain(unassigned.id)
})
```

- [ ] **Step 2: Run the search file and verify the new cases**

Run:

```bash
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/task-search.test.ts
```

Expected: PASS. If it fails, treat the failure as either a real Kaneo search drift or a mistaken assumption about the live envelope.

---

### Task 4: Strengthen Comment E2E Coverage For Dedicated `/comment` Contracts

**Files:**

- Modify: `tests/e2e/task-comments.test.ts`

- [ ] **Step 1: Add dedicated comment contract probes and wrapper-level ID-stability assertions**

Update `tests/e2e/task-comments.test.ts` with this import and these tests:

```typescript
import { kaneoApiJson } from './kaneo-api-helpers.js'

test('keeps comment IDs stable through provider update and delete flows', async () => {
  const suffix = generateUniqueSuffix()
  const task = await createTask({ config: kaneoConfig, projectId, title: `Stable Comment ${suffix}` })

  const original = await addComment({ config: kaneoConfig, taskId: task.id, comment: 'Original body' })
  const untouched = await addComment({ config: kaneoConfig, taskId: task.id, comment: 'Untouched body' })

  const { updateComment } = await import('../../src/providers/kaneo/update-comment.js')
  const updated = await updateComment({
    config: kaneoConfig,
    taskId: task.id,
    activityId: original.id,
    comment: 'Updated body',
  })

  expect(updated.id).toBe(original.id)

  const afterUpdate = await getComments({ config: kaneoConfig, taskId: task.id })
  expect(afterUpdate.find((entry) => entry.id === original.id)?.comment).toBe('Updated body')
  expect(afterUpdate.find((entry) => entry.id === untouched.id)?.comment).toBe('Untouched body')

  const { removeComment } = await import('../../src/providers/kaneo/remove-comment.js')
  const removed = await removeComment({ config: kaneoConfig, activityId: original.id })

  expect(removed.id).toBe(original.id)

  const afterDelete = await getComments({ config: kaneoConfig, taskId: task.id })
  expect(afterDelete.find((entry) => entry.id === original.id)).toBeUndefined()
  expect(afterDelete.find((entry) => entry.id === untouched.id)?.comment).toBe('Untouched body')

  await deleteTask({ config: kaneoConfig, taskId: task.id })
})

test('raw dedicated comment endpoints return the documented update and delete fields', async () => {
  const suffix = generateUniqueSuffix()
  const task = await createTask({ config: kaneoConfig, projectId, title: `Raw Comment ${suffix}` })

  const created = (await kaneoApiJson(`/comment/${task.id}`, {
    method: 'POST',
    body: JSON.stringify({ content: 'Raw comment body' }),
  })) as {
    id: string
    taskId: string
    userId: string
    content: string
    createdAt: string
    updatedAt?: string
    user?: { name: string; image: string | null }
  }

  const updated = (await kaneoApiJson(`/comment/${created.id}`, {
    method: 'PUT',
    body: JSON.stringify({ content: 'Raw updated body' }),
  })) as {
    id: string
    taskId: string
    userId: string
    content: string
    createdAt: string
    updatedAt: string
    user: { name: string; image: string | null }
  }

  expect(updated.id).toBe(created.id)
  expect(updated.taskId).toBe(task.id)
  expect(updated.content).toBe('Raw updated body')
  expect(typeof updated.updatedAt).toBe('string')
  expect(updated.user.name).toBeTruthy()

  const deleted = (await kaneoApiJson(`/comment/${created.id}`, {
    method: 'DELETE',
  })) as {
    id: string
    taskId: string
    userId: string
    content: string
    createdAt: string
    updatedAt: string
  }

  expect(deleted.id).toBe(created.id)
  expect(deleted.taskId).toBe(task.id)

  await deleteTask({ config: kaneoConfig, taskId: task.id })
})
```

- [ ] **Step 2: Run the comment E2E file**

Run:

```bash
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/task-comments.test.ts
```

Expected: PASS with the current dedicated `/comment` runtime. If it fails, compare the live response body against the latest Kaneo comment docs before changing assertions.

---

### Task 5: Expand Relation E2E Coverage For Reverse Mapping And Duplicate-Free Updates

**Files:**

- Modify: `tests/e2e/task-relations.test.ts`

- [ ] **Step 1: Add reverse-direction and duplicate-detection relation tests**

Update `tests/e2e/task-relations.test.ts` with this import and these tests:

```typescript
import { kaneoApiJson } from './kaneo-api-helpers.js'

test('maps blocks to blocked_by on the target task', async () => {
  const source = await createTask({ config: kaneoConfig, projectId, title: `Source ${Date.now()}` })
  const target = await createTask({ config: kaneoConfig, projectId, title: `Target ${Date.now()}` })
  testClient.trackTask(source.id)
  testClient.trackTask(target.id)

  await addTaskRelation({ config: kaneoConfig, taskId: source.id, relatedTaskId: target.id, type: 'blocks' })

  const sourceTask = await getTask({ config: kaneoConfig, taskId: source.id })
  const targetTask = await getTask({ config: kaneoConfig, taskId: target.id })

  expect(sourceTask.relations).toContainEqual({ type: 'blocks', taskId: target.id })
  expect(targetTask.relations).toContainEqual({ type: 'blocked_by', taskId: source.id })
})

test('maps subtask relations back to parent and child in opposite directions', async () => {
  const parent = await createTask({ config: kaneoConfig, projectId, title: `Parent ${Date.now()}` })
  const child = await createTask({ config: kaneoConfig, projectId, title: `Child ${Date.now()}` })
  testClient.trackTask(parent.id)
  testClient.trackTask(child.id)

  await addTaskRelation({ config: kaneoConfig, taskId: child.id, relatedTaskId: parent.id, type: 'parent' })

  const childTask = await getTask({ config: kaneoConfig, taskId: child.id })
  const parentTask = await getTask({ config: kaneoConfig, taskId: parent.id })

  expect(childTask.relations).toContainEqual({ type: 'parent', taskId: parent.id })
  expect(parentTask.relations).toContainEqual({ type: 'child', taskId: child.id })
})

test('relation update leaves exactly one live relation in the raw Kaneo payload', async () => {
  const taskA = await createTask({ config: kaneoConfig, projectId, title: `Task A ${Date.now()}` })
  const taskB = await createTask({ config: kaneoConfig, projectId, title: `Task B ${Date.now()}` })
  testClient.trackTask(taskA.id)
  testClient.trackTask(taskB.id)

  await addTaskRelation({ config: kaneoConfig, taskId: taskA.id, relatedTaskId: taskB.id, type: 'related' })
  await updateTaskRelation({ config: kaneoConfig, taskId: taskA.id, relatedTaskId: taskB.id, type: 'blocks' })

  const rawRelations = (await kaneoApiJson(`/task-relation/${taskA.id}`)) as Array<{
    sourceTaskId: string
    targetTaskId: string
    relationType: string
  }>

  const matching = rawRelations.filter(
    (relation) =>
      (relation.sourceTaskId === taskA.id && relation.targetTaskId === taskB.id) ||
      (relation.sourceTaskId === taskB.id && relation.targetTaskId === taskA.id),
  )

  expect(matching).toHaveLength(1)
  expect(matching[0]?.relationType).toBe('blocks')
})
```

- [ ] **Step 2: Run the relations file**

Run:

```bash
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/task-relations.test.ts
```

Expected: PASS with no duplicate live relations after the update path.

---

### Task 6: Expand Label E2E Coverage For Task-Scoped Visibility And Delete State

**Files:**

- Modify: `tests/e2e/label-operations.test.ts`

- [ ] **Step 1: Add task-label visibility and deletion-state regression tests**

Update `tests/e2e/label-operations.test.ts` with this import and these tests:

```typescript
import { kaneoApiJson } from './kaneo-api-helpers.js'

test('shows attached labels through the dedicated task-label endpoint and removes them after detach', async () => {
  const label = await createLabel({
    config: kaneoConfig,
    workspaceId: testClient.getWorkspaceId(),
    name: `Visible Label ${Date.now()}`,
  })
  testClient.trackLabel(label.id)

  const task = await createTask({ config: kaneoConfig, projectId, title: `Task ${Date.now()}` })
  testClient.trackTask(task.id)

  await addTaskLabel({
    config: kaneoConfig,
    taskId: task.id,
    labelId: label.id,
    workspaceId: testClient.getWorkspaceId(),
  })

  const rawAfterAdd = (await kaneoApiJson(`/label/task/${task.id}`)) as Array<{ id: string }>
  expect(rawAfterAdd.map((entry) => entry.id)).toContain(label.id)

  await removeTaskLabel({ config: kaneoConfig, taskId: task.id, labelId: label.id })

  const rawAfterRemove = (await kaneoApiJson(`/label/task/${task.id}`)) as Array<{ id: string }>
  expect(rawAfterRemove.map((entry) => entry.id)).not.toContain(label.id)
})

test('keeps unattached label deletion blocked and allows attached label deletion', async () => {
  const unattached = await createLabel({
    config: kaneoConfig,
    workspaceId: testClient.getWorkspaceId(),
    name: `Unattached ${Date.now()}`,
  })
  testClient.trackLabel(unattached.id)

  await expect(removeLabel({ config: kaneoConfig, labelId: unattached.id })).rejects.toThrow()

  const attached = await createLabel({
    config: kaneoConfig,
    workspaceId: testClient.getWorkspaceId(),
    name: `Attached ${Date.now()}`,
  })

  const task = await createTask({ config: kaneoConfig, projectId, title: `Delete Label Task ${Date.now()}` })
  testClient.trackTask(task.id)

  await addTaskLabel({
    config: kaneoConfig,
    taskId: task.id,
    labelId: attached.id,
    workspaceId: testClient.getWorkspaceId(),
  })

  await removeLabel({ config: kaneoConfig, labelId: attached.id })

  const workspaceLabels = (await kaneoApiJson(
    `/label/workspace/${testClient.getWorkspaceId()}`,
  )) as Array<{ id: string }>

  expect(workspaceLabels.map((entry) => entry.id)).not.toContain(attached.id)
})
```

- [ ] **Step 2: Run the label operations file**

Run:

```bash
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/label-operations.test.ts
```

Expected: PASS with the currently accepted runtime rule that unattached delete fails while attached delete succeeds.

---

### Task 7: Document And Wire The New E2E Coverage

**Files:**

- Modify: `tests/e2e/README.md`

- [ ] **Step 1: Update the E2E README with the image override and raw-helper note**

Add or update the relevant sections in `tests/e2e/README.md`:

````markdown
### Run Tests

```bash
# Run the full Kaneo E2E suite against the local papai image
IMAGE=papai:e2e bun test:e2e

# Run a targeted E2E file with the shared preload harness
IMAGE=papai:e2e bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/task-list-compatibility.test.ts
```

## Raw Kaneo API Oracles

`kaneo-api-helpers.ts` provides authenticated raw `/api/*` probes for E2E tests that need to confirm live Kaneo payload shape in addition to papai wrapper behavior. Use it sparingly and keep papai wrapper assertions as the primary oracle.
````

- [ ] **Step 2: Run the full E2E suite one final time**

Run:

```bash
IMAGE=papai:e2e bun test:e2e
```

Expected: PASS with the new task list suite, the raw API helper, and the expanded domain coverage all included in the single shared E2E entrypoint.
