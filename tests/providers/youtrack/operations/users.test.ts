import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  getYouTrackCurrentUser,
  listYouTrackUsers,
  resolveYouTrackUserRingId,
} from '../../../../src/providers/youtrack/operations/users.js'
import { mockLogger, restoreFetch } from '../../../utils/test-helpers.js'
import {
  type FetchMockFn,
  defaultConfig,
  getFetchUrlAt,
  getLastFetchMethod,
  mockFetchError,
  mockFetchSequence,
} from '../fetch-mock-utils.js'

const fetchMock: { current?: FetchMockFn } = {}

const config: YouTrackConfig = defaultConfig

const makeUser = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'user-1',
  login: 'alice',
  name: 'Alice Example',
  fullName: 'Alice Example',
  email: 'alice@example.com',
  ringId: 'ring-user-1',
  $type: 'User',
  ...overrides,
})

describe('listYouTrackUsers', () => {
  beforeEach(() => {
    mockLogger()
  })

  afterEach(() => {
    restoreFetch()
  })

  test('filters users locally by login full name or email case-insensitively', async () => {
    mockFetchSequence(fetchMock, [
      {
        data: [
          makeUser(),
          makeUser({ id: 'user-2', login: 'bob', fullName: 'Bob Example', email: 'alice.bob@example.com' }),
          makeUser({ id: 'user-3', login: 'charlie', fullName: 'Alice Johnson', email: 'charlie@example.com' }),
        ],
      },
    ])

    const users = await listYouTrackUsers(config, 'ALICE')

    expect(users).toEqual([
      { id: 'user-1', login: 'alice', name: 'Alice Example' },
      { id: 'user-2', login: 'bob', name: 'Bob Example' },
      { id: 'user-3', login: 'charlie', name: 'Alice Johnson' },
    ])
  })

  test('uses server-side query filter and limit for efficient user search', async () => {
    mockFetchSequence(fetchMock, [{ data: [makeUser({ id: 'user-200', login: 'target', fullName: 'Target User' })] }])

    const users = await listYouTrackUsers(config, 'target', 1)

    expect(users).toEqual([{ id: 'user-200', login: 'target', name: 'Target User' }])
    expect(fetchMock.current?.mock.calls).toHaveLength(1)

    const url = getFetchUrlAt(fetchMock.current, 0)
    expect(url.pathname).toBe('/api/users')
    expect(url.searchParams.get('query')).toBe('nameStartsWith:target')
    expect(url.searchParams.get('$top')).toBe('1')
  })

  test('uses GET /api/users with expected fields', async () => {
    mockFetchSequence(fetchMock, [{ data: [] }])

    await listYouTrackUsers(config)

    const url = getFetchUrlAt(fetchMock.current, 0)
    expect(url.pathname).toBe('/api/users')
    expect(url.searchParams.get('fields')).toBe('id,login,fullName,name,email,ringId')
    expect(getLastFetchMethod(fetchMock.current)).toBe('GET')
  })

  test('throws classified error on API failure', async () => {
    mockFetchError(fetchMock, 401)

    await expect(listYouTrackUsers(config, 'alice')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('getYouTrackCurrentUser', () => {
  beforeEach(() => {
    mockLogger()
  })

  afterEach(() => {
    restoreFetch()
  })

  test('returns the mapped current user and uses the me endpoint', async () => {
    mockFetchSequence(fetchMock, [{ data: makeUser({ id: 'me-1', login: 'current', fullName: 'Current User' }) }])

    const user = await getYouTrackCurrentUser(config)

    expect(user).toEqual({ id: 'me-1', login: 'current', name: 'Current User' })

    const url = getFetchUrlAt(fetchMock.current, 0)
    expect(url.pathname).toBe('/api/users/me')
    expect(url.searchParams.get('fields')).toBe('id,login,fullName,name,email,ringId')
    expect(getLastFetchMethod(fetchMock.current)).toBe('GET')
  })

  test('throws classified error on auth failure', async () => {
    mockFetchError(fetchMock, 403)

    await expect(getYouTrackCurrentUser(config)).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('resolveYouTrackUserRingId', () => {
  beforeEach(() => {
    mockLogger()
  })

  afterEach(() => {
    restoreFetch()
  })

  test('returns the Hub ringId for a direct user lookup', async () => {
    mockFetchSequence(fetchMock, [{ data: makeUser({ id: 'user-7', ringId: 'ring-user-7', login: 'alice' }) }])

    const ringId = await resolveYouTrackUserRingId(config, 'user-7')

    expect(ringId).toBe('ring-user-7')
    const url = getFetchUrlAt(fetchMock.current, 0)
    expect(url.pathname).toBe('/api/users/user-7')
    expect(url.searchParams.get('fields')).toBe('id,login,fullName,name,email,ringId')
    expect(getLastFetchMethod(fetchMock.current)).toBe('GET')
  })

  test('falls back to scanning the users collection when the identifier is already a ringId', async () => {
    mockFetchSequence(fetchMock, [
      { data: { error: 'Not found' }, status: 404 },
      { data: [makeUser({ id: 'user-7', ringId: 'ring-user-7', login: 'alice' })] },
    ])

    const ringId = await resolveYouTrackUserRingId(config, 'ring-user-7')

    expect(ringId).toBe('ring-user-7')
    expect(fetchMock.current?.mock.calls).toHaveLength(2)
    expect(getFetchUrlAt(fetchMock.current, 0).pathname).toBe('/api/users/ring-user-7')
    expect(getFetchUrlAt(fetchMock.current, 1).pathname).toBe('/api/users')
  })

  test('throws a classified error when the user cannot be resolved', async () => {
    mockFetchSequence(fetchMock, [{ data: { error: 'Not found' }, status: 404 }, { data: [] }])

    await expect(resolveYouTrackUserRingId(config, 'missing-user')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })

  test('throws not-found error when user is not found in collection scan', async () => {
    mockFetchSequence(fetchMock, [{ data: { error: 'Not found' }, status: 404 }, { data: [] }])

    const error = await resolveYouTrackUserRingId(config, 'missing-user').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(YouTrackClassifiedError)
    assert(error instanceof YouTrackClassifiedError)
    expect(error.appError).toEqual({
      type: 'provider',
      code: 'not-found',
      resourceType: 'User',
      resourceId: 'missing-user',
    })
  })
})
