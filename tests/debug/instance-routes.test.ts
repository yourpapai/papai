// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { setCachedTools, userCachesForTesting } from '../../src/cache.js'
import { ChatRouter } from '../../src/chat/router.js'
import type { ManagedChatInstance } from '../../src/chat/router.js'
import type { ChatProvider, ContextSnapshot } from '../../src/chat/types.js'
import { SESSION_COOKIE_NAME } from '../../src/dashboard-auth/cookie.js'
import { mintSession } from '../../src/dashboard-auth/index.js'
import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../src/debug/chat-router-runtime.js'
import { handleInstanceApiRoute, handleInstanceApiRouteWithDeps } from '../../src/debug/instance-routes.js'
import { addAdmin, listAdmins, SUPER_ADMIN_PLATFORM_ID } from '../../src/instances/admin-store.js'
import {
  listContextsByPlatformInstance,
  listContextsByTaskInstance,
  setContextSettings,
} from '../../src/instances/context-store.js'
import { getPlatformInstance, insertPlatformInstance } from '../../src/instances/platform-store.js'
import { getTaskInstance, listTaskInstances } from '../../src/instances/task-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import type { PlatformInstance, TaskInstance } from '../../src/instances/types.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { addUser, listUsers } from '../../src/users.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { getTestDb, mockLogger, setupTestDb } from '../utils/test-helpers.js'

const KANEO_PLUGIN_ID = 'task-provider-kaneo'
const YOUTRACK_PLUGIN_ID = 'task-provider-youtrack'

/** Register youtrack as a contributed type (it is no longer a builtin). */
const registerYouTrackContributed = (): void => {
  registerContributedTaskProviderType('youtrack', {
    pluginId: YOUTRACK_PLUGIN_ID,
    factory: () => createMockProvider({ name: 'youtrack' }),
    capabilities: new Set(),
    displayName: 'YouTrack',
    instanceConfigSchema: [
      { key: 'baseUrl', label: 'YouTrack URL', required: true, sensitive: false, scope: 'instance' },
    ],
    contextConfigSchema: [
      {
        key: 'token',
        label: 'YouTrack Permanent Token',
        required: true,
        sensitive: true,
        scope: 'context',
        storageKey: 'youtrack_token',
      },
    ],
    traits: new Set(),
  })
}

/** Register kaneo as a contributed type (it is no longer a builtin). */
const registerKaneoContributed = (): void => {
  registerContributedTaskProviderType('kaneo', {
    pluginId: KANEO_PLUGIN_ID,
    factory: () => createMockProvider({ name: 'kaneo' }),
    capabilities: new Set(),
    displayName: 'Kaneo',
    instanceConfigSchema: [
      { key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false, scope: 'instance' },
      { key: 'internalUrl', label: 'Kaneo Internal URL', required: false, sensitive: false, scope: 'instance' },
    ],
    contextConfigSchema: [
      {
        key: 'credential',
        label: 'Kaneo API Key',
        required: true,
        sensitive: true,
        scope: 'context',
        storageKey: 'kaneo_apikey',
      },
      {
        key: 'workspaceId',
        label: 'Workspace ID',
        required: true,
        sensitive: false,
        scope: 'context',
        storageKey: 'kaneo_workspace_id',
      },
    ],
    traits: new Set(),
  })
}

let authCookieValue: string
const jsonHeaders = (): Record<string, string> => ({
  Cookie: `${SESSION_COOKIE_NAME}=${authCookieValue}`,
  'Content-Type': 'application/json',
})

const readJson = async (res: Response): Promise<unknown> => JSON.parse(await res.text())

const route = (path: string, ...args: [] | [RequestInit]): Promise<Response | null> => {
  const req =
    args.length === 0 ? new Request(`http://debug.test${path}`) : new Request(`http://debug.test${path}`, args[0])
  return handleInstanceApiRoute(req, new URL(req.url))
}

const routeWithDeps = (
  path: string,
  deps: Parameters<typeof handleInstanceApiRouteWithDeps>[2],
  ...args: [] | [RequestInit]
): Promise<Response | null> => {
  const req =
    args.length === 0 ? new Request(`http://debug.test${path}`) : new Request(`http://debug.test${path}`, args[0])
  return handleInstanceApiRouteWithDeps(req, new URL(req.url), deps)
}

const expectResponse = (response: Response | null): Response => {
  expect(response).toBeInstanceOf(Response)
  if (response === null) throw new Error('expected response')
  return response
}

const assertObject = (value: unknown): object => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected object')
  return value
}

const assertArray = (value: unknown): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error('expected array')
  return value
}

const pick = (value: object, key: string): unknown => Reflect.get(value, key)

const cachedToolsFor = (key: string): unknown => {
  const entry = userCachesForTesting.get(key)
  if (entry === undefined) return undefined
  return entry.tools
}

const expectInstance = (router: ChatRouter, id: string): ManagedChatInstance => {
  const instance = router.getInstance(id)
  if (instance === null) throw new Error(`expected router instance ${id}`)
  return instance
}

const expectPlatformInstance = (id: string): PlatformInstance => {
  const instance = getPlatformInstance(id)
  if (instance === null) throw new Error(`expected platform instance ${id}`)
  return instance
}

const expectTaskInstance = (id: string): TaskInstance => {
  const instance = getTaskInstance(id)
  if (instance === null) throw new Error(`expected task instance ${id}`)
  return instance
}

const seedPlatformInstance = (id: string): void => {
  insertPlatformInstance({ id, type: 'telegram', config: { token: 'secret' }, status: 'active' })
}

const seedTaskInstance = (id: string): void => {
  insertTaskInstance({ id, type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
}

const fakeProvider = (start: () => Promise<void>, stop: () => Promise<void>): ChatProvider => ({
  name: 'fake-chat',
  threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
  capabilities: new Set(),
  traits: { observedGroupMessages: 'all' },
  configRequirements: [],
  registerCommand: (): void => {},
  onMessage: (): void => {},
  sendMessage: async (): Promise<void> => {},
  renderContext: (_snapshot: ContextSnapshot): { method: 'text'; content: string } => ({
    method: 'text',
    content: 'context',
  }),
  start,
  stop,
})

describe('instance API routes', () => {
  beforeEach(async () => {
    mockLogger()
    userCachesForTesting.clear()
    await setupTestDb()
    setStoreDb(getTestDb().$client)
    authCookieValue = mintSession('test-admin', { secure: false }).cookieValue
    clearRuntimeChatRouter()
    registerKaneoContributed()
    registerYouTrackContributed()
  })

  afterEach(() => {
    clearRuntimeChatRouter()
    userCachesForTesting.clear()
    setStoreDb(null)
    unregisterContributedTaskProviderType(KANEO_PLUGIN_ID)
    unregisterContributedTaskProviderType(YOUTRACK_PLUGIN_ID)
  })

  test('creates and lists masked platform instances', async () => {
    const created = expectResponse(
      await route('/api/platform-instances', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ id: 'telegram-main', type: 'telegram', config: { token: 'secret', label: 'main' } }),
      }),
    )

    expect(created.status).toBe(201)
    const createdBody = assertObject(await readJson(created))
    expect(pick(createdBody, 'config')).toEqual({ token: '********', label: 'main' })

    const listed = expectResponse(await route('/api/platform-instances'))

    expect(listed.status).toBe(200)
    const rows = assertArray(await readJson(listed))
    expect(rows).toHaveLength(1)
    expect(pick(assertObject(rows[0]), 'config')).toEqual({ token: '********', label: 'main' })
  })

  test('GET /api/platform-instances masks descriptor-sensitive fields', async () => {
    insertPlatformInstance({ id: 'tg', type: 'telegram', config: { token: 'secret' }, status: 'active' })

    const res = expectResponse(await route('/api/platform-instances'))

    const body = assertArray(await readJson(res))
    expect(pick(assertObject(pick(assertObject(body[0]), 'config')), 'token')).toBe('********')
  })

  test('duplicate platform create returns instance_exists conflict', async () => {
    insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' }, status: 'active' })

    const res = expectResponse(
      await route('/api/platform-instances', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ id: 'telegram-main', type: 'telegram', config: { token: 'other-secret' } }),
      }),
    )

    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ error: 'instance_exists', id: 'telegram-main' })
  })

  test('PATCH /api/platform-instances/:id updates config and status with masked config', async () => {
    insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' }, status: 'active' })

    const res = expectResponse(
      await route('/api/platform-instances/telegram-main', {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ config: { token: 'new-secret', label: 'main' }, status: 'stopped' }),
      }),
    )

    expect(res.status).toBe(200)
    const body = assertObject(await readJson(res))
    expect(pick(body, 'status')).toBe('stopped')
    expect(pick(body, 'config')).toEqual({ token: '********', label: 'main' })
  })

  test('PATCH /api/platform-instances/:id rejects invalid config and preserves the previous config', async () => {
    insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' }, status: 'active' })

    const res = expectResponse(
      await route('/api/platform-instances/telegram-main', {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ config: { label: 'main' } }),
      }),
    )

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({
      error: 'invalid_platform_instance_config',
      type: 'telegram',
      missing: ['token'],
    })
    expect(expectPlatformInstance('telegram-main').config).toEqual({ token: 'secret' })
  })

  test('platform PATCH missing instance returns 404', async () => {
    const res = expectResponse(
      await route('/api/platform-instances/missing-platform', {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ status: 'stopped' }),
      }),
    )

    expect(res.status).toBe(404)
  })

  test('returns null for unrelated API paths', async () => {
    const res = await route('/api/not-instances')

    expect(res).toBeNull()
  })

  test('rejects invalid platform instance schema with 400', async () => {
    const res = expectResponse(
      await route('/api/platform-instances', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ id: '', type: 'telegram', config: { token: 'secret' } }),
      }),
    )

    expect(res.status).toBe(400)
  })

  test('POST /api/platform-instances rejects missing descriptor-required config', async () => {
    const res = expectResponse(
      await route('/api/platform-instances', {
        method: 'POST',
        headers: jsonHeaders(),
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

  test('POST /api/platform-instances rejects malformed descriptor URL config', async () => {
    const res = expectResponse(
      await route('/api/platform-instances', {
        method: 'POST',
        headers: jsonHeaders(),
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

  test('rejects writes when DEBUG_TOKEN is unset', async () => {
    delete process.env['DEBUG_TOKEN']

    const res = expectResponse(
      await route('/api/platform-instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' } }),
      }),
    )

    expect(res.status).toBe(401)
  })

  test('returns 503 when apply has no runtime router', async () => {
    const res = expectResponse(
      await route('/api/platform-instances/apply', {
        method: 'POST',
        headers: jsonHeaders(),
      }),
    )

    expect(res.status).toBe(503)
    expect(await readJson(res)).toEqual({ error: 'router not initialised' })
  })

  test('returns config unreadable JSON when instance config loading fails', async () => {
    const router = new ChatRouter(() =>
      fakeProvider(
        mock(async () => {}),
        mock(async () => {}),
      ),
    )
    const res = expectResponse(
      await routeWithDeps(
        '/api/platform-instances/apply',
        {
          getRuntimeChatRouter: () => router,
          listActivePlatformInstances: () => {
            throw new Error('decrypt failed')
          },
        },
        { method: 'POST', headers: jsonHeaders() },
      ),
    )

    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'config unreadable' })
  })

  test('apply starts active DB platform instances missing from the runtime router and returns applied count', async () => {
    const start = mock(async () => {})
    const stop = mock(async () => {})
    const router = new ChatRouter(() => fakeProvider(start, stop))
    setRuntimeChatRouter(router)
    const instanceId = `telegram-apply-${randomUUID()}`
    const instance: PlatformInstance = {
      id: instanceId,
      type: 'telegram',
      config: { token: 'secret' },
      status: 'active',
      createdAt: '2026-05-24 00:00:00',
    }

    const res = expectResponse(
      await routeWithDeps(
        '/api/platform-instances/apply',
        { getRuntimeChatRouter: () => router, listActivePlatformInstances: () => [instance] },
        {
          method: 'POST',
          headers: jsonHeaders(),
        },
      ),
    )

    expect(res.status).toBe(200)
    expect(start.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(await readJson(res)).toEqual({ applied: 1 })
    expect(expectInstance(router, instanceId).status).toBe('active')
  })

  test('apply bounds concurrent platform starts', async () => {
    let activeStarts = 0
    let maxActiveStarts = 0
    const start = mock(async () => {
      activeStarts += 1
      maxActiveStarts = Math.max(maxActiveStarts, activeStarts)
      await Bun.sleep(5)
      activeStarts -= 1
    })
    const stop = mock(async () => {})
    const router = new ChatRouter(() => fakeProvider(start, stop))
    const instances: PlatformInstance[] = Array.from({ length: 6 }, (_, index) => ({
      id: `telegram-apply-${index}`,
      type: 'telegram',
      config: { token: `secret-${index}` },
      status: 'active',
      createdAt: '2026-05-24 00:00:00',
    }))

    const res = expectResponse(
      await routeWithDeps(
        '/api/platform-instances/apply',
        { getRuntimeChatRouter: () => router, listActivePlatformInstances: () => instances },
        { method: 'POST', headers: jsonHeaders() },
      ),
    )

    expect(res.status).toBe(200)
    expect(start).toHaveBeenCalledTimes(instances.length)
    expect(maxActiveStarts).toBeLessThanOrEqual(4)
    expect(await readJson(res)).toEqual({ applied: instances.length })
  })

  test('apply starts stopped runtime instances whose DB rows are active', async () => {
    const start = mock(async () => {})
    const stop = mock(async () => {})
    const router = new ChatRouter(() => fakeProvider(start, stop))
    const instanceId = `telegram-stopped-${randomUUID()}`
    const instance: PlatformInstance = {
      id: instanceId,
      type: 'telegram',
      config: { token: 'secret' },
      status: 'active',
      createdAt: '2026-05-24 00:00:00',
    }

    router.addInstance(instance.id, instance.type, instance.config)
    await router.stopInstance(instance.id)
    start.mockClear()

    const res = expectResponse(
      await routeWithDeps(
        '/api/platform-instances/apply',
        { getRuntimeChatRouter: () => router, listActivePlatformInstances: () => [instance] },
        { method: 'POST', headers: jsonHeaders() },
      ),
    )

    expect(res.status).toBe(200)
    expect(start).toHaveBeenCalledTimes(1)
    expect(expectInstance(router, instanceId).status).toBe('active')
  })

  test('deleting platform instance cascades owned rows, preserves super-admins, and clears context tool caches', async () => {
    seedPlatformInstance('telegram-main')
    seedTaskInstance('tasks-main')
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'telegram-main' })
    addUser({ userId: 'user-1', platformInstanceId: 'telegram-main', username: 'alice', addedBy: 'test' })
    addAdmin('platform-admin', 'telegram-main')
    addAdmin('super-admin', SUPER_ADMIN_PLATFORM_ID)
    setCachedTools('ctx-1', { old_tool: {} })
    setCachedTools('ctx-1:user-1:alice', { old_tool: {} })
    setCachedTools('ctx-other', { old_tool: {} })

    const res = expectResponse(
      await route('/api/platform-instances/telegram-main', {
        method: 'DELETE',
        headers: jsonHeaders(),
      }),
    )

    expect(res.status).toBe(204)
    expect(listContextsByPlatformInstance('telegram-main')).toEqual([])
    expect(listUsers('telegram-main')).toEqual([])
    expect(listAdmins().map((admin) => `${admin.platformInstanceId}:${admin.userId}`)).toEqual([
      '__super__:super-admin',
    ])
    expect(cachedToolsFor('ctx-1')).toBeNull()
    expect(cachedToolsFor('ctx-1:user-1:alice')).toBeNull()
    expect(cachedToolsFor('ctx-other')).toEqual({ old_tool: {} })
  })

  test('deleting platform instance does not remove runtime router instance until apply', async () => {
    seedPlatformInstance('telegram-main')
    const start = mock(async () => {})
    const stop = mock(async () => {})
    const router = new ChatRouter(() => fakeProvider(start, stop))
    router.addInstance('telegram-main', 'telegram', { token: 'secret' })
    setRuntimeChatRouter(router)

    const deleted = expectResponse(
      await route('/api/platform-instances/telegram-main', {
        method: 'DELETE',
        headers: jsonHeaders(),
      }),
    )

    expect(deleted.status).toBe(204)
    expect(router.getInstance('telegram-main')).not.toBeNull()
    expect(stop).not.toHaveBeenCalled()

    const applied = expectResponse(
      await route('/api/platform-instances/apply', {
        method: 'POST',
        headers: jsonHeaders(),
      }),
    )

    expect(applied.status).toBe(200)
    expect(router.getInstance('telegram-main')).toBeNull()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  test('updates platform instance status', async () => {
    await route('/api/platform-instances', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' } }),
    })

    const res = expectResponse(
      await route('/api/platform-instances/telegram-main/status', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ status: 'stopped' }),
      }),
    )

    expect(res.status).toBe(200)
    expect(pick(assertObject(await readJson(res)), 'status')).toBe('stopped')
  })

  test('deletes task instance context settings before deleting the task instance', async () => {
    seedPlatformInstance('telegram-main')
    seedTaskInstance('tasks-main')
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'telegram-main' })

    const res = expectResponse(
      await route('/api/task-instances/tasks-main', {
        method: 'DELETE',
        headers: jsonHeaders(),
      }),
    )

    expect(res.status).toBe(204)
    expect(listContextsByTaskInstance('tasks-main')).toEqual([])
  })

  test('deleting task instance clears cached tools for referencing contexts', async () => {
    seedPlatformInstance('telegram-main')
    seedTaskInstance('tasks-main')
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'telegram-main' })
    setCachedTools('ctx-1', { old_tool: {} })
    setCachedTools('ctx-1:user-1:alice', { old_tool: {} })
    setCachedTools('ctx-other', { old_tool: {} })

    const res = expectResponse(
      await route('/api/task-instances/tasks-main', {
        method: 'DELETE',
        headers: jsonHeaders(),
      }),
    )

    expect(res.status).toBe(204)
    expect(cachedToolsFor('ctx-1')).toBeNull()
    expect(cachedToolsFor('ctx-1:user-1:alice')).toBeNull()
    expect(cachedToolsFor('ctx-other')).toEqual({ old_tool: {} })
  })

  test('lists task instances with referencing context IDs', async () => {
    seedPlatformInstance('telegram-main')
    seedPlatformInstance('discord-main')
    seedTaskInstance('tasks-main')
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'telegram-main' })
    setContextSettings({ contextId: 'ctx-2', taskInstanceId: 'tasks-main', platformInstanceId: 'discord-main' })

    const res = expectResponse(await route('/api/task-instances'))

    expect(res.status).toBe(200)
    const row = assertObject(assertArray(await readJson(res))[0])
    expect(pick(row, 'referencingContextIds')).toEqual(['ctx-1', 'ctx-2'])
    expect(pick(row, 'referencingContextCount')).toBe(2)
  })

  test('creates and lists task instances with descriptor-driven masking', async () => {
    // Kaneo has no instance-scoped sensitive fields (credentials are user-scoped and never stored in
    // task_instances.config), so its descriptor contributes no masked keys here. Non-secret keys like
    // baseUrl pass through unmasked; secret-looking keys would still be masked by the name-pattern arm
    // of the defense-in-depth union (covered by the PATCH test below).
    const created = expectResponse(
      await route('/api/task-instances', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          id: 'tasks-main',
          type: 'kaneo',
          config: { baseUrl: 'https://kaneo.invalid' },
        }),
      }),
    )

    expect(created.status).toBe(201)
    expect(pick(assertObject(await readJson(created)), 'config')).toEqual({
      baseUrl: 'https://kaneo.invalid',
    })
    expect(expectTaskInstance('tasks-main').status).toBe('active')

    const listed = expectResponse(await route('/api/task-instances'))

    expect(listed.status).toBe(200)
    expect(listTaskInstances()).toHaveLength(1)
    expect(pick(assertObject(assertArray(await readJson(listed))[0]), 'config')).toEqual({
      baseUrl: 'https://kaneo.invalid',
    })
  })

  test('duplicate task create returns instance_exists conflict', async () => {
    insertTaskInstance({ id: 'tasks-main', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })

    const res = expectResponse(
      await route('/api/task-instances', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ id: 'tasks-main', type: 'kaneo', config: { url: 'https://other.invalid' } }),
      }),
    )

    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ error: 'instance_exists', id: 'tasks-main' })
  })

  test('PATCH /api/task-instances/:id updates config and status and clears referencing context tool cache', async () => {
    seedPlatformInstance('telegram-main')
    insertTaskInstance({
      id: 'tasks-main',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'telegram-main' })
    setCachedTools('ctx-1', { old_tool: {} })
    setCachedTools('ctx-other', { old_tool: {} })

    const res = expectResponse(
      await route('/api/task-instances/tasks-main', {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({
          config: { baseUrl: 'https://new-kaneo.invalid', internalUrl: 'https://internal.kaneo.invalid' },
          status: 'stopped',
        }),
      }),
    )

    expect(res.status).toBe(200)
    const body = assertObject(await readJson(res))
    expect(pick(body, 'status')).toBe('stopped')
    expect(pick(body, 'config')).toEqual({
      baseUrl: 'https://new-kaneo.invalid',
      internalUrl: 'https://internal.kaneo.invalid',
    })
    expect(cachedToolsFor('ctx-1')).toBeNull()
    expect(cachedToolsFor('ctx-other')).toEqual({ old_tool: {} })
  })

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
        headers: jsonHeaders(),
        body: JSON.stringify({ config: { internalUrl: 'https://internal.kaneo.invalid' } }),
      }),
    )

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({
      error: 'invalid_task_instance_config',
      type: 'kaneo',
      missing: ['baseUrl'],
    })
    expect(expectTaskInstance('tasks-main').config).toEqual({ baseUrl: 'https://kaneo.invalid' })
  })

  test('creates and deletes super-admin rows', async () => {
    const created = expectResponse(
      await route('/api/admins', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ userId: 'admin-1' }),
      }),
    )

    expect(created.status).toBe(201)
    expect(pick(assertObject(await readJson(created)), 'platformInstanceId')).toBe(SUPER_ADMIN_PLATFORM_ID)
    expect(listAdmins()).toHaveLength(1)

    const deleted = expectResponse(
      await route(`/api/admins/admin-1/${SUPER_ADMIN_PLATFORM_ID}`, {
        method: 'DELETE',
        headers: jsonHeaders(),
      }),
    )

    expect(deleted.status).toBe(204)
    expect(listAdmins()).toEqual([])
  })

  test('POST /api/admins rejects missing concrete platform instance', async () => {
    const res = expectResponse(
      await route('/api/admins', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ userId: 'admin-1', platformInstanceId: 'missing-platform' }),
      }),
    )

    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: 'platform_instance_not_found', id: 'missing-platform' })
    expect(listAdmins()).toEqual([])
  })

  test('lists admins', async () => {
    addAdmin('admin-1', SUPER_ADMIN_PLATFORM_ID)

    const res = expectResponse(await route('/api/admins'))

    expect(res.status).toBe(200)
    expect(pick(assertObject(assertArray(await readJson(res))[0]), 'userId')).toBe('admin-1')
  })

  test('GET /api/task-provider-types returns the catalog (both kaneo and youtrack are plugin-contributed)', async () => {
    // both kaneo and youtrack are registered in beforeEach as contributed types
    const res = expectResponse(await route('/api/task-provider-types'))

    expect(res.status).toBe(200)
    const body = assertArray(await readJson(res))
    const types = body.map((entry) => pick(assertObject(entry), 'type'))
    expect(types).toContain('kaneo')
    expect(types).toContain('youtrack')
    const kaneoEntry = assertObject(body.find((entry) => pick(assertObject(entry), 'type') === 'kaneo'))
    expect(pick(kaneoEntry, 'source')).toEqual({ plugin: KANEO_PLUGIN_ID })
    expect(Array.isArray(pick(kaneoEntry, 'capabilities'))).toBe(true)
    const youtrackEntry = assertObject(body.find((entry) => pick(assertObject(entry), 'type') === 'youtrack'))
    expect(pick(youtrackEntry, 'source')).toEqual({ plugin: YOUTRACK_PLUGIN_ID })
  })

  test('POST /api/task-instances rejects an unknown provider type', async () => {
    const res = expectResponse(
      await route('/api/task-instances', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ id: 'mystery-1', type: 'mystery', config: { baseUrl: 'https://x.invalid' } }),
      }),
    )

    expect(res.status).toBe(400)
    const body = assertObject(await readJson(res))
    expect(pick(body, 'error')).toBe('unknown_task_provider_type')
    expect(pick(body, 'type')).toBe('mystery')
  })

  test('POST /api/task-instances rejects malformed descriptor URL config', async () => {
    const res = expectResponse(
      await route('/api/task-instances', {
        method: 'POST',
        headers: jsonHeaders(),
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

  test('unknown task provider masks every config field', async () => {
    insertTaskInstance({ id: 'unknown', type: 'missing', config: { publicish: 'value' }, status: 'active' })

    const res = expectResponse(await route('/api/task-instances'))

    const body = assertArray(await readJson(res))
    expect(pick(assertObject(pick(assertObject(body[0]), 'config')), 'publicish')).toBe('********')
  })

  test('GET /api/task-instances marks rows whose provider plugin is not active', async () => {
    insertTaskInstance({ id: 'no-plugin-1', type: 'no-such-provider', config: { url: 'x' }, status: 'active' })

    const res = expectResponse(await route('/api/task-instances'))

    const body = assertArray(await readJson(res))
    const row = assertObject(body.find((entry) => pick(assertObject(entry), 'id') === 'no-plugin-1'))
    const unresolvedReason = pick(row, 'unresolvedReason')
    expect(typeof unresolvedReason).toBe('string')
    expect(String(unresolvedReason)).toContain('not active')
  })

  test('rejects a task-instance create when the provider validator fails', async () => {
    registerContributedTaskProviderType('validated', {
      pluginId: 'val',
      factory: () => createMockProvider({ name: 'validated' }),
      validateConfig: () => Promise.resolve({ ok: false as const, reason: 'bad url' }),
      capabilities: new Set<never>(),
      displayName: 'Validated',
      configSchema: [{ key: 'baseUrl', label: 'URL', required: true, sensitive: false, scope: 'instance' }],
    })
    try {
      const res = expectResponse(
        await routeWithDeps(
          '/api/task-instances',
          { getRuntimeChatRouter: () => null, listActivePlatformInstances: () => [] },
          {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({ id: 'v1', type: 'validated', config: { baseUrl: 'https://bad.invalid' } }),
          },
        ),
      )
      expect(res.status).toBe(400)
      const body = assertObject(await readJson(res))
      expect(pick(body, 'error')).toBe('invalid_task_instance_config')
      expect(pick(body, 'reason')).toBe('bad url')
    } finally {
      unregisterContributedTaskProviderType('val')
    }
  })

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
            headers: jsonHeaders(),
            body: JSON.stringify({ config: { baseUrl: 'https://new.invalid' } }),
          },
        ),
      )

      expect(res.status).toBe(400)
      const body = assertObject(await readJson(res))
      expect(pick(body, 'error')).toBe('invalid_task_instance_config')
      expect(pick(body, 'reason')).toBe('bad url')
      expect(expectTaskInstance('validated-patch-1').config).toEqual({ baseUrl: 'https://old.invalid' })
    } finally {
      unregisterContributedTaskProviderType('val-patch')
    }
  })

  test('allows a task-instance create when the provider validator passes', async () => {
    registerContributedTaskProviderType('validated-ok', {
      pluginId: 'val-ok',
      factory: () => createMockProvider({ name: 'validated-ok' }),
      validateConfig: () => Promise.resolve({ ok: true as const }),
      capabilities: new Set<never>(),
      displayName: 'Validated OK',
      configSchema: [{ key: 'baseUrl', label: 'URL', required: true, sensitive: false, scope: 'instance' }],
    })
    try {
      const res = expectResponse(
        await routeWithDeps(
          '/api/task-instances',
          { getRuntimeChatRouter: () => null, listActivePlatformInstances: () => [] },
          {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({ id: 'v-ok-1', type: 'validated-ok', config: { baseUrl: 'https://ok.invalid' } }),
          },
        ),
      )
      expect(res.status).toBe(201)
      const instance = getTaskInstance('v-ok-1')
      expect(instance).not.toBeNull()
    } finally {
      unregisterContributedTaskProviderType('val-ok')
    }
  })

  test('masks instance-scoped sensitive fields declared by a contributed task provider type', async () => {
    mockLogger()
    registerContributedTaskProviderType('masktest', {
      pluginId: 'mask-plugin',
      factory: () => createMockProvider({ name: 'masktest' }),
      capabilities: new Set<never>(),
      displayName: 'Mask Test',
      configSchema: [
        { key: 'baseUrl', label: 'URL', required: true, sensitive: false, scope: 'instance' },
        { key: 'apiSecret', label: 'Secret', required: true, sensitive: true, scope: 'instance' },
      ],
    })

    try {
      const created = expectResponse(
        await routeWithDeps(
          '/api/task-instances',
          { getRuntimeChatRouter: () => null, listActivePlatformInstances: () => [] },
          {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({
              id: 'masktest-1',
              type: 'masktest',
              config: { baseUrl: 'https://masktest.invalid', apiSecret: 'super-secret-value' },
            }),
          },
        ),
      )

      expect(created.status).toBe(201)
      const createdConfig = assertObject(pick(assertObject(await readJson(created)), 'config'))
      expect(pick(createdConfig, 'baseUrl')).toBe('https://masktest.invalid')
      expect(pick(createdConfig, 'apiSecret')).toBe('********')

      const listed = expectResponse(
        await routeWithDeps('/api/task-instances', {
          getRuntimeChatRouter: () => null,
          listActivePlatformInstances: () => [],
        }),
      )

      expect(listed.status).toBe(200)
      const rows = assertArray(await readJson(listed))
      const masktestRow = rows.find((row) => pick(assertObject(row), 'type') === 'masktest')
      const listedConfig = assertObject(pick(assertObject(masktestRow), 'config'))
      expect(pick(listedConfig, 'baseUrl')).toBe('https://masktest.invalid')
      expect(pick(listedConfig, 'apiSecret')).toBe('********')
    } finally {
      unregisterContributedTaskProviderType('mask-plugin')
    }
  })
})
