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
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../src/debug/chat-router-runtime.js'
import { handleInstanceApiRoute, handleInstanceApiRouteWithDeps } from '../../src/debug/instance-routes.js'
import { addAdmin, listAdmins, SUPER_ADMIN_PLATFORM_ID } from '../../src/instances/admin-store.js'
import {
  listContextsByPlatformInstance,
  listContextsByTaskInstance,
  setContextSettings,
} from '../../src/instances/context-store.js'
import { insertPlatformInstance } from '../../src/instances/platform-store.js'
import { getTaskInstance, listTaskInstances } from '../../src/instances/task-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import type { PlatformInstance, TaskInstance } from '../../src/instances/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const TOKEN = 'instance-api-token'
const jsonHeaders = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
} as const

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

const expectInstance = (router: ChatRouter, id: string): ManagedChatInstance => {
  const instance = router.getInstance(id)
  if (instance === null) throw new Error(`expected router instance ${id}`)
  return instance
}

const expectTaskInstance = (id: string): TaskInstance => {
  const instance = getTaskInstance(id)
  if (instance === null) throw new Error(`expected task instance ${id}`)
  return instance
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
    clearRuntimeChatRouter()
    process.env['DEBUG_TOKEN'] = TOKEN
  })

  afterEach(() => {
    clearRuntimeChatRouter()
    userCachesForTesting.clear()
    delete process.env['DEBUG_TOKEN']
  })

  test('creates and lists masked platform instances', async () => {
    const created = expectResponse(
      await route('/api/platform-instances', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ id: 'telegram-main', type: 'telegram', config: { bot_token: 'secret', label: 'main' } }),
      }),
    )

    expect(created.status).toBe(201)
    const createdBody = assertObject(await readJson(created))
    expect(pick(createdBody, 'config')).toEqual({ bot_token: '***', label: 'main' })

    const listed = expectResponse(await route('/api/platform-instances'))

    expect(listed.status).toBe(200)
    const rows = assertArray(await readJson(listed))
    expect(rows).toHaveLength(1)
    expect(pick(assertObject(rows[0]), 'config')).toEqual({ bot_token: '***', label: 'main' })
  })

  test('duplicate platform create returns instance_exists conflict', async () => {
    insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { bot_token: 'secret' }, status: 'active' })

    const res = expectResponse(
      await route('/api/platform-instances', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ id: 'telegram-main', type: 'telegram', config: { bot_token: 'other-secret' } }),
      }),
    )

    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ error: 'instance_exists', id: 'telegram-main' })
  })

  test('PATCH /api/platform-instances/:id updates config and status with masked config', async () => {
    insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { bot_token: 'secret' }, status: 'active' })

    const res = expectResponse(
      await route('/api/platform-instances/telegram-main', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ config: { bot_token: 'new-secret', label: 'main' }, status: 'stopped' }),
      }),
    )

    expect(res.status).toBe(200)
    const body = assertObject(await readJson(res))
    expect(pick(body, 'status')).toBe('stopped')
    expect(pick(body, 'config')).toEqual({ bot_token: '***', label: 'main' })
  })

  test('platform PATCH missing instance returns 404', async () => {
    const res = expectResponse(
      await route('/api/platform-instances/missing-platform', {
        method: 'PATCH',
        headers: jsonHeaders,
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
        headers: jsonHeaders,
        body: JSON.stringify({ id: '', type: 'telegram', config: { token: 'secret' } }),
      }),
    )

    expect(res.status).toBe(400)
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
        headers: jsonHeaders,
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
        { method: 'POST', headers: jsonHeaders },
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
          headers: jsonHeaders,
        },
      ),
    )

    expect(res.status).toBe(200)
    expect(start.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(await readJson(res)).toEqual({ applied: 1 })
    expect(expectInstance(router, instanceId).status).toBe('active')
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
        { method: 'POST', headers: jsonHeaders },
      ),
    )

    expect(res.status).toBe(200)
    expect(start).toHaveBeenCalledTimes(1)
    expect(expectInstance(router, instanceId).status).toBe('active')
  })

  test('deletes platform instance context settings before deleting the platform instance', async () => {
    insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'telegram-main' })

    const res = expectResponse(
      await route('/api/platform-instances/telegram-main', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    )

    expect(res.status).toBe(204)
    expect(listContextsByPlatformInstance('telegram-main')).toEqual([])
  })

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
    expect(listAdmins().map((admin) => `${admin.platformInstanceId}:${admin.userId}`)).toEqual([
      '__super__:super-admin',
    ])
  })

  test('updates platform instance status', async () => {
    await route('/api/platform-instances', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' } }),
    })

    const res = expectResponse(
      await route('/api/platform-instances/telegram-main/status', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ status: 'stopped' }),
      }),
    )

    expect(res.status).toBe(200)
    expect(pick(assertObject(await readJson(res)), 'status')).toBe('stopped')
  })

  test('deletes task instance context settings before deleting the task instance', async () => {
    insertTaskInstance({ id: 'tasks-main', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'telegram-main' })

    const res = expectResponse(
      await route('/api/task-instances/tasks-main', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    )

    expect(res.status).toBe(204)
    expect(listContextsByTaskInstance('tasks-main')).toEqual([])
  })

  test('deleting task instance clears cached tools for referencing contexts', async () => {
    insertTaskInstance({ id: 'tasks-main', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'telegram-main' })
    setCachedTools('ctx-1', { old_tool: {} })
    setCachedTools('ctx-1:user-1:alice', { old_tool: {} })
    setCachedTools('ctx-other', { old_tool: {} })

    const res = expectResponse(
      await route('/api/task-instances/tasks-main', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    )

    expect(res.status).toBe(204)
    expect(userCachesForTesting.get('ctx-1')?.tools).toBeNull()
    expect(userCachesForTesting.get('ctx-1:user-1:alice')?.tools).toBeNull()
    expect(userCachesForTesting.get('ctx-other')?.tools).toEqual({ old_tool: {} })
  })

  test('lists task instances with referencing context IDs', async () => {
    insertTaskInstance({ id: 'tasks-main', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'telegram-main' })
    setContextSettings({ contextId: 'ctx-2', taskInstanceId: 'tasks-main', platformInstanceId: 'discord-main' })

    const res = expectResponse(await route('/api/task-instances'))

    expect(res.status).toBe(200)
    const row = assertObject(assertArray(await readJson(res))[0])
    expect(pick(row, 'referencingContextIds')).toEqual(['ctx-1', 'ctx-2'])
    expect(pick(row, 'referencingContextCount')).toBe(2)
  })

  test('creates and lists masked task instances', async () => {
    const created = expectResponse(
      await route('/api/task-instances', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          id: 'tasks-main',
          type: 'kaneo',
          config: { api_key: 'secret', url: 'https://kaneo.invalid' },
        }),
      }),
    )

    expect(created.status).toBe(201)
    expect(pick(assertObject(await readJson(created)), 'config')).toEqual({
      api_key: '***',
      url: 'https://kaneo.invalid',
    })
    expect(expectTaskInstance('tasks-main').status).toBe('active')

    const listed = expectResponse(await route('/api/task-instances'))

    expect(listed.status).toBe(200)
    expect(listTaskInstances()).toHaveLength(1)
    expect(pick(assertObject(assertArray(await readJson(listed))[0]), 'config')).toEqual({
      api_key: '***',
      url: 'https://kaneo.invalid',
    })
  })

  test('duplicate task create returns instance_exists conflict', async () => {
    insertTaskInstance({ id: 'tasks-main', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })

    const res = expectResponse(
      await route('/api/task-instances', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ id: 'tasks-main', type: 'kaneo', config: { url: 'https://other.invalid' } }),
      }),
    )

    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ error: 'instance_exists', id: 'tasks-main' })
  })

  test('PATCH /api/task-instances/:id updates config and status and clears referencing context tool cache', async () => {
    insertTaskInstance({ id: 'tasks-main', type: 'kaneo', config: { api_key: 'secret' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'telegram-main' })
    setCachedTools('ctx-1', { old_tool: {} })
    setCachedTools('ctx-other', { old_tool: {} })

    const res = expectResponse(
      await route('/api/task-instances/tasks-main', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ config: { api_key: 'new-secret' }, status: 'stopped' }),
      }),
    )

    expect(res.status).toBe(200)
    const body = assertObject(await readJson(res))
    expect(pick(body, 'status')).toBe('stopped')
    expect(pick(body, 'config')).toEqual({ api_key: '***' })
    expect(userCachesForTesting.get('ctx-1')?.tools).toBeNull()
    expect(userCachesForTesting.get('ctx-other')?.tools).toEqual({ old_tool: {} })
  })

  test('creates and deletes super-admin rows', async () => {
    const created = expectResponse(
      await route('/api/admins', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ userId: 'admin-1' }),
      }),
    )

    expect(created.status).toBe(201)
    expect(pick(assertObject(await readJson(created)), 'platformInstanceId')).toBe(SUPER_ADMIN_PLATFORM_ID)
    expect(listAdmins()).toHaveLength(1)

    const deleted = expectResponse(
      await route(`/api/admins/admin-1/${SUPER_ADMIN_PLATFORM_ID}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    )

    expect(deleted.status).toBe(204)
    expect(listAdmins()).toEqual([])
  })

  test('lists admins', async () => {
    addAdmin('admin-1', SUPER_ADMIN_PLATFORM_ID)

    const res = expectResponse(await route('/api/admins'))

    expect(res.status).toBe(200)
    expect(pick(assertObject(assertArray(await readJson(res))[0]), 'userId')).toBe('admin-1')
  })

  test('GET /api/task-provider-types returns the built-in catalog', async () => {
    const res = expectResponse(await route('/api/task-provider-types'))

    expect(res.status).toBe(200)
    const body = assertArray(await readJson(res))
    const types = body.map((entry) => pick(assertObject(entry), 'type'))
    expect(types).toContain('kaneo')
    expect(types).toContain('youtrack')
    const kaneoEntry = assertObject(body.find((entry) => pick(assertObject(entry), 'type') === 'kaneo'))
    expect(pick(kaneoEntry, 'source')).toBe('builtin')
    expect(Array.isArray(pick(kaneoEntry, 'capabilities'))).toBe(true)
  })

  test('POST /api/task-instances rejects an unknown provider type', async () => {
    const res = expectResponse(
      await route('/api/task-instances', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ id: 'mystery-1', type: 'mystery', config: { baseUrl: 'https://x.invalid' } }),
      }),
    )

    expect(res.status).toBe(400)
    const body = assertObject(await readJson(res))
    expect(pick(body, 'error')).toBe('unknown_task_provider_type')
    expect(pick(body, 'type')).toBe('mystery')
  })
})
