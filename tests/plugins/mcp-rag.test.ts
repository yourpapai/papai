// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { ToolExecutionOptions } from 'ai'

import { RagClient } from '../../plugins/mcp-rag/client.js'
import {
  dedupeDocuments,
  formatDocuments,
  formatFailures,
  parseContextCodes,
  parseSources,
} from '../../plugins/mcp-rag/format.js'
import factory from '../../plugins/mcp-rag/index.js'
import type { PluginContext, PluginLogger, PluginRegistration } from '../../src/plugins/context.js'
import type { PluginTool, PluginToolRuntimeContext } from '../../src/plugins/types.js'

describe('mcp-rag format', () => {
  test('parseContextCodes trims, splits on semicolon, and drops empties', () => {
    expect(parseContextCodes('a; b ;;c')).toEqual(['a', 'b', 'c'])
    expect(parseContextCodes('')).toEqual([])
  })

  test('parseSources trims, splits on comma, and drops empties', () => {
    expect(parseSources('x, y ,,z')).toEqual(['x', 'y', 'z'])
    expect(parseSources(undefined)).toEqual([])
    expect(parseSources('')).toEqual([])
  })

  test('dedupeDocuments keeps first-wins by document_id/url and never collapses keyless docs', () => {
    const result = dedupeDocuments([
      { document_id: '1', title: 'A' },
      { document_id: '1', title: 'A2' },
      { url: 'u', title: 'B' },
      { title: 'C' },
      { title: 'D' },
    ])
    expect(result).toHaveLength(4)
    const kept = result.find((doc) => doc.document_id === '1')
    expect(kept?.title).toBe('A')
    expect(result.some((doc) => doc.title === 'C')).toBe(true)
    expect(result.some((doc) => doc.title === 'D')).toBe(true)
  })

  test('formatDocuments returns fallback message for empty list', () => {
    expect(formatDocuments([])).toBe('No documents found.')
  })

  test('formatDocuments includes title, url, and source line when present', () => {
    const output = formatDocuments([{ title: 'T', url: 'http://x', source: 'youtrack', source_type: 'issue' }])
    expect(output).toContain('Found 1 documents:')
    expect(output).toContain('1. T')
    expect(output).toContain('http://x')
    expect(output).toContain('source: youtrack/issue')
  })

  test('formatDocuments omits source line when absent and falls back for missing title/url', () => {
    const output = formatDocuments([{ title: 'T2', url: 'http://y' }, { url: 'http://z' }, { document_id: 'D9' }])
    expect(output).not.toContain('source:')
    expect(output).toContain('(untitled)')
    expect(output).toContain('D9')
  })

  test('formatFailures returns empty string for no failures', () => {
    expect(formatFailures([])).toBe('')
  })

  test('formatFailures joins context code and error for each failure', () => {
    const output = formatFailures([
      { contextCode: 'c1', error: 'boom' },
      { contextCode: 'c2', error: 'nope' },
    ])
    expect(output).toContain('c1')
    expect(output).toContain('boom')
    expect(output).toContain('c2')
    expect(output).toContain('nope')
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createRoutedHttpFetch(
  routes: Record<string, Response>,
  calls: Array<{ url: string; init: RequestInit | undefined }>,
): (url: string, init: RequestInit | undefined) => Promise<Response> {
  return (url: string, init: RequestInit | undefined): Promise<Response> => {
    calls.push({ url, init })
    const pathname = new URL(url).pathname
    const found = routes[pathname]
    return Promise.resolve(found ?? jsonResponse({ error: `unexpected path ${pathname}` }, 404))
  }
}

describe('RagClient', () => {
  const baseUrl = 'https://rag.test'

  test('search fires one POST per context code with X-Kontur-ApiKey auth and a JSON body', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const routes: Record<string, Response> = {
      '/v1/rag_contexts/c1/search-queries': jsonResponse({ documents: [] }),
      '/v1/rag_contexts/c2/search-queries': jsonResponse({ documents: [] }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new RagClient({ baseUrl, apiKey: 'k', contextCodes: ['c1', 'c2'], sources: ['s1'], httpFetch })

    await client.search('hello')

    expect(calls).toHaveLength(2)
    const urls = calls.map((call) => call.url).sort()
    expect(urls).toEqual([
      'https://rag.test/v1/rag_contexts/c1/search-queries',
      'https://rag.test/v1/rag_contexts/c2/search-queries',
    ])
    for (const call of calls) {
      expect(call.init?.method).toBe('POST')
      const headers = new Headers(call.init?.headers)
      expect(headers.get('X-Kontur-ApiKey')).toBe('k')
      expect(headers.get('Content-Type')).toBe('application/json')
      expect(call.init?.body).toBe(JSON.stringify({ query: 'hello', sources: ['s1'] }))
    }
  })

  test('merges documents from every context when all succeed', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const routes: Record<string, Response> = {
      '/v1/rag_contexts/c1/search-queries': jsonResponse({ documents: [{ document_id: '1', title: 'A' }] }),
      '/v1/rag_contexts/c2/search-queries': jsonResponse({ documents: [{ document_id: '2', title: 'B' }] }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new RagClient({ baseUrl, apiKey: 'k', contextCodes: ['c1', 'c2'], sources: ['s1'], httpFetch })

    const result = await client.search('hello')

    expect(result.documents).toHaveLength(2)
    expect(result.documents.some((doc) => doc.document_id === '1')).toBe(true)
    expect(result.documents.some((doc) => doc.document_id === '2')).toBe(true)
    expect(result.failures).toEqual([])
  })

  test('a single context failure does not throw, is collected in failures, and other contexts still contribute documents', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const routes: Record<string, Response> = {
      '/v1/rag_contexts/c1/search-queries': jsonResponse({ documents: [{ document_id: '1', title: 'A' }] }),
      '/v1/rag_contexts/c2/search-queries': jsonResponse({ error: 'boom' }, 500),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new RagClient({ baseUrl, apiKey: 'k', contextCodes: ['c1', 'c2'], sources: ['s1'], httpFetch })

    const result = await client.search('hello')

    expect(result.documents).toEqual([{ document_id: '1', title: 'A' }])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.contextCode).toBe('c2')
    expect(result.failures[0]?.error).toContain('500')
  })

  test('URL-encodes a path-traversal-like context code in the request path', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const routes: Record<string, Response> = {
      '/v1/rag_contexts/..%2F..%2Fx/search-queries': jsonResponse({ documents: [] }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new RagClient({ baseUrl, apiKey: 'k', contextCodes: ['../../x'], sources: ['s1'], httpFetch })

    await client.search('hello')

    expect(calls[0]?.url).toBe('https://rag.test/v1/rag_contexts/..%2F..%2Fx/search-queries')
  })

  test('a response with a missing or non-array documents field contributes no documents without throwing', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const routes: Record<string, Response> = {
      '/v1/rag_contexts/c1/search-queries': jsonResponse({}),
      '/v1/rag_contexts/c2/search-queries': jsonResponse({ documents: 'nope' }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new RagClient({ baseUrl, apiKey: 'k', contextCodes: ['c1', 'c2'], sources: ['s1'], httpFetch })

    const result = await client.search('hello')

    expect(result.documents).toEqual([])
    expect(result.failures).toEqual([])
  })

  test('only known string fields are picked into each RagDocument, dropping unrelated fields', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const routes: Record<string, Response> = {
      '/v1/rag_contexts/c1/search-queries': jsonResponse({
        documents: [{ document_id: '1', title: 'A', extra: 'drop', score: 5 }],
      }),
    }
    const httpFetch = createRoutedHttpFetch(routes, calls)
    const client = new RagClient({ baseUrl, apiKey: 'k', contextCodes: ['c1'], sources: ['s1'], httpFetch })

    const result = await client.search('hello')
    const [doc] = result.documents

    expect(doc).toEqual({ document_id: '1', title: 'A' })
    expect(Object.hasOwn(doc!, 'extra')).toBe(false)
    expect(Object.hasOwn(doc!, 'score')).toBe(false)
  })
})

function requireString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('expected a string result')
  }
  return value
}

function createMockLogger(): PluginLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }
}

function createMockContext(
  overrides: {
    httpFetch?: (url: string, init?: RequestInit) => Promise<Response>
    sourceDescription?: string
  } = {},
): {
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
    pluginId: 'mcp-rag',
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
      allowedHosts: new Set(['rag.test']),
      logger: createMockLogger(),
    },
    adminConfig: {
      get: (key: string) => (key === 'source_description' ? overrides.sourceDescription : undefined),
    },
  }

  return { ctx, registeredTools }
}

function createMockRuntimeContext(
  overrides: {
    allowed?: boolean
    retryAfterSec?: number
    baseUrl?: string | undefined
    apiKey?: string | undefined
    contextCode?: string | undefined
    sources?: string | undefined
  } = {},
): PluginToolRuntimeContext {
  const notImplemented = (): Promise<never> => Promise.reject(new Error('not implemented'))

  const values: Record<string, string | undefined> = {
    base_url: 'baseUrl' in overrides ? overrides.baseUrl : 'https://rag.test',
    api_key: 'apiKey' in overrides ? overrides.apiKey : 'k',
    context_code: 'contextCode' in overrides ? overrides.contextCode : 'c1',
    sources: 'sources' in overrides ? overrides.sources : undefined,
  }

  return {
    pluginId: 'mcp-rag',
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

const BASE_TOOL_DESCRIPTION =
  'Search a corporate knowledge base (RAG service) by natural-language query. ' +
  'Returns matching documents (title, link, source). Sources and context are fixed in the server config.'

describe('mcp-rag plugin', () => {
  test('activates and registers exactly 1 tool named rag_search', () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    expect([...registeredTools.keys()]).toEqual(['rag_search'])
  })

  test('description is base + operator source_description when configured', () => {
    const { ctx, registeredTools } = createMockContext({ sourceDescription: 'Covers Team X docs.' })
    const instance = factory()
    instance.activate(ctx)

    const description = registeredTools.get('rag_search')!.description
    expect(description.startsWith(BASE_TOOL_DESCRIPTION)).toBe(true)
    expect(description.endsWith('Covers Team X docs.')).toBe(true)
  })

  test('description is just the base string when source_description is not configured', () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    expect(registeredTools.get('rag_search')!.description).toBe(BASE_TOOL_DESCRIPTION)
  })

  test('rag_search returns formatted documents on success', async () => {
    const httpFetch = (): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify({ documents: [{ document_id: '1', title: 'A' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('rag_search')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ query: 'hello' }, runtimeCtx, options)

    expect(typeof result).toBe('string')
    const text = requireString(result)
    expect(text).toContain('Found 1 documents:')
    expect(text).toContain('A')
  })

  test('returns not_configured when admin creds are missing', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('rag_search')!
    const runtimeCtx = createMockRuntimeContext({ baseUrl: undefined })
    const options = createMockOptions()
    const result = await tool.execute({ query: 'hello' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'not_configured', message: 'RAG is not configured' })
  })

  test('returns rate_limited when the rate limit is exceeded', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('rag_search')!
    const runtimeCtx = createMockRuntimeContext({ allowed: false, retryAfterSec: 30 })
    const options = createMockOptions()
    const result = await tool.execute({ query: 'hello' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'rate_limited', retryAfterSec: 30 })
  })
})
