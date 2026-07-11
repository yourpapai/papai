// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { ToolExecutionOptions } from 'ai'

import { FigmaClient } from '../../plugins/mcp-figma/client.js'
import { parseIds, simplifyFigmaResponse } from '../../plugins/mcp-figma/format.js'
import factory from '../../plugins/mcp-figma/index.js'
import type { PluginContext, PluginLogger, PluginRegistration } from '../../src/plugins/context.js'
import type { PluginTool, PluginToolRuntimeContext } from '../../src/plugins/types.js'

interface CapturedRequest {
  url: string
  init: RequestInit | undefined
}

function mockHttpFetch(
  jsonBody: unknown,
  status = 200,
): { httpFetch: (url: string, init: RequestInit | undefined) => Promise<Response>; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = []
  const httpFetch = (url: string, init: RequestInit | undefined): Promise<Response> => {
    captured.push({ url, init })
    return Promise.resolve(new Response(JSON.stringify(jsonBody), { status }))
  }
  return { httpFetch, captured }
}

describe('mcp-figma simplify', () => {
  test('simplifies a GetFile shape: drops hidden nodes, rounds dimensions, keeps text style, no extra keys', () => {
    const apiResponse = {
      name: 'Doc',
      document: {
        name: 'D',
        children: [
          {
            id: '1:1',
            name: 'Frame',
            type: 'FRAME',
            visible: true,
            absoluteBoundingBox: { width: 100.126, height: 50 },
            layoutMode: 'VERTICAL',
            children: [
              {
                id: '1:2',
                name: 'Label',
                type: 'TEXT',
                characters: 'Hi',
                style: { fontFamily: 'Inter', fontSize: 14, fontWeight: 600, lineHeightPx: 20 },
              },
              {
                id: '1:3',
                name: 'Hidden',
                type: 'RECTANGLE',
                visible: false,
              },
            ],
          },
        ],
      },
    }

    expect(simplifyFigmaResponse(apiResponse)).toEqual({
      name: 'Doc',
      nodes: [
        {
          id: '1:1',
          name: 'Frame',
          type: 'FRAME',
          width: 100.13,
          height: 50,
          layoutMode: 'VERTICAL',
          children: [
            {
              id: '1:2',
              name: 'Label',
              type: 'TEXT',
              text: 'Hi',
              textStyle: { fontFamily: 'Inter', fontSize: 14, fontWeight: 600 },
            },
          ],
        },
      ],
    })
  })

  test('simplifies a GetFileNodes shape and maps VECTOR to IMAGE-SVG', () => {
    const apiResponse = {
      nodes: {
        '1:1': { document: { id: '1:1', name: 'N', type: 'VECTOR' } },
      },
    }

    expect(simplifyFigmaResponse(apiResponse)).toEqual({
      name: '',
      nodes: [{ id: '1:1', name: 'N', type: 'IMAGE-SVG' }],
    })
  })

  test('non-record input yields empty result', () => {
    expect(simplifyFigmaResponse(null)).toEqual({ name: '', nodes: [] })
    expect(simplifyFigmaResponse('x')).toEqual({ name: '', nodes: [] })
    expect(simplifyFigmaResponse(42)).toEqual({ name: '', nodes: [] })
  })

  test('GetFileNodes shape with empty nodes map yields empty result', () => {
    expect(simplifyFigmaResponse({ nodes: {} })).toEqual({ name: '', nodes: [] })
  })

  test('parseIds splits on commas/semicolons, trims, strips leading I, drops empties', () => {
    expect(parseIds('I1:2; 3:4 ,,5:6')).toEqual(['1:2', '3:4', '5:6'])
    expect(parseIds('')).toEqual([])
  })
})

describe('FigmaClient', () => {
  test('getFile sends X-Figma-Token + Accept headers and returns the simplified file', async () => {
    const apiResponse = {
      name: 'Doc',
      document: { name: 'D', children: [{ id: '1:1', name: 'Frame', type: 'FRAME', visible: true }] },
    }
    const { httpFetch, captured } = mockHttpFetch(apiResponse)
    const client = new FigmaClient({ token: 'tok', httpFetch })

    const result = await client.getFile('abc')

    expect(captured).toHaveLength(1)
    expect(captured[0]?.url).toBe('https://api.figma.com/v1/files/abc')
    const headers = new Headers(captured[0]?.init?.headers)
    expect(headers.get('X-Figma-Token')).toBe('tok')
    expect(headers.get('Accept')).toBe('application/json')
    expect(result).toEqual({
      name: 'Doc',
      nodes: [{ id: '1:1', name: 'Frame', type: 'FRAME' }],
    })
  })

  test('getFileNodes parses ids and builds the nodes URL', async () => {
    const { httpFetch, captured } = mockHttpFetch({ name: '', nodes: {} })
    const client = new FigmaClient({ token: 'tok', httpFetch })

    await client.getFileNodes('abc', 'I1:2;3:4')

    expect(captured[0]?.url).toBe('https://api.figma.com/v1/files/abc/nodes?ids=1%3A2,3%3A4')
  })

  test('getImages includes scale only for png with scale set, and returns raw json', async () => {
    const rawJson = { images: { '1:2': 'https://example.com/img.png' } }
    const { httpFetch: httpFetch1, captured: captured1 } = mockHttpFetch(rawJson)
    const client1 = new FigmaClient({ token: 'tok', httpFetch: httpFetch1 })

    const result1 = await client1.getImages('abc', '1:2', 'png', 2)

    expect(captured1[0]?.url).toBe('https://api.figma.com/v1/images/abc?ids=1%3A2&format=png&scale=2')
    expect(result1).toEqual(rawJson)

    const { httpFetch: httpFetch2, captured: captured2 } = mockHttpFetch(rawJson)
    const client2 = new FigmaClient({ token: 'tok', httpFetch: httpFetch2 })

    await client2.getImages('abc', '1:2', 'svg')

    expect(captured2[0]?.url).toBe('https://api.figma.com/v1/images/abc?ids=1%3A2&format=svg')
  })

  test('getFileStyles returns the styles array, or [] when absent', async () => {
    const { httpFetch: httpFetch1 } = mockHttpFetch({ styles: [{ key: 's' }] })
    const client1 = new FigmaClient({ token: 'tok', httpFetch: httpFetch1 })
    expect(await client1.getFileStyles('abc')).toEqual([{ key: 's' }])

    const { httpFetch: httpFetch2 } = mockHttpFetch({})
    const client2 = new FigmaClient({ token: 'tok', httpFetch: httpFetch2 })
    expect(await client2.getFileStyles('abc')).toEqual([])
  })

  test('getStyle builds the styles/:key URL and returns raw json', async () => {
    const rawJson = { key: 'S:x' }
    const { httpFetch, captured } = mockHttpFetch(rawJson)
    const client = new FigmaClient({ token: 'tok', httpFetch })

    const result = await client.getStyle('abc', 'S:x')

    expect(captured[0]?.url).toBe('https://api.figma.com/v1/files/abc/styles/S%3Ax')
    expect(result).toEqual(rawJson)
  })

  test('getComponents returns the components array, or [] when absent', async () => {
    const { httpFetch: httpFetch1 } = mockHttpFetch({ components: [1] })
    const client1 = new FigmaClient({ token: 'tok', httpFetch: httpFetch1 })
    expect(await client1.getComponents('abc')).toEqual([1])

    const { httpFetch: httpFetch2 } = mockHttpFetch({})
    const client2 = new FigmaClient({ token: 'tok', httpFetch: httpFetch2 })
    expect(await client2.getComponents('abc')).toEqual([])
  })

  test('getComments returns the comments array, or [] when absent', async () => {
    const { httpFetch: httpFetch1 } = mockHttpFetch({ comments: [2] })
    const client1 = new FigmaClient({ token: 'tok', httpFetch: httpFetch1 })
    expect(await client1.getComments('abc')).toEqual([2])

    const { httpFetch: httpFetch2 } = mockHttpFetch({})
    const client2 = new FigmaClient({ token: 'tok', httpFetch: httpFetch2 })
    expect(await client2.getComments('abc')).toEqual([])
  })

  test('percent-encodes path traversal attempts in fileKey', async () => {
    const { httpFetch, captured } = mockHttpFetch({})
    const client = new FigmaClient({ token: 'tok', httpFetch })

    await client.getFile('../../admin')

    expect(captured).toHaveLength(1)
    const url = new URL(captured[0]!.url)
    expect(url.pathname).toBe('/v1/files/..%2F..%2Fadmin')
    expect(url.pathname.startsWith('/v1/files/')).toBe(true)
  })

  test('rejects when the response is not ok', async () => {
    const { httpFetch } = mockHttpFetch({ error: 'nope' }, 403)
    const client = new FigmaClient({ token: 'tok', httpFetch })

    await expect(client.getFile('abc')).rejects.toThrow('Figma API 403 for /v1/files/abc')
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
    pluginId: 'mcp-figma',
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
      allowedHosts: new Set(['api.figma.com']),
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
    token?: string | undefined
  } = {},
): PluginToolRuntimeContext {
  const notImplemented = (): Promise<never> => Promise.reject(new Error('not implemented'))

  const token = 'token' in overrides ? overrides.token : 'tok'

  return {
    pluginId: 'mcp-figma',
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
      get: () => undefined,
    },
    contextConfig: {
      get: (key: string) => (key === 'token' ? token : undefined),
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

describe('mcp-figma plugin', () => {
  test('activates and registers all 7 Figma tools', () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    expect([...registeredTools.keys()].sort()).toEqual(
      [
        'figma_get_file',
        'figma_get_file_nodes',
        'figma_get_images',
        'figma_get_file_styles',
        'figma_get_style',
        'figma_get_components',
        'figma_get_comments',
      ].sort(),
    )
  })

  test('figma_get_file returns the simplified file and calls the correct URL', async () => {
    let capturedUrl = ''
    const apiResponse = {
      name: 'Doc',
      document: { name: 'D', children: [{ id: '1:1', name: 'Frame', type: 'FRAME', visible: true }] },
    }
    const httpFetch = (url: string): Promise<Response> => {
      capturedUrl = url
      return Promise.resolve(
        new Response(JSON.stringify(apiResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('figma_get_file')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ fileKey: 'abc' }, runtimeCtx, options)

    expect(capturedUrl).toBe('https://api.figma.com/v1/files/abc')
    expect(result).toEqual(simplifyFigmaResponse(apiResponse))
  })

  test('returns not_configured when the context token is missing', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('figma_get_file')!
    const runtimeCtx = createMockRuntimeContext({ token: undefined })
    const options = createMockOptions()
    const result = await tool.execute({ fileKey: 'abc' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'not_configured', message: 'Figma token is not configured' })
  })

  test('returns rate_limited when the rate limit is exceeded', async () => {
    const { ctx, registeredTools } = createMockContext()
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('figma_get_file')!
    const runtimeCtx = createMockRuntimeContext({ allowed: false, retryAfterSec: 30 })
    const options = createMockOptions()
    const result = await tool.execute({ fileKey: 'abc' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'rate_limited', retryAfterSec: 30 })
  })

  test('returns figma_error when httpFetch throws a non-abort error', async () => {
    const httpFetch = (): Promise<Response> => Promise.reject(new Error('Connection refused'))

    const { ctx, registeredTools } = createMockContext({ httpFetch })
    const instance = factory()
    instance.activate(ctx)

    const tool = registeredTools.get('figma_get_file')!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ fileKey: 'abc' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'figma_error', message: 'Connection refused' })
  })
})
