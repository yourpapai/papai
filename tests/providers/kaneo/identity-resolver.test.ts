// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import type { KaneoConfig } from '../../../plugins/task-provider-kaneo/client.js'
import { createKaneoIdentityResolver } from '../../../plugins/task-provider-kaneo/identity-resolver.js'
import type { IdentityUser } from '../../../src/providers/types.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const mockConfig: KaneoConfig = {
  baseUrl: 'http://localhost:3000',
  apiKey: 'test-key',
}

const mockWorkspaceId = 'ws-123'

describe('createKaneoIdentityResolver', () => {
  beforeEach(() => {
    mockLogger()
  })

  afterEach(() => {
    restoreFetch()
  })

  it('should create a resolver with searchUsers method', () => {
    const resolver = createKaneoIdentityResolver(mockConfig, mockWorkspaceId)
    expect('searchUsers' in resolver).toBe(true)
    expect(typeof resolver.searchUsers).toBe('function')
  })

  it('implements UserIdentityResolver interface', () => {
    const resolver = createKaneoIdentityResolver(mockConfig, mockWorkspaceId)
    expect('searchUsers' in resolver).toBe(true)
    expect(typeof resolver.searchUsers).toBe('function')
  })

  it('searchUsers returns mapped users from API', async () => {
    const fetchMock = mock<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            { id: 'user-1', name: 'Alice Smith', email: 'alice@test.com', role: 'member' },
            { id: 'user-2', name: 'Bob Jones', email: 'bob@test.com', role: 'admin' },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    setMockFetch((url: string, init: RequestInit) => fetchMock(url, init))

    const resolver = createKaneoIdentityResolver(mockConfig, mockWorkspaceId)
    const users = await resolver.searchUsers('ali', 10)

    expect(users).toHaveLength(1)
    expect(users[0]).toEqual({ id: 'user-1', login: 'alice@test.com', name: 'Alice Smith' })
  })

  it('searchUsers includes workspaceId in URL path', async () => {
    const capturedUrls: string[] = []
    const fetchMock = mock<(url: string, init: RequestInit) => Promise<Response>>((url: string) => {
      capturedUrls.push(url)
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 'user-1', name: 'Alice', email: 'alice@test.com', role: 'member' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    setMockFetch((url: string, init: RequestInit) => fetchMock(url, init))

    const resolver = createKaneoIdentityResolver(mockConfig, mockWorkspaceId)
    await resolver.searchUsers('alice', 10)

    expect(capturedUrls).toHaveLength(1)
    expect(capturedUrls[0]).toContain(`/workspace/${mockWorkspaceId}/members`)
  })

  it('searchUsers limits results correctly', async () => {
    const fetchMock = mock<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            { id: 'user-1', name: 'Alice', email: 'alice@test.com', role: 'member' },
            { id: 'user-2', name: 'Bob', email: 'bob@test.com', role: 'member' },
            { id: 'user-3', name: 'Charlie', email: 'charlie@test.com', role: 'member' },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    setMockFetch((url: string, init: RequestInit) => fetchMock(url, init))

    const resolver = createKaneoIdentityResolver(mockConfig, mockWorkspaceId)
    const users = await resolver.searchUsers('', 2)

    expect(users).toHaveLength(2)
  })

  it('searchUsers throws on API error', async () => {
    const fetchMock = mock<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'Auth failed' }), { status: 401 })),
    )
    setMockFetch((url: string, init: RequestInit) => fetchMock(url, init))

    const resolver = createKaneoIdentityResolver(mockConfig, mockWorkspaceId)
    await expect(resolver.searchUsers('alice')).rejects.toThrow()
  })

  it('IdentityUser type accepts all fields', () => {
    const user: IdentityUser = {
      id: 'u-1',
      login: 'alice',
      name: 'Alice Smith',
    }
    expect(user.id).toBe('u-1')
    expect(user.login).toBe('alice')
    expect(user.name).toBe('Alice Smith')
  })

  it('IdentityUser type works without optional name', () => {
    const user: IdentityUser = {
      id: 'u-2',
      login: 'bob',
    }
    expect(user.id).toBe('u-2')
    expect(user.login).toBe('bob')
    expect(user.name).toBeUndefined()
  })
})
