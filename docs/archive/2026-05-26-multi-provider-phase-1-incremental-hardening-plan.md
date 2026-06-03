<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Phase 1 Incremental Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make current multi-provider dashboard and resolver operations safe by fixing admin cleanup, cache invalidation, update routes, duplicate errors, and platform apply consistency.

**Architecture:** Keep the current DB schema and provider catalog intact. Add small store helpers, centralize tool-cache invalidation for instance assignments, extend existing debug instance routes, and make `/api/platform-instances/apply` the only runtime reconciliation path for platform-instance mutations.

**Tech Stack:** Bun test runner, TypeScript, Drizzle SQLite stores, Zod route validation, `p-limit` for bounded runtime lifecycle operations.

---

## File Map

- Modify: `src/instances/admin-store.ts` - add platform-admin bulk deletion helper.
- Modify: `src/instances/context-store.ts` - clear tool caches when context assignments change or are deleted.
- Create: `src/instances/tool-cache-invalidation.ts` - small cache invalidation wrapper around `clearCachedToolsByPrefix()`.
- Modify: `src/debug/instance-routes.ts` - add PATCH routes, duplicate checks, task cache invalidation, admin cleanup, DB-only platform delete, bounded apply.
- Modify: `client/admin/fetchers.ts` - add PATCH fetchers for platform and task instances.
- Modify: `client/admin/sections/InstancesSection.svelte` - use PATCH status update path and mark all platform mutations unapplied.
- Modify: `tests/instances/admin-store.test.ts` - cover bulk platform-admin deletion.
- Modify: `tests/instances/context-store.test.ts` - cover cache invalidation on assignment and context delete.
- Modify: `tests/debug/instance-routes.test.ts` - cover duplicate conflicts, PATCH routes, task cache invalidation, admin cleanup, and apply-only deletion semantics.
- Modify: `tests/client/admin/instances-page.test.ts` if present; otherwise the existing client admin test file that covers `InstancesSection.svelte` - update status-toggle fetch expectation if it asserts the old endpoint.

## Task 1: Admin Store Platform Cleanup

**Files:**

- Modify: `src/instances/admin-store.ts`
- Test: `tests/instances/admin-store.test.ts`

- [ ] **Step 1: Write the failing admin-store test**

Add `deleteAdminsByPlatformInstance` to the import list in `tests/instances/admin-store.test.ts`:

```typescript
import {
  addAdmin,
  deleteAdminsByPlatformInstance,
  isAdmin,
  isPlatformAdmin,
  isSuperAdmin,
  listAdmins,
  listAdminsForPlatform,
  removeAdmin,
  SUPER_ADMIN_PLATFORM_ID,
} from '../../src/instances/admin-store.js'
```

Add this test before the final `listAdmins returns all admin rows` test:

```typescript
test('deleteAdminsByPlatformInstance removes only rows for that platform', () => {
  addAdmin('platform-1', 'tg-default')
  addAdmin('platform-2', 'tg-default')
  addAdmin('other-platform', 'mm-default')
  addAdmin('super-user', SUPER_ADMIN_PLATFORM_ID)

  expect(deleteAdminsByPlatformInstance('tg-default')).toBe(2)

  const rows = listAdmins()
    .map((a) => `${a.platformInstanceId}:${a.userId}`)
    .toSorted()
  expect(rows).toEqual(['__super__:super-user', 'mm-default:other-platform'])
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `bun test tests/instances/admin-store.test.ts`

Expected: FAIL with an import/export error for `deleteAdminsByPlatformInstance`.

- [ ] **Step 3: Implement the store helper**

In `src/instances/admin-store.ts`, add this export after `removeAdmin()`:

```typescript
export const deleteAdminsByPlatformInstance = (platformInstanceId: string): number => {
  const deletedRows = getDrizzleDb()
    .delete(admins)
    .where(eq(admins.platformInstanceId, platformInstanceId))
    .returning({ userId: admins.userId })
    .all()
  log.info({ platformInstanceId, deletedCount: deletedRows.length }, 'admins removed for platform instance')
  return deletedRows.length
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `bun test tests/instances/admin-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit this task**

Run:

```bash
git add src/instances/admin-store.ts tests/instances/admin-store.test.ts
git commit -m "fix(instances): clean up platform admin rows"
```

## Task 2: Context Assignment Tool Cache Invalidation

**Files:**

- Create: `src/instances/tool-cache-invalidation.ts`
- Modify: `src/instances/context-store.ts`
- Test: `tests/instances/context-store.test.ts`

- [ ] **Step 1: Write failing context-store cache tests**

Update imports in `tests/instances/context-store.test.ts`:

```typescript
import { getCachedTools, setCachedTools, userCachesForTesting } from '../../src/cache.js'
import {
  deleteContextsByPlatformInstance,
  deleteContextsByTaskInstance,
  getContextSettings,
  listContextsByPlatformInstance,
  listContextsByTaskInstance,
  setContextSettings,
} from '../../src/instances/context-store.js'
```

Update `beforeEach` to clear in-memory caches:

```typescript
beforeEach(async () => {
  mockLogger()
  userCachesForTesting.clear()
  await setupTestDb()
})
```

Add these tests after the existing upsert test:

```typescript
test('setContextSettings clears cached tool sets for the context', () => {
  setCachedTools('u1', { old_tool: {} })

  setContextSettings({ contextId: 'u1', taskInstanceId: 'yt-default', platformInstanceId: 'tg-default' })

  expect(getCachedTools('u1')).toBeUndefined()
})

test('setContextSettings clears cached group-derived tool sets for the context', () => {
  setCachedTools('group-1:user-1:alice', { old_tool: {} })

  setContextSettings({ contextId: 'group-1', taskInstanceId: 'yt-default', platformInstanceId: 'tg-default' })

  expect(getCachedTools('group-1:user-1:alice')).toBeUndefined()
})

test('deleteContextsByTaskInstance clears tool caches for deleted contexts', () => {
  setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'tg-default' })
  setContextSettings({ contextId: 'ctx-2', taskInstanceId: 'tasks-main', platformInstanceId: 'tg-default' })
  setCachedTools('ctx-1', { old_tool: {} })
  setCachedTools('ctx-2:user-1:alice', { old_tool: {} })

  expect(deleteContextsByTaskInstance('tasks-main')).toBe(2)

  expect(getCachedTools('ctx-1')).toBeUndefined()
  expect(getCachedTools('ctx-2:user-1:alice')).toBeUndefined()
})

test('deleteContextsByPlatformInstance clears tool caches for deleted contexts', () => {
  setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'tg-default' })
  setContextSettings({ contextId: 'ctx-2', taskInstanceId: 'tasks-other', platformInstanceId: 'tg-default' })
  setCachedTools('ctx-1', { old_tool: {} })
  setCachedTools('ctx-2:user-1:alice', { old_tool: {} })

  expect(deleteContextsByPlatformInstance('tg-default')).toBe(2)

  expect(getCachedTools('ctx-1')).toBeUndefined()
  expect(getCachedTools('ctx-2:user-1:alice')).toBeUndefined()
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `bun test tests/instances/context-store.test.ts`

Expected: FAIL because deleted contexts or assignment updates do not clear cached tools.

- [ ] **Step 3: Add the cache invalidation helper**

Create `src/instances/tool-cache-invalidation.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { clearCachedToolsByPrefix } from '../cache.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'instances:tool-cache-invalidation' })

export const clearToolCachesForContexts = (contextIds: readonly string[]): void => {
  const uniqueContextIds = [...new Set(contextIds)]
  for (const contextId of uniqueContextIds) clearCachedToolsByPrefix(contextId)
  if (uniqueContextIds.length > 0) {
    log.info({ contextCount: uniqueContextIds.length }, 'cleared tool caches for contexts')
  }
}
```

- [ ] **Step 4: Wire context-store invalidation**

Modify `src/instances/context-store.ts` imports:

```typescript
import { clearToolCachesForContexts } from './tool-cache-invalidation.js'
```

Update `setContextSettings()` to read the previous row and clear the context after the upsert:

```typescript
export const setContextSettings = (input: ContextSettings): void => {
  const existing = getContextSettings(input.contextId)
  getDrizzleDb()
    .insert(contextSettings)
    .values(input)
    .onConflictDoUpdate({
      target: contextSettings.contextId,
      set: {
        taskInstanceId: sql`excluded.task_instance_id`,
        platformInstanceId: sql`excluded.platform_instance_id`,
      },
    })
    .run()
  clearToolCachesForContexts([input.contextId, existing?.contextId].filter((id): id is string => id !== undefined))
  log.info(
    {
      contextId: input.contextId,
      taskInstanceId: input.taskInstanceId,
      platformInstanceId: input.platformInstanceId,
    },
    'context settings upserted',
  )
}
```

Update delete helpers:

```typescript
export const deleteContextsByTaskInstance = (taskInstanceId: string): number => {
  const deletedRows = getDrizzleDb()
    .delete(contextSettings)
    .where(eq(contextSettings.taskInstanceId, taskInstanceId))
    .returning({ contextId: contextSettings.contextId })
    .all()
  clearToolCachesForContexts(deletedRows.map((row) => row.contextId))
  log.info({ taskInstanceId, deletedCount: deletedRows.length }, 'context settings deleted for task instance')
  return deletedRows.length
}

export const deleteContextsByPlatformInstance = (platformInstanceId: string): number => {
  const deletedRows = getDrizzleDb()
    .delete(contextSettings)
    .where(eq(contextSettings.platformInstanceId, platformInstanceId))
    .returning({ contextId: contextSettings.contextId })
    .all()
  clearToolCachesForContexts(deletedRows.map((row) => row.contextId))
  log.info({ platformInstanceId, deletedCount: deletedRows.length }, 'context settings deleted for platform instance')
  return deletedRows.length
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `bun test tests/instances/context-store.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit this task**

Run:

```bash
git add src/instances/tool-cache-invalidation.ts src/instances/context-store.ts tests/instances/context-store.test.ts
git commit -m "fix(instances): clear tool caches on context changes"
```

## Task 3: Task Instance Cache Invalidation Through Routes

**Files:**

- Modify: `src/debug/instance-routes.ts`
- Test: `tests/debug/instance-routes.test.ts`

- [ ] **Step 1: Write failing route tests for task cache invalidation**

Add cache imports to `tests/debug/instance-routes.test.ts`:

```typescript
import { getCachedTools, setCachedTools, userCachesForTesting } from '../../src/cache.js'
```

Update the suite `beforeEach`:

```typescript
beforeEach(async () => {
  mockLogger()
  userCachesForTesting.clear()
  await setupTestDb()
  clearRuntimeChatRouter()
  process.env['DEBUG_TOKEN'] = TOKEN
})
```

Add this test after `deletes task instance context settings before deleting the task instance`:

```typescript
test('deleting task instance clears cached tools for referencing contexts', async () => {
  insertTaskInstance({ id: 'tasks-main', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
  setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'telegram-main' })
  setCachedTools('ctx-1', { old_tool: {} })
  setCachedTools('ctx-1:user-1:alice', { old_tool: {} })

  const res = expectResponse(
    await route('/api/task-instances/tasks-main', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    }),
  )

  expect(res.status).toBe(204)
  expect(getCachedTools('ctx-1')).toBeUndefined()
  expect(getCachedTools('ctx-1:user-1:alice')).toBeUndefined()
})
```

- [ ] **Step 2: Run the route test and verify it fails or stays red until Task 2 is present**

Run: `bun test tests/debug/instance-routes.test.ts --test-name-pattern "deleting task instance clears cached tools"`

Expected before Task 2 implementation: FAIL because cache invalidation is absent. Expected after Task 2 implementation: PASS through `deleteContextsByTaskInstance()`.

- [ ] **Step 3: Keep route deletion using context-store deletion helper**

No route-specific implementation is needed if Task 2 updated `deleteContextsByTaskInstance()` correctly. Confirm `src/debug/instance-routes.ts` still calls:

```typescript
deleteContextsByTaskInstance(taskInstanceId)
deleteTaskInstance(taskInstanceId)
```

- [ ] **Step 4: Run the focused route test and verify it passes**

Run: `bun test tests/debug/instance-routes.test.ts --test-name-pattern "deleting task instance clears cached tools"`

Expected: PASS.

- [ ] **Step 5: Commit this task**

Run:

```bash
git add tests/debug/instance-routes.test.ts
git commit -m "test(debug): cover task delete cache invalidation"
```

## Task 4: Instance Duplicate Conflict And PATCH Routes

**Files:**

- Modify: `src/debug/instance-routes.ts`
- Modify: `client/admin/fetchers.ts`
- Modify: `client/admin/sections/InstancesSection.svelte`
- Test: `tests/debug/instance-routes.test.ts`

- [ ] **Step 1: Write failing route tests for duplicate IDs and PATCH**

Add these tests to `tests/debug/instance-routes.test.ts` after the platform schema validation test:

```typescript
test('returns 409 when creating a duplicate platform instance', async () => {
  insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' }, status: 'active' })

  const res = expectResponse(
    await route('/api/platform-instances', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' } }),
    }),
  )

  expect(res.status).toBe(409)
  expect(await readJson(res)).toEqual({ error: 'instance_exists', id: 'telegram-main' })
})

test('PATCH /api/platform-instances/:id updates config and status', async () => {
  insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { token: 'old' }, status: 'active' })

  const res = expectResponse(
    await route('/api/platform-instances/telegram-main', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ config: { token: 'new', label: 'main' }, status: 'stopped' }),
    }),
  )

  expect(res.status).toBe(200)
  const body = assertObject(await readJson(res))
  expect(pick(body, 'status')).toBe('stopped')
  expect(pick(body, 'config')).toEqual({ token: '***', label: 'main' })
})

test('PATCH /api/platform-instances/:id returns 404 for missing instance', async () => {
  const res = expectResponse(
    await route('/api/platform-instances/missing', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ status: 'stopped' }),
    }),
  )

  expect(res.status).toBe(404)
})
```

Add these tests after the task instance create/list test:

```typescript
test('returns 409 when creating a duplicate task instance', async () => {
  insertTaskInstance({ id: 'tasks-main', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })

  const res = expectResponse(
    await route('/api/task-instances', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: 'tasks-main', type: 'kaneo', config: { url: 'https://kaneo.invalid' } }),
    }),
  )

  expect(res.status).toBe(409)
  expect(await readJson(res)).toEqual({ error: 'instance_exists', id: 'tasks-main' })
})

test('PATCH /api/task-instances/:id updates config and status and clears referencing tool caches', async () => {
  insertTaskInstance({ id: 'tasks-main', type: 'kaneo', config: { url: 'https://old.invalid' }, status: 'active' })
  setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'telegram-main' })
  setCachedTools('ctx-1', { old_tool: {} })

  const res = expectResponse(
    await route('/api/task-instances/tasks-main', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ config: { api_key: 'secret', url: 'https://new.invalid' }, status: 'stopped' }),
    }),
  )

  expect(res.status).toBe(200)
  const body = assertObject(await readJson(res))
  expect(pick(body, 'status')).toBe('stopped')
  expect(pick(body, 'config')).toEqual({ api_key: '***', url: 'https://new.invalid' })
  expect(getCachedTools('ctx-1')).toBeUndefined()
})
```

- [ ] **Step 2: Run the focused route tests and verify they fail**

Run: `bun test tests/debug/instance-routes.test.ts`

Expected: FAIL for duplicate response expectations and missing PATCH routes.

- [ ] **Step 3: Add schemas and helpers in `instance-routes.ts`**

Modify imports:

```typescript
import { clearToolCachesForContexts } from '../instances/tool-cache-invalidation.js'
import { updateTaskInstance } from '../instances/task-store.js'
```

Update the existing task-store import to include `updateTaskInstance` instead of adding a duplicate import:

```typescript
import {
  deleteTaskInstance,
  getTaskInstance,
  insertTaskInstance,
  listTaskInstances,
  updateTaskInstance,
} from '../instances/task-store.js'
```

Add patch schemas near `statusSchema`:

```typescript
const instancePatchSchema = z
  .object({
    config: instanceConfigSchema.optional(),
    status: z.enum(['pending', 'active', 'stopped']).optional(),
  })
  .refine((value) => value.config !== undefined || value.status !== undefined, {
    message: 'at least one of config or status is required',
  })
```

Add helpers near `validationError()`:

```typescript
const instanceExistsError = (id: string): Response => jsonResponse({ error: 'instance_exists', id }, { status: 409 })
```

- [ ] **Step 4: Implement duplicate checks and platform PATCH**

Update platform POST before `insertPlatformInstance()`:

```typescript
if (getPlatformInstance(body.id) !== null) return instanceExistsError(body.id)
insertPlatformInstance({ ...body, status: 'active' })
```

Add PATCH handling before the platform DELETE block:

```typescript
if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'platform-instances' && req.method === 'PATCH') {
  const instanceId = parts[2]
  if (instanceId === undefined) return textResponse('Not found', 404)
  if (getPlatformInstance(instanceId) === null) return textResponse('Not found', 404)
  const body = await parseBody(req, instancePatchSchema)
  if (body instanceof Response) return body
  updatePlatformInstance(instanceId, { config: body.config, status: body.status })
  const instance = getPlatformInstance(instanceId)
  return instance === null ? textResponse('Not found', 404) : jsonResponse(maskedPlatformInstance(instance))
}
```

Update the existing status route to reject missing instances before update:

```typescript
if (getPlatformInstance(instanceId) === null) return textResponse('Not found', 404)
updatePlatformInstance(instanceId, { config: undefined, status: body.status })
```

- [ ] **Step 5: Implement duplicate checks and task PATCH**

Update task POST before `insertTaskInstance()`:

```typescript
if (getTaskInstance(body.id) !== null) return instanceExistsError(body.id)
insertTaskInstance({ ...body, status: 'active' })
```

Add PATCH handling before the task DELETE logic:

```typescript
if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'task-instances' && req.method === 'PATCH') {
  const taskInstanceId = parts[2]
  if (taskInstanceId === undefined) return textResponse('Not found', 404)
  if (getTaskInstance(taskInstanceId) === null) return textResponse('Not found', 404)
  const body = await parseBody(req, instancePatchSchema)
  if (body instanceof Response) return body
  const referencingContextIds = listContextsByTaskInstance(taskInstanceId).map((context) => context.contextId)
  updateTaskInstance(taskInstanceId, { config: body.config, status: body.status })
  clearToolCachesForContexts(referencingContextIds)
  const instance = getTaskInstance(taskInstanceId)
  return instance === null ? textResponse('Not found', 404) : jsonResponse(maskedTaskInstance(instance))
}
```

- [ ] **Step 6: Add client fetchers**

In `client/admin/fetchers.ts`, add types near `PlatformInstanceStatusInput`:

```typescript
export type UpdatePlatformInstanceInput = {
  readonly config?: InstanceConfigView
  readonly status?: PlatformInstanceStatusInput | 'pending'
}

export type UpdateTaskInstanceInput = {
  readonly config?: InstanceConfigView
  readonly status?: TaskInstanceView['status']
}
```

Add fetchers after `setPlatformInstanceStatus()`:

```typescript
export const updatePlatformInstance = async (
  id: string,
  input: UpdatePlatformInstanceInput,
): Promise<PlatformInstanceView> => {
  const res = await fetch(`/api/platform-instances/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readBody(res)
  requireOk(res, body)
  return PlatformInstanceViewSchema.parse(body)
}

export const updateTaskInstance = async (id: string, input: UpdateTaskInstanceInput): Promise<TaskInstanceView> => {
  const res = await fetch(`/api/task-instances/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readBody(res)
  requireOk(res, body)
  return TaskInstanceViewSchema.parse(body)
}
```

- [ ] **Step 7: Move status toggle to PATCH in the admin client**

In `client/admin/sections/InstancesSection.svelte`, replace the import `setPlatformInstanceStatus` with `updatePlatformInstance`:

```typescript
    updatePlatformInstance,
```

Update `updatePlatformStatus()`:

```typescript
async function updatePlatformStatus(instance: PlatformInstanceView): Promise<void> {
  try {
    const nextStatus = instance.status === 'active' ? 'stopped' : 'active'
    await updatePlatformInstance(instance.id, { status: nextStatus })
    platformDirty = true
    await loadPlatformInstances()
    setSuccess(`Platform instance ${nextStatus}. Platform changes are unapplied.`)
  } catch (err) {
    setError(err)
  }
}
```

- [ ] **Step 8: Run focused route and client tests**

Run: `bun test tests/debug/instance-routes.test.ts`

Expected: PASS.

Run: `bun test:client`

Expected: PASS or only unrelated pre-existing failures. If a client test expects the old status endpoint, update it to expect `PATCH /api/platform-instances/:id` with `{ status }`.

- [ ] **Step 9: Commit this task**

Run:

```bash
git add src/debug/instance-routes.ts client/admin/fetchers.ts client/admin/sections/InstancesSection.svelte tests/debug/instance-routes.test.ts tests/client
git commit -m "feat(admin): update instance configs in place"
```

## Task 5: Platform Delete Uses Apply-Only Runtime Reconciliation

**Files:**

- Modify: `src/debug/instance-routes.ts`
- Test: `tests/debug/instance-routes.test.ts`

- [ ] **Step 1: Write failing apply-only delete test**

Add this test after `deletes platform instance context settings before deleting the platform instance`:

```typescript
test('deleting platform instance does not remove runtime router instance until apply', async () => {
  insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' }, status: 'active' })
  const start = mock(async () => {})
  const stop = mock(async () => {})
  const router = new ChatRouter(() => fakeProvider(start, stop))
  router.addInstance('telegram-main', 'telegram', { token: 'secret' })
  setRuntimeChatRouter(router)

  const deleted = expectResponse(
    await route('/api/platform-instances/telegram-main', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    }),
  )

  expect(deleted.status).toBe(204)
  expect(router.getInstance('telegram-main')).not.toBeNull()
  expect(stop).not.toHaveBeenCalled()

  const applied = expectResponse(
    await route('/api/platform-instances/apply', {
      method: 'POST',
      headers: jsonHeaders,
    }),
  )

  expect(applied.status).toBe(200)
  expect(router.getInstance('telegram-main')).toBeNull()
  expect(stop).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `bun test tests/debug/instance-routes.test.ts --test-name-pattern "does not remove runtime router instance until apply"`

Expected: FAIL because current delete calls `router.removeInstance()` inline.

- [ ] **Step 3: Remove inline runtime removal from platform DELETE and clean admins**

Modify the admin-store import in `src/debug/instance-routes.ts`:

```typescript
import {
  addAdmin,
  deleteAdminsByPlatformInstance,
  listAdmins,
  removeAdmin,
  SUPER_ADMIN_PLATFORM_ID,
} from '../instances/admin-store.js'
```

Replace the platform DELETE block body with:

```typescript
const instanceId = parts[2]
if (instanceId === undefined) return textResponse('Not found', 404)
deleteAdminsByPlatformInstance(instanceId)
deleteContextsByPlatformInstance(instanceId)
deletePlatformInstance(instanceId)
return new Response(null, { status: 204 })
```

- [ ] **Step 4: Add route assertion for admin cleanup**

Add this test near the existing platform delete test:

```typescript
test('deleting platform instance removes platform admin rows', async () => {
  insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' }, status: 'active' })
  addAdmin('platform-admin', 'telegram-main')
  addAdmin('super-admin', SUPER_ADMIN_PLATFORM_ID)

  const res = expectResponse(
    await route('/api/platform-instances/telegram-main', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    }),
  )

  expect(res.status).toBe(204)
  expect(listAdmins().map((admin) => `${admin.platformInstanceId}:${admin.userId}`)).toEqual(['__super__:super-admin'])
})
```

- [ ] **Step 5: Run the focused route tests and verify they pass**

Run: `bun test tests/debug/instance-routes.test.ts --test-name-pattern "deleting platform instance"`

Expected: PASS.

- [ ] **Step 6: Commit this task**

Run:

```bash
git add src/debug/instance-routes.ts tests/debug/instance-routes.test.ts
git commit -m "fix(admin): make platform delete apply-only"
```

## Task 6: Bound Apply Concurrency

**Files:**

- Modify: `src/debug/instance-routes.ts`
- Test: `tests/debug/instance-routes.test.ts`

- [ ] **Step 1: Add p-limit import and implementation**

Modify `src/debug/instance-routes.ts` imports:

```typescript
import pLimit from 'p-limit'
import { z } from 'zod'
```

Add a local constant near `INSTANCE_API_PREFIXES`:

```typescript
const INSTANCE_APPLY_CONCURRENCY = 4
```

Replace the three unbounded `Promise.all` calls in `applyPlatformInstances()` with:

```typescript
const limit = pLimit(INSTANCE_APPLY_CONCURRENCY)

await Promise.all(removed.map((id) => limit(() => router.removeInstance(id))))
await Promise.all(
  missing.map((instance) =>
    limit(async () => {
      router.addInstance(instance.id, instance.type, instance.config)
      await router.startInstance(instance.id)
    }),
  ),
)
await Promise.all(stopped.map((instance) => limit(() => router.startInstance(instance.id))))
```

- [ ] **Step 2: Run route tests to verify behavior is preserved**

Run: `bun test tests/debug/instance-routes.test.ts --test-name-pattern "apply"`

Expected: PASS.

- [ ] **Step 3: Run lint on the touched route file**

Run: `bun lint:agent-strict -- src/debug/instance-routes.ts`

Expected: PASS.

- [ ] **Step 4: Commit this task**

Run:

```bash
git add src/debug/instance-routes.ts tests/debug/instance-routes.test.ts
git commit -m "fix(debug): bound platform apply concurrency"
```

## Task 7: Final Verification

**Files:**

- Verify all files touched in Tasks 1-6.

- [ ] **Step 1: Run focused instance and route tests**

Run:

```bash
bun test tests/instances/admin-store.test.ts tests/instances/context-store.test.ts tests/debug/instance-routes.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run client tests if `InstancesSection.svelte` changed**

Run: `bun test:client`

Expected: PASS.

- [ ] **Step 3: Run TypeScript checks**

Run: `bun typecheck`

Expected: PASS.

- [ ] **Step 4: Run strict lint for touched implementation files**

Run:

```bash
bun lint:agent-strict -- src/instances/admin-store.ts src/instances/context-store.ts src/instances/tool-cache-invalidation.ts src/debug/instance-routes.ts client/admin/fetchers.ts client/admin/sections/InstancesSection.svelte
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run: `git diff --stat HEAD`

Expected: diff includes only Phase 1 hardening files and tests.

- [ ] **Step 6: Commit final verification fixes if any**

If verification required additional fixes, run:

```bash
git add <fixed files>
git commit -m "fix: address phase 1 hardening verification"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: admin cleanup is Task 1 and Task 5; cache invalidation is Tasks 2-4; update routes and duplicate errors are Task 4; apply-only platform reconciliation is Task 5; bounded apply is Task 6; final verification is Task 7.
- Placeholder scan: no unfinished markers or unspecified implementation steps are intentionally left in this plan.
- Type consistency: helper names are `deleteAdminsByPlatformInstance` and `clearToolCachesForContexts`; route patch schema is `instancePatchSchema`; client fetchers are `updatePlatformInstance` and `updateTaskInstance`.
