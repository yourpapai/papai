// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { McpEndpointConfig } from '../../src/mcp/types.js'
import type { McpClientHandle, UserEndpointDeps } from '../../src/mcp/user-endpoints.js'
import { parseMcpEndpoints, buildMcpToolSet } from '../../src/mcp/user-endpoints.js'

type GetOrCreateFn = UserEndpointDeps['getOrCreate']

function makeMockClient(
  tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> = [],
): McpClientHandle {
  return {
    listTools: mock(() => Promise.resolve({ tools })),
    callTool: mock(() => Promise.resolve({ content: [{ type: 'text', text: 'ok' }] })),
  }
}

const defaultTools = [
  { name: 'echo', description: 'Echo input', inputSchema: { type: 'object' as const, properties: {} } },
]

function makeDeps(overrides?: { getCachedConfig?: (userId: string, key: string) => string | null }): UserEndpointDeps {
  const getOrCreate: GetOrCreateFn = mock(() =>
    Promise.resolve({ hash: 'abc123', client: makeMockClient(defaultTools) }),
  )
  return {
    getCachedConfig: overrides?.getCachedConfig ?? mock(() => null as string | null),
    getOrCreate,
  }
}

function makeFailingGetOrCreate(failingId: string, goodClient: McpClientHandle): GetOrCreateFn {
  return (endpoint: McpEndpointConfig) =>
    endpoint.id === failingId
      ? Promise.reject(new Error('connection failed'))
      : Promise.resolve({ hash: 'abc', client: goodClient })
}

describe('parseMcpEndpoints', () => {
  test('returns empty array for null', () => {
    expect(parseMcpEndpoints(null)).toEqual([])
  })

  test('parses valid JSON array of endpoint configs', () => {
    const raw = JSON.stringify([{ id: 'test', url: 'https://example.com/mcp', enabled: true }])
    const result = parseMcpEndpoints(raw)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('test')
    expect(result[0]!.url).toBe('https://example.com/mcp')
  })

  test('returns empty array for invalid JSON', () => {
    expect(parseMcpEndpoints('not json')).toEqual([])
  })

  test('skips entries that fail schema validation', () => {
    const raw = JSON.stringify([
      { id: 'valid', url: 'https://example.com/mcp', enabled: true },
      { id: '', url: 'https://example.com/mcp' },
      { id: 'no-url' },
      { id: 'http-only', url: 'http://example.com/mcp' },
    ])
    const result = parseMcpEndpoints(raw)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('valid')
  })

  test('returns empty array for non-array JSON', () => {
    expect(parseMcpEndpoints(JSON.stringify({ id: 'test', url: 'https://example.com/mcp' }))).toEqual([])
  })
})

describe('buildMcpToolSet', () => {
  let deps: UserEndpointDeps

  beforeEach(() => {
    deps = makeDeps()
  })

  test('returns empty ToolSet when no endpoints configured', async () => {
    const result = await buildMcpToolSet('ctx-1', deps)
    expect(Object.keys(result)).toEqual([])
  })

  test('returns empty ToolSet when config is empty array', async () => {
    deps = makeDeps({ getCachedConfig: mock(() => '[]') })
    const result = await buildMcpToolSet('ctx-1', deps)
    expect(Object.keys(result)).toEqual([])
  })

  test('builds ToolSet from configured endpoints', async () => {
    const endpoints: McpEndpointConfig[] = [{ id: 'srv', url: 'https://example.com/mcp', enabled: true }]
    deps = makeDeps({ getCachedConfig: mock(() => JSON.stringify(endpoints)) })

    const result = await buildMcpToolSet('ctx-1', deps)

    expect(deps.getOrCreate).toHaveBeenCalledWith(endpoints[0])
    const keys = Object.keys(result)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toBe('mcp_srv__echo')
  })

  test('skips disabled endpoints', async () => {
    const endpoints: McpEndpointConfig[] = [{ id: 'srv', url: 'https://example.com/mcp', enabled: false }]
    deps = makeDeps({ getCachedConfig: mock(() => JSON.stringify(endpoints)) })

    const result = await buildMcpToolSet('ctx-1', deps)

    expect(deps.getOrCreate).not.toHaveBeenCalled()
    expect(Object.keys(result)).toEqual([])
  })

  test('skips endpoints where connection fails', async () => {
    const endpoints: McpEndpointConfig[] = [
      { id: 'bad', url: 'https://fail.example.com/mcp', enabled: true },
      { id: 'good', url: 'https://example.com/mcp', enabled: true },
    ]
    deps = makeDeps({ getCachedConfig: mock(() => JSON.stringify(endpoints)) })
    const goodClient = makeMockClient(defaultTools)
    deps.getOrCreate = mock(makeFailingGetOrCreate('bad', goodClient))

    const result = await buildMcpToolSet('ctx-1', deps)

    const keys = Object.keys(result)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toBe('mcp_good__echo')
  })

  test('merges tools from multiple endpoints', async () => {
    const toolA = [{ name: 'tool-a', description: 'A', inputSchema: { type: 'object' as const, properties: {} } }]
    let hashCounter = 0
    deps = makeDeps({
      getCachedConfig: mock(() =>
        JSON.stringify([
          { id: 'srv1', url: 'https://a.example.com/mcp', enabled: true },
          { id: 'srv2', url: 'https://b.example.com/mcp', enabled: true },
        ] as McpEndpointConfig[]),
      ),
    })
    deps.getOrCreate = mock((() => {
      hashCounter++
      return Promise.resolve({ hash: `h${hashCounter}`, client: makeMockClient(toolA) })
    }) as GetOrCreateFn)

    const result = await buildMcpToolSet('ctx-1', deps)

    const keys = Object.keys(result)
    expect(keys).toHaveLength(2)
    expect(keys).toContain('mcp_srv1__tool-a')
    expect(keys).toContain('mcp_srv2__tool-a')
  })
})
