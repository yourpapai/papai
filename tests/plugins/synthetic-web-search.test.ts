// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { ToolExecutionOptions } from 'ai'

import factory from '../../plugins/synthetic-web-search/index.js'
import type { PluginContext, PluginLogger, PluginRegistration } from '../../src/plugins/context.js'
import type { PluginPromptFragment, PluginTool, PluginToolRuntimeContext } from '../../src/plugins/types.js'

function createMockLogger(): PluginLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }
}

function createMockContext(
  overrides: { apiKey?: string; httpFetch?: (url: string, init?: RequestInit) => Promise<Response> } = {},
): {
  ctx: PluginContext
  registeredTool: { value: PluginTool | undefined }
  registeredFragment: { value: PluginPromptFragment | undefined }
} {
  const registeredTool: { value: PluginTool | undefined } = { value: undefined }
  const registeredFragment: { value: PluginPromptFragment | undefined } = { value: undefined }

  const registration: PluginRegistration = {
    registerTool: (tool: PluginTool) => {
      registeredTool.value = tool
    },
    registerPromptFragment: (fragment: PluginPromptFragment) => {
      registeredFragment.value = fragment
    },
    registerCommand: () => {},
    registerScheduledJob: () => {},
    registerTaskProviderType: () => {},
  }

  const ctx: PluginContext = {
    pluginId: 'synthetic-web-search',
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
      allowedHosts: new Set(['api.synthetic.new']),
      logger: createMockLogger(),
    },
    adminConfig: {
      get: (key: string) =>
        key === 'api_key' ? ('apiKey' in overrides ? overrides.apiKey : 'test-api-key') : undefined,
    },
  }

  return { ctx, registeredTool, registeredFragment }
}

function createMockRuntimeContext(
  overrides: { allowed?: boolean; retryAfterSec?: number } = {},
): PluginToolRuntimeContext {
  const notImplemented = (): Promise<never> => Promise.reject(new Error('not implemented'))

  return {
    pluginId: 'synthetic-web-search',
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
  }
}

function createMockOptions(): ToolExecutionOptions {
  return {
    toolCallId: 'test-call-id',
    messages: [],
  }
}

describe('synthetic-web-search plugin', () => {
  test('activates and registers search tool and web-search-hint prompt fragment', () => {
    const { ctx, registeredTool, registeredFragment } = createMockContext()
    const instance = factory()
    void instance.activate(ctx)

    expect(registeredTool.value).toBeDefined()
    expect(registeredTool.value!.name).toBe('search')
    expect(registeredTool.value!.description).toContain('search engine')

    expect(registeredFragment.value).toBeDefined()
    expect(registeredFragment.value!.name).toBe('web-search-hint')
    expect(typeof registeredFragment.value!.content).toBe('string')
  })

  test('search tool returns results from API', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { url: 'https://example.com/1', title: 'Result 1', text: 'Text 1' },
            { url: 'https://example.com/2', title: 'Result 2', text: 'Text 2', published: '2026-01-01' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const tool = registeredTool.value!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ query: 'test query' }, runtimeCtx, options)

    expect(mockHttpFetch).toHaveBeenCalledWith(
      'https://api.synthetic.new/v2/search',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-api-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'test query' }),
      }),
    )

    expect(result).toEqual({
      results: [
        { url: 'https://example.com/1', title: 'Result 1', text: 'Text 1', published: undefined },
        { url: 'https://example.com/2', title: 'Result 2', text: 'Text 2', published: '2026-01-01' },
      ],
    })
  })

  test('search tool returns rate_limited error when rate limit exceeded', async () => {
    const { ctx, registeredTool } = createMockContext()
    const instance = factory()
    void instance.activate(ctx)

    const tool = registeredTool.value!
    const runtimeCtx = createMockRuntimeContext({ allowed: false, retryAfterSec: 30 })
    const options = createMockOptions()
    const result = await tool.execute({ query: 'test query' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'rate_limited', retryAfterSec: 30 })
  })

  test('search tool returns single result when index is specified', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { url: 'https://example.com/1', title: 'Result 1', text: 'Text 1' },
            { url: 'https://example.com/2', title: 'Result 2', text: 'Text 2' },
            { url: 'https://example.com/3', title: 'Result 3', text: 'Text 3' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const tool = registeredTool.value!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ query: 'test query', index: 1 }, runtimeCtx, options)

    expect(result).toEqual({
      results: [{ url: 'https://example.com/2', title: 'Result 2', text: 'Text 2', published: undefined }],
    })
  })

  test('search tool returns index_out_of_range error when index exceeds results length', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ url: 'https://example.com/1', title: 'Result 1', text: 'Text 1' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const tool = registeredTool.value!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ query: 'test query', index: 5 }, runtimeCtx, options)

    expect(result).toEqual({
      error: 'index_out_of_range',
      message: 'Index 5 is out of range (only 1 result available)',
    })
  })

  test('search tool returns api_error when API returns non-200 status', async () => {
    const mockHttpFetch = mock().mockResolvedValue(new Response('Unauthorized', { status: 401 }))

    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const tool = registeredTool.value!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ query: 'test query' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'api_error', status: 401, message: 'Unauthorized' })
  })

  test('search tool returns empty results array when API returns no results', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )

    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const tool = registeredTool.value!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ query: 'test query' }, runtimeCtx, options)

    expect(result).toEqual({ results: [] })
  })

  test('search tool returns not_configured error when API key is missing', async () => {
    const { ctx, registeredTool } = createMockContext({ apiKey: undefined })
    const instance = factory()
    void instance.activate(ctx)

    const tool = registeredTool.value!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ query: 'test query' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'not_configured', message: 'Synthetic API key is not configured' })
  })

  test('search tool truncates result text when max_length is specified', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { url: 'https://example.com/1', title: 'Result 1', text: 'A'.repeat(100) },
            { url: 'https://example.com/2', title: 'Result 2', text: 'B'.repeat(100) },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const tool = registeredTool.value!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ query: 'test query', max_length: 20 }, runtimeCtx, options)

    expect(result).toEqual({
      results: [
        { title: 'Result 1', url: 'https://example.com/1', text: 'AAAAAAAAAA...', published: undefined },
        { title: 'Result 2', url: 'https://example.com/2', text: 'BBBBBBBBBB...', published: undefined },
      ],
    })
  })

  test('search tool returns timeout error on AbortError', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    const mockHttpFetch = mock().mockRejectedValue(abortError)

    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const tool = registeredTool.value!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ query: 'test query' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'timeout', message: 'The operation was aborted' })
  })

  test('search tool returns network_error on fetch failure', async () => {
    const mockHttpFetch = mock().mockRejectedValue(new Error('Connection refused'))

    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const tool = registeredTool.value!
    const runtimeCtx = createMockRuntimeContext()
    const options = createMockOptions()
    const result = await tool.execute({ query: 'test query' }, runtimeCtx, options)

    expect(result).toEqual({ error: 'network_error', message: 'Connection refused' })
  })
})
