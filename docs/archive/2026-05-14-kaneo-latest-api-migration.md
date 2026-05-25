<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kaneo Latest API Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align papai's Kaneo provider with the latest published Kaneo API reference for tasks, search, comments, relations, and labels while keeping papai's normalized provider contract stable.

**Architecture:** Keep the existing Kaneo provider/resource/operation layering, but make each migrated domain validate and map the latest published API-reference contract directly. Replace older runtime-driven compatibility paths only where the published docs now define a newer stable contract: `/comment/*` for comments, grouped `/search` results, documented `startDate` task fields, and first-class `/task-relation` resources for Kaneo relation persistence.

**Tech Stack:** Bun, TypeScript, Zod v4, Bun test runner, Kaneo provider/resource wrappers, Vercel AI SDK tool builders.

**Spec:** `docs/superpowers/specs/2026-05-14-kaneo-latest-api-migration-design.md`

**Execution Note:** Commit steps are included for teams that want granular history. During actual execution, only run the commit steps if the user has explicitly asked for commits in that session.

---

## Scope Check

This should stay as one implementation plan. The work is split into five Kaneo domains, but they all serve the same doc-first migration goal and share the same provider, tool-surface, and E2E verification gates.

## File Structure

- Modify: `src/providers/kaneo/schemas/create-task.ts`
  Add documented `startDate` and tighten task response typing used by create/update mapping.
- Modify: `src/providers/kaneo/schemas/get-task.ts`
  Add documented `startDate` and keep the get-task schema aligned with latest published docs.
- Modify: `src/providers/kaneo/schemas/list-tasks.ts`
  Model the richer task-list payload used inside grouped list/search responses.
- Modify: `src/providers/kaneo/schemas/global-search.ts`
  Replace flat compat assumptions with grouped latest-doc search schemas.
- Modify: `src/providers/kaneo/schemas/create-comment.ts`
  Model the latest `/comment` response object.
- Modify: `src/providers/kaneo/schemas/update-comment.ts`
  Model the latest `/comment` update/delete response object.
- Modify: `src/providers/kaneo/schemas/api-compat.ts`
  Remove search/comment compat from the primary path and keep only truly temporary compat schemas that still serve non-migrated paths.
- Modify: `src/providers/kaneo/task-update-helpers.ts`
  Include `startDate` in full `PUT /task/{id}` bodies.
- Modify: `src/providers/kaneo/task-resource.ts`
  Align list/get/search/relation behavior with the latest documented contracts.
- Modify: `src/providers/kaneo/comment-resource.ts`
  Move comment CRUD to `/comment/{taskId}` and `/comment/{id}`.
- Modify: `src/providers/kaneo/task-relations.ts`
  Replace frontmatter persistence with documented `/task-relation` resource handling.
- Modify: `src/providers/kaneo/label-resource.ts`
  Restore doc-first delete behavior and keep attach/detach aligned with documented task-label endpoints.
- Modify: `src/providers/kaneo/classify-error.ts`
  Keep endpoint-sensitive error mapping correct for `/comment/*`, `/task-relation/*`, and nested label routes.
- Modify: `src/providers/kaneo/constants.ts`
  Restore `labels.delete` when the provider path is again doc-first.
- Modify: `src/providers/kaneo/kaneo-client.ts`
  Keep resource exposure stable while underlying resource methods change contract.
- Modify: `src/providers/kaneo/create-task.ts`
  Thread `startDate` through the public wrapper.
- Modify: `src/providers/kaneo/update-task.ts`
  Thread `startDate` through the public wrapper.
- Modify: `src/providers/kaneo/add-comment.ts`
  Keep wrapper input/output aligned with the new comment-resource contract.
- Modify: `src/providers/kaneo/get-comments.ts`
  Keep wrapper output aligned with the new comment-resource contract.
- Modify: `src/providers/kaneo/update-comment.ts`
  Rename path params internally from `activityId` semantics to comment-ID semantics while preserving wrapper shape.
- Modify: `src/providers/kaneo/remove-comment.ts`
  Rename path params internally from `activityId` semantics to comment-ID semantics while preserving wrapper shape.
- Modify: `src/providers/kaneo/add-task-relation.ts`
  Keep wrapper aligned with the new relation-resource contract.
- Modify: `src/providers/kaneo/update-task-relation.ts`
  Keep wrapper aligned with delete-plus-create relation updates over documented primitives.
- Modify: `src/providers/kaneo/remove-task-relation.ts`
  Keep wrapper aligned with relation-ID-backed deletion resolved from task relations.
- Modify: `tests/providers/kaneo/task-resource.test.ts`
  Update list/search/get/relation unit coverage to latest doc-first behavior.
- Modify: `tests/providers/kaneo/search-tasks.test.ts`
  Replace flat-search assumptions with grouped-search tests.
- Modify: `tests/providers/kaneo/comment-resource.test.ts`
  Replace activity fallback tests with `/comment` endpoint tests.
- Modify: `tests/providers/kaneo/task-relations.test.ts`
  Replace frontmatter behavior with resource-ID-backed relation CRUD tests.
- Modify: `tests/providers/kaneo/label-resource.test.ts`
  Restore doc-first label delete coverage.
- Modify: `tests/providers/kaneo/schema-validation.test.ts`
  Update schema-first coverage for `startDate`, grouped search, `/comment` payloads, and relation schemas.
- Modify: `tests/providers/kaneo/index.test.ts`
  Reassert provider capability surface, especially restored `labels.delete` and provider search behavior.
- Modify: `tests/tools/label-tools.test.ts`
  Reassert `remove_label` exposure path after restoring Kaneo label delete support.
- Modify: `tests/tools/task-label-tools.test.ts`
  Keep task-label tools aligned with label semantics after delete restoration.
- Modify: `tests/tools/task-relation-tools.test.ts`
  Keep task-relation tool expectations aligned with the narrowed documented Kaneo relation types.
- Modify: `tests/e2e/task-comments.test.ts`
  Rework E2E coverage around `/comment` CRUD instead of activity fallback.
- Modify: `tests/e2e/task-relations.test.ts`
  Rework relation E2E assertions around first-class relation state instead of description frontmatter.
- Modify: `tests/e2e/label-operations.test.ts`
  Restore doc-first label delete expectations.
- Modify: `tests/e2e/kaneo-test-client.ts`
  Remove runtime-safe label cleanup assumptions that only delete attached labels.

---

### Task 1: Align Task Schemas And Update/List Core

**Files:**

- Modify: `src/providers/kaneo/create-task.ts`
- Modify: `src/providers/kaneo/update-task.ts`
- Modify: `src/providers/kaneo/task-resource.ts`
- Modify: `src/providers/kaneo/task-update-helpers.ts`
- Modify: `src/providers/kaneo/schemas/create-task.ts`
- Modify: `src/providers/kaneo/schemas/get-task.ts`
- Modify: `src/providers/kaneo/schemas/list-tasks.ts`
- Modify: `tests/providers/kaneo/task-resource.test.ts`
- Modify: `tests/providers/kaneo/schema-validation.test.ts`

- [ ] **Step 1: Write the failing task-schema tests for `startDate` and doc-first list payloads**

Update `tests/providers/kaneo/schema-validation.test.ts` and `tests/providers/kaneo/task-resource.test.ts` with these new cases:

```typescript
test('KaneoTaskResponseSchema accepts documented startDate on create/get responses', () => {
  const result = KaneoTaskResponseSchema.safeParse(
    createMockTask({
      id: 'task-1',
      projectId: 'proj-1',
      title: 'Task with start',
      description: 'Body',
      status: 'to-do',
      priority: 'medium',
      startDate: '2026-05-20T09:00:00.000Z',
      dueDate: '2026-05-21T09:00:00.000Z',
      createdAt: '2026-05-14T09:00:00.000Z',
    }),
  )

  expect(result.success).toBe(true)
})

test('PUT update body preserves existing startDate and allows overriding it', async () => {
  const requests: Array<{ method: string; body?: unknown }> = []

  setMockFetch((_url, options) => {
    const body = typeof options.body === 'string' ? (JSON.parse(options.body) as unknown) : undefined
    requests.push({ method: options.method ?? 'GET', body })

    return Promise.resolve(
      new Response(
        JSON.stringify(
          createMockTask({
            id: 'task-1',
            projectId: 'proj-1',
            title: 'Existing',
            description: 'Existing desc',
            status: 'col-1',
            priority: 'medium',
            position: 3,
            startDate: '2026-05-20T09:00:00.000Z',
          }),
        ),
        { status: 200 },
      ),
    )
  })

  const resource = new TaskResource(mockConfig, statusDeps)
  await resource.update('task-1', { title: 'Renamed' })

  expect(requests[1]?.body).toMatchObject({
    title: 'Renamed',
    startDate: '2026-05-20T09:00:00.000Z',
  })
})

test('list reads documented project-with-columns response and includes plannedTasks', async () => {
  setMockFetch(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          project: {
            id: 'proj-1',
            name: 'Project 1',
            slug: 'project-1',
            icon: null,
            workspaceId: 'ws-1',
          },
          columns: [
            {
              status: 'to-do',
              tasks: [
                {
                  id: 'task-1',
                  title: 'Column task',
                  status: 'to-do',
                  priority: 'medium',
                  number: 1,
                  dueDate: null,
                },
              ],
            },
          ],
          plannedTasks: [
            {
              id: 'task-2',
              title: 'Planned task',
              status: 'planned',
              priority: 'high',
              number: 2,
              dueDate: '2026-05-22T09:00:00.000Z',
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  )

  const resource = new TaskResource(mockConfig, statusDeps)
  const result = await resource.list('proj-1')

  expect(result.map((task) => task.id)).toEqual(['task-1', 'task-2'])
})
```

- [ ] **Step 2: Run the targeted task-schema tests and confirm they fail**

Run:

```bash
bun test tests/providers/kaneo/schema-validation.test.ts tests/providers/kaneo/task-resource.test.ts
```

Expected: FAIL because the current task schemas do not model `startDate`, and task-list parsing still assumes the runtime-safe `data` envelope instead of the doc-first grouped response.

- [ ] **Step 3: Add `startDate` to task schemas and thread it through task create/update wrappers**

Update `src/providers/kaneo/schemas/create-task.ts`, `src/providers/kaneo/schemas/get-task.ts`, and `src/providers/kaneo/create-task.ts`:

```typescript
import { z } from 'zod'

const TaskPriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])

export const TaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  position: z.number().nullable(),
  number: z.number().nullable(),
  userId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: TaskPriorityEnum,
  startDate: z.string().datetime().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
})

export type CreateTaskResponse = z.infer<typeof TaskSchema>
```

```typescript
export async function createTask({
  config,
  projectId,
  title,
  description,
  priority,
  status,
  startDate,
  dueDate,
  userId,
}: {
  config: KaneoConfig
  projectId: string
  title: string
  description?: string
  priority?: string
  status?: string
  startDate?: string
  dueDate?: string
  userId?: string
}): Promise<CreateTaskResponse> {
  const client = new KaneoClient(config)
  return await client.tasks.create({
    projectId,
    title,
    description,
    priority,
    status,
    startDate,
    dueDate,
    userId,
  })
}
```

- [ ] **Step 4: Preserve `startDate` in full task updates and move list parsing to the doc-first grouped response**

Update `src/providers/kaneo/task-update-helpers.ts`, `src/providers/kaneo/schemas/list-tasks.ts`, and `src/providers/kaneo/task-resource.ts`:

```typescript
type TaskUpdateParams = {
  title?: string
  description?: string
  status?: string
  priority?: string
  startDate?: string
  dueDate?: string
  projectId?: string
  userId?: string
}

type FullUpdateBody = {
  title: string
  description: string
  status: string
  priority: string
  projectId: string
  position: number
  startDate?: string
  dueDate?: string
  userId?: string
}

const existingStartDate = typeof existing.startDate === 'string' ? existing.startDate : undefined
const startDate = patch.startDate ?? existingStartDate
if (startDate !== undefined) {
  body.startDate = startDate
}
```

```typescript
export const ListedTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  number: z.number(),
  dueDate: z.string().datetime().nullable().optional(),
})

export const ListTasksResponseSchema = z.object({
  project: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    icon: z.string().nullable(),
    workspaceId: z.string(),
  }),
  columns: z.array(
    z.object({
      status: z.string(),
      tasks: z.array(ListedTaskSchema),
    }),
  ),
  plannedTasks: z.array(ListedTaskSchema).optional().default([]),
})
```

```typescript
const result = await kaneoFetch(
  this.config,
  'GET',
  `/task/tasks/${projectId}`,
  undefined,
  query,
  ListTasksResponseSchema,
)

const tasks = result.columns
  .flatMap((column) =>
    column.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      number: task.number,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate ?? null,
    })),
  )
  .concat(
    result.plannedTasks.map((task) => ({
      id: task.id,
      title: task.title,
      number: task.number,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate ?? null,
    })),
  )
```

- [ ] **Step 5: Run the targeted task tests and confirm they pass**

Run:

```bash
bun test tests/providers/kaneo/schema-validation.test.ts tests/providers/kaneo/task-resource.test.ts
```

Expected: PASS with task schema coverage for `startDate` and doc-first list parsing.

- [ ] **Step 6: Commit**

```bash
git add src/providers/kaneo/create-task.ts src/providers/kaneo/update-task.ts src/providers/kaneo/task-resource.ts src/providers/kaneo/task-update-helpers.ts src/providers/kaneo/schemas/create-task.ts src/providers/kaneo/schemas/get-task.ts src/providers/kaneo/schemas/list-tasks.ts tests/providers/kaneo/task-resource.test.ts tests/providers/kaneo/schema-validation.test.ts
git commit -m "refactor: align Kaneo task schemas with published API"
```

### Task 2: Migrate Kaneo Search To The Published Grouped Contract

**Files:**

- Modify: `src/providers/kaneo/search-tasks.ts`
- Modify: `src/providers/kaneo/task-resource.ts`
- Modify: `src/providers/kaneo/schemas/global-search.ts`
- Modify: `src/providers/kaneo/schemas/api-compat.ts`
- Modify: `tests/providers/kaneo/search-tasks.test.ts`
- Modify: `tests/providers/kaneo/task-resource.test.ts`
- Modify: `tests/providers/kaneo/schema-validation.test.ts`
- Modify: `tests/providers/kaneo/index.test.ts`

- [ ] **Step 1: Write the failing grouped-search tests**

Update `tests/providers/kaneo/search-tasks.test.ts` with grouped-response coverage:

```typescript
test('maps grouped task search results into TaskSearchResult[]', async () => {
  setMockFetch(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              projectId: 'proj-1',
              position: 1,
              number: 10,
              userId: 'user-1',
              title: 'Fix bug',
              description: 'Details',
              status: 'to-do',
              priority: 'high',
              startDate: '2026-05-20T09:00:00.000Z',
              dueDate: null,
              createdAt: '2026-05-14T09:00:00.000Z',
            },
          ],
          projects: [],
          workspaces: [],
          comments: [],
          activities: [],
        }),
        { status: 200 },
      ),
    ),
  )

  const result = await searchTasks({
    config: mockConfig,
    query: 'bug',
    workspaceId: 'ws-1',
  })

  expect(result).toEqual([
    {
      id: 'task-1',
      title: 'Fix bug',
      number: 10,
      status: 'to-do',
      priority: 'high',
      projectId: 'proj-1',
      userId: 'user-1',
    },
  ])
})

test('omits offset and limit from the remote request when assignee filtering stays local', async () => {
  let requestUrl: URL | undefined

  setMockFetch((url) => {
    requestUrl = new URL(url)

    return Promise.resolve(
      new Response(JSON.stringify({ tasks: [], projects: [], workspaces: [], comments: [], activities: [] }), {
        status: 200,
      }),
    )
  })

  await searchTasks({
    config: mockConfig,
    query: 'bug',
    workspaceId: 'ws-1',
    assigneeId: 'user-1',
    offset: 5,
    limit: 10,
  })

  expect(requestUrl?.searchParams.get('offset')).toBeNull()
  expect(requestUrl?.searchParams.get('limit')).toBeNull()
})
```

- [ ] **Step 2: Run the grouped-search tests and confirm they fail**

Run:

```bash
bun test tests/providers/kaneo/search-tasks.test.ts tests/providers/kaneo/task-resource.test.ts tests/providers/kaneo/index.test.ts
```

Expected: FAIL because the current implementation still validates the flat compat `{ results }` shape.

- [ ] **Step 3: Replace the flat search schema with grouped doc-first schemas**

Update `src/providers/kaneo/schemas/global-search.ts` and `src/providers/kaneo/schemas/api-compat.ts`:

```typescript
import { z } from 'zod'

const TaskPriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])

export const SearchTaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  position: z.number().nullable(),
  number: z.number().nullable(),
  userId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: TaskPriorityEnum,
  startDate: z.string().datetime().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
})

export const GlobalSearchResponseSchema = z.object({
  tasks: z.array(SearchTaskSchema),
  projects: z.array(z.unknown()),
  workspaces: z.array(z.unknown()),
  comments: z.array(z.unknown()),
  activities: z.array(z.unknown()),
})
```

```typescript
// Remove GlobalSearchResponseCompatSchema from the primary path once grouped search is implemented.
export const ListTasksResponseCompatSchema = z.object({
  data: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string().optional(),
    icon: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    isPublic: z.boolean().nullable().optional(),
    workspaceId: z.string().optional(),
    columns: z.array(ColumnWithTasksCompatSchema),
    archivedTasks: z.array(ListTaskSchema),
    plannedTasks: z.array(ListTaskSchema),
  }),
  pagination: z
    .object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    })
    .optional(),
})
```

- [ ] **Step 4: Flatten grouped search results in the provider adaptation layer**

Update `src/providers/kaneo/search-tasks.ts` and the `TaskResource.search()` path in `src/providers/kaneo/task-resource.ts`:

```typescript
export const TaskResultSchema = SearchTaskSchema.pick({
  id: true,
  title: true,
  number: true,
  status: true,
  priority: true,
  projectId: true,
}).extend({
  userId: z
    .string()
    .nullable()
    .transform((value) => value ?? ''),
})

export const KaneoSearchResponseSchema = GlobalSearchResponseSchema
```

```typescript
const result = await kaneoFetch(this.config, 'GET', '/search', undefined, queryParams, KaneoSearchResponseSchema)

let tasks: TaskResult[] = result.tasks.map((task) => ({
  id: task.id,
  title: task.title,
  number: task.number ?? 0,
  status: task.status,
  priority: task.priority,
  projectId: task.projectId,
  userId: task.userId ?? '',
}))

if (params.assigneeId !== undefined) {
  tasks = tasks.filter((task) => task.userId === params.assigneeId)
  const offset = params.offset ?? 0
  const limit = params.limit
  tasks = limit === undefined ? tasks.slice(offset) : tasks.slice(offset, offset + limit)
}
```

- [ ] **Step 5: Run the grouped-search tests and confirm they pass**

Run:

```bash
bun test tests/providers/kaneo/search-tasks.test.ts tests/providers/kaneo/task-resource.test.ts tests/providers/kaneo/schema-validation.test.ts tests/providers/kaneo/index.test.ts
```

Expected: PASS with grouped-search parsing and provider-level offset behavior still preserved.

- [ ] **Step 6: Commit**

```bash
git add src/providers/kaneo/search-tasks.ts src/providers/kaneo/task-resource.ts src/providers/kaneo/schemas/global-search.ts src/providers/kaneo/schemas/api-compat.ts tests/providers/kaneo/search-tasks.test.ts tests/providers/kaneo/task-resource.test.ts tests/providers/kaneo/schema-validation.test.ts tests/providers/kaneo/index.test.ts
git commit -m "refactor: move Kaneo search to grouped API contract"
```

### Task 3: Move Comment CRUD To The Published `/comment` API

**Files:**

- Modify: `src/providers/kaneo/comment-resource.ts`
- Modify: `src/providers/kaneo/add-comment.ts`
- Modify: `src/providers/kaneo/get-comments.ts`
- Modify: `src/providers/kaneo/update-comment.ts`
- Modify: `src/providers/kaneo/remove-comment.ts`
- Modify: `src/providers/kaneo/classify-error.ts`
- Modify: `src/providers/kaneo/schemas/create-comment.ts`
- Modify: `src/providers/kaneo/schemas/update-comment.ts`
- Modify: `src/providers/kaneo/schemas/api-compat.ts`
- Modify: `tests/providers/kaneo/comment-resource.test.ts`
- Modify: `tests/providers/kaneo/schema-validation.test.ts`
- Modify: `tests/e2e/task-comments.test.ts`

- [ ] **Step 1: Write the failing `/comment` endpoint tests**

Update `tests/providers/kaneo/comment-resource.test.ts`:

```typescript
test('adds comment through POST /comment/{taskId} and returns the created comment object', async () => {
  const requests: Array<{ url: string; method: string; body?: unknown }> = []

  setMockFetch((url, options) => {
    requests.push({
      url,
      method: options.method ?? 'GET',
      body: typeof options.body === 'string' ? (JSON.parse(options.body) as unknown) : undefined,
    })

    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'comment-1',
          taskId: 'task-1',
          userId: 'user-1',
          content: 'New comment',
          createdAt: '2026-05-14T09:00:00.000Z',
          updatedAt: '2026-05-14T09:00:00.000Z',
          user: { name: 'Test User', image: null },
        }),
        { status: 200 },
      ),
    )
  })

  const resource = new CommentResource(mockConfig)
  const result = await resource.add('task-1', 'New comment')

  expect(requests).toEqual([
    {
      url: 'https://api.test.com/api/comment/task-1',
      method: 'POST',
      body: { content: 'New comment' },
    },
  ])
  expect(result).toEqual({
    id: 'comment-1',
    comment: 'New comment',
    createdAt: '2026-05-14T09:00:00.000Z',
  })
})

test('lists comments through GET /comment/{taskId}', async () => {
  setMockFetch(() =>
    Promise.resolve(
      new Response(
        JSON.stringify([
          {
            id: 'comment-1',
            taskId: 'task-1',
            userId: 'user-1',
            content: 'First',
            createdAt: '2026-05-14T09:00:00.000Z',
            updatedAt: '2026-05-14T09:00:00.000Z',
            user: { name: 'Test User', image: null },
          },
        ]),
        { status: 200 },
      ),
    ),
  )

  const resource = new CommentResource(mockConfig)
  const result = await resource.list('task-1')

  expect(result).toEqual([{ id: 'comment-1', comment: 'First', createdAt: '2026-05-14T09:00:00.000Z' }])
})

test('updates comment through PUT /comment/{id}', async () => {
  const requests: Array<{ url: string; method: string; body?: unknown }> = []

  setMockFetch((url, options) => {
    requests.push({
      url,
      method: options.method ?? 'GET',
      body: typeof options.body === 'string' ? (JSON.parse(options.body) as unknown) : undefined,
    })

    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'comment-1',
          taskId: 'task-1',
          userId: 'user-1',
          content: 'Updated text',
          createdAt: '2026-05-14T09:00:00.000Z',
          updatedAt: '2026-05-14T10:00:00.000Z',
          user: { name: 'Test User', image: null },
        }),
        { status: 200 },
      ),
    )
  })

  const resource = new CommentResource(mockConfig)
  const result = await resource.update('task-1', 'comment-1', 'Updated text')

  expect(requests[0]).toMatchObject({
    url: 'https://api.test.com/api/comment/comment-1',
    method: 'PUT',
    body: { content: 'Updated text' },
  })
  expect(result.comment).toBe('Updated text')
})
```

- [ ] **Step 2: Run the comment tests and confirm they fail**

Run:

```bash
bun test tests/providers/kaneo/comment-resource.test.ts tests/providers/kaneo/schema-validation.test.ts
```

Expected: FAIL because the current implementation still uses `/activity/comment` and `GET /activity/{taskId}`.

- [ ] **Step 3: Replace activity response schemas with `/comment` response schemas**

Update `src/providers/kaneo/schemas/create-comment.ts` and `src/providers/kaneo/schemas/update-comment.ts`:

```typescript
import { z } from 'zod'

const CommentUserSchema = z.object({
  name: z.string(),
  image: z.string().nullable(),
})

export const CreateCommentResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  userId: z.string(),
  content: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  user: CommentUserSchema.optional(),
})

export const CommentListResponseSchema = z.array(CreateCommentResponseSchema)
```

```typescript
import { CreateCommentResponseSchema } from './create-comment.js'

export const UpdateCommentResponseSchema = CreateCommentResponseSchema
```

Remove the old comment compat schemas from `src/providers/kaneo/schemas/api-compat.ts` once `comment-resource.ts` no longer imports them.

- [ ] **Step 4: Move comment-resource and wrapper methods to `/comment` endpoints**

Update `src/providers/kaneo/comment-resource.ts`, `src/providers/kaneo/update-comment.ts`, and `src/providers/kaneo/remove-comment.ts`:

```typescript
async add(taskId: string, comment: string): Promise<{ id: string; comment: string; createdAt: string }> {
  const created = await kaneoFetch(
    this.config,
    'POST',
    `/comment/${taskId}`,
    { content: comment },
    undefined,
    CreateCommentResponseSchema,
  )

  return {
    id: created.id,
    comment: created.content,
    createdAt: created.createdAt,
  }
}

async list(taskId: string): Promise<{ id: string; comment: string; createdAt: string }[]> {
  const comments = await kaneoFetch(this.config, 'GET', `/comment/${taskId}`, undefined, undefined, CommentListResponseSchema)

  return comments.map((comment) => ({
    id: comment.id,
    comment: comment.content,
    createdAt: comment.createdAt,
  }))
}

async update(_taskId: string, commentId: string, comment: string): Promise<{ id: string; comment: string; createdAt: string }> {
  const updated = await kaneoFetch(
    this.config,
    'PUT',
    `/comment/${commentId}`,
    { content: comment },
    undefined,
    UpdateCommentResponseSchema,
  )

  return {
    id: updated.id,
    comment: updated.content,
    createdAt: updated.createdAt,
  }
}

async remove(commentId: string): Promise<{ id: string; success: true }> {
  await kaneoFetch(this.config, 'DELETE', `/comment/${commentId}`, undefined, undefined, UpdateCommentResponseSchema)
  return { id: commentId, success: true }
}
```

```typescript
export async function updateComment({
  config,
  taskId,
  activityId,
  comment,
}: {
  config: KaneoConfig
  taskId: string
  activityId: string
  comment: string
}): Promise<{ id: string; comment: string; createdAt: string }> {
  const client = new KaneoClient(config)
  return await client.comments.update(taskId, activityId, comment)
}
```

Keep wrapper parameter names stable for now, but update internal log messages and endpoint classification so `/comment/` 404s classify as comment-not-found rather than activity-not-found.

- [ ] **Step 5: Rework comment E2E around `/comment` CRUD and run the tests**

Update `tests/e2e/task-comments.test.ts` so assertions no longer mention fallback activity fetches and instead assert the direct returned object from `/comment` endpoints.

Run:

```bash
bun test tests/providers/kaneo/comment-resource.test.ts tests/providers/kaneo/schema-validation.test.ts tests/e2e/task-comments.test.ts
```

Expected: PASS with direct comment CRUD behavior and no activity fallback assumptions in the main comment path.

- [ ] **Step 6: Commit**

```bash
git add src/providers/kaneo/comment-resource.ts src/providers/kaneo/add-comment.ts src/providers/kaneo/get-comments.ts src/providers/kaneo/update-comment.ts src/providers/kaneo/remove-comment.ts src/providers/kaneo/classify-error.ts src/providers/kaneo/schemas/create-comment.ts src/providers/kaneo/schemas/update-comment.ts src/providers/kaneo/schemas/api-compat.ts tests/providers/kaneo/comment-resource.test.ts tests/providers/kaneo/schema-validation.test.ts tests/e2e/task-comments.test.ts
git commit -m "refactor: move Kaneo comments to published comment endpoints"
```

### Task 4: Replace Frontmatter Relations With Documented `/task-relation` Resources

**Files:**

- Modify: `src/providers/kaneo/task-relations.ts`
- Modify: `src/providers/kaneo/task-resource.ts`
- Modify: `src/providers/kaneo/add-task-relation.ts`
- Modify: `src/providers/kaneo/update-task-relation.ts`
- Modify: `src/providers/kaneo/remove-task-relation.ts`
- Modify: `src/providers/kaneo/frontmatter.ts`
  Remove Kaneo-only relation helpers from the live Kaneo path, or leave the file only if other non-Kaneo code still imports it.
- Modify: `src/providers/kaneo/classify-error.ts`
- Modify: `tests/providers/kaneo/task-relations.test.ts`
- Modify: `tests/providers/kaneo/task-resource.test.ts`
- Modify: `tests/tools/task-relation-tools.test.ts`
- Modify: `tests/e2e/task-relations.test.ts`

- [ ] **Step 1: Write the failing relation-resource tests against documented primitives**

Update `tests/providers/kaneo/task-relations.test.ts` with relation-resource-ID-backed tests:

```typescript
test('adds relation through POST /task-relation with documented relationType', async () => {
  const requests: Array<{ url: string; method: string; body?: unknown }> = []

  setMockFetch((url, options) => {
    requests.push({
      url,
      method: options.method ?? 'GET',
      body: typeof options.body === 'string' ? (JSON.parse(options.body) as unknown) : undefined,
    })

    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'rel-1',
          sourceTaskId: 'task-1',
          targetTaskId: 'task-2',
          relationType: 'blocks',
          createdAt: '2026-05-14T09:00:00.000Z',
        }),
        { status: 200 },
      ),
    )
  })

  const result = await addTaskRelation(mockConfig, 'task-1', 'task-2', 'blocks')

  expect(requests[0]).toMatchObject({
    url: 'https://api.test.com/api/task-relation',
    method: 'POST',
    body: { sourceTaskId: 'task-1', targetTaskId: 'task-2', relationType: 'blocks' },
  })
  expect(result).toEqual({ taskId: 'task-1', relatedTaskId: 'task-2', type: 'blocks' })
})

test('updates relation by resolving relation id, deleting it, then recreating it', async () => {
  const requests: Array<{ url: string; method: string; body?: unknown }> = []

  setMockFetch((url, options) => {
    requests.push({
      url,
      method: options.method ?? 'GET',
      body: typeof options.body === 'string' ? (JSON.parse(options.body) as unknown) : undefined,
    })

    if (url.endsWith('/api/task-relation/task-1')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            relations: [
              {
                id: 'rel-1',
                sourceTaskId: 'task-1',
                targetTaskId: 'task-2',
                relationType: 'related',
                createdAt: '2026-05-14T09:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        ),
      )
    }

    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'rel-1',
          sourceTaskId: 'task-1',
          targetTaskId: 'task-2',
          relationType: 'blocks',
          createdAt: '2026-05-14T09:00:00.000Z',
        }),
        { status: 200 },
      ),
    )
  })

  const result = await updateTaskRelation(mockConfig, 'task-1', 'task-2', 'blocks')

  expect(requests.map((request) => request.method)).toEqual(['GET', 'DELETE', 'POST'])
  expect(result).toEqual({ taskId: 'task-1', relatedTaskId: 'task-2', type: 'blocks' })
})

test('removes relation by looking up relation id then DELETE /task-relation/{id}', async () => {
  setMockFetch((url) => {
    if (url.endsWith('/api/task-relation/task-1')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            relations: [
              {
                id: 'rel-1',
                sourceTaskId: 'task-1',
                targetTaskId: 'task-2',
                relationType: 'blocks',
                createdAt: '2026-05-14T09:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        ),
      )
    }

    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'rel-1',
          sourceTaskId: 'task-1',
          targetTaskId: 'task-2',
          relationType: 'blocks',
          createdAt: '2026-05-14T09:00:00.000Z',
        }),
        { status: 200 },
      ),
    )
  })

  const result = await removeTaskRelation(mockConfig, 'task-1', 'task-2')
  expect(result).toEqual({ taskId: 'task-1', relatedTaskId: 'task-2', success: true })
})
```

- [ ] **Step 2: Run the relation tests and confirm they fail**

Run:

```bash
bun test tests/providers/kaneo/task-relations.test.ts tests/tools/task-relation-tools.test.ts tests/e2e/task-relations.test.ts
```

Expected: FAIL because the current implementation still persists relations in task description frontmatter.

- [ ] **Step 3: Implement relation schemas and resource helpers over documented endpoints**

Update `src/providers/kaneo/task-relations.ts` with explicit resource schemas and helper lookup:

```typescript
const KaneoRelationTypeSchema = z.enum(['blocks', 'related', 'subtask'])

const KaneoRelationSchema = z.object({
  id: z.string(),
  sourceTaskId: z.string(),
  targetTaskId: z.string(),
  relationType: KaneoRelationTypeSchema,
  createdAt: z.string().datetime(),
})

const KaneoTaskRelationsResponseSchema = z.object({
  relations: z.array(KaneoRelationSchema),
})

const mapOutgoingRelationType = (type: RelationType): z.infer<typeof KaneoRelationTypeSchema> => {
  if (type === 'blocks') return 'blocks'
  if (type === 'related') return 'related'
  if (type === 'parent' || type === 'child') return 'subtask'
  throw new KaneoClassifiedError(
    `Kaneo does not document relation type: ${type}`,
    providerError.unsupportedOperation(`Kaneo relation type ${type}`),
  )
}

const findRelation = async (config: KaneoConfig, taskId: string, relatedTaskId: string) => {
  const response = await kaneoFetch(
    config,
    'GET',
    `/task-relation/${taskId}`,
    undefined,
    undefined,
    KaneoTaskRelationsResponseSchema,
  )
  return response.relations.find((relation) => relation.targetTaskId === relatedTaskId)
}
```

- [ ] **Step 4: Replace Kaneo frontmatter relation behavior with doc-first create/get/delete operations**

Continue updating `src/providers/kaneo/task-relations.ts`, `src/providers/kaneo/task-resource.ts`, and wrappers:

```typescript
export async function addTaskRelation(
  config: KaneoConfig,
  taskId: string,
  relatedTaskId: string,
  type: RelationType,
): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  const relationType = mapOutgoingRelationType(type)

  await kaneoFetch(
    config,
    'POST',
    '/task-relation',
    {
      sourceTaskId: taskId,
      targetTaskId: relatedTaskId,
      relationType,
    },
    undefined,
    KaneoRelationSchema,
  )

  return { taskId, relatedTaskId, type }
}

export async function removeTaskRelation(
  config: KaneoConfig,
  taskId: string,
  relatedTaskId: string,
): Promise<{ taskId: string; relatedTaskId: string; success: true }> {
  const relation = await findRelation(config, taskId, relatedTaskId)
  if (relation === undefined) {
    throw new KaneoClassifiedError(
      `Relation between task ${taskId} and ${relatedTaskId} not found`,
      providerError.relationNotFound(taskId, relatedTaskId),
    )
  }

  await kaneoFetch(config, 'DELETE', `/task-relation/${relation.id}`, undefined, undefined, KaneoRelationSchema)
  return { taskId, relatedTaskId, success: true }
}

export async function updateTaskRelation(
  config: KaneoConfig,
  taskId: string,
  relatedTaskId: string,
  type: RelationType,
): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  await removeTaskRelation(config, taskId, relatedTaskId)
  return await addTaskRelation(config, taskId, relatedTaskId, type)
}
```

Also update `src/providers/kaneo/task-resource.ts` so `get()` no longer parses relation state from `description`. Instead, fetch task details first, fetch `/task-relation/{taskId}` second, and map those relations into papai's normalized `relations` array.

- [ ] **Step 5: Narrow Kaneo tool/provider relation expectations and run the tests**

Update `tests/tools/task-relation-tools.test.ts` and `tests/e2e/task-relations.test.ts` so Kaneo expectations only exercise documented native relation types (`blocks`, `related`, and `parent` only if mapped to `subtask`). Remove assertions that relation state is stored in the task description.

Run:

```bash
bun test tests/providers/kaneo/task-relations.test.ts tests/providers/kaneo/task-resource.test.ts tests/tools/task-relation-tools.test.ts tests/e2e/task-relations.test.ts
```

Expected: PASS with first-class relation persistence and no frontmatter assertions.

- [ ] **Step 6: Commit**

```bash
git add src/providers/kaneo/task-relations.ts src/providers/kaneo/task-resource.ts src/providers/kaneo/add-task-relation.ts src/providers/kaneo/update-task-relation.ts src/providers/kaneo/remove-task-relation.ts src/providers/kaneo/frontmatter.ts src/providers/kaneo/classify-error.ts tests/providers/kaneo/task-relations.test.ts tests/providers/kaneo/task-resource.test.ts tests/tools/task-relation-tools.test.ts tests/e2e/task-relations.test.ts
git commit -m "refactor: move Kaneo relations to first-class relation resources"
```

### Task 5: Preserve Runtime-Verified Kaneo Label Delete Behavior

**Files:**

- Modify: `src/providers/kaneo/label-resource.ts`
- Modify: `src/providers/kaneo/constants.ts`
- Modify: `tests/providers/kaneo/label-resource.test.ts`
- Modify: `tests/providers/kaneo/index.test.ts`
- Modify: `tests/tools/tools-builder.test.ts`
- Modify: `tests/e2e/label-operations.test.ts`
- Modify: `tests/e2e/kaneo-test-client.ts`

- [x] **Step 1: Write the failing runtime-first label-delete tests**

Update `tests/providers/kaneo/label-resource.test.ts`, `tests/providers/kaneo/index.test.ts`, and `tests/e2e/label-operations.test.ts` to reflect live Kaneo runtime behavior:

```typescript
test('rejects deleting unattached workspace labels', async () => {
  setMockFetch(() =>
    Promise.resolve(
      new Response(JSON.stringify({ id: 'label-1', name: 'bug', color: '#ff0000', taskId: null }), {
        status: 200,
      }),
    ),
  )

  const resource = new LabelResource(mockConfig)
  const promise = resource.remove('label-1')
  await expect(promise).rejects.toHaveProperty('appError.code', 'unsupported-operation')
})

test('KaneoProvider does not expose labels.delete capability', () => {
  const provider = new KaneoProvider({ apiKey: 'test-key', baseUrl: 'https://api.test.com' }, 'workspace-1')
  expect(provider.capabilities.has('labels.delete')).toBe(false)
})

test('throws error when removing unattached label', async () => {
  const label = await createLabel({
    config: kaneoConfig,
    workspaceId: testClient.getWorkspaceId(),
    name: 'Unattached Remove',
  })
  testClient.trackLabel(label.id)

  const promise = removeLabel({ config: kaneoConfig, labelId: label.id })
  await expect(promise).rejects.toThrow()
})
```

- [x] **Step 2: Run the label tests and confirm they fail**

Run:

```bash
bun test tests/providers/kaneo/label-resource.test.ts tests/providers/kaneo/index.test.ts tests/tools/tools-builder.test.ts
bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/e2e.test.ts --test-name-pattern "E2E: Label Operations"
```

Expected: FAIL because Kaneo currently suppresses `labels.delete` and rejects unattached-label deletion as unsupported.

- [x] **Step 3: Keep runtime-verified label delete semantics and capability suppression**

Update `src/providers/kaneo/label-resource.ts` and `src/providers/kaneo/constants.ts`:

```typescript
async remove(labelId: string): Promise<{ id: string; success: true }> {
  this.log.debug({ labelId }, 'Removing label')

  try {
    const label = await kaneoFetch(this.config, 'GET', `/label/${labelId}`, undefined, undefined, CreateLabelResponseSchema)

    if (label.taskId === null) {
      throw new KaneoClassifiedError(
        `Label ${labelId} cannot be deleted because Kaneo only deletes labels that are attached to a task`,
        providerError.unsupportedOperation('remove unattached Kaneo label'),
      )
    }

    await kaneoFetch(this.config, 'DELETE', `/label/${labelId}`, undefined, undefined, z.unknown())

    this.log.info({ labelId }, 'Label removed')
    return { id: labelId, success: true }
  } catch (error) {
    this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to remove label')
    throw classifyKaneoError(error)
  }
}
```

```typescript
export const ALL_CAPABILITIES: ReadonlySet<TaskCapability> = new Set<TaskCapability>([
  'tasks.delete',
  'tasks.relations',
  'projects.read',
  'projects.list',
  'projects.create',
  'projects.update',
  'projects.delete',
  'comments.read',
  'comments.create',
  'comments.update',
  'comments.delete',
  'labels.list',
  'labels.create',
  'labels.update',
  'labels.assign',
  'statuses.list',
  'statuses.create',
  'statuses.update',
  'statuses.delete',
  'statuses.reorder',
])
```

- [x] **Step 4: Keep cleanup/test utilities aligned with attached-label-only runtime delete and run the label suites**

Update `tests/e2e/kaneo-test-client.ts` so cleanup only attempts `removeLabel()` for tracked labels that are still attached to a task.

Run:

```bash
bun test tests/providers/kaneo/label-resource.test.ts tests/providers/kaneo/index.test.ts tests/tools/tools-builder.test.ts
bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/e2e.test.ts --test-name-pattern "E2E: Label Operations"
```

Expected: PASS with Kaneo `labels.delete` still hidden, unattached delete still rejected, and E2E cleanup preserving the attached-label safety check.

- [ ] **Step 5: Commit**

```bash
git add src/providers/kaneo/label-resource.ts src/providers/kaneo/constants.ts tests/providers/kaneo/label-resource.test.ts tests/providers/kaneo/index.test.ts tests/tools/tools-builder.test.ts tests/e2e/label-operations.test.ts tests/e2e/kaneo-test-client.ts
git commit -m "test: align Kaneo label deletion with live runtime behavior"
```

### Task 6: Run Full Kaneo Verification Gates

**Files:**

- Verify only: `tests/providers/kaneo/task-resource.test.ts`
- Verify only: `tests/providers/kaneo/search-tasks.test.ts`
- Verify only: `tests/providers/kaneo/comment-resource.test.ts`
- Verify only: `tests/providers/kaneo/task-relations.test.ts`
- Verify only: `tests/providers/kaneo/label-resource.test.ts`
- Verify only: `tests/providers/kaneo/schema-validation.test.ts`
- Verify only: `tests/providers/kaneo/index.test.ts`
- Verify only: `tests/tools/label-tools.test.ts`
- Verify only: `tests/tools/task-label-tools.test.ts`
- Verify only: `tests/tools/task-relation-tools.test.ts`
- Verify only: `tests/e2e/task-comments.test.ts`
- Verify only: `tests/e2e/task-relations.test.ts`
- Verify only: `tests/e2e/label-operations.test.ts`

- [x] **Step 1: Run the Kaneo provider unit/integration suites**

Run:

```bash
bun test tests/providers/kaneo/task-resource.test.ts tests/providers/kaneo/search-tasks.test.ts tests/providers/kaneo/comment-resource.test.ts tests/providers/kaneo/task-relations.test.ts tests/providers/kaneo/label-resource.test.ts tests/providers/kaneo/schema-validation.test.ts tests/providers/kaneo/index.test.ts
```

Expected: PASS with the full Kaneo provider path aligned to verified Kaneo runtime behavior where docs and runtime diverge.

- [x] **Step 2: Run the Kaneo-related tool tests**

Run:

```bash
bun test tests/tools/label-tools.test.ts tests/tools/task-label-tools.test.ts tests/tools/task-relation-tools.test.ts
```

Expected: PASS with label-tool exposure still gated off for Kaneo, and relation-tool expectations aligned to documented Kaneo relation support.

- [x] **Step 3: Run the targeted Kaneo E2E suites**

Run:

```bash
bun test --preload ./tests/e2e/bun-test-setup.ts --path-ignore-patterns '' tests/e2e/e2e.test.ts --test-name-pattern "E2E: Task Comments|E2E: Task Relations|E2E: Label Operations"
```

Expected: PASS with direct `/comment` CRUD, first-class relation persistence, and runtime-verified attached-label-only Kaneo deletion semantics.

- [x] **Step 4: Run the full E2E suite**

Run:

```bash
bun test:e2e
```

Expected: PASS with no Kaneo regressions in the broader provider-real Docker-backed suite, including live `/search` runtime-envelope parsing and relation assertions that no longer depend on description frontmatter.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-05-14-kaneo-latest-api-migration.md
git commit -m "docs: add Kaneo latest API migration plan"
```

## Drift Log

| Date       | Category               | Item                                                                                  | Decision                                                                                                                                                                     |
| ---------- | ---------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-14 | In-plan, partial       | Task 1 files in `src/providers/kaneo/task-resource.ts` and related tests              | Keep current runtime-safe list-envelope edits; finish doc-first `startDate` and published list contract                                                                      |
| 2026-05-14 | In-plan, partial       | Task 3 files in comment schemas/tests and `src/providers/kaneo/schemas/api-compat.ts` | Keep current activity drift compatibility only as transitional context; migrate mainline CRUD to `/comment`                                                                  |
| 2026-05-14 | In-plan, divergent     | Task 5 files in label resource/capabilities/tests                                     | Live Kaneo runtime and upstream controller still reject unattached label deletion with 400, so keep `labels.delete` hidden and preserve attached-label-only delete behavior  |
| 2026-05-14 | In-plan, divergent     | Task 1 list-task payload shape                                                        | User chose runtime-compatible `{ data, pagination }` envelope over stricter grouped top-level shape due Kaneo docs/runtime ambiguity                                         |
| 2026-05-14 | Out-of-plan, on-goal   | Shared `TaskProvider` signatures in `src/providers/types.ts` need `startDate`         | User approved extending Task 1 to align the public provider contract with the implemented Kaneo `startDate` support                                                          |
| 2026-05-14 | Out-of-plan, on-goal   | Shared normalized `Task` output and Kaneo mappers need `startDate`                    | User approved extending Task 1 so provider outputs can round-trip the new `startDate` field                                                                                  |
| 2026-05-14 | In-plan, divergent     | Task 2 search response shape                                                          | Live Kaneo `ghcr.io/usekaneo/kaneo:2.7.2` returns `/search` as `{ results, totalCount, searchQuery }`, so the provider now normalizes both runtime and grouped-doc envelopes |
| 2026-05-14 | In-plan, stale anchors | Task 6 verification expectations for labels and search                                | Updated Task 6 expectations to match verified runtime-first label behavior and dual-envelope search parsing                                                                  |
| 2026-05-14 | In-plan, stale anchors | Task 6 targeted E2E command                                                           | Updated the plan to use the preload-backed `tests/e2e/e2e.test.ts` entrypoint and `--test-name-pattern` filtering used by the repo harness                                   |
