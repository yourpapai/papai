// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { ToolExecutionOptions } from 'ai'

import { SentryClient } from '../../plugins/mcp-sentry/client.js'
import { sanitizeObject } from '../../plugins/mcp-sentry/format.js'
import factory from '../../plugins/mcp-sentry/index.js'
import type { PluginContext, PluginLogger, PluginRegistration } from '../../src/plugins/context.js'
import type { PluginTool, PluginToolRuntimeContext } from '../../src/plugins/types.js'

describe('mcp-sentry sanitizeObject', () => {
  test('masks secret-ish keys, leaves others', () => {
    const input = { token: 'abc', name: 'Bob', inner: { password: 'p', ok: 1 } }
    expect(sanitizeObject(input)).toEqual({
      token: '[REDACTED]',
      name: 'Bob',
      inner: { password: '[REDACTED]', ok: 1 },
    })
  })

  test('does not mask a key literally named "key"', () => {
    expect(sanitizeObject({ key: 'keep-me', apikey: 'x' })).toEqual({ key: 'keep-me', apikey: '[REDACTED]' })
  })

  test('leaves falsy secret values as-is', () => {
    expect(sanitizeObject({ token: '', secret: 0 })).toEqual({ token: '', secret: 0 })
  })

  test('recurses through arrays', () => {
    expect(sanitizeObject([{ token: 'a' }, { name: 'b' }])).toEqual([{ token: '[REDACTED]' }, { name: 'b' }])
  })

  test('passes primitives through', () => {
    expect(sanitizeObject('hello')).toBe('hello')
    expect(sanitizeObject(42)).toBe(42)
    expect(sanitizeObject(null)).toBe(null)
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface RouteResponse {
  body: unknown
  status?: number
}

function createRoutedFetch(routes: Record<string, RouteResponse>): (url: string) => Promise<Response> {
  return (url: string): Promise<Response> => {
    const { pathname } = new URL(url)
    const route = routes[pathname]
    const found = route ?? { body: { error: `unexpected path ${pathname}` }, status: 404 }
    return Promise.resolve(jsonResponse(found.body, found.status ?? 200))
  }
}

describe('SentryClient', () => {
  const baseUrl = 'https://sentry.test'
  const token = 'tok'
  const orgSlug = 'acme'

  test('getIssue calls httpFetch with correct URL, headers, method', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const httpFetch = (url: string, init: RequestInit | undefined): Promise<Response> => {
      capturedUrl = url
      capturedInit = init
      return Promise.resolve(jsonResponse({ id: 'ABC-1' }))
    }
    const client = new SentryClient({ baseUrl, token, orgSlug, httpFetch })

    const result = await client.getIssue('ABC-1')

    expect(capturedUrl).toBe('https://sentry.test/api/0/issues/ABC-1/')
    expect(capturedInit?.method).toBe('GET')
    const headers = new Headers(capturedInit?.headers)
    expect(headers.get('Authorization')).toBe('Bearer tok')
    expect(headers.get('Accept')).toBe('application/json')
    expect(result).toEqual({ id: 'ABC-1' })
  })

  test('getIssue encodes a traversal-like issueId so the request stays under /api/0/issues/', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(jsonResponse({ id: 'x' }))
    }
    const client = new SentryClient({ baseUrl, token, orgSlug, httpFetch })

    await client.getIssue('../../organizations/acme/projects')

    expect(capturedUrl).toContain('issues/..%2F..%2Forganizations')
    expect(new URL(capturedUrl).pathname.startsWith('/api/0/issues/')).toBe(true)
  })

  test('getIssueTagValues encodes a traversal-like tagKey', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(jsonResponse([]))
    }
    const client = new SentryClient({ baseUrl, token, orgSlug, httpFetch })

    await client.getIssueTagValues('A', 'env/../x')

    const { pathname } = new URL(capturedUrl)
    expect(pathname).toBe('/api/0/issues/A/tags/env%2F..%2Fx/values/')
  })

  test('getProjects calls the org projects URL with no query params', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(jsonResponse([{ id: '1' }, { id: '2' }]))
    }
    const client = new SentryClient({ baseUrl, token, orgSlug, httpFetch })

    const result = await client.getProjects()

    expect(capturedUrl).toBe('https://sentry.test/api/0/organizations/acme/projects/')
    expect(result).toEqual([{ id: '1' }, { id: '2' }])
  })

  test('searchIssues sends sort and limit as query params', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(jsonResponse([]))
    }
    const client = new SentryClient({ baseUrl, token, orgSlug, httpFetch })

    await client.searchIssues({ sort: 'freq', limit: 5 })

    const parsed = new URL(capturedUrl)
    expect(parsed.pathname).toBe('/api/0/organizations/acme/issues/')
    expect(parsed.searchParams.get('sort')).toBe('freq')
    expect(parsed.searchParams.get('limit')).toBe('5')
  })

  test('sanitizes secrets in the returned payload', async () => {
    const httpFetch = (): Promise<Response> => Promise.resolve(jsonResponse({ id: 'ABC-1', token: 'super-secret' }))
    const client = new SentryClient({ baseUrl, token, orgSlug, httpFetch })

    const result = await client.getIssue('ABC-1')

    expect(result).toEqual({ id: 'ABC-1', token: '[REDACTED]' })
  })

  test('throws on non-2xx response', async () => {
    const httpFetch = (): Promise<Response> => Promise.resolve(jsonResponse({ detail: 'not found' }, 404))
    const client = new SentryClient({ baseUrl, token, orgSlug, httpFetch })

    await expect(client.getIssue('missing')).rejects.toThrow(/404/u)
  })

  test('getIssueDetails assembles composite payload and tolerates release failures', async () => {
    const httpFetch = createRoutedFetch({
      '/api/0/issues/X/': {
        body: { id: 'X', tags: [{ key: 'browser' }, { key: 'os' }], metadata: { release: 'v1.0.0' } },
      },
      '/api/0/issues/X/events/': { body: [{ id: 'ev1', release: 'v1.0.0' }] },
      '/api/0/issues/X/comments/': { body: [{ id: 'c1' }] },
      '/api/0/issues/X/tags/browser/values/': { body: [{ value: 'chrome' }] },
      '/api/0/issues/X/tags/os/values/': { body: [{ value: 'linux' }] },
      '/api/0/organizations/acme/releases/v1.0.0/': { body: { detail: 'server error' }, status: 500 },
      '/api/0/organizations/acme/releases/v1.0.0/commits/': { body: { detail: 'server error' }, status: 500 },
    })
    const client = new SentryClient({ baseUrl, token, orgSlug, httpFetch })

    const result = await client.getIssueDetails('X')

    expect(result).toHaveProperty('issue')
    expect(result).toHaveProperty('latestEvents')
    expect(result).toHaveProperty('tagValues')
    expect(result).toHaveProperty('comments')
    expect(result).toHaveProperty('suspectReleases')
    expect(result).toHaveProperty('releaseCommits')

    const details = result as {
      issue: unknown
      latestEvents: unknown
      tagValues: Record<string, unknown>
      comments: unknown
      suspectReleases: unknown[]
      releaseCommits: Array<{ version: string; commits: unknown }>
    }
    expect(details.tagValues['browser']).toEqual([{ value: 'chrome' }])
    expect(details.tagValues['os']).toEqual([{ value: 'linux' }])
    // release fetch failed -> excluded from suspectReleases
    expect(details.suspectReleases).toEqual([])
    // commits fetch failed -> [] for that version, but still present since collected regardless of release success
    expect(details.releaseCommits).toEqual([{ version: 'v1.0.0', commits: [] }])
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
    pluginId: 'mcp-sentry',
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
      allowedHosts: new Set(['sentry.test']),
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
    token?: string | undefined
    orgSlug?: string | undefined
  } = {},
): PluginToolRuntimeContext {
  const notImplemented = (): Promise<never> => Promise.reject(new Error('not implemented'))

  const values: Record<string, string | undefined> = {
    base_url: 'baseUrl' in overrides ? overrides.baseUrl : 'https://sentry.test',
    token: 'token' in overrides ? overrides.token : 'tok',
    org_slug: 'orgSlug' in overrides ? overrides.orgSlug : 'acme',
  }

  return {
    pluginId: 'mcp-sentry',
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

describe('mcp-sentry plugin', () => {
  test('activates and registers all 7 Sentry tools', () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    expect([...registeredTools.keys()].sort()).toEqual(
      [
        'sentry_get_projects',
        'sentry_search_issues',
        'sentry_get_issue',
        'sentry_get_issue_events',
        'sentry_get_issue_tag_values',
        'sentry_get_issue_comments',
        'sentry_get_issue_details',
      ].sort(),
    )
  })

  test('sentry_get_issue returns the sanitized issue and calls the correct URL', async () => {
    let capturedUrl = ''
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'ABC-1', token: 'super-secret' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('sentry_get_issue')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ issueId: 'ABC-1' }, runtimeCtx, options)

    expect(capturedUrl).toBe('https://sentry.test/api/0/issues/ABC-1/')
    expect(result).toEqual({ id: 'ABC-1', token: '[REDACTED]' })
  })

  test('returns not_configured when admin creds are missing', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('sentry_get_projects')!
    const runtimeCtx = createMockRuntimeContext({ baseUrl: undefined })
    const options = createMockOptions()
    const result = await tool.execute({}, runtimeCtx, options)

    expect(result).toEqual({ error: 'not_configured', message: 'Sentry is not configured' })
  })

  test('returns rate_limited when the rate limit is exceeded', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('sentry_get_projects')!
    const runtimeCtx = createMockRuntimeContext({ allowed: false, retryAfterSec: 30 })
    const options = createMockOptions()
    const result = await tool.execute({}, runtimeCtx, options)

    expect(result).toEqual({ error: 'rate_limited', retryAfterSec: 30 })
  })

  test('returns sentry_error when httpFetch throws a non-abort error', async () => {
    const httpFetch = (): Promise<Response> => Promise.reject(new Error('Connection refused'))

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('sentry_get_projects')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({}, runtimeCtx, options)

    expect(result).toEqual({ error: 'sentry_error', message: 'Connection refused' })
  })

  test('returns timeout when httpFetch aborts', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    const httpFetch = (): Promise<Response> => Promise.reject(abortError)

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('sentry_get_projects')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({}, runtimeCtx, options)

    expect(result).toEqual({ error: 'timeout', message: 'The operation was aborted' })
  })
})
