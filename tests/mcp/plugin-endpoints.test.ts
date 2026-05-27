// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { PluginMcpDescriptor } from '../../src/mcp/plugin-endpoints.js'
import { buildPluginMcpToolSet } from '../../src/mcp/plugin-endpoints.js'
import type { McpPluginConfig } from '../../src/mcp/types.js'

type MockClient = {
  listTools: ReturnType<typeof mock>
  callTool: ReturnType<typeof mock>
}

function makeMockClient(
  tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> = [],
): MockClient {
  return {
    listTools: mock(() => Promise.resolve({ tools })),
    callTool: mock(() => Promise.resolve({ content: [{ type: 'text', text: 'ok' }] })),
  }
}

type PoolEntry = { hash: string; client: MockClient }

function makeMockPool(): {
  getOrCreateFromPlugin: (pluginId: string, mcp: McpPluginConfig) => Promise<PoolEntry>
} {
  return {
    getOrCreateFromPlugin: mock((_pluginId: string, _mcp: McpPluginConfig) =>
      Promise.resolve({ hash: 'h1', client: makeMockClient([{ name: 'greet', description: 'Say hello' }]) }),
    ),
  }
}

const httpMcp: McpPluginConfig = { transport: 'streamable-http', url: 'https://example.com/mcp' }

function descriptor(overrides?: Partial<PluginMcpDescriptor>): PluginMcpDescriptor {
  return {
    mcp: overrides?.mcp ?? httpMcp,
    configRequirements: overrides?.configRequirements ?? [],
    configValues: overrides?.configValues,
  }
}

describe('buildPluginMcpToolSet', () => {
  test('returns empty ToolSet when no active plugins', async () => {
    const pool = makeMockPool()
    const result = await buildPluginMcpToolSet([], new Map(), pool)
    expect(Object.keys(result)).toEqual([])
  })

  test('returns empty ToolSet when no plugins have mcp config', async () => {
    const pool = makeMockPool()
    const descriptors = new Map<string, PluginMcpDescriptor>()
    const result = await buildPluginMcpToolSet(['plug-a'], descriptors, pool)
    expect(Object.keys(result)).toEqual([])
  })

  test('builds ToolSet from a plugin with mcp config', async () => {
    const pool = makeMockPool()
    const descriptors = new Map<string, PluginMcpDescriptor>([['plug-a', descriptor()]])

    const result = await buildPluginMcpToolSet(['plug-a'], descriptors, pool)

    expect(pool.getOrCreateFromPlugin).toHaveBeenCalledWith('plug-a', httpMcp)
    const keys = Object.keys(result)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toBe('plugin_plug-a__greet')
  })

  test('resolves ${VAR} placeholders in headers', async () => {
    const pool = makeMockPool()
    const mcp: McpPluginConfig = {
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer ${API_TOKEN}' },
    }
    const desc: PluginMcpDescriptor = {
      mcp,
      configRequirements: [{ key: 'api_token', label: 'API Token', required: true }],
      configValues: { api_token: 'secret-123' },
    }
    const descriptors = new Map<string, PluginMcpDescriptor>([['plug-a', desc]])

    await buildPluginMcpToolSet(['plug-a'], descriptors, pool)

    expect(pool.getOrCreateFromPlugin).toHaveBeenCalledWith('plug-a', {
      ...mcp,
      headers: { Authorization: 'Bearer secret-123' },
    })
  })

  test('resolves ${VAR} placeholders in env', async () => {
    const pool = makeMockPool()
    const mcp: McpPluginConfig = {
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      env: { TOKEN: '${MY_TOKEN}' },
    }
    const desc: PluginMcpDescriptor = {
      mcp,
      configRequirements: [{ key: 'my_token', label: 'My Token', required: true }],
      configValues: { my_token: 'tok-456' },
    }
    const descriptors = new Map<string, PluginMcpDescriptor>([['plug-a', desc]])

    await buildPluginMcpToolSet(['plug-a'], descriptors, pool)

    expect(pool.getOrCreateFromPlugin).toHaveBeenCalledWith('plug-a', {
      ...mcp,
      env: { TOKEN: 'tok-456' },
    })
  })

  test('skips plugin with missing required config values', async () => {
    const pool = makeMockPool()
    const mcp: McpPluginConfig = {
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer ${API_TOKEN}' },
    }
    const desc: PluginMcpDescriptor = {
      mcp,
      configRequirements: [{ key: 'api_token', label: 'API Token', required: true }],
      // no configValues provided
    }
    const descriptors = new Map<string, PluginMcpDescriptor>([['plug-a', desc]])

    const result = await buildPluginMcpToolSet(['plug-a'], descriptors, pool)

    expect(pool.getOrCreateFromPlugin).not.toHaveBeenCalled()
    expect(Object.keys(result)).toEqual([])
  })

  test('skips plugin when non-required config value is missing', async () => {
    const pool = makeMockPool()
    const mcp: McpPluginConfig = {
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer ${API_TOKEN}' },
    }
    const desc: PluginMcpDescriptor = {
      mcp,
      configRequirements: [{ key: 'api_token', label: 'API Token', required: false }],
      // no configValues provided — placeholder can't be resolved
    }
    const descriptors = new Map<string, PluginMcpDescriptor>([['plug-a', desc]])

    const result = await buildPluginMcpToolSet(['plug-a'], descriptors, pool)

    expect(pool.getOrCreateFromPlugin).not.toHaveBeenCalled()
    expect(Object.keys(result)).toEqual([])
  })

  test('applies toolFilter from plugin mcp config', async () => {
    const pool = makeMockPool()
    const tools = [
      { name: 'alpha', description: 'A' },
      { name: 'beta', description: 'B' },
      { name: 'gamma', description: 'C' },
    ]
    pool.getOrCreateFromPlugin = mock(() => Promise.resolve({ hash: 'h1', client: makeMockClient(tools) }))
    const mcp: McpPluginConfig = {
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      toolFilter: { allow: ['alpha', 'gamma'] },
    }
    const descriptors = new Map<string, PluginMcpDescriptor>([['plug-a', descriptor({ mcp })]])

    const result = await buildPluginMcpToolSet(['plug-a'], descriptors, pool)

    const keys = Object.keys(result).sort()
    expect(keys).toEqual(['plugin_plug-a__alpha', 'plugin_plug-a__gamma'])
  })

  test('gracefully skips plugin that fails to connect', async () => {
    const pool = makeMockPool()
    pool.getOrCreateFromPlugin = mock(() => Promise.reject(new Error('connection refused')))

    const descriptors = new Map<string, PluginMcpDescriptor>([['plug-a', descriptor()]])

    const result = await buildPluginMcpToolSet(['plug-a'], descriptors, pool)

    expect(Object.keys(result)).toEqual([])
  })

  test('merges tools from multiple plugins', async () => {
    const pool = makeMockPool()
    let hashCounter = 0
    pool.getOrCreateFromPlugin = mock((_pluginId: string) => {
      hashCounter++
      return Promise.resolve({
        hash: `h${hashCounter}`,
        client: makeMockClient([{ name: 'tool-x', description: 'X' }]),
      })
    })

    const descriptors = new Map<string, PluginMcpDescriptor>([
      ['plug-a', descriptor()],
      ['plug-b', descriptor()],
    ])

    const result = await buildPluginMcpToolSet(['plug-a', 'plug-b'], descriptors, pool)

    const keys = Object.keys(result).sort()
    expect(keys).toEqual(['plugin_plug-a__tool-x', 'plugin_plug-b__tool-x'])
  })
})
