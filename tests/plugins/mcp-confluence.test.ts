// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { ToolExecutionOptions } from 'ai'

import { ConfluenceClient } from '../../plugins/mcp-confluence/client.js'
import { simplifyComment, simplifyComments, simplifyPage } from '../../plugins/mcp-confluence/format.js'
import factory from '../../plugins/mcp-confluence/index.js'
import type { PluginContext, PluginLogger, PluginRegistration } from '../../src/plugins/context.js'
import type { PluginTool, PluginToolRuntimeContext } from '../../src/plugins/types.js'

describe('mcp-confluence simplify', () => {
  test('simplifyPage keeps only id/type/title/space{key,name}/body.storage', () => {
    const page = {
      id: '1',
      type: 'page',
      title: 'T',
      status: 'current',
      space: { id: 9, key: 'TEAM', name: 'Team', type: 'global' },
      version: { number: 3 },
      _links: { self: 'x' },
      extensions: {},
      body: { storage: { value: '<p>hi</p>', representation: 'storage' }, view: { value: 'x' } },
    }

    expect(simplifyPage(page)).toEqual({
      id: '1',
      type: 'page',
      title: 'T',
      space: { key: 'TEAM', name: 'Team' },
      body: { storage: { value: '<p>hi</p>', representation: 'storage' } },
    })
  })

  test('simplifyComment drops space', () => {
    const comment = {
      id: '2',
      type: 'comment',
      title: 'RE: T',
      status: 'current',
      space: { id: 9, key: 'TEAM', name: 'Team', type: 'global' },
      version: { number: 1 },
      body: { storage: { value: '<p>hey</p>', representation: 'storage' } },
    }

    expect(simplifyComment(comment)).toEqual({
      id: '2',
      type: 'comment',
      title: 'RE: T',
      body: { storage: { value: '<p>hey</p>', representation: 'storage' } },
    })
  })

  test('simplifyComments maps results and carries paging fields', () => {
    const comment = {
      id: '2',
      type: 'comment',
      title: 'RE: T',
      space: { id: 9, key: 'TEAM', name: 'Team', type: 'global' },
      body: { storage: { value: '<p>hey</p>', representation: 'storage' } },
    }
    const resp = { results: [comment, comment], size: 2, limit: 100, start: 0, _links: {} }

    expect(simplifyComments(resp)).toEqual({
      results: [
        {
          id: '2',
          type: 'comment',
          title: 'RE: T',
          body: { storage: { value: '<p>hey</p>', representation: 'storage' } },
        },
        {
          id: '2',
          type: 'comment',
          title: 'RE: T',
          body: { storage: { value: '<p>hey</p>', representation: 'storage' } },
        },
      ],
      size: 2,
      limit: 100,
      start: 0,
    })
  })

  test('simplifyComments falls back to empty results array when results is not an array', () => {
    expect(simplifyComments({ results: 'nope', size: 1 })).toEqual({ results: [], size: 1 })
  })

  test('simplifyPage on a page missing space omits the space key entirely', () => {
    const page = {
      id: '1',
      type: 'page',
      title: 'T',
      body: { storage: { value: '<p>hi</p>', representation: 'storage' } },
    }
    const result = simplifyPage(page)

    expect(Object.hasOwn(result, 'space')).toBe(false)
    expect(result).toEqual({
      id: '1',
      type: 'page',
      title: 'T',
      body: { storage: { value: '<p>hi</p>', representation: 'storage' } },
    })
  })

  test('simplifyPage on a page missing body.storage omits the body key entirely', () => {
    const page = { id: '1', type: 'page', title: 'T' }
    const result = simplifyPage(page)

    expect(Object.hasOwn(result, 'body')).toBe(false)
  })

  test('simplifyPage on non-object input returns an empty object without throwing', () => {
    expect(simplifyPage(null)).toEqual({})
    expect(simplifyPage('x')).toEqual({})
    expect(simplifyPage(undefined)).toEqual({})
  })

  test('simplifyComment on non-object input returns an empty object without throwing', () => {
    expect(simplifyComment(null)).toEqual({})
    expect(simplifyComment(42)).toEqual({})
  })

  test('simplifyComments on non-object input returns empty results without throwing', () => {
    expect(simplifyComments(null)).toEqual({ results: [] })
    expect(simplifyComments('x')).toEqual({ results: [] })
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const rawPage = {
  id: '810922884',
  type: 'page',
  title: 'T',
  status: 'current',
  space: { id: 9, key: 'TEAM', name: 'Team', type: 'global' },
  version: { number: 3 },
  _links: { self: 'x' },
  extensions: {},
  body: { storage: { value: '<p>hi</p>', representation: 'storage' }, view: { value: 'x' } },
}

const rawComment = {
  id: '2',
  type: 'comment',
  title: 'RE: T',
  status: 'current',
  space: { id: 9, key: 'TEAM', name: 'Team', type: 'global' },
  version: { number: 1 },
  body: { storage: { value: '<p>hey</p>', representation: 'storage' } },
}

function tinyUrlResponse(finalUrl: string): Response {
  const resp = jsonResponse({})
  Object.defineProperty(resp, 'url', { value: finalUrl, configurable: true })
  return resp
}

function createRoutedFetch(
  routes: Record<string, Response>,
  calls: Array<{ url: string; init: RequestInit | undefined }>,
): (url: string, init: RequestInit | undefined) => Promise<Response> {
  return (url: string, init: RequestInit | undefined): Promise<Response> => {
    calls.push({ url, init })
    const found = routes[url]
    return Promise.resolve(found ?? jsonResponse({ error: `unexpected url ${url}` }, 404))
  }
}

describe('ConfluenceClient', () => {
  const baseUrl = 'https://wiki.test'
  const username = 'u'
  const password = 'p'
  const basicAuth = 'Basic ' + Buffer.from('u:p').toString('base64')

  test('getPage requests /content/<id>?expand=... with Basic auth headers and returns the simplified page', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const httpFetch = (url: string, init: RequestInit | undefined): Promise<Response> => {
      capturedUrl = url
      capturedInit = init
      return Promise.resolve(jsonResponse(rawPage))
    }
    const client = new ConfluenceClient({ baseUrl, username, password, httpFetch })

    const result = await client.getPage('810922884')

    expect(capturedUrl).toBe('https://wiki.test/rest/api/content/810922884?expand=body.storage,version,space')
    const headers = new Headers(capturedInit?.headers)
    expect(headers.get('Authorization')).toBe(basicAuth)
    expect(headers.get('Accept')).toBe('application/json')
    expect(result).toEqual(simplifyPage(rawPage))
  })

  test('getPageByTitle builds an encoded query and returns the first simplified result', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(jsonResponse({ results: [rawPage] }))
    }
    const client = new ConfluenceClient({ baseUrl, username, password, httpFetch })

    const result = await client.getPageByTitle('TEAM', 'My Page')

    const parsed = new URL(capturedUrl)
    expect(parsed.pathname).toBe('/rest/api/content')
    expect(parsed.searchParams.get('spaceKey')).toBe('TEAM')
    expect(parsed.searchParams.get('title')).toBe('My Page')
    expect(parsed.searchParams.get('expand')).toBe('body.storage,version,space')
    expect(result).toEqual(simplifyPage(rawPage))
  })

  test('getPageByTitle throws when no results are found', async () => {
    const httpFetch = (): Promise<Response> => Promise.resolve(jsonResponse({ results: [] }))
    const client = new ConfluenceClient({ baseUrl, username, password, httpFetch })

    await expect(client.getPageByTitle('TEAM', 'Missing')).rejects.toThrow(
      'Confluence page not found: spaceKey=TEAM, title=Missing',
    )
  })

  test('getComments requests child comments with expand and limit', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(jsonResponse({ results: [rawComment], size: 1, limit: 100, start: 0 }))
    }
    const client = new ConfluenceClient({ baseUrl, username, password, httpFetch })

    const result = await client.getComments('810922884')

    expect(capturedUrl).toBe(
      'https://wiki.test/rest/api/content/810922884/child/comment?expand=body.storage,version,space&limit=100',
    )
    expect(result).toEqual(simplifyComments({ results: [rawComment], size: 1, limit: 100, start: 0 }))
  })

  test('addComment POSTs a storage-format body and returns the simplified comment', async () => {
    let capturedInit: RequestInit | undefined
    const httpFetch = (_url: string, init: RequestInit | undefined): Promise<Response> => {
      capturedInit = init
      return Promise.resolve(jsonResponse(rawComment))
    }
    const client = new ConfluenceClient({ baseUrl, username, password, httpFetch })

    const result = await client.addComment('810922884', '<p>hi</p>')

    expect(capturedInit?.method).toBe('POST')
    expect(capturedInit?.body).toBe(
      JSON.stringify({ type: 'comment', body: { storage: { value: '<p>hi</p>', representation: 'storage' } } }),
    )
    expect(result).toEqual(simplifyComment(rawComment))
  })

  test('getPage encodes a traversal-like pageId so the request stays under /rest/api/content/', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(jsonResponse(rawPage))
    }
    const client = new ConfluenceClient({ baseUrl, username, password, httpFetch })

    await client.getPage('../../admin')

    const { pathname } = new URL(capturedUrl)
    expect(pathname.startsWith('/rest/api/content/')).toBe(true)
    expect(pathname).toContain('content/..%2F..%2Fadmin')
  })

  test('getPage rejects on a non-2xx response', async () => {
    const httpFetch = (): Promise<Response> => Promise.resolve(jsonResponse({ error: 'nope' }, 404))
    const client = new ConfluenceClient({ baseUrl, username, password, httpFetch })

    await expect(client.getPage('missing')).rejects.toThrow(
      'Confluence API 404 for /content/missing?expand=body.storage,version,space',
    )
  })

  describe('resolveShortLink', () => {
    test('resolves a classic /x/<key> short link using response.url, calling only the tinyurl then getPage', async () => {
      const calls: Array<{ url: string; init: RequestInit | undefined }> = []
      const routes: Record<string, Response> = {
        'https://wiki.test/x/AbCdEf': tinyUrlResponse('https://wiki.test/pages/viewpage.action?pageId=12345678'),
        'https://wiki.test/rest/api/content/12345678?expand=body.storage,version,space': jsonResponse(rawPage),
      }
      const httpFetch = createRoutedFetch(routes, calls)
      const client = new ConfluenceClient({ baseUrl, username, password, httpFetch })

      const result = await client.resolveShortLink('https://wiki.test/x/AbCdEf')

      expect(calls).toHaveLength(2)
      expect(calls[0]?.url).toBe('https://wiki.test/x/AbCdEf')
      const tinyHeaders = new Headers(calls[0]?.init?.headers)
      expect(tinyHeaders.get('Authorization')).toBe(basicAuth)
      expect(tinyHeaders.has('Accept')).toBe(false)
      expect(tinyHeaders.has('Content-Type')).toBe(false)
      expect(calls[1]?.url).toBe('https://wiki.test/rest/api/content/12345678?expand=body.storage,version,space')
      expect(result).toEqual({
        resolvedUrl: 'https://wiki.test/pages/viewpage.action?pageId=12345678',
        page: simplifyPage(rawPage),
      })
    })

    test('resolves a Cloud-style /pages/<id>/<title> resolved URL', async () => {
      const calls: Array<{ url: string; init: RequestInit | undefined }> = []
      const routes: Record<string, Response> = {
        'https://wiki.test/x/AbCdEf': tinyUrlResponse('https://wiki.test/spaces/TEAM/pages/999/Title'),
        'https://wiki.test/rest/api/content/999?expand=body.storage,version,space': jsonResponse(rawPage),
      }
      const httpFetch = createRoutedFetch(routes, calls)
      const client = new ConfluenceClient({ baseUrl, username, password, httpFetch })

      const result = await client.resolveShortLink('https://wiki.test/x/AbCdEf')

      expect(calls[1]?.url).toBe('https://wiki.test/rest/api/content/999?expand=body.storage,version,space')
      expect(result.resolvedUrl).toBe('https://wiki.test/spaces/TEAM/pages/999/Title')
    })

    test('throws when the short-link key is empty', async () => {
      const httpFetch = (): Promise<Response> => Promise.resolve(jsonResponse({}))
      const client = new ConfluenceClient({ baseUrl, username, password, httpFetch })

      await expect(client.resolveShortLink('https://wiki.test/x/')).rejects.toThrow('Could not extract short-link key')
    })

    test('throws when the tinyurl response is not ok', async () => {
      const httpFetch = (): Promise<Response> => Promise.resolve(jsonResponse({}, 404))
      const client = new ConfluenceClient({ baseUrl, username, password, httpFetch })

      await expect(client.resolveShortLink('https://wiki.test/x/AbCdEf')).rejects.toThrow(
        'Could not resolve short link "https://wiki.test/x/AbCdEf": status 404',
      )
    })

    test('throws when the resolved URL has no extractable pageId', async () => {
      const httpFetch = (): Promise<Response> => {
        const resp = jsonResponse({})
        Object.defineProperty(resp, 'url', { value: 'https://wiki.test/nowhere', configurable: true })
        return Promise.resolve(resp)
      }
      const client = new ConfluenceClient({ baseUrl, username, password, httpFetch })

      await expect(client.resolveShortLink('https://wiki.test/x/AbCdEf')).rejects.toThrow(
        'Could not extract pageId from resolved URL "https://wiki.test/nowhere"',
      )
    })
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
    pluginId: 'mcp-confluence',
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
      allowedHosts: new Set(['wiki.test']),
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
    username?: string | undefined
    password?: string | undefined
  } = {},
): PluginToolRuntimeContext {
  const notImplemented = (): Promise<never> => Promise.reject(new Error('not implemented'))

  const values: Record<string, string | undefined> = {
    base_url: 'baseUrl' in overrides ? overrides.baseUrl : 'https://wiki.test',
    username: 'username' in overrides ? overrides.username : 'u',
    password: 'password' in overrides ? overrides.password : 'p',
  }

  return {
    pluginId: 'mcp-confluence',
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
  } as PluginToolRuntimeContext
}

function createMockOptions(): ToolExecutionOptions {
  return {
    toolCallId: 'test-call-id',
    messages: [],
  }
}

describe('mcp-confluence plugin', () => {
  test('activates and registers all 5 Confluence tools', () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    expect([...registeredTools.keys()].sort()).toEqual(
      [
        'confluence_get_page',
        'confluence_get_page_by_title',
        'confluence_get_comments',
        'confluence_add_comment',
        'confluence_resolve_short_link',
      ].sort(),
    )
  })

  test('confluence_get_page returns the simplified page and calls the correct URL', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(
        new Response(JSON.stringify(rawPage), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('confluence_get_page')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ pageId: '810922884' }, runtimeCtx, options)

    expect(capturedUrl).toBe('https://wiki.test/rest/api/content/810922884?expand=body.storage,version,space')
    expect(result).toEqual(simplifyPage(rawPage))
  })

  test('returns not_configured when admin creds are missing', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('confluence_get_page')!
    const runtimeCtx = createMockRuntimeContext({ baseUrl: undefined })
    const options = createMockOptions()
    const result = await tool.execute({ pageId: '1' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'not_configured', message: 'Confluence is not configured' })
  })

  test('returns rate_limited when the rate limit is exceeded', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('confluence_get_page')!
    const runtimeCtx = createMockRuntimeContext({ allowed: false, retryAfterSec: 30 })
    const options = createMockOptions()
    const result = await tool.execute({ pageId: '1' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'rate_limited', retryAfterSec: 30 })
  })

  test('returns confluence_error when httpFetch throws a non-abort error', async () => {
    const httpFetch = (): Promise<Response> => Promise.reject(new Error('Connection refused'))

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('confluence_get_page')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ pageId: '1' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'confluence_error', message: 'Connection refused' })
  })

  test('returns timeout when httpFetch aborts', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    const httpFetch = (): Promise<Response> => Promise.reject(abortError)

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('confluence_get_page')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ pageId: '1' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'timeout', message: 'The operation was aborted' })
  })
})
