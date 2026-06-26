// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  fetchAdminIdentity,
  fetchAdminIdentityMappings,
  fetchDeferredPrompts,
  fetchMemos,
  fetchRecentRequests,
  fetchRecurringTasks,
} from '../../../client/admin/fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const captured: Array<{ readonly url: string; readonly init: RequestInit }> = []

beforeEach(() => {
  captured.length = 0
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

describe('fetchAdminIdentityMappings', () => {
  test('GETs /admin/identity/mappings and returns a validated array', async () => {
    installFetch(200, [
      {
        contextId: 'ctx-alice',
        providerName: 'kaneo',
        providerUserId: 'k-1',
        providerUserLogin: 'alice',
        displayName: 'Alice',
        matchedAt: '2026-05-21T00:00:00.000Z',
        matchMethod: 'auto',
        confidence: 100,
      },
    ])

    const result = await fetchAdminIdentityMappings()
    const firstEntry = expectDefined(result[0], 'missing identity mapping entry')

    expect(firstCaptured().url).toBe('/admin/identity/mappings')
    expect(result).toHaveLength(1)
    expect(firstEntry.contextId).toBe('ctx-alice')
    expect(firstEntry.providerName).toBe('kaneo')
    expect(firstEntry.matchMethod).toBe('auto')
  })

  test('returns empty array when server returns []', async () => {
    installFetch(200, [])

    const result = await fetchAdminIdentityMappings()

    expect(firstCaptured().url).toBe('/admin/identity/mappings')
    expect(result).toEqual([])
  })

  test('rejects malformed identity mapping payloads', async () => {
    installFetch(200, [{ contextId: 'ctx-alice' }])

    await expect(fetchAdminIdentityMappings()).rejects.toThrow()
  })

  test('throws on non-ok response', async () => {
    installFetch(401, 'Unauthorized')

    await expect(fetchAdminIdentityMappings()).rejects.toThrow('request failed with status 401')
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
