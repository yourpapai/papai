// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  applyPlatformInstances,
  createAdmin,
  createPlatformInstance,
  createTaskInstance,
  deleteAdmin,
  deletePlatformInstance,
  deleteTaskInstance,
  fetchAdmins,
  fetchAdminGroups,
  fetchAdminIdentity,
  fetchAdminLlm,
  fetchAdminSystem,
  fetchDeferredPrompts,
  fetchMemos,
  fetchPlatformInstances,
  fetchPlatformProviderTypes,
  fetchRecentRequests,
  fetchRecurringTasks,
  fetchTaskInstances,
  fetchTaskProviderTypes,
  setPlatformInstanceStatus,
  submitAdminLlm,
} from '../../../client/admin/fetchers.js'
import type { AdminInstanceView } from '../../../client/shared/api-types.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

type Equal<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false
type Expect<Actual extends true> = Actual
type ExpectedAdminInstanceView = Readonly<
  { userId: string; platformInstanceId: string } & Partial<{ createdAt: string }>
>
type PlatformStatusInput = Parameters<typeof setPlatformInstanceStatus>[1]
const adminInstanceViewContract: Expect<Equal<AdminInstanceView, ExpectedAdminInstanceView>> = true
const platformStatusInputContract: Expect<Equal<PlatformStatusInput, 'active' | 'stopped'>> = true

const applyResult = {
  applied: 1,
  started: ['telegram-main'],
  stopped: [],
  removed: [],
  recreated: [],
  unchanged: [],
  failed: [],
} as const

const captured: Array<{ readonly url: string; readonly init: RequestInit }> = []

beforeEach(() => {
  captured.length = 0
})

test('compile-time instance client contracts are enforced', () => {
  expect(adminInstanceViewContract).toBe(true)
  expect(platformStatusInputContract).toBe(true)
})

afterEach(() => {
  restoreFetch()
})

const installFetch = (status: number, payload: unknown): void => {
  setMockFetch((url, init) => {
    captured.push({ url, init })
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
}

const firstCaptured = (): { readonly url: string; readonly init: RequestInit } => {
  const first = captured[0]
  if (first === undefined) throw new Error('missing captured fetch call')
  return first
}

const expectDefined = <T>(value: T | undefined | null, message: string): NonNullable<T> => {
  expect(value, message).not.toBeUndefined()
  expect(value, message).not.toBeNull()
  return value!
}

describe('fetchAdminLlm', () => {
  test('GETs /admin/llm', async () => {
    const empty = { value: null, updatedAt: null, updatedBy: null }
    installFetch(200, {
      llm_apikey: empty,
      llm_baseurl: empty,
      main_model: empty,
      small_model: empty,
      embedding_model: empty,
    })
    const snap = await fetchAdminLlm()
    expect(firstCaptured().url).toBe('/admin/llm')
    expect(snap.llm_apikey.value).toBeNull()
  })
})

describe('submitAdminLlm', () => {
  test('POSTs JSON body to /admin/llm', async () => {
    installFetch(200, { ok: true, key: 'main_model', updatedAt: 123 })
    const result = await submitAdminLlm({ key: 'main_model', value: 'gpt-6' })
    const call = firstCaptured()
    expect(call.url).toBe('/admin/llm')
    expect(call.init.method).toBe('POST')
    expect(call.init.body).toBe(JSON.stringify({ key: 'main_model', value: 'gpt-6' }))
    expect(result.key).toBe('main_model')
  })

  test('throws on 400 with the server message', async () => {
    installFetch(400, { error: 'value must be a non-empty string' })
    await expect(submitAdminLlm({ key: 'main_model', value: '' })).rejects.toThrow('value must be a non-empty string')
  })
})

describe('fetchAdminSystem', () => {
  test('GETs /admin/system and validates the summary', async () => {
    installFetch(200, {
      chatProvider: 'telegram',
      taskProvider: 'kaneo',
      debugServer: true,
      adminUserSet: true,
    })
    const result = await fetchAdminSystem()
    expect(firstCaptured().url).toBe('/admin/system')
    expect(result.chatProvider).toBe('telegram')
  })

  test('rejects raw provider strings outside the safe enums', async () => {
    installFetch(200, {
      chatProvider: 'custom-chat-secret',
      taskProvider: 'kaneo',
      debugServer: true,
      adminUserSet: true,
    })

    await expect(fetchAdminSystem()).rejects.toThrow()
  })
})

describe('fetchMemos', () => {
  test('GETs /memos with userId and state', async () => {
    installFetch(200, [
      {
        id: 'memo-1',
        userId: 'user-1',
        content: 'remember this',
        summary: 'remember',
        tags: ['work'],
        status: 'archived',
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T01:00:00.000Z',
      },
    ])

    const result = await fetchMemos('user-1', 'archived')
    const firstMemo = expectDefined(result[0], 'missing memo')

    expect(firstCaptured().url).toBe('/memos?userId=user-1&state=archived')
    expect(result).toHaveLength(1)
    expect(firstMemo.status).toBe('archived')
  })

  test('rejects malformed memo payloads', async () => {
    installFetch(200, [{ id: 'memo-1', userId: 'user-1' }])

    await expect(fetchMemos('user-1', 'active')).rejects.toThrow()
  })

  test('falls back to generic error for plain-text server errors', async () => {
    installFetch(400, 'Missing userId parameter')

    await expect(fetchMemos('user-1', 'archived')).rejects.toThrow('request failed with status 400')
  })
})

describe('fetchRecurringTasks', () => {
  test('GETs /recurring with userId', async () => {
    installFetch(200, [
      {
        id: 'rec-1',
        userId: 'user-1',
        title: 'Daily sync',
        rrule: 'FREQ=DAILY',
        nextRun: '2026-05-22T00:00:00.000Z',
        enabled: true,
        lastRun: null,
      },
    ])

    const result = await fetchRecurringTasks('user-1')
    const firstTask = expectDefined(result[0], 'missing recurring task')

    expect(firstCaptured().url).toBe('/recurring?userId=user-1')
    expect(firstTask.title).toBe('Daily sync')
  })

  test('rejects malformed recurring payloads', async () => {
    installFetch(200, [{ id: 'rec-1' }])

    await expect(fetchRecurringTasks('user-1')).rejects.toThrow()
  })

  test('falls back to generic error for plain-text server errors', async () => {
    installFetch(400, 'Missing userId parameter')

    await expect(fetchRecurringTasks('user-1')).rejects.toThrow('request failed with status 400')
  })
})

describe('fetchDeferredPrompts', () => {
  test('GETs /deferred with userId', async () => {
    installFetch(200, [
      {
        id: 'def-1',
        createdByUserId: 'user-1',
        prompt: 'Check project',
        fireAt: '2026-05-22T10:00:00.000Z',
        rrule: null,
        status: 'active',
      },
    ])

    const result = await fetchDeferredPrompts('user-1')
    const firstPrompt = expectDefined(result[0], 'missing deferred prompt')

    expect(firstCaptured().url).toBe('/deferred?userId=user-1')
    expect(firstPrompt.prompt).toBe('Check project')
  })

  test('rejects malformed deferred payloads', async () => {
    installFetch(200, [{ id: 'def-1' }])

    await expect(fetchDeferredPrompts('user-1')).rejects.toThrow()
  })

  test('falls back to generic error for plain-text server errors', async () => {
    installFetch(400, 'Missing userId parameter')

    await expect(fetchDeferredPrompts('user-1')).rejects.toThrow('request failed with status 400')
  })
})

describe('fetchAdminIdentity', () => {
  test('GETs /identity with userId and provider', async () => {
    installFetch(200, {
      contextId: 'user-1',
      providerName: 'kaneo',
      providerUserId: 'provider-1',
      providerUserLogin: 'ki',
      displayName: 'Ki',
      matchedAt: '2026-05-21T00:00:00.000Z',
      matchMethod: 'auto',
      confidence: 0.9,
    })

    const result = await fetchAdminIdentity('user-1', 'kaneo')
    const mapping = expectDefined(result, 'missing identity mapping')

    expect(firstCaptured().url).toBe('/identity?userId=user-1&provider=kaneo')
    expect(mapping.contextId).toBe('user-1')
    expect(mapping.providerName).toBe('kaneo')
    expect(mapping.providerUserId).toBe('provider-1')
  })

  test('returns null for not found identity lookups', async () => {
    installFetch(404, 'Not found')

    await expect(fetchAdminIdentity('user-1', 'kaneo')).resolves.toBeNull()
  })

  test('falls back to generic error for plain-text server errors', async () => {
    installFetch(400, 'Missing userId parameter')

    await expect(fetchAdminIdentity('user-1', 'kaneo')).rejects.toThrow('request failed with status 400')
  })

  test('rejects malformed identity payloads', async () => {
    installFetch(200, { contextId: 'user-1', providerName: 'kaneo' })

    await expect(fetchAdminIdentity('user-1', 'kaneo')).rejects.toThrow()
  })
})

describe('fetchRecentRequests', () => {
  test('GETs /admin/subjects/:id/recent-requests and returns parsed rows', async () => {
    installFetch(200, {
      subjectId: 'user-A',
      limit: 25,
      requests: [
        {
          ts: 1_700_000_000_000,
          modelLabel: 'gpt-4o',
          role: 'main',
          inputTokens: 100,
          outputTokens: 200,
          finishStatus: 'stop',
        },
      ],
    })
    const result = await fetchRecentRequests('user-A')
    const firstRequest = expectDefined(result[0], 'missing recent request')
    expect(firstCaptured().url).toBe('/admin/subjects/user-A/recent-requests?limit=25')
    expect(result).toHaveLength(1)
    expect(firstRequest.modelLabel).toBe('gpt-4o')
  })

  test('returns empty array on non-ok response', async () => {
    installFetch(500, { error: 'internal error' })
    const result = await fetchRecentRequests('user-A')
    expect(result).toHaveLength(0)
  })

  test('returns empty array when parse fails', async () => {
    installFetch(200, { unexpected: 'shape' })
    const result = await fetchRecentRequests('user-A')
    expect(result).toHaveLength(0)
  })
})

describe('fetchAdminGroups', () => {
  test('GETs /auth/groups', async () => {
    installFetch(200, [{ group_id: 'group-1', added_by: 'admin', added_at: '2026-05-21T00:00:00.000Z' }])

    const result = await fetchAdminGroups()
    const firstGroup = expectDefined(result[0], 'missing group')

    expect(firstCaptured().url).toBe('/auth/groups')
    expect(firstGroup.group_id).toBe('group-1')
  })

  test('rejects malformed group payloads', async () => {
    installFetch(200, [{ group_id: 'group-1' }])

    await expect(fetchAdminGroups()).rejects.toThrow()
  })
})

describe('instance API fetchers', () => {
  const platformInstance = {
    id: 'telegram-main',
    type: 'telegram',
    config: { TELEGRAM_BOT_TOKEN: '***' },
    status: 'active',
    createdAt: '2026-05-24T00:00:00.000Z',
  } as const

  const taskInstance = {
    id: 'kaneo-main',
    type: 'kaneo',
    config: { KANEO_INTERNAL_URL: 'https://kaneo.example' },
    status: 'active',
    createdAt: '2026-05-24T00:00:00.000Z',
  } as const

  test('fetchPlatformInstances GETs and validates /api/platform-instances', async () => {
    installFetch(200, [platformInstance])

    const result = await fetchPlatformInstances()

    expect(firstCaptured().url).toBe('/api/platform-instances')
    expect(result).toEqual([platformInstance])
  })

  test('fetchPlatformInstances accepts unreadable diagnostics object shape', async () => {
    installFetch(200, {
      instances: [platformInstance],
      unreadable: [{ table: 'platform_instances', id: 'bad', type: 'telegram', error: 'Encrypted payload' }],
    })

    const result = await fetchPlatformInstances()

    expect(firstCaptured().url).toBe('/api/platform-instances')
    expect(result).toEqual([platformInstance])
  })

  test('createPlatformInstance POSTs JSON and returns the created instance', async () => {
    installFetch(201, platformInstance)

    const result = await createPlatformInstance({
      id: 'telegram-main',
      type: 'telegram',
      config: { TELEGRAM_BOT_TOKEN: 'secret' },
    })
    const call = firstCaptured()

    expect(call.url).toBe('/api/platform-instances')
    expect(call.init.method).toBe('POST')
    expect(call.init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(call.init.body).toBe(
      JSON.stringify({ id: 'telegram-main', type: 'telegram', config: { TELEGRAM_BOT_TOKEN: 'secret' } }),
    )
    expect(result).toEqual(platformInstance)
  })

  test('setPlatformInstanceStatus POSTs status to the encoded instance path', async () => {
    installFetch(200, { ...platformInstance, status: 'stopped' })

    const result = await setPlatformInstanceStatus('telegram/main', 'stopped')
    const call = firstCaptured()

    expect(call.url).toBe('/api/platform-instances/telegram%2Fmain/status')
    expect(call.init.method).toBe('POST')
    expect(call.init.body).toBe(JSON.stringify({ status: 'stopped' }))
    expect(result.status).toBe('stopped')
  })

  test('deletePlatformInstance DELETEs the encoded instance path', async () => {
    installFetch(204, null)

    await deletePlatformInstance('telegram/main')

    expect(firstCaptured()).toMatchObject({
      url: '/api/platform-instances/telegram%2Fmain',
      init: { method: 'DELETE' },
    })
  })

  test('applyPlatformInstances POSTs apply and parses detailed reconciliation results', async () => {
    installFetch(200, applyResult)

    const result = await applyPlatformInstances()
    const call = firstCaptured()

    expect(call.url).toBe('/api/platform-instances/apply')
    expect(call.init.method).toBe('POST')
    expect(result).toEqual(applyResult)
  })

  test('fetchTaskInstances GETs task instances', async () => {
    installFetch(200, [taskInstance])

    const result = await fetchTaskInstances()

    expect(firstCaptured().url).toBe('/api/task-instances')
    expect(result).toEqual([taskInstance])
  })

  test('fetchTaskInstances accepts unreadable diagnostics object shape', async () => {
    installFetch(200, {
      instances: [taskInstance],
      unreadable: [{ table: 'task_instances', id: 'bad', type: 'kaneo', error: 'Encrypted payload' }],
    })

    const result = await fetchTaskInstances()

    expect(firstCaptured().url).toBe('/api/task-instances')
    expect(result).toEqual([taskInstance])
  })

  test('createTaskInstance POSTs JSON to task instances', async () => {
    installFetch(201, taskInstance)

    const result = await createTaskInstance({
      id: 'kaneo-main',
      type: 'kaneo',
      config: { KANEO_INTERNAL_URL: 'https://kaneo.example' },
    })
    const call = firstCaptured()

    expect(call.url).toBe('/api/task-instances')
    expect(call.init.method).toBe('POST')
    expect(result).toEqual(taskInstance)
  })

  test('deleteTaskInstance DELETEs the encoded task instance path', async () => {
    installFetch(204, null)

    await deleteTaskInstance('kaneo/main')

    expect(firstCaptured()).toMatchObject({ url: '/api/task-instances/kaneo%2Fmain', init: { method: 'DELETE' } })
  })

  test('fetchAdmins GETs admin records', async () => {
    installFetch(200, [
      { userId: 'user-1', platformInstanceId: 'telegram-main', createdAt: '2026-05-24T00:00:00.000Z' },
    ])

    const result = await fetchAdmins()
    const firstAdmin = expectDefined(result[0], 'missing admin')

    expect(firstCaptured().url).toBe('/api/admins')
    expect(firstAdmin.userId).toBe('user-1')
  })

  test('createAdmin POSTs JSON and parses the admin record', async () => {
    installFetch(201, { userId: 'user-1', platformInstanceId: 'telegram-main' })

    const result = await createAdmin({ userId: 'user-1', platformInstanceId: 'telegram-main' })
    const call = firstCaptured()

    expect(call.url).toBe('/api/admins')
    expect(call.init.method).toBe('POST')
    expect(call.init.body).toBe(JSON.stringify({ userId: 'user-1', platformInstanceId: 'telegram-main' }))
    expect(result.platformInstanceId).toBe('telegram-main')
  })

  test('deleteAdmin DELETEs URL-encoded user and platform segments', async () => {
    installFetch(204, null)

    await deleteAdmin('user/1', 'telegram/main')

    expect(firstCaptured()).toMatchObject({
      url: '/api/admins/user%2F1/telegram%2Fmain',
      init: { method: 'DELETE' },
    })
  })
})

test('fetchTaskProviderTypes parses the catalog', async () => {
  setMockFetch(() =>
    Promise.resolve(
      Response.json([
        {
          type: 'kaneo',
          displayName: 'Kaneo',
          instanceConfigSchema: [{ key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false }],
          contextConfigSchema: [],
          capabilities: ['comments.read'],
          traits: [],
          source: 'builtin',
        },
      ]),
    ),
  )
  const types = await fetchTaskProviderTypes()
  expect(types[0]?.type).toBe('kaneo')
  expect(types[0]?.instanceConfigSchema[0]?.key).toBe('baseUrl')
  restoreFetch()
})

test('fetchTaskProviderTypes throws on non-ok response', async () => {
  installFetch(500, { error: 'internal server error' })
  await expect(fetchTaskProviderTypes()).rejects.toThrow()
})

test('fetchPlatformProviderTypes parses the catalog', async () => {
  setMockFetch(() =>
    Promise.resolve(
      Response.json([
        {
          type: 'mattermost',
          displayName: 'Mattermost',
          instanceConfigSchema: [
            { key: 'baseUrl', label: 'Mattermost URL', required: true, sensitive: false },
            { key: 'token', label: 'Mattermost Bot Token', required: true, sensitive: true },
          ],
          contextConfigSchema: [],
          capabilities: ['commands'],
          traits: { observedGroupMessages: 'all', maxMessageLength: 16383 },
          source: 'builtin',
        },
      ]),
    ),
  )
  const types = await fetchPlatformProviderTypes()
  expect(types[0]?.type).toBe('mattermost')
  expect(types[0]?.instanceConfigSchema[1]?.sensitive).toBe(true)
  expect(types[0]?.traits.observedGroupMessages).toBe('all')
  restoreFetch()
})

test('fetchPlatformProviderTypes throws on non-ok response', async () => {
  installFetch(500, { error: 'internal server error' })
  await expect(fetchPlatformProviderTypes()).rejects.toThrow()
})
