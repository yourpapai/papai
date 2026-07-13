// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { ToolExecutionOptions } from 'ai'

import { MattermostClient } from '../../plugins/mcp-mattermost/client.js'
import {
  extractPostId,
  mapOrderedPosts,
  normalizeBaseUrl,
  parseSince,
  shapePost,
} from '../../plugins/mcp-mattermost/format.js'
import factory from '../../plugins/mcp-mattermost/index.js'
import type { PluginContext, PluginLogger, PluginRegistration } from '../../src/plugins/context.js'
import type { PluginTool, PluginToolRuntimeContext } from '../../src/plugins/types.js'

describe('mcp-mattermost format', () => {
  describe('normalizeBaseUrl', () => {
    test('replaces wss:// with https:// and strips trailing slash', () => {
      expect(normalizeBaseUrl('wss://mm.x/')).toBe('https://mm.x')
    })

    test('replaces ws:// with http://', () => {
      expect(normalizeBaseUrl('ws://mm.x')).toBe('http://mm.x')
    })

    test('strips multiple trailing slashes', () => {
      expect(normalizeBaseUrl('https://mm.x///')).toBe('https://mm.x')
    })

    test('leaves an already-normalized URL unchanged', () => {
      expect(normalizeBaseUrl('https://mm.x')).toBe('https://mm.x')
    })
  })

  describe('extractPostId', () => {
    test('extracts the id from a /_redirect/pl/ permalink', () => {
      expect(extractPostId('https://mm.x/_redirect/pl/AbC123')).toBe('AbC123')
    })

    test('extracts the id from a team/channel permalink', () => {
      expect(extractPostId('https://mm.x/team/chan/pl/XY9')).toBe('XY9')
    })

    test('trims a bare id with no permalink shape', () => {
      expect(extractPostId('  bareId ')).toBe('bareId')
    })
  })

  describe('parseSince', () => {
    test('returns undefined for undefined', () => {
      expect(parseSince(undefined)).toBeUndefined()
    })

    test('returns a number as-is', () => {
      expect(parseSince(1_700_000_000_000)).toBe(1_700_000_000_000)
    })

    test('parses a numeric string as epoch millis', () => {
      expect(parseSince('1700000000000')).toBe(1_700_000_000_000)
    })

    test('parses an ISO date string via Date.parse', () => {
      expect(parseSince('2023-01-01T00:00:00Z')).toBe(Date.parse('2023-01-01T00:00:00Z'))
    })

    test('throws on an unparseable string', () => {
      expect(() => parseSince('not-a-date')).toThrow('Invalid since value: not-a-date')
    })
  })

  describe('shapePost', () => {
    test('picks only known fields and drops props/metadata', () => {
      const raw = {
        id: 'p1',
        message: 'hi',
        user_id: 'u1',
        channel_id: 'c1',
        create_at: 5,
        update_at: 6,
        edit_at: 0,
        root_id: '',
        file_ids: ['f1', '', 7],
        props: { x: 1 },
        metadata: { y: 2 },
      }

      expect(shapePost(raw)).toEqual({
        id: 'p1',
        message: 'hi',
        user_id: 'u1',
        channel_id: 'c1',
        create_at: 5,
        update_at: 6,
        edit_at: 0,
        root_id: '',
        file_ids: ['f1', ''],
      })
    })

    test('returns an empty object for null', () => {
      expect(shapePost(null)).toEqual({})
    })

    test('returns an empty object for a non-record primitive', () => {
      expect(shapePost('x')).toEqual({})
    })
  })

  describe('mapOrderedPosts', () => {
    test('maps ids through order, dropping missing ids, shaping each post', () => {
      const raw = {
        posts: {
          p1: { id: 'p1', message: 'a' },
          p2: { id: 'p2', message: 'b' },
        },
        order: ['p2', 'p1', 'pX'],
      }

      expect(mapOrderedPosts(raw)).toEqual([
        { id: 'p2', message: 'b' },
        { id: 'p1', message: 'a' },
      ])
    })

    test('returns an empty array for null', () => {
      expect(mapOrderedPosts(null)).toEqual([])
    })

    test('returns an empty array for a record missing posts/order', () => {
      expect(mapOrderedPosts({})).toEqual([])
    })
  })
})

type CapturedCall = { url: string; init: RequestInit | undefined }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status })
}

function createRoutedHttpFetch(
  routes: Record<string, Response>,
  calls: CapturedCall[],
): (url: string, init: RequestInit | undefined) => Promise<Response> {
  return (url: string, init: RequestInit | undefined): Promise<Response> => {
    calls.push({ url, init })
    const pathname = new URL(url).pathname
    const route = routes[pathname]
    return Promise.resolve(route ?? jsonResponse({ error: `unexpected pathname ${pathname}` }, 404))
  }
}

function countCallsTo(calls: CapturedCall[], pathname: string): number {
  return calls.filter((c) => new URL(c.url).pathname === pathname).length
}

describe('MattermostClient', () => {
  const baseUrl = 'https://mm.test'
  const token = 'tok'

  test('getPost fetches the post, enriches the author, and returns a shaped post', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/v4/posts/P1': jsonResponse({
        id: 'P1',
        message: 'hi',
        user_id: 'u1',
        channel_id: 'c1',
        create_at: 1000,
        props: { should: 'be dropped' },
      }),
      '/api/v4/users/u1': jsonResponse({ id: 'u1', username: 'alice', first_name: 'Alice', last_name: 'A' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new MattermostClient({ baseUrl, token, httpFetch })

    const result = await client.getPost('https://mm.test/pl/P1')

    expect(calls[0]?.url).toBe('https://mm.test/api/v4/posts/P1')
    const headers = new Headers(calls[0]?.init?.headers)
    expect(headers.get('Authorization')).toBe('Bearer tok')
    expect(headers.get('Accept')).toBe('application/json')
    expect(calls[1]?.url).toBe('https://mm.test/api/v4/users/u1')
    expect(result).toEqual({
      id: 'P1',
      message: 'hi',
      user_id: 'u1',
      channel_id: 'c1',
      create_at: 1000,
      user: { id: 'u1', username: 'alice', name: 'Alice A' },
    })
    expect(result).not.toHaveProperty('props')
  })

  test('getPost resolves file_ids into attachments', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/v4/posts/P1': jsonResponse({ id: 'P1', message: 'see attached', file_ids: ['F1'] }),
      '/api/v4/files/F1/info': jsonResponse({
        id: 'F1',
        name: 'a.txt',
        size: 5,
        mime_type: 'text/plain',
        extension: 'txt',
        create_at: 123,
      }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new MattermostClient({ baseUrl, token, httpFetch })

    const result = await client.getPost('P1')

    expect(result.attachments).toEqual([
      { id: 'F1', name: 'a.txt', size: 5, mime_type: 'text/plain', extension: 'txt', create_at: 123 },
    ])
  })

  test('getPost swallows a failed user enrichment and returns the post without a user field', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/v4/posts/P1': jsonResponse({ id: 'P1', message: 'hi', user_id: 'u1' }),
      '/api/v4/users/u1': jsonResponse({ error: 'not found' }, 404),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new MattermostClient({ baseUrl, token, httpFetch })

    const result = await client.getPost('P1')

    expect(result).toEqual({ id: 'P1', message: 'hi', user_id: 'u1' })
    expect(result).not.toHaveProperty('user')
  })

  test('getThread orders posts and dedupes repeated user enrichment fetches', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/v4/posts/P1/thread': jsonResponse({
        posts: {
          a: { id: 'a', user_id: 'u1' },
          b: { id: 'b', user_id: 'u1' },
        },
        order: ['b', 'a'],
      }),
      '/api/v4/users/u1': jsonResponse({ id: 'u1', username: 'alice' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new MattermostClient({ baseUrl, token, httpFetch })

    const result = await client.getThread('P1')

    expect(result.map((p) => p.id)).toEqual(['b', 'a'])
    expect(result.every((p) => p.user?.username === 'alice')).toBe(true)
    expect(countCallsTo(calls, '/api/v4/users/u1')).toBe(1)
  })

  test('getChannelPosts caps per_page at 200, defaults page to 0, and sorts posts ascending by create_at', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/v4/channels/c1/posts': jsonResponse({
        posts: {
          a: { id: 'a', create_at: 200 },
          b: { id: 'b', create_at: 100 },
        },
        order: ['a', 'b'],
      }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new MattermostClient({ baseUrl, token, httpFetch })

    const result = await client.getChannelPosts('c1', { perPage: 300 })

    expect(calls[0]?.url).toBe('https://mm.test/api/v4/channels/c1/posts?page=0&per_page=200')
    expect(result.posts.map((p) => p.id)).toEqual(['b', 'a'])
    expect(result.order).toEqual(['b', 'a'])
    expect(result.page).toBe(0)
    expect(result.per_page).toBe(200)
    expect(result.since).toBeUndefined()
  })

  test('getChannelPosts uses since instead of page/per_page when provided', async () => {
    const calls: CapturedCall[] = []
    const expectedSince = Date.parse('2023-01-01T00:00:00Z')
    const routes: Record<string, Response> = {
      '/api/v4/channels/c1/posts': jsonResponse({ posts: {}, order: [] }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new MattermostClient({ baseUrl, token, httpFetch })

    const result = await client.getChannelPosts('c1', { since: '2023-01-01T00:00:00Z' })

    expect(calls[0]?.url).toBe(`https://mm.test/api/v4/channels/c1/posts?since=${expectedSince}`)
    expect(result.since).toBe(expectedSince)
    expect(result.page).toBeUndefined()
    expect(result.per_page).toBeUndefined()
  })

  test('createPost sends root_id from an explicit rootId', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/v4/posts': jsonResponse({ id: 'P9', message: 'hi', channel_id: 'c1', root_id: 'r1' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new MattermostClient({ baseUrl, token, httpFetch })

    const result = await client.createPost({ channelId: 'c1', message: 'hi', rootId: 'r1' })

    expect(calls[0]?.url).toBe('https://mm.test/api/v4/posts')
    expect(calls[0]?.init?.method).toBe('POST')
    const headers = new Headers(calls[0]?.init?.headers)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ channel_id: 'c1', message: 'hi', root_id: 'r1' }))
    expect(result.id).toBe('P9')
  })

  test('createPost derives root_id from a threadLinkOrId permalink', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/v4/posts': jsonResponse({ id: 'P9', message: 'hi', channel_id: 'c1', root_id: 'R2' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new MattermostClient({ baseUrl, token, httpFetch })

    await client.createPost({ channelId: 'c1', message: 'hi', threadLinkOrId: 'https://mm.test/pl/R2' })

    expect(calls[0]?.init?.body).toBe(JSON.stringify({ channel_id: 'c1', message: 'hi', root_id: 'R2' }))
  })

  describe('downloadAttachment', () => {
    test('inlines text content for small text/* attachments', async () => {
      const calls: CapturedCall[] = []
      const routes: Record<string, Response> = {
        '/api/v4/files/F1/info': jsonResponse({ id: 'F1', size: 100, mime_type: 'text/plain', name: 'a.txt' }),
        '/api/v4/files/F1': textResponse('hello'),
      }
      const httpFetch = createRoutedHttpFetch(routes, calls)
      const client = new MattermostClient({ baseUrl, token, httpFetch })

      const result = await client.downloadAttachment('F1')

      expect(result).toEqual({
        attachment: { id: 'F1', size: 100, mime_type: 'text/plain', name: 'a.txt' },
        text: 'hello',
      })
      expect(calls[1]?.url).toBe('https://mm.test/api/v4/files/F1')
      const headers = new Headers(calls[1]?.init?.headers)
      expect(headers.get('Accept')).toBe('*/*')
    })

    test('flags large attachments as too large without fetching content', async () => {
      const calls: CapturedCall[] = []
      const routes: Record<string, Response> = {
        '/api/v4/files/F1/info': jsonResponse({ id: 'F1', size: 999_999, mime_type: 'text/plain', name: 'big.txt' }),
      }
      const httpFetch = createRoutedHttpFetch(routes, calls)
      const client = new MattermostClient({ baseUrl, token, httpFetch })

      const result = await client.downloadAttachment('F1')

      expect(result).toEqual({
        attachment: { id: 'F1', size: 999_999, mime_type: 'text/plain', name: 'big.txt' },
        tooLarge: true,
      })
      expect(countCallsTo(calls, '/api/v4/files/F1')).toBe(0)
    })

    test('flags non-text attachments as binary without fetching content', async () => {
      const calls: CapturedCall[] = []
      const routes: Record<string, Response> = {
        '/api/v4/files/F1/info': jsonResponse({ id: 'F1', size: 100, mime_type: 'image/png', name: 'p.png' }),
      }
      const httpFetch = createRoutedHttpFetch(routes, calls)
      const client = new MattermostClient({ baseUrl, token, httpFetch })

      const result = await client.downloadAttachment('F1')

      expect(result).toEqual({
        attachment: { id: 'F1', size: 100, mime_type: 'image/png', name: 'p.png' },
        isBinary: true,
        note: 'Binary attachment; content not inlined (no filesystem handoff in this MCP transport).',
      })
      expect(countCallsTo(calls, '/api/v4/files/F1')).toBe(0)
    })
  })

  test('getPost encodes a traversal-like id so the request stays under /posts/', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/v4/posts/..%2F..%2Fadmin': jsonResponse({ id: 'x' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new MattermostClient({ baseUrl, token, httpFetch })

    await client.getPost('../../admin')

    expect(calls[0]?.url).toBe('https://mm.test/api/v4/posts/..%2F..%2Fadmin')
  })

  test('getPost rejects on a non-2xx response from the primary post fetch', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/v4/posts/P1': jsonResponse({ error: 'nope' }, 500),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new MattermostClient({ baseUrl, token, httpFetch })

    await expect(client.getPost('P1')).rejects.toThrow('Mattermost API 500 for /posts/P1')
  })
})

function createMockLogger(): PluginLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }
}

function createMockContext(overrides: { httpFetch?: (url: string, init?: RequestInit) => Promise<Response> } = {}): {
  ctx: PluginContext
  registeredTools: Map<string, PluginTool>
} {
  const registeredTools = new Map<string, PluginTool>()

  const registration: PluginRegistration = {
    registerTool: (tool: PluginTool) => {
      registeredTools.set(tool.name, tool)
    },
    registerPromptFragment: () => {},
    registerCommand: () => {},
    registerScheduledJob: () => {},
    registerAttachmentTransformer: () => {},
    registerTaskProviderType: () => {},
  }

  const ctx: PluginContext = {
    pluginId: 'mcp-mattermost',
    contextId: '__system__',
    permissions: new Set(['http']),
    kv: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      list: () => [],
    },
    log: createMockLogger(),
    registration,
    providerRuntime: {
      httpFetch: overrides.httpFetch ?? mock(),
      allowedHosts: new Set(['mm.test']),
      logger: createMockLogger(),
    },
    adminConfig: {
      get: () => undefined,
    },
  }

  return { ctx, registeredTools }
}

function createMockRuntimeContext(
  overrides: {
    allowed?: boolean
    retryAfterSec?: number
    baseUrl?: string | undefined
    accessToken?: string | undefined
  } = {},
): PluginToolRuntimeContext {
  const notImplemented = (): Promise<never> => Promise.reject(new Error('not implemented'))

  const values: Record<string, string | undefined> = {
    base_url: 'baseUrl' in overrides ? overrides.baseUrl : 'https://mm.test',
    access_token: 'accessToken' in overrides ? overrides.accessToken : 'tok',
  }

  return {
    pluginId: 'mcp-mattermost',
    storageContextId: 'test-context',
    chatUserId: 'test-user',
    taskProvider: {
      getTask: () => notImplemented(),
      listTasks: () => notImplemented(),
      searchTasks: () => notImplemented(),
      createTask: () => notImplemented(),
      updateTask: () => notImplemented(),
    },
    kv: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      list: () => [],
    },
    rateLimit: {
      check: () => ({
        allowed: overrides.allowed ?? true,
        retryAfterSec: overrides.retryAfterSec,
      }),
    },
    attachments: {
      read: () => notImplemented(),
    },
    adminConfig: {
      get: (key: string) => values[key],
    },
    contextConfig: {
      get: () => undefined,
    },
    codingSecrets: {
      resolve: () => null,
      resolveForgeToken: () => null,
      resolveAgent: () => null,
      resolveForge: () => null,
      resolveProviderHost: () => null,
      resolveModel: () => null,
      resolveMcpServers: () => ({ ok: true, servers: [] }),
      resolveMcpTokens: () => ({}),
    },
    codingRepos: { list: () => [], get: () => null },
    transcript: { mintUrl: () => null },
  } as PluginToolRuntimeContext
}

function createMockOptions(): ToolExecutionOptions {
  return {
    toolCallId: 'test-call-id',
    messages: [],
  }
}

describe('mcp-mattermost plugin', () => {
  test('activates and registers all 5 Mattermost tools', () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    expect([...registeredTools.keys()].sort()).toEqual(
      [
        'mattermost_get_post',
        'mattermost_get_thread',
        'mattermost_get_channel_posts',
        'mattermost_create_post',
        'mattermost_download_attachment',
      ].sort(),
    )
  })

  test('mattermost_get_post returns the enriched post and calls the correct URL', async () => {
    const calls: CapturedCall[] = []
    const routes: Record<string, Response> = {
      '/api/v4/posts/P1': jsonResponse({ id: 'P1', message: 'hi', user_id: 'u1', channel_id: 'c1', create_at: 1 }),
      '/api/v4/users/u1': jsonResponse({ id: 'u1', username: 'alice', first_name: 'Alice', last_name: 'A' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('mattermost_get_post')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ linkOrId: 'P1' }, runtimeCtx, options)

    expect(calls[0]?.url).toBe('https://mm.test/api/v4/posts/P1')
    expect(result).toEqual({
      id: 'P1',
      message: 'hi',
      user_id: 'u1',
      channel_id: 'c1',
      create_at: 1,
      user: { id: 'u1', username: 'alice', name: 'Alice A' },
    })
  })

  test('returns not_configured when admin creds are missing', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('mattermost_get_post')!
    const runtimeCtx = createMockRuntimeContext({ baseUrl: undefined })
    const options = createMockOptions()
    const result = await tool.execute({ linkOrId: 'P1' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'not_configured', message: 'Mattermost is not configured' })
  })

  test('returns rate_limited when the rate limit is exceeded', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('mattermost_get_post')!
    const runtimeCtx = createMockRuntimeContext({ allowed: false, retryAfterSec: 30 })
    const options = createMockOptions()
    const result = await tool.execute({ linkOrId: 'P1' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'rate_limited', retryAfterSec: 30 })
  })

  test('returns mattermost_error when httpFetch throws a non-abort error', async () => {
    const httpFetch = (): Promise<Response> => Promise.reject(new Error('Connection refused'))

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('mattermost_get_post')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ linkOrId: 'P1' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'mattermost_error', message: 'Connection refused' })
  })
})
