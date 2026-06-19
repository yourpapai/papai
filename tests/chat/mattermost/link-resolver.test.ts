// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { parseMattermostPermalink, resolveChatLink } from '../../../src/chat/mattermost/link-resolver.js'
import {
  expectAppError,
  mockLogger,
  restoreFetch,
  seedTestPlatformInstance,
  setMockFetch,
  setupTestDb,
} from '../../utils/test-helpers.js'

// Route a Mattermost REST path to a canned JSON response (status 200 unless overridden).
function routeFetch(routes: Record<string, { status?: number; body: unknown }>): void {
  setMockFetch((url) => {
    const path = new URL(url).pathname
    const route = routes[path]
    if (route === undefined) return Promise.resolve(new Response('not mapped', { status: 404 }))
    return Promise.resolve(new Response(JSON.stringify(route.body), { status: route.status ?? 200 }))
  })
}

const BASE = 'https://mm.example.com'
function seedMm(): void {
  seedTestPlatformInstance({ id: 'mm-1', type: 'mattermost', config: { baseUrl: BASE, token: 'tok' } })
}

describe('parseMattermostPermalink', () => {
  const base = 'https://mm.example.com'

  test('extracts post id from a permalink on the same host', () => {
    expect(parseMattermostPermalink('https://mm.example.com/eng/pl/abc123', base)).toBe('abc123')
  })

  test('tolerates a trailing slash', () => {
    expect(parseMattermostPermalink('https://mm.example.com/eng/pl/abc123/', base)).toBe('abc123')
  })

  test('rejects a link on a different host', () => {
    expect(parseMattermostPermalink('https://evil.example.com/eng/pl/abc123', base)).toBeNull()
  })

  test('rejects a non-permalink path', () => {
    expect(parseMattermostPermalink('https://mm.example.com/eng/channels/town-square', base)).toBeNull()
  })

  test('rejects a non-URL string', () => {
    expect(parseMattermostPermalink('not a url', base)).toBeNull()
  })
})

describe('resolveChatLink (single post)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedMm()
  })
  afterEach(() => {
    restoreFetch()
  })

  test("scope 'post' returns the linked message, flagged root + linked", async () => {
    routeFetch({
      '/api/v4/posts/abc123': {
        body: { id: 'abc123', user_id: 'u1', channel_id: 'c1', message: 'hello there', create_at: 1700000000000 },
      },
      '/api/v4/channels/c1/members/user-1': { body: { roles: 'channel_user' } },
      '/api/v4/users/u1': { body: { id: 'u1', username: 'alice', first_name: 'Alice', last_name: 'A', nickname: '' } },
    })

    const result = await resolveChatLink({
      platformInstanceId: 'mm-1',
      requesterUserId: 'user-1',
      url: `${BASE}/eng/pl/abc123`,
      scope: 'post',
    })

    expect(result.source).toBe('mattermost')
    expect(result.linkedPostId).toBe('abc123')
    expect(result.rootPostId).toBe('abc123')
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toEqual({
      authorId: 'u1',
      author: 'Alice A (@alice)',
      timestamp: new Date(1700000000000).toISOString(),
      text: 'hello there',
      isRoot: true,
      isLinked: true,
    })
  })

  test('membership denied (members endpoint 403) → not-accessible AppError, no content', async () => {
    routeFetch({
      '/api/v4/posts/abc123': {
        body: { id: 'abc123', user_id: 'u1', channel_id: 'c1', message: 'secret', create_at: 1 },
      },
      '/api/v4/channels/c1/members/user-1': { status: 403, body: { message: 'forbidden' } },
    })

    const error = await resolveChatLink({
      platformInstanceId: 'mm-1',
      requesterUserId: 'user-1',
      url: `${BASE}/eng/pl/abc123`,
      scope: 'post',
    }).then(
      () => null,
      (e: unknown) => e,
    )
    expectAppError(error, 'Chat message "abc123" was not found.')
  })

  test('post not found (404) → not-found AppError', async () => {
    routeFetch({ '/api/v4/posts/abc123': { status: 404, body: {} } })

    const error = await resolveChatLink({
      platformInstanceId: 'mm-1',
      requesterUserId: 'user-1',
      url: `${BASE}/eng/pl/abc123`,
      scope: 'post',
    }).then(
      () => null,
      (e: unknown) => e,
    )
    expectAppError(error, 'Chat message "abc123" was not found.')
  })

  test('foreign host → invalid-input AppError', async () => {
    routeFetch({})
    const error = await resolveChatLink({
      platformInstanceId: 'mm-1',
      requesterUserId: 'user-1',
      url: 'https://evil.example.com/eng/pl/abc123',
      scope: 'post',
    }).then(
      () => null,
      (e: unknown) => e,
    )
    expectAppError(error, 'Invalid url: not a Mattermost permalink for this workspace')
  })
})

describe('resolveChatLink (thread)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedMm()
  })
  afterEach(() => {
    restoreFetch()
  })

  test('link to a reply with scope thread returns whole thread, ordered, with isLinked on the reply', async () => {
    routeFetch({
      '/api/v4/posts/reply2': {
        body: { id: 'reply2', user_id: 'u2', channel_id: 'c1', message: 'the reply', create_at: 20, root_id: 'root1' },
      },
      '/api/v4/channels/c1/members/user-1': { body: { roles: 'channel_user' } },
      '/api/v4/posts/root1/thread': {
        body: {
          order: ['reply2', 'root1'],
          posts: {
            root1: { id: 'root1', user_id: 'u1', channel_id: 'c1', message: 'the root', create_at: 10 },
            reply2: {
              id: 'reply2',
              user_id: 'u2',
              channel_id: 'c1',
              message: 'the reply',
              create_at: 20,
              root_id: 'root1',
            },
          },
        },
      },
      '/api/v4/users/u1': { body: { id: 'u1', username: 'alice' } },
      '/api/v4/users/u2': { body: { id: 'u2', username: 'bob' } },
    })

    const result = await resolveChatLink({
      platformInstanceId: 'mm-1',
      requesterUserId: 'user-1',
      url: `${BASE}/eng/pl/reply2`,
      scope: 'thread',
    })

    expect(result.rootPostId).toBe('root1')
    expect(result.linkedPostId).toBe('reply2')
    // chronological
    expect(result.messages.map((m) => m.text)).toEqual(['the root', 'the reply'])
    const root = result.messages[0]
    const reply = result.messages[1]
    expect(root?.isRoot).toBe(true)
    expect(root?.isLinked).toBe(false)
    expect(reply?.isRoot).toBe(false)
    expect(reply?.isLinked).toBe(true)
  })

  test('threads over the 100-post cap are truncated', async () => {
    const posts: Record<string, unknown> = {}
    const order: string[] = []
    posts['p0'] = { id: 'p0', user_id: 'u1', channel_id: 'c1', message: 'm0', create_at: 0, root_id: '' }
    order.push('p0')
    for (let i = 1; i < 130; i++) {
      const id = `p${i}`
      order.push(id)
      posts[id] = { id, user_id: 'u1', channel_id: 'c1', message: `m${i}`, create_at: i, root_id: 'p0' }
    }
    routeFetch({
      '/api/v4/posts/p0': { body: posts['p0'] },
      '/api/v4/channels/c1/members/user-1': { body: { roles: 'channel_user' } },
      '/api/v4/posts/p0/thread': { body: { order, posts } },
      '/api/v4/users/u1': { body: { id: 'u1', username: 'alice' } },
    })

    const result = await resolveChatLink({
      platformInstanceId: 'mm-1',
      requesterUserId: 'user-1',
      url: `${BASE}/eng/pl/p0`,
      scope: 'thread',
    })

    expect(result.messages).toHaveLength(100)
    expect(result.truncated).toBe(true)
  })
})
