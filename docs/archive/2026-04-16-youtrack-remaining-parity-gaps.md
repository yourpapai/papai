<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack Remaining Parity Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining YouTrack parity gaps by adding pagination controls to the highest-volume read tools, making the summary-only task lookup decision explicit, and removing the last provider-side hard cap on project listing.

**Architecture:** Extend the shared provider contract only where the exposed tool surface truly needs it, using optional pagination params that preserve current callers. Reuse existing YouTrack `$top`/`$skip` behavior, but keep `offset`-only reads from silently truncating by continuing bounded pagination from the requested offset when no explicit limit is supplied. Avoid introducing a redundant summary tool unless the contract win is clear and documented.

**Tech Stack:** Bun, TypeScript, Zod v4, Vercel AI SDK tools, Bun test runner, YouTrack REST API

---

## File Map

**Provider files to modify**

- `src/providers/types.ts`: add minimal optional pagination params for comments and work items; optionally add a summary-specific method only if the summary tool is approved.
- `src/providers/youtrack/operations/comments.ts`: thread `limit` and `offset` into comment reads using `$top` and `$skip`, while keeping `offset`-only requests from falling back to YouTrack's server-default page size.
- `src/providers/youtrack/operations/work-items.ts`: thread `limit` and `offset` into work-item reads using `$top` and `$skip`, while keeping `offset`-only requests from falling back to YouTrack's server-default page size.
- `src/providers/youtrack/operations/tasks.ts`: extend search pagination beyond the current `limit`-only contract if the chosen tool contract needs offset/page behavior.
- `src/providers/youtrack/operations/projects.ts`: replace the fixed `$top=100` project listing cap with paginated collection fetching.
- `src/providers/youtrack/index.ts`: wire new optional provider params through the concrete provider methods.
- `src/providers/youtrack/helpers.ts`: reuse existing `paginate()` helper; extending it with an initial offset is acceptable when that avoids duplicating bounded pagination logic for offset-only reads.

**Tool files to modify**

- `src/tools/get-comments.ts`: add `limit` and `offset` inputs and pass them through.
- `src/tools/list-work.ts`: add `limit` and `offset` inputs and pass them through.
- `src/tools/search-tasks.ts`: add either `offset` plus `limit` or `page` plus `limit`; prefer `offset` plus `limit` to match existing `get_task_history` semantics and YouTrack REST API pagination.
- `src/tools/list-projects.ts`: leave the tool contract unchanged unless product requirements justify surfacing pagination to models.
- `src/tools/tools-builder.ts`: only modify if a summary-only tool is approved.
- `src/tools/get-task.ts`: keep as the fallback full-detail path; optionally share logic with a new summary-only tool if that tool is approved.
- `src/tools/index.ts`: no functional change expected unless a new summary-only tool is added and its assembly needs a public wiring check.

**Tests to modify or create**

- `tests/tools/comment-tools.test.ts`: add schema and execution coverage for paginated `get_comments`.
- `tests/tools/work-item-tools.test.ts`: add schema and execution coverage for paginated `list_work`.
- `tests/tools/search-tasks.test.ts`: add schema and execution coverage for the chosen search pagination contract.
- `tests/providers/youtrack/operations/comments.test.ts`: assert `$top` and `$skip` query propagation, plus safe `offset`-only behavior that does not silently truncate results.
- `tests/providers/youtrack/operations/work-items.test.ts`: assert `$top` and `$skip` query propagation, plus safe `offset`-only behavior that does not silently truncate results.
- `tests/providers/youtrack/operations/tasks.test.ts`: assert the chosen search pagination query parameters.
- `tests/providers/youtrack/operations/projects.test.ts`: replace the current `$top=100` assumption with paginated project fetch expectations.
- `tests/tools/tools-builder.test.ts`: add or update expectations only if a summary-only tool is approved.
- `tests/providers/youtrack/tools-integration.test.ts`: add or update expectations only if a summary-only tool is approved.
- `tests/tools/get-task-summary.test.ts`: create only if a summary-only tool is approved.

---

## Task 1: Add Pagination to `get_comments`

**Files:**

- Modify: `src/providers/types.ts`
- Modify: `src/providers/youtrack/operations/comments.ts`
- Modify: `src/providers/youtrack/index.ts`
- Modify: `src/tools/get-comments.ts`
- Modify: `tests/tools/comment-tools.test.ts`
- Modify: `tests/providers/youtrack/operations/comments.test.ts`

- [ ] **Step 1: Write the failing tool schema test for comment pagination**

Add this test to `tests/tools/comment-tools.test.ts` inside the `makeGetCommentsTool` block:

```typescript
test('accepts optional limit and offset for comment pagination', () => {
  const provider = createMockProvider()
  const tool = makeGetCommentsTool(provider)

  expect(schemaValidates(tool, { taskId: 'task-1', limit: 20, offset: 40 })).toBe(true)
  expect(schemaValidates(tool, { taskId: 'task-1', limit: 0 })).toBe(false)
  expect(schemaValidates(tool, { taskId: 'task-1', offset: -1 })).toBe(false)
})
```

- [ ] **Step 2: Write the failing tool execution test for comment pagination passthrough**

Add this test to `tests/tools/comment-tools.test.ts` near the existing `gets all comments on task` coverage:

```typescript
test('passes limit and offset to provider.getComments', async () => {
  const getComments = mock(() => Promise.resolve([]))
  const provider = createMockProvider({ getComments })
  const tool = makeGetCommentsTool(provider)

  await getToolExecutor(tool)({ taskId: 'task-1', limit: 20, offset: 40 }, { toolCallId: '1', messages: [] })

  expect(getComments).toHaveBeenCalledWith('task-1', { limit: 20, offset: 40 })
})
```

- [ ] **Step 3: Write the failing provider tests for explicit and offset-only comment pagination**

Add this test to `tests/providers/youtrack/operations/comments.test.ts` inside `describe('getYouTrackComments', ...)`:

```typescript
test('passes $top and $skip when pagination params are provided', async () => {
  mockFetchResponse([])

  await getYouTrackComments(config, 'TEST-1', { limit: 20, offset: 40 })

  const url = getLastFetchUrl()
  expect(url.pathname).toBe('/api/issues/TEST-1/comments')
  expect(url.searchParams.get('$top')).toBe('20')
  expect(url.searchParams.get('$skip')).toBe('40')
})
```

Add this second test to cover the `offset`-only edge case:

```typescript
test('continues bounded pagination from the requested offset when only offset is provided', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) =>
    makeCommentResponse({ id: `comment-${index + 41}`, text: `Comment ${index + 41}` }),
  )
  const secondPage = [makeCommentResponse({ id: 'comment-141', text: 'Comment 141' })]

  installFetchMock((url) => {
    const requestUrl = new URL(url)
    const skip = requestUrl.searchParams.get('$skip')

    if (skip === '40') {
      return Promise.resolve(
        new Response(JSON.stringify(firstPage), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    if (skip === '140') {
      return Promise.resolve(
        new Response(JSON.stringify(secondPage), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    return Promise.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  const comments = await getYouTrackComments(config, 'TEST-1', { offset: 40 })

  expect(comments).toHaveLength(101)
  const firstUrl = getFetchUrl(0)
  expect(firstUrl.searchParams.get('$top')).toBe('100')
  expect(firstUrl.searchParams.get('$skip')).toBe('40')
  const secondUrl = getFetchUrl(1)
  expect(secondUrl.searchParams.get('$top')).toBe('100')
  expect(secondUrl.searchParams.get('$skip')).toBe('140')
})
```

- [ ] **Step 4: Run the focused comment suites to verify they fail**

Run:

```bash
bun test tests/tools/comment-tools.test.ts tests/providers/youtrack/operations/comments.test.ts
```

Expected: FAIL because `get_comments` only accepts `taskId`, the shared provider contract does not accept pagination params, and the YouTrack comment reader cannot yet distinguish explicit pagination from safe `offset`-only pagination.

- [ ] **Step 5: Extend the shared provider contract minimally**

Update `src/providers/types.ts` so the comment reader becomes:

```typescript
  getComments?(taskId: string, params?: { limit?: number; offset?: number }): Promise<Comment[]>
```

Do not change add, update, or delete comment signatures.

- [ ] **Step 6: Implement paginated comments in the YouTrack provider operation**

Update `src/providers/youtrack/operations/comments.ts` so `getYouTrackComments` becomes:

```typescript
export async function getYouTrackComments(
  config: YouTrackConfig,
  taskId: string,
  params?: { limit?: number; offset?: number },
): Promise<Comment[]> {
  log.debug({ taskId, params }, 'getComments')
  try {
    if (params?.limit !== undefined) {
      const query: Record<string, string> = { fields: COMMENT_FIELDS }
      if (params?.limit !== undefined) query['$top'] = String(params.limit)
      if (params?.offset !== undefined) query['$skip'] = String(params.offset)

      const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/comments`, { query })
      const comments = CommentSchema.array().parse(raw)
      log.info({ taskId, count: comments.length }, 'Comments retrieved')
      return comments.map(mapComment)
    }

    if (params?.offset !== undefined) {
      const comments = await paginateYouTrackCommentsFromOffset(config, taskId, params.offset, 100, 10)
      log.info({ taskId, count: comments.length }, 'Comments retrieved')
      return comments.map(mapComment)
    }

    const comments = await paginate(
      config,
      `/api/issues/${taskId}/comments`,
      { fields: COMMENT_FIELDS },
      CommentSchema.array(),
    )
    log.info({ taskId, count: comments.length }, 'Comments retrieved')
    return comments.map(mapComment)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to get comments')
    throw classifyYouTrackError(error, { taskId })
  }
}
```

Add local helpers in the same file to preserve the existing bounded pagination semantics while starting from an explicit offset:

```typescript
function paginateYouTrackCommentsFromOffset(
  config: YouTrackConfig,
  taskId: string,
  offset: number,
  pageSize: number,
  maxPages: number,
): Promise<readonly YouTrackComment[]> {
  return paginateYouTrackCommentsPage(config, taskId, offset, pageSize, maxPages, [])
}

async function paginateYouTrackCommentsPage(
  config: YouTrackConfig,
  taskId: string,
  offset: number,
  pageSize: number,
  maxPages: number,
  accumulated: readonly YouTrackComment[],
): Promise<readonly YouTrackComment[]> {
  if (accumulated.length >= maxPages * pageSize) {
    return accumulated
  }

  const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/comments`, {
    query: {
      fields: COMMENT_FIELDS,
      $top: String(pageSize),
      $skip: String(offset),
    },
  })
  const comments = CommentSchema.array().parse(raw)
  const nextAccumulated = [...accumulated, ...comments]

  if (comments.length < pageSize) {
    return nextAccumulated
  }

  return paginateYouTrackCommentsPage(config, taskId, offset + pageSize, pageSize, maxPages, nextAccumulated)
}
```

- [ ] **Step 7: Wire the concrete provider and tool passthrough**

Update `src/providers/youtrack/index.ts` and `src/tools/get-comments.ts` to:

```typescript
  getComments(taskId: string, params?: { limit?: number; offset?: number }): Promise<Comment[]> {
    return getYouTrackComments(this.config, taskId, params)
  }
```

```typescript
inputSchema: z.object({
  taskId: z.string().describe('Task ID'),
  limit: z.number().int().positive().optional().describe('Maximum number of comments to return'),
  offset: z.number().int().min(0).optional().describe('Number of comments to skip before returning results'),
}),
execute: async ({ taskId, limit, offset }) => {
  return await provider.getComments!(taskId, { limit, offset })
}
```

Also add one tool-level passthrough test covering `offset`-only and `limit`-only calls so the semantics stay explicit.

- [ ] **Step 8: Run the comment suites to verify they pass**

Run:

```bash
bun test tests/tools/comment-tools.test.ts tests/providers/youtrack/operations/comments.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the comment pagination change**

```bash
git add src/providers/types.ts src/providers/youtrack/operations/comments.ts src/providers/youtrack/index.ts src/tools/get-comments.ts tests/tools/comment-tools.test.ts tests/providers/youtrack/operations/comments.test.ts
git commit -m "feat(youtrack): add comment pagination controls"
```

## Task 2: Add Pagination to `list_work`

**Files:**

- Modify: `src/providers/types.ts`
- Modify: `src/providers/youtrack/operations/work-items.ts`
- Modify: `src/providers/youtrack/index.ts`
- Modify: `src/tools/list-work.ts`
- Modify: `tests/tools/work-item-tools.test.ts`
- Modify: `tests/providers/youtrack/operations/work-items.test.ts`

- [ ] **Step 1: Write the failing tool schema test for work-item pagination**

Add this test to `tests/tools/work-item-tools.test.ts` inside `describe('makeListWorkTool', ...)`:

```typescript
test('schema accepts optional limit and offset', () => {
  const provider = createMockProvider()
  const t = makeListWorkTool(provider)

  expect(schemaValidates(t, { taskId: 'task-1', limit: 10, offset: 30 })).toBe(true)
  expect(schemaValidates(t, { taskId: 'task-1', limit: 0 })).toBe(false)
  expect(schemaValidates(t, { taskId: 'task-1', offset: -1 })).toBe(false)
})
```

- [ ] **Step 2: Write the failing tool execution test for work-item pagination passthrough**

Add this test to `tests/tools/work-item-tools.test.ts`:

```typescript
test('passes limit and offset to provider.listWorkItems', async () => {
  const listWorkItems = mock(() => Promise.resolve([]))
  const provider = createMockProvider({ listWorkItems })

  await getToolExecutor(makeListWorkTool(provider))({ taskId: 'task-99', limit: 10, offset: 30 })

  expect(listWorkItems).toHaveBeenCalledWith('task-99', { limit: 10, offset: 30 })
})
```

- [ ] **Step 3: Write the failing provider tests for explicit and offset-only work-item pagination**

Add this test to `tests/providers/youtrack/operations/work-items.test.ts` inside `describe('listYouTrackWorkItems', ...)`:

```typescript
test('passes $top and $skip when pagination params are provided', async () => {
  mockFetchResponse([])

  await listYouTrackWorkItems(config, 'PROJ-42', { limit: 10, offset: 30 })

  const url = getLastFetchUrl()
  expect(url.pathname).toBe('/api/issues/PROJ-42/timeTracking/workItems')
  expect(url.searchParams.get('$top')).toBe('10')
  expect(url.searchParams.get('$skip')).toBe('30')
})
```

Add this second test to cover the `offset`-only edge case:

```typescript
test('uses paginated fetching for offset-only requests so results are not silently truncated', async () => {
  installFetchMock((url: string) => {
    const parsedUrl = new URL(url)
    const skip = parsedUrl.searchParams.get('$skip')
    const top = parsedUrl.searchParams.get('$top')

    if (skip === '30' && top === '100') {
      return Promise.resolve(
        new Response(
          JSON.stringify(Array.from({ length: 100 }, (_, index) => makeWorkItemResponse({ id: `8-${31 + index}` }))),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
    }

    if (skip === '130' && top === '100') {
      return Promise.resolve(
        new Response(JSON.stringify([makeWorkItemResponse({ id: '8-131' })]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    return Promise.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  const result = await listYouTrackWorkItems(config, 'PROJ-42', { offset: 30 })

  expect(result).toHaveLength(101)
  expect(fetchMock.mock.calls).toHaveLength(2)
  const firstUrl = new URL(FetchCallSchema.parse(fetchMock.mock.calls[0])[0])
  const secondUrl = new URL(FetchCallSchema.parse(fetchMock.mock.calls[1])[0])
  expect(firstUrl.searchParams.get('$skip')).toBe('30')
  expect(firstUrl.searchParams.get('$top')).toBe('100')
  expect(secondUrl.searchParams.get('$skip')).toBe('130')
  expect(secondUrl.searchParams.get('$top')).toBe('100')
})
```

- [ ] **Step 4: Run the focused work-item suites to verify they fail**

Run:

```bash
bun test tests/tools/work-item-tools.test.ts tests/providers/youtrack/operations/work-items.test.ts
```

Expected: FAIL because `list_work` only accepts `taskId`, the provider contract does not accept pagination params, and the operation cannot yet distinguish explicit pagination from safe `offset`-only pagination.

- [ ] **Step 5: Extend the shared work-item contract minimally**

Update `src/providers/types.ts` so the work-item reader becomes:

```typescript
  listWorkItems?(taskId: string, params?: { limit?: number; offset?: number }): Promise<WorkItem[]>
```

- [ ] **Step 6: Implement paginated work-item fetching in the YouTrack operation**

Update `src/providers/youtrack/operations/work-items.ts` so `listYouTrackWorkItems` becomes:

```typescript
export async function listYouTrackWorkItems(
  config: YouTrackConfig,
  taskId: string,
  params?: { limit?: number; offset?: number },
): Promise<WorkItem[]> {
  log.debug({ taskId, params }, 'listWorkItems')
  try {
    if (params?.limit !== undefined) {
      const query: Record<string, string> = { fields: WORK_ITEM_FIELDS }
      if (params?.limit !== undefined) query['$top'] = String(params.limit)
      if (params?.offset !== undefined) query['$skip'] = String(params.offset)

      const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/timeTracking/workItems`, { query })
      const items = YouTrackWorkItemSchema.array().parse(raw)
      log.info({ taskId, count: items.length }, 'Work items listed')
      return items.map((wi) => mapWorkItem(wi, taskId))
    }

    const items = await paginate(
      config,
      `/api/issues/${taskId}/timeTracking/workItems`,
      { fields: WORK_ITEM_FIELDS },
      YouTrackWorkItemSchema.array(),
      undefined,
      undefined,
      params?.offset ?? 0,
    )
    log.info({ taskId, count: items.length }, 'Work items listed')
    return items.map((wi) => mapWorkItem(wi, taskId))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to list work items')
    throw classifyYouTrackError(error, { taskId })
  }
}
```

Update `src/providers/youtrack/helpers.ts` so `paginate` can start from a non-zero initial offset without duplicating the pagination loop:

```typescript
export function paginate<T>(
  config: YouTrackConfig,
  path: string,
  query: Record<string, YouTrackQueryValue>,
  schema: z.ZodType<T[]>,
  maxPages = 10,
  pageSize = 100,
  initialSkip = 0,
): Promise<T[]> {
  return paginatePage(config, path, query, schema, maxPages, pageSize, initialSkip, [])
}
```

This keeps the existing default behavior intact while letting offset-only work-item reads continue bounded pagination from the requested skip.

- [ ] **Step 7: Wire the concrete provider and tool passthrough**

Update `src/providers/youtrack/index.ts` and `src/tools/list-work.ts` to:

```typescript
  listWorkItems(taskId: string, params?: { limit?: number; offset?: number }): Promise<WorkItem[]> {
    return listYouTrackWorkItems(this.config, taskId, params)
  }
```

```typescript
inputSchema: z.object({
  taskId: z.string().describe('Task ID to list work items for'),
  limit: z.number().int().positive().optional().describe('Maximum number of work items to return'),
  offset: z.number().int().min(0).optional().describe('Number of work items to skip before returning results'),
}),
execute: async ({ taskId, limit, offset }) => {
  const result = await provider.listWorkItems!(taskId, { limit, offset })
  log.info({ taskId, count: result.length }, 'Work items listed')
  return result
}
```

- [ ] **Step 8: Run the work-item suites to verify they pass**

Run:

```bash
bun test tests/tools/work-item-tools.test.ts tests/providers/youtrack/operations/work-items.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the work-item pagination change**

```bash
git add src/providers/types.ts src/providers/youtrack/operations/work-items.ts src/providers/youtrack/index.ts src/tools/list-work.ts tests/tools/work-item-tools.test.ts tests/providers/youtrack/operations/work-items.test.ts
git commit -m "feat(youtrack): add work-item pagination controls"
```

## Task 3: Add Search Pagination Beyond `limit`

**Files:**

- Modify: `src/providers/types.ts`
- Modify: `src/providers/youtrack/operations/tasks.ts`
- Modify: `src/providers/youtrack/index.ts`
- Modify: `src/tools/search-tasks.ts`
- Modify: `tests/tools/search-tasks.test.ts`
- Modify: `tests/providers/youtrack/operations/tasks.test.ts`

- [ ] **Step 1: Write the failing tool schema test for search pagination**

Add this test to `tests/tools/search-tasks.test.ts`:

```typescript
test('accepts offset and limit for paginated search results', () => {
  const tool = makeSearchTasksTool(createMockProvider(), 'test-search-identity')

  expect(tool.inputSchema.safeParse({ query: 'tasks', limit: 25, offset: 50 }).success).toBe(true)
  expect(tool.inputSchema.safeParse({ query: 'tasks', offset: -1 }).success).toBe(false)
})
```

- [ ] **Step 2: Write the failing tool passthrough test for search pagination**

Add this test to `tests/tools/search-tasks.test.ts`:

```typescript
test('passes offset and limit to provider.searchTasks', async () => {
  const searchTasks = mock(() => Promise.resolve([]))
  const provider = createMockProvider({ searchTasks })
  const tool = makeSearchTasksTool(provider, 'test-search-identity')

  await tool.execute?.({ query: 'tasks', limit: 25, offset: 50 }, { toolCallId: '1', messages: [] })

  expect(searchTasks).toHaveBeenCalledWith({
    query: 'tasks',
    projectId: undefined,
    assigneeId: undefined,
    limit: 25,
    offset: 50,
  })
})
```

- [ ] **Step 3: Write the failing provider pagination test for search**

Add this test to `tests/providers/youtrack/operations/tasks.test.ts` near the search tests:

```typescript
test('passes $top and $skip when search pagination params are provided', async () => {
  mockFetchResponse([])

  await searchYouTrackTasks(config, { query: 'bug', limit: 25, offset: 50 })

  const url = getLastFetchUrl()
  expect(url.pathname).toBe('/api/issues')
  expect(url.searchParams.get('$top')).toBe('25')
  expect(url.searchParams.get('$skip')).toBe('50')
})
```

- [ ] **Step 4: Run the focused search suites to verify they fail**

Run:

```bash
bun test tests/tools/search-tasks.test.ts tests/providers/youtrack/operations/tasks.test.ts
```

Expected: FAIL because the shared search contract has no `offset`, the tool schema rejects it, and the provider search request does not send `$skip`.

- [ ] **Step 5: Extend the shared search contract with `offset`**

Update `src/providers/types.ts` so the search signature becomes:

```typescript
  searchTasks(params: {
    query: string
    projectId?: string
    assigneeId?: string
    limit?: number
    offset?: number
  }): Promise<TaskSearchResult[]>
```

Update the matching signatures in `src/providers/youtrack/index.ts` and `tests/tools/mock-provider.ts`.

- [ ] **Step 6: Implement `$skip` passthrough in the YouTrack search operation**

Update the request query assembly in `src/providers/youtrack/operations/tasks.ts` to:

```typescript
const raw = await youtrackFetch(config, 'GET', '/api/issues', {
  query: {
    fields: ISSUE_LIST_FIELDS,
    query,
    $top: String(params.limit ?? 50),
    ...(params.offset !== undefined ? { $skip: String(params.offset) } : {}),
    customFields: YOUTRACK_INLINE_LIST_CUSTOM_FIELDS,
  },
})
```

- [ ] **Step 7: Extend the tool schema and passthrough**

Update `src/tools/search-tasks.ts` to:

```typescript
inputSchema: z.object({
  query: z.string().describe('Search keyword or phrase'),
  projectId: z.string().optional().describe('Filter by project ID'),
  assigneeId: z.string().optional().describe('Filter by assignee user ID, or "me" to filter by your own tasks'),
  limit: z.number().int().positive().optional().describe('Maximum number of results to return'),
  offset: z.number().int().min(0).optional().describe('Number of matching tasks to skip before returning results'),
}),
execute: async ({ query, projectId, assigneeId, limit, offset }) => {
  const tasks = await provider.searchTasks({ query, projectId, assigneeId: resolvedAssigneeId, limit, offset })
  return tasks
}
```

- [ ] **Step 8: Run the search suites to verify they pass**

Run:

```bash
bun test tests/tools/search-tasks.test.ts tests/providers/youtrack/operations/tasks.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the search pagination change**

```bash
git add src/providers/types.ts src/providers/youtrack/operations/tasks.ts src/providers/youtrack/index.ts src/tools/search-tasks.ts tests/tools/search-tasks.test.ts tests/providers/youtrack/operations/tasks.test.ts tests/tools/mock-provider.ts
git commit -m "feat(youtrack): add search pagination controls"
```

## Task 4: Remove the Fixed `$top=100` Cap from `list_projects`

**Files:**

- Modify: `src/providers/youtrack/operations/projects.ts`
- Modify: `tests/providers/youtrack/operations/projects.test.ts`

- [ ] **Step 1: Write the failing provider test for multi-page project listing**

Add this test to `tests/providers/youtrack/operations/projects.test.ts` inside `describe('listYouTrackProjects', ...)`:

```typescript
test('fetches multiple pages when the first page reaches the pagination limit', async () => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) {
      return Promise.resolve(
        new Response(
          JSON.stringify(
            Array.from({ length: 100 }, (_, index) =>
              makeProjectResponse({ id: `proj-${index}`, shortName: `P${index}` }),
            ),
          ),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
    }

    return Promise.resolve(
      new Response(JSON.stringify([makeProjectResponse({ id: 'proj-last', shortName: 'LAST' })]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  const projects = await listYouTrackProjects(config)

  expect(projects).toHaveLength(101)
  expect(fetchMock.mock.calls).toHaveLength(2)
})
```

- [ ] **Step 2: Write the failing request-shape assertion for paginated projects**

Add this test to `tests/providers/youtrack/operations/projects.test.ts`:

```typescript
test('requests project pages with $top and $skip pagination params', async () => {
  let callCount = 0
  installFetchMock((url: string) => {
    callCount++
    const parsedUrl = new URL(url)
    if (callCount === 1) {
      expect(parsedUrl.searchParams.get('$top')).toBe('100')
      expect(parsedUrl.searchParams.get('$skip')).toBe('0')
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  await listYouTrackProjects(config)
})
```

- [ ] **Step 3: Run the project provider suite to verify it fails**

Run:

```bash
bun test tests/providers/youtrack/operations/projects.test.ts
```

Expected: FAIL because the implementation does a single request with a hard-coded `$top=100` and no paging loop.

- [ ] **Step 4: Replace the hard cap with the shared pagination helper**

Update `src/providers/youtrack/operations/projects.ts` so `listYouTrackProjects` becomes:

```typescript
export async function listYouTrackProjects(config: YouTrackConfig): Promise<Project[]> {
  log.debug('listProjects')
  try {
    const projects = await paginate(
      config,
      '/api/admin/projects',
      { fields: PROJECT_FIELDS },
      ProjectSchema.array(),
      10,
      100,
    )
    log.info({ count: projects.length }, 'Projects listed')
    return projects
      .filter((p) => p.archived !== true)
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        url: `${config.baseUrl}/projects/${p.shortName ?? p.id}`,
      }))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list projects')
    throw classifyYouTrackError(error)
  }
}
```

- [ ] **Step 5: Update the existing request expectation test**

Change the existing `uses GET method to /api/admin/projects` assertion in `tests/providers/youtrack/operations/projects.test.ts` so it expects both:

```typescript
expect(url.pathname).toBe('/api/admin/projects')
expect(url.searchParams.get('$top')).toBe('100')
expect(url.searchParams.get('$skip')).toBe('0')
```

- [ ] **Step 6: Run the project provider suite to verify it passes**

Run:

```bash
bun test tests/providers/youtrack/operations/projects.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the project pagination fix**

```bash
git add src/providers/youtrack/operations/projects.ts tests/providers/youtrack/operations/projects.test.ts
git commit -m "fix(youtrack): paginate project listing"
```

## Task 5: Decide and Document the Summary-Only Lookup Tool

Decision rule: only add a summary-only tool if it provides a materially smaller, lower-risk contract than `get_task` without creating provider-specific branching, duplicate maintenance, or new ambiguity for the model. Otherwise, explicitly document that `get_task` already covers the use case.

Chosen path: do not add `get_task_summary` in this pass. Keep `get_task` as the only single-task read tool and revisit only if model telemetry shows repeated over-fetch or tool misuse.

**Files:**

- Modify: `docs/superpowers/plans/2026-04-14-youtrack-tool-parity-checklist.md`
- Modify: `docs/superpowers/plans/2026-04-16-youtrack-remaining-parity-gaps.md`
- Optionally create: `src/tools/get-task-summary.ts`
- Optionally modify: `src/tools/tools-builder.ts`
- Optionally modify: `tests/tools/tools-builder.test.ts`
- Optionally modify: `tests/providers/youtrack/tools-integration.test.ts`
- Optionally create: `tests/tools/get-task-summary.test.ts`

- [ ] **Step 1: Write down the decision criteria before changing code**

Add this note under the Task 5 heading in this plan file while executing:

```markdown
Decision rule: only add a summary-only tool if it provides a materially smaller, lower-risk contract than `get_task` without creating provider-specific branching, duplicate maintenance, or new ambiguity for the model. Otherwise, explicitly document that `get_task` already covers the use case.
```

- [ ] **Step 2: Verify the current evidence before choosing implementation**

Run:

```bash
bun test tests/tools/get-task.test.ts tests/tools/tools-builder.test.ts tests/providers/youtrack/tools-integration.test.ts
```

Expected: PASS, confirming the current system already has a stable full-detail lookup path.

- [ ] **Step 3: Prefer the no-new-tool path unless new requirements appear**

Update `docs/superpowers/plans/2026-04-14-youtrack-tool-parity-checklist.md` item 9 to record:

```markdown
- [x] Confirmed `get_task` already subsumes the MCP summary-only endpoint for current papai usage. No separate `get_task_summary` tool will be added in this pass because it adds tool-surface area without reducing provider complexity or unlocking missing YouTrack functionality.
```

- [ ] **Step 4: Record the same decision in the new remaining-gaps plan**

Append this note under Task 5 in `docs/superpowers/plans/2026-04-16-youtrack-remaining-parity-gaps.md` while executing:

```markdown
Chosen path: do not add `get_task_summary` in this pass. Keep `get_task` as the only single-task read tool and revisit only if model telemetry shows repeated over-fetch or tool misuse.
```

- [ ] **Step 5: If product requirements change, follow this alternative path instead of the documentation-only path**

If a summary-only tool is later required, implement it as a thin wrapper with this exact shape:

```typescript
export function makeGetTaskSummaryTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'Fetch only the task identifier and title for a single task when full details are unnecessary.',
    inputSchema: z.object({ taskId: z.string().describe('Task ID') }),
    execute: async ({ taskId }) => {
      const task = await provider.getTask(taskId)
      return { id: task.id, title: task.title }
    },
  })
}
```

If this branch is taken, also add builder wiring, integration-test coverage, and a dedicated tool test before merging.

- [ ] **Step 6: Commit the summary-tool decision record**

```bash
git add docs/superpowers/plans/2026-04-14-youtrack-tool-parity-checklist.md docs/superpowers/plans/2026-04-16-youtrack-remaining-parity-gaps.md
git commit -m "docs(youtrack): record summary lookup decision"
```

## Task 6: Run Final Remaining-Gap Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-04-16-youtrack-remaining-parity-gaps.md`

- [ ] **Step 1: Run the targeted verification suite for all remaining-gap work**

Run:

```bash
bun test tests/tools/comment-tools.test.ts tests/tools/work-item-tools.test.ts tests/tools/search-tasks.test.ts tests/providers/youtrack/operations/comments.test.ts tests/providers/youtrack/operations/work-items.test.ts tests/providers/youtrack/operations/tasks.test.ts tests/providers/youtrack/operations/projects.test.ts tests/tools/get-task.test.ts tests/tools/tools-builder.test.ts tests/providers/youtrack/tools-integration.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the broader repo checks for touched files**

Run:

```bash
bun check
```

Expected: PASS for staged files.

- [ ] **Step 3: Update this plan with execution notes**

Append this completion note to the bottom of `docs/superpowers/plans/2026-04-16-youtrack-remaining-parity-gaps.md` when done:

```markdown
## Execution Notes

- Comment pagination added with `limit` and `offset`.
- Work-item pagination added with `limit` and `offset`.
- Search pagination extended beyond `limit` with `offset`.
- Project listing no longer stops at the first 100 results.
- Summary-only task lookup explicitly deferred; `get_task` remains the canonical single-task read tool.
```

- [ ] **Step 4: Commit the verification and plan completion note**

```bash
git add docs/superpowers/plans/2026-04-16-youtrack-remaining-parity-gaps.md
git commit -m "docs(youtrack): finalize remaining parity gap plan"
```

---

## Self-Review

**Spec coverage:**

- Item 8 coverage: `get_comments`, `list_work`, and `search_tasks` pagination are each broken into provider-contract, tool-contract, provider-operation, and test tasks.
- Item 9 coverage: the plan makes the summary-only tool decision explicit, defaults to documenting the deferral, and includes an exact fallback implementation path if requirements change.
- Remaining gaps coverage: the plan also closes the provider-side `list_projects` hard cap that remained outside the tool schema work.

**Placeholder scan:**

- No `TODO` or `TBD` placeholders remain.
- Each code-changing step includes exact file targets, code snippets, and verification commands.

**Type consistency:**

- Pagination uses `limit` and `offset` consistently across tool schemas, provider contracts, and YouTrack `$top`/`$skip` translation.
- The summary-only path intentionally reuses `provider.getTask()` instead of inventing a new provider method unless later requirements justify it.

## Execution Notes

- Comment pagination added with `limit` and `offset`.
- Work-item pagination added with `limit` and `offset`.
- Search pagination extended beyond `limit` with `offset`.
- Project listing no longer stops at the first 100 results.
- Summary-only task lookup explicitly deferred; `get_task` remains the canonical single-task read tool.
