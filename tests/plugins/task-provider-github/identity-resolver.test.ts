// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { GitHubClassifiedError } from '../../../plugins/task-provider-github/classify-error.js'
import type { GitHubConfig } from '../../../plugins/task-provider-github/client.js'
import { createTrackedLoggerMock } from '../../utils/logger-mock.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

// The resolver creates its child logger inside the factory (see the module
// comment there), so the tracked mock must be installed at factory time, not
// module-eval time: combined runs load this module under another file's graph
// before this file's mocks run. File-level install for the delayed import, plus
// a suite-level re-install after the global mock-reset restore (tests/AGENTS.md).
const tracked = createTrackedLoggerMock()
const installTrackedLogger = (): void => {
  void mock.module('../../../src/logger.js', () => ({ logger: tracked.logger, getLogLevel: tracked.getLogLevel }))
}
installTrackedLogger()

const { createGitHubIdentityResolver } = await import('../../../plugins/task-provider-github/identity-resolver.js')

const config: GitHubConfig = { baseUrl: '', repo: 'octocat/Hello-World', token: 'test-token' }

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const user = (login: string, id: number, name?: string | null): Record<string, unknown> => ({
  login,
  id,
  avatar_url: `https://avatars.githubusercontent.com/u/${id}?v=4`,
  html_url: `https://github.com/${login}`,
  type: 'User',
  site_admin: false,
  ...(name === undefined ? {} : { name }),
})

type CapturedRequest = Readonly<{ url: URL; method: string }>

/** Routes responses by pathname and captures every request for assertions. */
const routeByPathname = (
  sink: CapturedRequest[],
  routes: Readonly<Record<string, () => unknown>>,
): ((url: string, init: RequestInit) => Promise<Response>) => {
  return (url: string, init: RequestInit): Promise<Response> => {
    const parsed = new URL(url)
    sink.push({ url: parsed, method: init.method ?? '' })
    const respond = routes[parsed.pathname]
    if (respond === undefined) return Promise.resolve(jsonResponse({ message: `unexpected ${parsed.pathname}` }, 500))
    const data = respond()
    return Promise.resolve(data instanceof Response ? data : jsonResponse(data))
  }
}

const collaboratorsPath = '/repos/octocat/Hello-World/collaborators'
const searchUsersPath = '/search/users'

afterEach(() => {
  restoreFetch()
  tracked.clearCalls()
})

describe('createGitHubIdentityResolver.searchUsers', () => {
  beforeEach(() => {
    installTrackedLogger()
  })
  test('exact-login collaborator match ranks first and never touches /search/users', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(
      routeByPathname(calls, {
        [collaboratorsPath]: () => [user('mona', 1, 'Mona Lisa Octocat'), user('octocat', 583231, 'The Octocat')],
      }),
    )
    const resolver = createGitHubIdentityResolver(config)
    const results = await resolver.searchUsers('octocat')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url.pathname).toBe(collaboratorsPath)
    expect(results[0]).toEqual({ id: '583231', login: 'octocat', name: 'The Octocat' })
    expect(results.map((candidate) => candidate.login)).toContain('mona')
  })

  test('display-name word match within collaborators avoids the search fallback', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(
      routeByPathname(calls, {
        [collaboratorsPath]: () => [user('hubot', 1, 'Hubot Robot'), user('octocat', 583231, 'The Octocat')],
      }),
    )
    const resolver = createGitHubIdentityResolver(config)
    const results = await resolver.searchUsers('Robot')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url.pathname).toBe(collaboratorsPath)
    expect(results.map((candidate) => candidate.login)).toEqual(['hubot'])
  })

  test('collaborator miss falls back to exactly one /search/users request with permission=push on the listing', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(
      routeByPathname(calls, {
        [collaboratorsPath]: () => [user('octocat', 583231, 'The Octocat')],
        [searchUsersPath]: () => ({ total_count: 1, items: [user('gollum', 3, 'Gollum')] }),
      }),
    )
    const resolver = createGitHubIdentityResolver(config)
    const results = await resolver.searchUsers('gollum')
    expect(calls).toHaveLength(2)
    expect(calls[0]?.url.pathname).toBe(collaboratorsPath)
    expect(calls[0]?.url.searchParams.get('permission')).toBe('push')
    expect(calls[1]?.url.pathname).toBe(searchUsersPath)
    expect(calls[1]?.url.searchParams.get('q')).toBe('gollum')
    expect(calls[1]?.url.searchParams.get('per_page')).toBe('10')
    expect(results).toEqual([{ id: '3', login: 'gollum', name: 'Gollum' }])
  })

  test('no match anywhere returns an empty list', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(
      routeByPathname(calls, {
        [collaboratorsPath]: () => [user('octocat', 583231, 'The Octocat')],
        [searchUsersPath]: () => ({ total_count: 0, items: [] }),
      }),
    )
    const resolver = createGitHubIdentityResolver(config)
    const results = await resolver.searchUsers('nobody-here')
    expect(results).toEqual([])
    expect(calls).toHaveLength(2)
  })

  test('explicit limit sizes the fallback page and caps the results', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(
      routeByPathname(calls, {
        [collaboratorsPath]: () => [user('octocat', 583231, 'The Octocat')],
        [searchUsersPath]: () => ({
          total_count: 5,
          items: [user('gollum', 3), user('smegol', 4), user('precious', 5), user('ring', 6), user('bagginss', 7)],
        }),
      }),
    )
    const resolver = createGitHubIdentityResolver(config)
    const results = await resolver.searchUsers('gollum', 3)
    expect(calls[1]?.url.searchParams.get('per_page')).toBe('3')
    expect(results).toHaveLength(3)
  })

  test('collaborators with a null display name resolve by login without breaking the call', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(
      routeByPathname(calls, {
        [collaboratorsPath]: () => [user('nameless', 9, null), user('octocat', 583231, null)],
      }),
    )
    const resolver = createGitHubIdentityResolver(config)
    const results = await resolver.searchUsers('octocat')
    expect(calls).toHaveLength(1)
    expect(results).toEqual([{ id: '583231', login: 'octocat', name: undefined }])
  })

  test('upstream failure rethrows a classified error, logs error, never logs the token', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(
      routeByPathname(calls, {
        [collaboratorsPath]: () => jsonResponse({ message: 'Server Error' }, 500),
      }),
    )
    const resolver = createGitHubIdentityResolver(config)
    const caught = await resolver.searchUsers('octocat').catch((error: unknown) => error)
    assert.ok(caught instanceof GitHubClassifiedError)
    expect(caught.appError).toHaveProperty('code', 'unexpected')
    expect(tracked.getCallsByLevel('error').length).toBeGreaterThan(0)
    expect(JSON.stringify(tracked.getCalls())).not.toContain('test-token')
  })
})
