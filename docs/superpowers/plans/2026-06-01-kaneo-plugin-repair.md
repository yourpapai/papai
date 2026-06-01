<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kaneo Plugin Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair pre-plugin Kaneo users by backfilling the new plugin-era assignment state, and fix the admin/settings flows that currently leave Kaneo task instances unusable.

**Architecture:** Add an idempotent startup repair pass that detects legacy Kaneo-configured contexts, ensures there is one usable active Kaneo task instance, enables the Kaneo plugin for those contexts, and backfills missing `context_settings` rows from scoped context IDs. In parallel, fix the settings admin task-instance lifecycle so Kaneo instances do not get created as permanently `pending`, and harden the group assignment UI/API to only expose active task instances.

**Tech Stack:** Bun, TypeScript, Drizzle ORM, SQLite, Svelte, bun:test, happy-dom

---

**Execution note:** This plan intentionally omits git commit steps. Only commit if the user explicitly asks for it.

## File Map

- Create: `src/instances/kaneo-legacy-repair.ts`
  - Startup-only, idempotent repair helper for legacy Kaneo users.
- Modify: `src/index.ts`
  - Run the repair after plugin activation and before runtime warnings.
- Test: `tests/instances/kaneo-legacy-repair.test.ts`
  - Covers repair creation, promotion, assignment, enablement, and no-op edge cases.

- Modify: `src/debug/settings/admin/instances-routes.ts`
  - Make admin-created task instances default to `active`; preserve PATCH status editing.
- Modify: `client/settings/admin-fetchers.ts`
  - Add PATCH helper for admin task instances.
- Modify: `client/settings/sections/admin/AdminInstancesSection.svelte`
  - Add Start/Stop controls for task instances.
- Test: `tests/debug/settings/admin/instances-routes.test.ts`
  - Covers route defaults and status updates.
- Test: `tests/client/settings/sections/admin/AdminInstancesSection.test.ts`
  - Covers task-instance status actions in the SPA.

- Modify: `src/debug/settings/group-routes.ts`
  - Only list active task instances; reject assigning inactive ones.
- Modify: `client/settings/sections/GroupProviderSection.svelte`
  - Show a clear empty-state when there are no active task instances.
- Test: `tests/debug/settings/group-routes.test.ts`
  - Covers active-only listing and inactive assignment rejection.
- Test: `tests/client/settings/sections/GroupProviderSection.test.ts`
  - Covers empty-state and unchanged active selection behavior.

### Task 1: Add the Kaneo Legacy Startup Repair

**Files:**

- Create: `src/instances/kaneo-legacy-repair.ts`
- Modify: `src/index.ts`
- Test: `tests/instances/kaneo-legacy-repair.test.ts`

- [ ] **Step 1: Write the failing startup-repair tests**

```ts
import { beforeEach, describe, expect, test } from 'bun:test'

import { runKaneoLegacyRepair } from '../../src/instances/kaneo-legacy-repair.js'
import { getContextSettings } from '../../src/instances/context-store.js'
import { getTaskInstance, insertTaskInstance, listTaskInstances } from '../../src/instances/task-store.js'
import { getPluginContextState } from '../../src/plugins/store.js'
import { KANEO_PLUGIN_CREDENTIAL_KEY, KANEO_PLUGIN_WORKSPACE_KEY } from '../../src/types/config.js'
import { addUser } from '../../src/users.js'
import { setConfigValue } from '../../src/config.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../utils/test-helpers.js'

describe('runKaneoLegacyRepair', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['INSTANCE_CONFIG_KEY'] = '7'.repeat(64)
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
  })

  test('creates one active Kaneo task instance and backfills assignment + plugin enablement', async () => {
    const contextId = 'pi:cGktMQ:ctx:dS0x'
    setConfigValue(contextId, KANEO_PLUGIN_CREDENTIAL_KEY, 'cred-1')
    setConfigValue(contextId, KANEO_PLUGIN_WORKSPACE_KEY, 'ws-1')
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.example'
    process.env['KANEO_INTERNAL_URL'] = 'https://kaneo.internal'

    const summary = runKaneoLegacyRepair()

    expect(summary.repairedContexts).toBe(1)
    expect(listTaskInstances().map((row) => ({ id: row.id, type: row.type, status: row.status }))).toEqual([
      { id: 'kaneo-default', type: 'kaneo', status: 'active' },
    ])
    expect(getContextSettings(contextId)?.taskInstanceId).toBe('kaneo-default')
    expect(getPluginContextState('task-provider-kaneo', contextId)?.enabled).toBe(true)
  })

  test('promotes a single pending Kaneo instance instead of creating a second row', async () => {
    const contextId = 'pi:cGktMQ:ctx:dS0x'
    setConfigValue(contextId, KANEO_PLUGIN_CREDENTIAL_KEY, 'cred-1')
    setConfigValue(contextId, KANEO_PLUGIN_WORKSPACE_KEY, 'ws-1')
    insertTaskInstance({
      id: 'legacy-kaneo',
      type: 'kaneo',
      status: 'pending',
      config: { baseUrl: 'https://kaneo.example', internalUrl: 'https://kaneo.internal' },
    })

    const summary = runKaneoLegacyRepair()

    expect(summary.promotedTaskInstances).toBe(1)
    expect(getTaskInstance('legacy-kaneo')?.status).toBe('active')
    expect(listTaskInstances()).toHaveLength(1)
    expect(getContextSettings(contextId)?.taskInstanceId).toBe('legacy-kaneo')
  })

  test('skips assignment when multiple active Kaneo instances already exist', async () => {
    const contextId = 'pi:cGktMQ:ctx:dS0x'
    setConfigValue(contextId, KANEO_PLUGIN_CREDENTIAL_KEY, 'cred-1')
    setConfigValue(contextId, KANEO_PLUGIN_WORKSPACE_KEY, 'ws-1')
    insertTaskInstance({ id: 'k1', type: 'kaneo', status: 'active', config: { baseUrl: 'https://one.example' } })
    insertTaskInstance({ id: 'k2', type: 'kaneo', status: 'active', config: { baseUrl: 'https://two.example' } })

    const summary = runKaneoLegacyRepair()

    expect(summary.skippedDueToAmbiguousTaskInstance).toBe(1)
    expect(getContextSettings(contextId)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the new server test and verify it fails**

Run: `bun test tests/instances/kaneo-legacy-repair.test.ts`

Expected: FAIL with module-not-found or missing export errors for `runKaneoLegacyRepair`.

- [ ] **Step 3: Implement the idempotent repair helper**

```ts
// src/instances/kaneo-legacy-repair.ts
import { inArray } from 'drizzle-orm'

import { parseScopedContextId } from '../chat/scoped-context.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { userConfig } from '../db/schema.js'
import { setContextSettings } from './context-store.js'
import { insertTaskInstance, listTaskInstances, updateTaskInstance } from './task-store.js'
import { logger } from '../logger.js'
import { setPluginEnabledForContext } from '../plugins/registry.js'
import { KANEO_PLUGIN_CREDENTIAL_KEY, KANEO_PLUGIN_WORKSPACE_KEY } from '../types/config.js'

const log = logger.child({ scope: 'instances:kaneo-legacy-repair' })
const KANEO_PLUGIN_ID = 'task-provider-kaneo'
const KANEO_DEFAULT_INSTANCE_ID = 'kaneo-default'

type RepairSummary = {
  repairedContexts: number
  createdTaskInstances: number
  promotedTaskInstances: number
  skippedDueToAmbiguousTaskInstance: number
}

function listLegacyConfiguredContextIds(): string[] {
  const rows = getDrizzleDb()
    .select({ userId: userConfig.userId, key: userConfig.key })
    .from(userConfig)
    .where(inArray(userConfig.key, [KANEO_PLUGIN_CREDENTIAL_KEY, KANEO_PLUGIN_WORKSPACE_KEY]))
    .all()

  const grouped = new Map<string, Set<string>>()
  for (const row of rows) {
    const keys = grouped.get(row.userId) ?? new Set<string>()
    keys.add(row.key)
    grouped.set(row.userId, keys)
  }

  return [...grouped.entries()]
    .filter(([, keys]) => keys.has(KANEO_PLUGIN_CREDENTIAL_KEY) && keys.has(KANEO_PLUGIN_WORKSPACE_KEY))
    .map(([contextId]) => contextId)
}

function resolveUsableKaneoTaskInstanceId(): { id: string; created: boolean; promoted: boolean } | null {
  const kaneoInstances = listTaskInstances().filter((instance) => instance.type === 'kaneo')
  const active = kaneoInstances.filter((instance) => instance.status === 'active')
  if (active.length === 1) return { id: active[0]!.id, created: false, promoted: false }
  if (active.length > 1) return null

  const pending = kaneoInstances.filter((instance) => instance.status === 'pending')
  if (pending.length === 1) {
    updateTaskInstance(pending[0]!.id, { config: undefined, status: 'active' })
    return { id: pending[0]!.id, created: false, promoted: true }
  }
  if (pending.length > 1) return null

  const baseUrl = process.env['KANEO_CLIENT_URL']?.trim()
  const internalUrl = process.env['KANEO_INTERNAL_URL']?.trim()
  if (!baseUrl) return null

  insertTaskInstance({
    id: KANEO_DEFAULT_INSTANCE_ID,
    type: 'kaneo',
    status: 'active',
    config: internalUrl ? { baseUrl, internalUrl } : { baseUrl },
  })
  return { id: KANEO_DEFAULT_INSTANCE_ID, created: true, promoted: false }
}

export function runKaneoLegacyRepair(): RepairSummary {
  const candidateContextIds = listLegacyConfiguredContextIds()
  if (candidateContextIds.length === 0) {
    return {
      repairedContexts: 0,
      createdTaskInstances: 0,
      promotedTaskInstances: 0,
      skippedDueToAmbiguousTaskInstance: 0,
    }
  }

  const taskInstance = resolveUsableKaneoTaskInstanceId()
  if (taskInstance === null) {
    log.warn(
      { contexts: candidateContextIds.length },
      'Skipping Kaneo legacy repair: ambiguous or unavailable task instance state',
    )
    return {
      repairedContexts: 0,
      createdTaskInstances: 0,
      promotedTaskInstances: 0,
      skippedDueToAmbiguousTaskInstance: candidateContextIds.length,
    }
  }

  let repairedContexts = 0
  for (const contextId of candidateContextIds) {
    const parsed = parseScopedContextId(contextId)
    if (parsed === null) continue
    setContextSettings({
      contextId,
      taskInstanceId: taskInstance.id,
      platformInstanceId: parsed.platformInstanceId,
    })
    setPluginEnabledForContext(KANEO_PLUGIN_ID, contextId, true)
    repairedContexts += 1
  }

  return {
    repairedContexts,
    createdTaskInstances: taskInstance.created ? 1 : 0,
    promotedTaskInstances: taskInstance.promoted ? 1 : 0,
    skippedDueToAmbiguousTaskInstance: 0,
  }
}
```

- [ ] **Step 4: Wire the repair into startup after plugin activation**

```ts
// src/index.ts
import { runKaneoLegacyRepair } from './instances/kaneo-legacy-repair.js'

// after activatePlugins(toActivate)
const kaneoPluginActive = pluginRegistry.getEntry('task-provider-kaneo')?.state === 'active'
if (kaneoPluginActive) {
  const kaneoRepairSummary = runKaneoLegacyRepair()
  log.info({ kaneoRepairSummary }, 'Kaneo legacy repair evaluated')
}

warnUnresolvedTaskInstances()
```

- [ ] **Step 5: Run the focused server tests and verify they pass**

Run: `bun test tests/instances/kaneo-legacy-repair.test.ts tests/providers/resolver.test.ts tests/plugins/task-provider-kaneo/provision.test.ts tests/config-keys.test.ts`

Expected: PASS. The new repair tests pass, and existing resolver/provision/config behavior remains green.

### Task 2: Fix Admin Task-Instance Lifecycle in Settings

**Files:**

- Modify: `src/debug/settings/admin/instances-routes.ts`
- Modify: `client/settings/admin-fetchers.ts`
- Modify: `client/settings/sections/admin/AdminInstancesSection.svelte`
- Test: `tests/debug/settings/admin/instances-routes.test.ts`
- Test: `tests/client/settings/sections/admin/AdminInstancesSection.test.ts`

- [ ] **Step 1: Write failing route and SPA tests for task-instance status control**

```ts
// tests/debug/settings/admin/instances-routes.test.ts
test('admin POST task-instances defaults omitted status to active', async () => {
  const url = new URL('https://x/settings/api/admin/task-instances')
  const res = await handleAdminInstancesRoutes(
    new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'ti-new', type: 'kaneo', config: {} }),
    }),
    url,
    '/settings/api/admin/task-instances',
  )
  expect(res.status).toBe(201)
  expect(getTaskInstance('ti-new')?.status).toBe('active')
})

test('admin PATCH task-instances updates status', async () => {
  const url = new URL('https://x/settings/api/admin/task-instances/ti-1')
  const res = await handleAdminInstancesRoutes(
    new Request(url, {
      method: 'PATCH',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' }),
    }),
    url,
    '/settings/api/admin/task-instances/ti-1',
  )
  expect(res.status).toBe(200)
  expect(getTaskInstance('ti-1')?.status).toBe('stopped')
})
```

```ts
// tests/client/settings/sections/admin/AdminInstancesSection.test.ts
test('renders a task status button and calls PATCH when clicked', async () => {
  setCsrfToken('c')
  let taskPatchSeen = false
  setMockFetch((url, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase()
    if (url.includes('/admin/task-instances/k') && method === 'PATCH') {
      taskPatchSeen = true
      return Promise.resolve(json({ ok: true, id: 'k' }))
    }
    if (url.includes('/admin/task-instances')) {
      return Promise.resolve(
        json({ instances: [{ id: 'k', type: 'kaneo', status: 'active', config: {}, createdAt: 1 }] }),
      )
    }
    if (url.includes('/admin/platform-instances')) {
      return Promise.resolve(
        json({ instances: [{ id: 'tg', type: 'telegram', status: 'active', config: {}, createdAt: 1 }] }),
      )
    }
    if (url.includes('/admin/platform-provider-types')) {
      return Promise.resolve(
        json({ providerTypes: [{ type: 'telegram', displayName: 'Telegram', instanceConfigSchema: [] }] }),
      )
    }
    if (url.includes('/admin/task-provider-types')) {
      return Promise.resolve(
        json({ providerTypes: [{ type: 'kaneo', displayName: 'Kaneo', instanceConfigSchema: [] }] }),
      )
    }
    return Promise.resolve(json({}))
  })

  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(AdminInstancesSection, { target })
  await drain()
  target.querySelector<HTMLButtonElement>('[data-testid="task-status-k"]')!.click()
  await drain()

  expect(taskPatchSeen).toBe(true)
  void unmount(component)
})
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run: `bun test tests/debug/settings/admin/instances-routes.test.ts`

Expected: FAIL because task-instance POST still defaults to `pending` and the new PATCH assertion is missing.

Run: `bun test:client`

Expected: FAIL in `AdminInstancesSection.test.ts` because there is no `task-status-k` button or task PATCH helper yet.

- [ ] **Step 3: Make task-instance creation default to active and expose task PATCH in the client fetchers**

```ts
// src/debug/settings/admin/instances-routes.ts
const TaskInstanceCreateSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  config: z.record(z.string(), z.string()).default({}),
  status: z.enum(['pending', 'active', 'stopped']).default('active'),
})
```

```ts
// client/settings/admin-fetchers.ts
export const updateAdminTaskInstance = (
  id: string,
  input: { status?: string; config?: Record<string, string> },
): Promise<unknown> =>
  writeJson(`/settings/api/admin/task-instances/${encodeURIComponent(id)}`, 'PATCH', input, (b) => b)
```

- [ ] **Step 4: Add task Start/Stop controls to the admin instances SPA**

```svelte
<!-- client/settings/sections/admin/AdminInstancesSection.svelte -->
<script lang="ts">
  import {
    createAdminPlatformInstance,
    createAdminTaskInstance,
    deleteAdminPlatformInstance,
    deleteAdminTaskInstance,
    fetchAdminPlatformInstances,
    fetchAdminPlatformProviderTypes,
    fetchAdminTaskInstances,
    fetchAdminTaskProviderTypes,
    updateAdminPlatformInstance,
    updateAdminTaskInstance,
  } from '../../admin-fetchers.js'

  async function toggleTaskStatus(row: AdminInstanceRow): Promise<void> {
    error = null
    status = null
    try {
      await updateAdminTaskInstance(row.id, { status: row.status === 'active' ? 'stopped' : 'active' })
      await load()
    } catch (err) {
      setErr(err)
    }
  }
</script>

<td>
  <button
    type="button"
    data-testid={`task-status-${row.id}`}
    onclick={() => void toggleTaskStatus(row)}>{row.status === 'active' ? 'Stop' : 'Start'}</button>
  <button
    type="button"
    data-testid={`task-delete-${row.id}`}
    onclick={() => void deleteTask(row.id)}>Delete</button>
</td>
```

- [ ] **Step 5: Run the focused tests and verify they pass**

Run: `bun test tests/debug/settings/admin/instances-routes.test.ts`

Expected: PASS. New task-instance POST defaults and PATCH behavior are green.

Run: `bun test:client`

Expected: PASS. `AdminInstancesSection` now exposes the task status action and continues rendering existing rows.

### Task 3: Expose Only Active Task Instances in Group Settings

**Files:**

- Modify: `src/debug/settings/group-routes.ts`
- Modify: `client/settings/sections/GroupProviderSection.svelte`
- Test: `tests/debug/settings/group-routes.test.ts`
- Test: `tests/client/settings/sections/GroupProviderSection.test.ts`

- [ ] **Step 1: Write failing tests for active-only group assignment**

```ts
// tests/debug/settings/group-routes.test.ts
test('task-instance GET only returns active task instances', async () => {
  const contextId = seedManageableGroup()
  insertTaskInstance({ id: 'ti-active', type: 'kaneo', config: {}, status: 'active' })
  insertTaskInstance({ id: 'ti-pending', type: 'kaneo', config: {}, status: 'pending' })

  const getUrl = new URL(`https://x/settings/api/group/task-instance?contextId=${encodeURIComponent(contextId)}`)
  const res = await handleGroupRoutes(
    new Request(getUrl, { headers: authHeaders(session) }),
    getUrl,
    '/settings/api/group/task-instance',
  )
  const body = TaskInstanceGetSchema.parse(await res.json())

  expect(body.available).toEqual([{ id: 'ti-active', type: 'kaneo', status: 'active' }])
})

test('task-instance PATCH rejects inactive instances', async () => {
  const contextId = seedManageableGroup()
  insertTaskInstance({ id: 'ti-pending', type: 'kaneo', config: {}, status: 'pending' })

  const patchUrl = new URL('https://x/settings/api/group/task-instance')
  const res = await handleGroupRoutes(
    new Request(patchUrl, {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskInstanceId: 'ti-pending', contextId }),
    }),
    patchUrl,
    '/settings/api/group/task-instance',
  )

  expect(res.status).toBe(422)
})
```

```ts
// tests/client/settings/sections/GroupProviderSection.test.ts
test('shows an empty-state when no active task instances are available', async () => {
  setMockFetch(() => Promise.resolve(json({ contextId: 'group:7', taskInstanceId: null, available: [] })))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
  await drain()

  expect(target.textContent).toContain('No active task instances available')
  void unmount(component)
})
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run: `bun test tests/debug/settings/group-routes.test.ts`

Expected: FAIL because the route still returns every task instance regardless of status.

Run: `bun test:client`

Expected: FAIL in `GroupProviderSection.test.ts` because the component has no empty-state for zero active options.

- [ ] **Step 3: Filter group settings to active task instances and reject inactive assignment**

```ts
// src/debug/settings/group-routes.ts
function handleTaskInstanceGet(authed: AuthenticatedSettingsRequest, url: URL): Response {
  const outcome = requireGroup(authed, 'read', url.searchParams.get('contextId'))
  if (!outcome.ok) return outcome.response
  const settings = getContextSettings(outcome.group.contextId)
  const available = listTaskInstances()
    .filter((taskInstance) => taskInstance.status === 'active')
    .map((taskInstance) => ({ id: taskInstance.id, type: taskInstance.type, status: taskInstance.status }))

  return settingsJson(200, {
    contextId: outcome.group.contextId,
    taskInstanceId: settings?.taskInstanceId ?? null,
    available,
  })
}

async function handleTaskInstancePatch(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  // existing parse/auth code stays the same
  const taskInstance = getTaskInstance(body.data.taskInstanceId)
  if (taskInstance === null || taskInstance.status !== 'active') {
    return settingsJson(422, { error: 'unknown active task instance' })
  }
  // existing setContextSettings call stays the same
}
```

- [ ] **Step 4: Add a clear zero-options state to the group provider section**

```svelte
<!-- client/settings/sections/GroupProviderSection.svelte -->
{#if data !== null && data.available.length === 0}
  <p class="placeholder">No active task instances available. Ask a bot admin to start or create one in Admin → Instances.</p>
{:else if data !== null}
  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void save() }}>
    <label>
      <span>Task instance</span>
      <select data-testid="group-task-instance" value={selected} onchange={(e) => (selected = (e.target as HTMLSelectElement).value)}>
        {#each data.available as option (option.id)}
          <option value={option.id}>{option.id} ({option.type} · {option.status})</option>
        {/each}
      </select>
    </label>
    <button type="submit" data-testid="group-task-instance-save">Save</button>
  </form>
{/if}
```

- [ ] **Step 5: Run the focused tests and verify they pass**

Run: `bun test tests/debug/settings/group-routes.test.ts`

Expected: PASS. Group settings only expose active rows and reject pending ones.

Run: `bun test:client`

Expected: PASS. `GroupProviderSection` still supports active selections and now renders a useful empty-state.

## Final Verification

- [ ] Run: `bun test tests/instances/kaneo-legacy-repair.test.ts tests/debug/settings/admin/instances-routes.test.ts tests/debug/settings/group-routes.test.ts tests/providers/resolver.test.ts tests/plugins/task-provider-kaneo/provision.test.ts tests/config-keys.test.ts`
      Expected: PASS.

- [ ] Run: `bun test:client`
      Expected: PASS.

- [ ] Run: `bun typecheck`
      Expected: PASS.

- [ ] Run: `bun format:check`
      Expected: PASS.

## Self-Review

- Spec coverage: The plan covers the three verified defects: missing legacy backfill, admin-created `pending` Kaneo task instances, and settings flows exposing unusable inactive task instances.
- Placeholder scan: No `TODO`, `TBD`, or “handle appropriately” placeholders remain.
- Type consistency: The same runtime names are used throughout the plan: `runKaneoLegacyRepair`, `updateAdminTaskInstance`, `task-status-${row.id}`, `Kaneo legacy repair evaluated`.
