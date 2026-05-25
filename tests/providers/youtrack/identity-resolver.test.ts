// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import type { IdentityUser } from '../../../src/providers/types.js'
import type { YouTrackConfig } from '../../../src/providers/youtrack/client.js'
import {
  createYouTrackIdentityResolver,
  type YouTrackIdentityResolver,
} from '../../../src/providers/youtrack/identity-resolver.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const mockConfig: YouTrackConfig = {
  baseUrl: 'http://localhost:8080',
  token: 'test-token',
}

describe('createYouTrackIdentityResolver', () => {
  it('should create a resolver with searchUsers method', () => {
    const resolver = createYouTrackIdentityResolver(mockConfig)
    expect('searchUsers' in resolver).toBe(true)
    expect(typeof resolver.searchUsers).toBe('function')
  })

  it('should create a resolver with getUserByLogin method', () => {
    const resolver = createYouTrackIdentityResolver(mockConfig)
    expect('getUserByLogin' in resolver).toBe(true)
    expect(typeof resolver.getUserByLogin).toBe('function')
  })
})

describe('YouTrackIdentityResolver interface', () => {
  beforeEach(() => {
    mockLogger()
  })

  afterEach(() => {
    restoreFetch()
  })

  it('should extend UserIdentityResolver', () => {
    const resolver: YouTrackIdentityResolver = {
      searchUsers(query: string): Promise<IdentityUser[]> {
        return Promise.resolve([{ id: 'u-1', login: query }])
      },
      getUserByLogin(login: string): Promise<IdentityUser | null> {
        return Promise.resolve({ id: 'u-1', login, name: login })
      },
    }

    // Verify searchUsers is a function
    expect('searchUsers' in resolver).toBe(true)
    expect(typeof resolver.searchUsers).toBe('function')

    // Verify extended method exists
    expect('getUserByLogin' in resolver).toBe(true)
    expect(typeof resolver.getUserByLogin).toBe('function')
  })

  it('should work with IdentityUser type', async () => {
    const user: IdentityUser = {
      id: 'u-1',
      login: 'alice',
      name: 'Alice Smith',
    }

    const resolver: YouTrackIdentityResolver = {
      searchUsers(): Promise<IdentityUser[]> {
        return Promise.resolve([user])
      },
      getUserByLogin(): Promise<IdentityUser | null> {
        return Promise.resolve(user)
      },
    }

    const found = await resolver.getUserByLogin('alice')
    expect(found).toEqual(user)
  })

  it('searchUsers returns mapped users from API', async () => {
    const fetchMock = mock<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id: 'user-1',
              login: 'alice',
              name: 'Alice Smith',
              fullName: 'Alice Smith',
              email: 'alice@test.com',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    setMockFetch((url: string, init: RequestInit) => fetchMock(url, init))

    const resolver = createYouTrackIdentityResolver(mockConfig)
    const users = await resolver.searchUsers('alice', 10)

    expect(users).toHaveLength(1)
    expect(users[0]).toEqual({ id: 'user-1', login: 'alice', name: 'Alice Smith' })
  })

  it('searchUsers throws on API error', async () => {
    const fetchMock = mock<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'Auth failed' }), { status: 401 })),
    )
    setMockFetch((url: string, init: RequestInit) => fetchMock(url, init))

    const resolver = createYouTrackIdentityResolver(mockConfig)
    await expect(resolver.searchUsers('alice')).rejects.toThrow()
  })

  it('getUserByLogin returns user when found', async () => {
    const fetchMock = mock<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 'user-1', login: 'alice', ringId: 'ring-user-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    setMockFetch((url: string, init: RequestInit) => fetchMock(url, init))

    const resolver = createYouTrackIdentityResolver(mockConfig)
    const user = await resolver.getUserByLogin('alice')

    expect(user).toEqual({ id: 'ring-user-1', login: 'alice', name: 'alice' })
  })

  it('getUserByLogin returns null when user not found', async () => {
    const fetchMock = mock<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })),
    )
    setMockFetch((url: string, init: RequestInit) => fetchMock(url, init))

    const resolver = createYouTrackIdentityResolver(mockConfig)
    const user = await resolver.getUserByLogin('missing')

    expect(user).toBeNull()
  })

  it('searchUsers includes query and limit parameters in URL', async () => {
    const capturedUrls: string[] = []
    const fetchMock = mock<(url: string, init: RequestInit) => Promise<Response>>((url: string) => {
      capturedUrls.push(url)
      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id: 'user-1',
              login: 'alice',
              name: 'Alice Smith',
              fullName: 'Alice Smith',
              email: 'alice@test.com',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    })
    setMockFetch((url: string, init: RequestInit) => fetchMock(url, init))

    const resolver = createYouTrackIdentityResolver(mockConfig)
    await resolver.searchUsers('alice', 10)

    expect(capturedUrls).toHaveLength(1)
    expect(capturedUrls[0]).toContain('/api/users')
    expect(capturedUrls[0]).toContain('query=nameStartsWith%3Aalice')
    expect(capturedUrls[0]).toContain('%24top=10')
  })

  it('getUserByLogin calls correct API endpoint', async () => {
    const capturedUrls: string[] = []
    const fetchMock = mock<(url: string, init: RequestInit) => Promise<Response>>((url: string) => {
      capturedUrls.push(url)
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'user-1', login: 'alice', ringId: 'ring-user-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    setMockFetch((url: string, init: RequestInit) => fetchMock(url, init))

    const resolver = createYouTrackIdentityResolver(mockConfig)
    await resolver.getUserByLogin('alice')

    expect(capturedUrls).toHaveLength(1)
    expect(capturedUrls[0]).toContain('/api/users/alice')
    expect(capturedUrls[0]).toContain('fields=')
  })
})
