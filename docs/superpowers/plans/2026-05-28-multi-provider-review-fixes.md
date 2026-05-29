<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the production-relevant multi-provider review findings by enforcing instance config validation on POST and PATCH and by making `/admin/system` read provider state from the DB-backed instance tables.

**Architecture:** Add one small debug-layer validation helper that validates instance-scoped descriptor fields before `platform_instances` or `task_instances` rows are written. Wire that helper into the existing instance API routes, keep contributed task-provider validators in the task-provider catalog route module, and update the admin system summary to derive its legacy singular provider fields from current DB rows rather than bootstrap env vars.

**Tech Stack:** Bun test runner, TypeScript, Zod v4 request parsing, Drizzle SQLite stores, existing debug API route helpers.

---

## Scope

Fix in this plan:

- Enforce descriptor-required instance config fields for platform POST, platform PATCH, task POST, and task PATCH.
- Reject malformed `*Url` instance config fields with a 400 before persistence.
- Keep contributed task-provider `validateConfig` parity on task PATCH when `config` is present.
- Make `/admin/system` provider display read `platform_instances` and `task_instances` instead of `CHAT_PROVIDER` and `TASK_PROVIDER`.

Not in this plan:

- Removing `TaskProviderResolver.resolveStrict()`. It has no production callers and is cleanup, not a behavior fix.
- Dropping `users.kaneo_workspace_id`. Stats already read `user_config`; the physical column needs a dedicated migration plan.
- Adding provider resolver caching. Current built-ins are stateless; caching is a contract decision for contributed providers and should not be bundled with validation fixes.

## File Structure

- Create `src/debug/instance-config-validation.ts`
  - Owns debug/admin API validation of instance-scoped provider descriptor configs.
  - Has no DB writes and no provider construction.
  - Returns `Response | null`, matching existing route helper style.
- Modify `src/debug/instance-routes.ts`
  - Calls platform config validation before platform insert/update.
  - Calls task descriptor validation and contributed task-provider validation before task insert/update.
  - Reuses existing `validateTaskInstanceConfig()` for contributed task-provider validators.
- Modify `src/debug/admin-system.ts`
  - Replaces env-derived provider display with DB-derived provider display.
  - Keeps response shape unchanged: `chatProvider`, `taskProvider`, `debugServer`, `adminUserSet`.
- Modify `tests/debug/instance-routes.test.ts`
  - Adds failing tests for platform PATCH, platform POST, task PATCH descriptor validation, and task PATCH contributed validator parity.
  - Updates existing positive PATCH tests to use descriptor-valid config.
- Modify `tests/debug/admin-system.test.ts`
  - Adds DB setup and tests that `/admin/system` ignores bootstrap env provider values.
- Modify `tests/debug/admin-system-route.test.ts`
  - Seeds DB instance rows for the route-level safe summary test.
  - Verifies unsupported env provider values no longer affect provider display.

---

### Task 1: Add Shared Instance Config Validation Helper

**Files:**

- Create: `src/debug/instance-config-validation.ts`
- Test: `tests/debug/instance-routes.test.ts`

- [ ] **Step 1: Write the failing platform POST validation test**

Add `getPlatformInstance` to the existing platform-store import in `tests/debug/instance-routes.test.ts`:

```ts
import { getPlatformInstance, insertPlatformInstance } from '../../src/instances/platform-store.js'
```

Add this test after `test('rejects invalid platform instance schema with 400', ...)`:

```ts
test('POST /api/platform-instances rejects missing descriptor-required config', async () => {
  const res = expectResponse(
    await route('/api/platform-instances', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: 'telegram-main', type: 'telegram', config: { label: 'main' } }),
    }),
  )

  expect(res.status).toBe(400)
  expect(await readJson(res)).toEqual({
    error: 'invalid_platform_instance_config',
    type: 'telegram',
    missing: ['token'],
  })
  expect(getPlatformInstance('telegram-main')).toBeNull()
})
```

Add this test immediately after the missing-config test:

```ts
test('POST /api/platform-instances rejects malformed descriptor URL config', async () => {
  const res = expectResponse(
    await route('/api/platform-instances', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        id: 'mattermost-main',
        type: 'mattermost',
        config: { baseUrl: 'not a url', token: 'secret' },
      }),
    }),
  )

  expect(res.status).toBe(400)
  expect(await readJson(res)).toEqual({
    error: 'invalid_platform_instance_config',
    type: 'mattermost',
    invalidUrls: ['baseUrl'],
  })
  expect(getPlatformInstance('mattermost-main')).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/instance-routes.test.ts --test-name-pattern "POST /api/platform-instances rejects"`

Expected: FAIL because the route currently returns `201` and persists invalid platform instances.

- [ ] **Step 3: Create the validation helper**

Create `src/debug/instance-config-validation.ts` with this complete content:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listPlatformProviderTypes } from '../chat/registry.js'
import type { InstanceConfig } from '../instances/types.js'
import { getTaskProviderDescriptor } from '../providers/registry.js'
import { jsonResponse } from './json-response.js'

type InstanceConfigField = {
  readonly key: string
  readonly required: boolean
}

type InstanceConfigValidationError = {
  readonly missing: readonly string[]
  readonly invalidUrls: readonly string[]
}

const isBlank = (value: string | undefined): boolean => value === undefined || value.trim() === ''

const isUrlField = (key: string): boolean => key.toLowerCase().endsWith('url')

const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const validateDescriptorConfig = (
  fields: readonly InstanceConfigField[],
  config: InstanceConfig,
): InstanceConfigValidationError => {
  const missing = fields.filter((field) => field.required && isBlank(config[field.key])).map((field) => field.key)

  const invalidUrls = fields
    .filter((field) => isUrlField(field.key))
    .filter((field) => {
      const value = config[field.key]
      return value !== undefined && value.trim() !== '' && !isHttpUrl(value)
    })
    .map((field) => field.key)

  return { missing, invalidUrls }
}

const validationResponse = (
  error: 'invalid_platform_instance_config' | 'invalid_task_instance_config',
  type: string,
  result: InstanceConfigValidationError,
): Response | null => {
  if (result.missing.length === 0 && result.invalidUrls.length === 0) return null
  return jsonResponse(
    {
      error,
      type,
      ...(result.missing.length === 0 ? {} : { missing: result.missing }),
      ...(result.invalidUrls.length === 0 ? {} : { invalidUrls: result.invalidUrls }),
    },
    { status: 400 },
  )
}

export const validatePlatformInstanceConfig = (type: string, config: InstanceConfig): Response | null => {
  const descriptor = listPlatformProviderTypes().find((candidate) => candidate.type === type)
  if (descriptor === undefined) {
    return jsonResponse({ error: 'unknown_platform_provider_type', type }, { status: 400 })
  }
  return validationResponse(
    'invalid_platform_instance_config',
    type,
    validateDescriptorConfig(descriptor.instanceConfigSchema, config),
  )
}

export const validateTaskDescriptorInstanceConfig = (type: string, config: InstanceConfig): Response | null => {
  const descriptor = getTaskProviderDescriptor(type)
  if (descriptor === undefined) return jsonResponse({ error: 'unknown_task_provider_type', type }, { status: 400 })
  return validationResponse(
    'invalid_task_instance_config',
    type,
    validateDescriptorConfig(descriptor.instanceConfigSchema, config),
  )
}
```

- [ ] **Step 4: Wire platform POST to the helper**

In `src/debug/instance-routes.ts`, add this import near the other debug route imports:

```ts
import { validatePlatformInstanceConfig } from './instance-config-validation.js'
```

In the platform POST branch, replace this block:

```ts
if (getPlatformInstance(body.id) !== null) return instanceExistsError(body.id)
insertPlatformInstance({ ...body, status: 'active' })
```

with this block:

```ts
if (getPlatformInstance(body.id) !== null) return instanceExistsError(body.id)
const configError = validatePlatformInstanceConfig(body.type, body.config)
if (configError !== null) return configError
insertPlatformInstance({ ...body, status: 'active' })
```

Task 3 extends this import when task-instance validation is wired.

- [ ] **Step 5: Run the focused test to verify it passes**

Run: `bun test tests/debug/instance-routes.test.ts --test-name-pattern "POST /api/platform-instances rejects"`

Expected: PASS.

- [ ] **Step 6: Run the full route suite and fix expected positive fixture keys**

Run: `bun test tests/debug/instance-routes.test.ts`

Expected: FAIL in older positive platform tests that still use `{ bot_token: 'secret' }` as the full Telegram config.

Update these existing test fixtures in `tests/debug/instance-routes.test.ts`:

```ts
body: JSON.stringify({ id: 'telegram-main', type: 'telegram', config: { token: 'secret', label: 'main' } }),
```

```ts
expect(pick(createdBody, 'config')).toEqual({ token: '********', label: 'main' })
```

```ts
expect(pick(assertObject(rows[0]), 'config')).toEqual({ token: '********', label: 'main' })
```

```ts
insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' }, status: 'active' })
```

```ts
body: JSON.stringify({ id: 'telegram-main', type: 'telegram', config: { token: 'other-secret' } }),
```

```ts
insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' }, status: 'active' })
```

```ts
        body: JSON.stringify({ config: { token: 'new-secret', label: 'main' }, status: 'stopped' }),
```

```ts
expect(pick(body, 'config')).toEqual({ token: '********', label: 'main' })
```

No other fixture should rely on `bot_token` as a complete Telegram instance config.

- [ ] **Step 7: Run route suite again**

Run: `bun test tests/debug/instance-routes.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/debug/instance-config-validation.ts src/debug/instance-routes.ts tests/debug/instance-routes.test.ts
git commit -m "fix: validate platform instance config"
```

---

### Task 2: Validate Platform PATCH Config Before Persistence

**Files:**

- Modify: `src/debug/instance-routes.ts:126-133`
- Test: `tests/debug/instance-routes.test.ts`

- [ ] **Step 1: Write the failing platform PATCH validation test**

Add this test after `test('PATCH /api/platform-instances/:id updates config and status with masked config', ...)`:

```ts
test('PATCH /api/platform-instances/:id rejects invalid config and preserves the previous config', async () => {
  insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' }, status: 'active' })

  const res = expectResponse(
    await route('/api/platform-instances/telegram-main', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ config: { label: 'main' } }),
    }),
  )

  expect(res.status).toBe(400)
  expect(await readJson(res)).toEqual({
    error: 'invalid_platform_instance_config',
    type: 'telegram',
    missing: ['token'],
  })
  expect(getPlatformInstance('telegram-main')?.config).toEqual({ token: 'secret' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/instance-routes.test.ts --test-name-pattern "PATCH /api/platform-instances/:id rejects invalid config"`

Expected: FAIL because PATCH currently accepts the invalid config and overwrites the stored config.

- [ ] **Step 3: Implement platform PATCH validation**

Replace `handlePlatformPatch` in `src/debug/instance-routes.ts` with this function:

```ts
const handlePlatformPatch = async (req: Request, instanceId: string): Promise<Response> => {
  const existing = getPlatformInstance(instanceId)
  if (existing === null) return textResponse('Not found', 404)
  const body = await parseBody(req, instancePatchSchema)
  if (body instanceof Response) return body
  if (body.config !== undefined) {
    const configError = validatePlatformInstanceConfig(existing.type, body.config)
    if (configError !== null) return configError
  }
  updatePlatformInstance(instanceId, { config: body.config, status: body.status })
  const instance = getPlatformInstance(instanceId)
  return instance === null ? textResponse('Not found', 404) : jsonResponse(maskedPlatformInstance(instance))
}
```

- [ ] **Step 4: Run focused platform PATCH tests**

Run: `bun test tests/debug/instance-routes.test.ts --test-name-pattern "PATCH /api/platform-instances"`

Expected: PASS.

- [ ] **Step 5: Run full route suite**

Run: `bun test tests/debug/instance-routes.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/debug/instance-routes.ts tests/debug/instance-routes.test.ts
git commit -m "fix: validate platform instance patch config"
```

---

### Task 3: Validate Task POST and PATCH Config Before Persistence

**Files:**

- Modify: `src/debug/instance-routes.ts:193-218`
- Test: `tests/debug/instance-routes.test.ts`

- [ ] **Step 1: Write the failing task POST descriptor URL validation test**

Add this test after `test('POST /api/task-instances rejects an unknown provider type', ...)`:

```ts
test('POST /api/task-instances rejects malformed descriptor URL config', async () => {
  const res = expectResponse(
    await route('/api/task-instances', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: 'tasks-main', type: 'kaneo', config: { baseUrl: 'not a url' } }),
    }),
  )

  expect(res.status).toBe(400)
  expect(await readJson(res)).toEqual({
    error: 'invalid_task_instance_config',
    type: 'kaneo',
    invalidUrls: ['baseUrl'],
  })
  expect(getTaskInstance('tasks-main')).toBeNull()
})
```

- [ ] **Step 2: Write the failing task PATCH descriptor validation test**

Add this test after `test('PATCH /api/task-instances/:id updates config and status and clears referencing context tool cache', ...)`:

```ts
test('PATCH /api/task-instances/:id rejects missing descriptor-required config and preserves the previous config', async () => {
  insertTaskInstance({
    id: 'tasks-main',
    type: 'kaneo',
    config: { baseUrl: 'https://kaneo.invalid' },
    status: 'active',
  })

  const res = expectResponse(
    await route('/api/task-instances/tasks-main', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ config: { internalUrl: 'https://internal.kaneo.invalid' } }),
    }),
  )

  expect(res.status).toBe(400)
  expect(await readJson(res)).toEqual({
    error: 'invalid_task_instance_config',
    type: 'kaneo',
    missing: ['baseUrl'],
  })
  expect(getTaskInstance('tasks-main')?.config).toEqual({ baseUrl: 'https://kaneo.invalid' })
})
```

- [ ] **Step 3: Write the failing task PATCH contributed-validator test**

Add this test after `test('rejects a task-instance create when the provider validator fails', ...)`:

```ts
test('PATCH /api/task-instances/:id rejects config when the contributed provider validator fails', async () => {
  registerContributedTaskProviderType('validated-patch', {
    pluginId: 'val-patch',
    factory: () => createMockProvider({ name: 'validated-patch' }),
    validateConfig: () => Promise.resolve({ ok: false as const, reason: 'bad url' }),
    capabilities: new Set<never>(),
    displayName: 'Validated Patch',
    configSchema: [{ key: 'baseUrl', label: 'URL', required: true, sensitive: false, scope: 'instance' }],
  })
  insertTaskInstance({
    id: 'validated-patch-1',
    type: 'validated-patch',
    config: { baseUrl: 'https://old.invalid' },
    status: 'active',
  })
  try {
    const res = expectResponse(
      await routeWithDeps(
        '/api/task-instances/validated-patch-1',
        { getRuntimeChatRouter: () => null, listActivePlatformInstances: () => [] },
        {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify({ config: { baseUrl: 'https://new.invalid' } }),
        },
      ),
    )

    expect(res.status).toBe(400)
    const body = assertObject(await readJson(res))
    expect(pick(body, 'error')).toBe('invalid_task_instance_config')
    expect(pick(body, 'reason')).toBe('bad url')
    expect(getTaskInstance('validated-patch-1')?.config).toEqual({ baseUrl: 'https://old.invalid' })
  } finally {
    unregisterContributedTaskProviderType('val-patch')
  }
})
```

- [ ] **Step 4: Run focused tests to verify they fail**

Run: `bun test tests/debug/instance-routes.test.ts --test-name-pattern "api/task-instances.*rejects"`

Expected: FAIL because task POST currently accepts malformed built-in URLs and task PATCH currently persists invalid config.

- [ ] **Step 5: Extend the validation import for task routes**

In `src/debug/instance-routes.ts`, replace this import:

```ts
import { validatePlatformInstanceConfig } from './instance-config-validation.js'
```

with this import:

```ts
import { validatePlatformInstanceConfig, validateTaskDescriptorInstanceConfig } from './instance-config-validation.js'
```

- [ ] **Step 6: Wire descriptor and contributed validators into task POST**

In the task POST branch in `src/debug/instance-routes.ts`, replace this block:

```ts
if (getTaskInstance(body.id) !== null) return instanceExistsError(body.id)
const configError = await validateTaskInstanceConfig(body.type, body.config)
if (configError !== null) return configError
insertTaskInstance({ ...body, status: 'active' })
```

with this block:

```ts
if (getTaskInstance(body.id) !== null) return instanceExistsError(body.id)
const descriptorConfigError = validateTaskDescriptorInstanceConfig(body.type, body.config)
if (descriptorConfigError !== null) return descriptorConfigError
const configError = await validateTaskInstanceConfig(body.type, body.config)
if (configError !== null) return configError
insertTaskInstance({ ...body, status: 'active' })
```

- [ ] **Step 7: Wire descriptor and contributed validators into task PATCH**

In the task PATCH branch in `src/debug/instance-routes.ts`, replace this block:

```ts
if (getTaskInstance(taskInstanceId) === null) return textResponse('Not found', 404)
const body = await parseBody(req, instancePatchSchema)
if (body instanceof Response) return body
const referencingContextIds = listContextsByTaskInstance(taskInstanceId).map((context) => context.contextId)
updateTaskInstance(taskInstanceId, { config: body.config, status: body.status })
```

with this block:

```ts
const existing = getTaskInstance(taskInstanceId)
if (existing === null) return textResponse('Not found', 404)
const body = await parseBody(req, instancePatchSchema)
if (body instanceof Response) return body
if (body.config !== undefined) {
  const descriptorConfigError = validateTaskDescriptorInstanceConfig(existing.type, body.config)
  if (descriptorConfigError !== null) return descriptorConfigError
  const configError = await validateTaskInstanceConfig(existing.type, body.config)
  if (configError !== null) return configError
}
const referencingContextIds = listContextsByTaskInstance(taskInstanceId).map((context) => context.contextId)
updateTaskInstance(taskInstanceId, { config: body.config, status: body.status })
```

- [ ] **Step 8: Update the existing positive task PATCH test fixture**

In `tests/debug/instance-routes.test.ts`, replace the setup and PATCH body inside `test('PATCH /api/task-instances/:id updates config and status and clears referencing context tool cache', ...)` with descriptor-valid config:

```ts
insertTaskInstance({ id: 'tasks-main', type: 'kaneo', config: { baseUrl: 'https://kaneo.invalid' }, status: 'active' })
```

```ts
        body: JSON.stringify({
          config: { baseUrl: 'https://new-kaneo.invalid', internalUrl: 'https://internal.kaneo.invalid' },
          status: 'stopped',
        }),
```

Replace the config assertion in that test with:

```ts
expect(pick(body, 'config')).toEqual({
  baseUrl: 'https://new-kaneo.invalid',
  internalUrl: 'https://internal.kaneo.invalid',
})
```

- [ ] **Step 9: Run focused task route tests**

Run: `bun test tests/debug/instance-routes.test.ts --test-name-pattern "task-instance"`

Expected: PASS.

- [ ] **Step 10: Run full route suite**

Run: `bun test tests/debug/instance-routes.test.ts`

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/debug/instance-routes.ts tests/debug/instance-routes.test.ts
git commit -m "fix: validate task instance patch config"
```

---

### Task 4: Make `/admin/system` Read Providers From Instance Tables

**Files:**

- Modify: `src/debug/admin-system.ts:10-39`
- Test: `tests/debug/admin-system.test.ts`
- Test: `tests/debug/admin-system-route.test.ts`

- [ ] **Step 1: Write failing unit tests for DB-derived provider display**

In `tests/debug/admin-system.test.ts`, add these imports:

```ts
import { insertPlatformInstance } from '../../src/instances/platform-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { setupTestDb } from '../utils/test-helpers.js'
```

Change the `beforeEach` callback to be async and reset the test DB:

```ts
beforeEach(async () => {
  await setupTestDb()
  process.env['CHAT_PROVIDER'] = saved['CHAT_PROVIDER']
  process.env['TASK_PROVIDER'] = saved['TASK_PROVIDER']
  process.env['DEBUG_SERVER'] = saved['DEBUG_SERVER']
  process.env['ADMIN_USER_ID'] = saved['ADMIN_USER_ID']
})
```

Replace `test('returns known providers verbatim', ...)` with:

```ts
test('returns providers from instance tables when bootstrap env vars are unset', async () => {
  delete process.env['CHAT_PROVIDER']
  delete process.env['TASK_PROVIDER']
  insertPlatformInstance({ id: 'discord-main', type: 'discord', config: { token: 'secret' }, status: 'active' })
  insertTaskInstance({
    id: 'youtrack-main',
    type: 'youtrack',
    config: { baseUrl: 'https://youtrack.invalid' },
    status: 'active',
  })

  const res = handleAdminSystem()
  const body = await readJson(res)

  expect(pick(body, 'chatProvider')).toBe('discord')
  expect(pick(body, 'taskProvider')).toBe('youtrack')
})
```

Replace `test('maps unknown providers to "unknown"', ...)` with:

```ts
test('ignores unsupported bootstrap env provider values', async () => {
  process.env['CHAT_PROVIDER'] = 'signal'
  process.env['TASK_PROVIDER'] = 'jira'

  const res = handleAdminSystem()
  const body = await readJson(res)

  expect(pick(body, 'chatProvider')).toBe('unknown')
  expect(pick(body, 'taskProvider')).toBe('unknown')
})
```

Replace `test('reports unknown task provider when TASK_PROVIDER is unset', ...)` with:

```ts
test('reports unknown task provider when no task instances exist', async () => {
  delete process.env['TASK_PROVIDER']

  const res = handleAdminSystem()
  const body = await readJson(res)

  expect(res.status).toBe(200)
  expect(pick(body, 'taskProvider')).toBe('unknown')
})
```

- [ ] **Step 2: Run unit tests to verify they fail**

Run: `bun test tests/debug/admin-system.test.ts`

Expected: FAIL because `handleAdminSystem()` still reads `CHAT_PROVIDER` and `TASK_PROVIDER` from `process.env`.

- [ ] **Step 3: Implement DB-derived provider display**

Add these imports to the existing import block in `src/debug/admin-system.ts`:

```ts
import { listPlatformInstances } from '../instances/platform-store.js'
import { listTaskInstances } from '../instances/task-store.js'
```

Then delete the existing `CHAT_PROVIDERS`, `safeProviderValue()`, `safeChatProvider()`, and `safeTaskProvider()` definitions and add these constants and functions below the imports:

```ts
const TASK_PROVIDERS = ['kaneo', 'youtrack'] as const

type AdminChatProvider = 'telegram' | 'mattermost' | 'discord' | 'unknown'
type AdminTaskProvider = (typeof TASK_PROVIDERS)[number] | 'unknown'

const singleKnownProvider = <T extends string>(values: readonly T[]): T | 'unknown' => {
  const unique = [...new Set(values)].toSorted((a, b) => a.localeCompare(b))
  return unique.length === 1 ? unique[0]! : 'unknown'
}

const safeChatProvider = (): AdminChatProvider =>
  singleKnownProvider(listPlatformInstances().map((instance) => instance.type))

const safeTaskProvider = (): AdminTaskProvider => {
  const known = listTaskInstances()
    .map((instance) => instance.type)
    .filter((type): type is (typeof TASK_PROVIDERS)[number] => TASK_PROVIDERS.some((knownType) => knownType === type))
  return singleKnownProvider(known)
}
```

After the edit, the top of `src/debug/admin-system.ts` should be:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listPlatformInstances } from '../instances/platform-store.js'
import { listTaskInstances } from '../instances/task-store.js'
import { logger } from '../logger.js'
import { listRecentRequests } from '../usage/recent-requests.js'
import { RecentRequestsResponseSchema } from './admin-schemas.js'

const TASK_PROVIDERS = ['kaneo', 'youtrack'] as const

type AdminChatProvider = 'telegram' | 'mattermost' | 'discord' | 'unknown'
type AdminTaskProvider = (typeof TASK_PROVIDERS)[number] | 'unknown'

const singleKnownProvider = <T extends string>(values: readonly T[]): T | 'unknown' => {
  const unique = [...new Set(values)].toSorted((a, b) => a.localeCompare(b))
  return unique.length === 1 ? unique[0]! : 'unknown'
}

const safeChatProvider = (): AdminChatProvider =>
  singleKnownProvider(listPlatformInstances().map((instance) => instance.type))

const safeTaskProvider = (): AdminTaskProvider => {
  const known = listTaskInstances()
    .map((instance) => instance.type)
    .filter((type): type is (typeof TASK_PROVIDERS)[number] => TASK_PROVIDERS.some((knownType) => knownType === type))
  return singleKnownProvider(known)
}
```

Do not change `handleAdminSystem()` response shape.

- [ ] **Step 4: Run admin-system unit tests**

Run: `bun test tests/debug/admin-system.test.ts`

Expected: PASS.

- [ ] **Step 5: Update route-level admin-system tests to seed DB rows**

In `tests/debug/admin-system-route.test.ts`, add these imports:

```ts
import { insertPlatformInstance } from '../../src/instances/platform-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
```

Change the route suite `beforeEach` callback to async and reset the DB before seeding instance rows:

```ts
beforeEach(async () => {
  await setupTestDb()
  process.env['DEBUG_TOKEN'] = TOKEN
  process.env['CHAT_PROVIDER'] = 'telegram'
  process.env['TASK_PROVIDER'] = 'kaneo'
  process.env['DEBUG_SERVER'] = 'true'
  process.env['ADMIN_USER_ID'] = 'admin-1'
  process.env['TELEGRAM_BOT_TOKEN'] = 'secret-token-value'
  process.env['LLM_API_KEY'] = 'sk-secret-value'
  insertPlatformInstance({
    id: 'telegram-main',
    type: 'telegram',
    config: { token: 'secret-token-value' },
    status: 'active',
  })
  insertTaskInstance({
    id: 'kaneo-main',
    type: 'kaneo',
    config: { baseUrl: 'https://kaneo.invalid' },
    status: 'active',
  })
})
```

The inserted rows are needed because `/admin/system` now reads provider display from DB instance tables, not provider env vars.

Remove the old sync `beforeEach` body that only assigned env vars:

```ts
beforeEach(() => {
  process.env['DEBUG_TOKEN'] = TOKEN
  process.env['CHAT_PROVIDER'] = 'telegram'
  process.env['TASK_PROVIDER'] = 'kaneo'
  process.env['DEBUG_SERVER'] = 'true'
  process.env['ADMIN_USER_ID'] = 'admin-1'
  process.env['TELEGRAM_BOT_TOKEN'] = 'secret-token-value'
  process.env['LLM_API_KEY'] = 'sk-secret-value'
})
```

Replace the unsupported env route test with:

```ts
test('GET /admin/system ignores unsupported bootstrap env providers', async () => {
  process.env['CHAT_PROVIDER'] = 'custom-chat-secret'
  process.env['TASK_PROVIDER'] = 'custom-task-secret'

  const res = await fetch(`http://localhost:${TEST_PORT}/admin/system`, { headers: authHeaders })
  expect(res.status).toBe(200)
  const text = await res.text()
  expect(text).not.toContain('custom-chat-secret')
  expect(text).not.toContain('custom-task-secret')

  const body = parseJsonObject(text)
  expect(pick(body, 'chatProvider')).toBe('telegram')
  expect(pick(body, 'taskProvider')).toBe('kaneo')
})
```

- [ ] **Step 6: Run route-level admin-system tests**

Run: `bun test tests/debug/admin-system-route.test.ts`

Expected: PASS.

- [ ] **Step 7: Run both admin-system suites together**

Run: `bun test tests/debug/admin-system.test.ts tests/debug/admin-system-route.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/debug/admin-system.ts tests/debug/admin-system.test.ts tests/debug/admin-system-route.test.ts
git commit -m "fix: read admin system providers from instances"
```

---

### Task 5: Final Verification

**Files:**

- Verify: `src/debug/instance-config-validation.ts`
- Verify: `src/debug/instance-routes.ts`
- Verify: `src/debug/admin-system.ts`
- Verify: `tests/debug/instance-routes.test.ts`
- Verify: `tests/debug/admin-system.test.ts`
- Verify: `tests/debug/admin-system-route.test.ts`

- [ ] **Step 1: Run targeted debug API tests**

Run:

```bash
bun test tests/debug/instance-routes.test.ts tests/debug/admin-system.test.ts tests/debug/admin-system-route.test.ts
```

Expected: PASS for all tests in the three files.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run lint on touched source and tests**

Run:

```bash
bun lint:agent-strict -- src/debug/instance-config-validation.ts src/debug/instance-routes.ts src/debug/admin-system.ts tests/debug/instance-routes.test.ts tests/debug/admin-system.test.ts tests/debug/admin-system-route.test.ts
```

Expected: PASS with no lint violations.

- [ ] **Step 4: Run format check on touched source and tests**

Run:

```bash
bun format:check src/debug/instance-config-validation.ts src/debug/instance-routes.ts src/debug/admin-system.ts tests/debug/instance-routes.test.ts tests/debug/admin-system.test.ts tests/debug/admin-system-route.test.ts
```

Expected: PASS with no formatting changes needed.

- [ ] **Step 5: Inspect git diff**

Run:

```bash
git diff -- src/debug/instance-config-validation.ts src/debug/instance-routes.ts src/debug/admin-system.ts tests/debug/instance-routes.test.ts tests/debug/admin-system.test.ts tests/debug/admin-system-route.test.ts
```

Expected: Diff contains only validation, route wiring, DB-derived admin system display, and tests described in this plan.

- [ ] **Step 6: Commit verification-ready state if previous tasks were not committed separately**

If Tasks 1-4 were already committed, skip this commit. If the work is still uncommitted, run:

```bash
git add src/debug/instance-config-validation.ts src/debug/instance-routes.ts src/debug/admin-system.ts tests/debug/instance-routes.test.ts tests/debug/admin-system.test.ts tests/debug/admin-system-route.test.ts
git commit -m "fix: harden multi-provider admin instance updates"
```

Expected: Commit succeeds and includes only the files listed above.

---

## Self-Review Notes

Spec coverage:

- PATCH task config validation parity is covered by Task 3.
- Platform PATCH validation is covered by Task 2.
- Platform POST descriptor validation is covered by Task 1 so PATCH and POST have consistent semantics.
- Task POST descriptor validation is covered by Task 3 so built-in required fields and URL fields are not weaker than PATCH.
- `/admin/system` env display drift is covered by Task 4.
- `resolveStrict`, `users.kaneo_workspace_id`, and resolver caching are explicitly excluded because they are cleanup or architectural follow-ups, not production-impact fixes for this patch.

Placeholder scan:

- The plan includes exact file paths, exact test code, exact implementation code, exact commands, and expected outcomes.

Type consistency:

- New helper exports are `validatePlatformInstanceConfig()` and `validateTaskDescriptorInstanceConfig()`.
- `src/debug/instance-routes.ts` imports and calls those exact helper names.
- Task-provider contributed validation continues to use existing `validateTaskInstanceConfig()`.
