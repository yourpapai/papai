// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { McpToolDef } from '../../src/mcp/tool-adapter.js'
import { convertMcpToolsToToolSet } from '../../src/mcp/tool-adapter.js'
import type { McpToolFilter } from '../../src/mcp/types.js'
import { getToolExecutor } from '../utils/test-helpers.js'

type MockClient = {
  callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<{
    content: Array<{ type: string; text?: string }>
    isError?: boolean
  }>
}

function makeMockClient(overrides?: { callTool?: ReturnType<typeof mock> }): MockClient {
  return {
    callTool: overrides?.callTool ?? mock(() => Promise.resolve({ content: [{ type: 'text', text: 'ok' }] })),
  }
}

describe('convertMcpToolsToToolSet', () => {
  test('converts single MCP tool to namespaced ToolSet entry', () => {
    const tools: McpToolDef[] = [{ name: 'greet', description: 'Say hello' }]
    const client = makeMockClient()

    const result = convertMcpToolsToToolSet('my-server', tools, client)

    expect(Object.keys(result)).toEqual(['mcp_my-server__greet'])
    expect(result['mcp_my-server__greet']).toBeDefined()
    expect(result['mcp_my-server__greet']!.description).toBe('Say hello')
  })

  test('namespaces multiple tools', () => {
    const tools: McpToolDef[] = [
      { name: 'greet', description: 'Say hello' },
      { name: 'farewell', description: 'Say goodbye' },
    ]
    const client = makeMockClient()

    const result = convertMcpToolsToToolSet('srv', tools, client)

    expect(Object.keys(result).sort()).toEqual(['mcp_srv__farewell', 'mcp_srv__greet'])
  })

  describe('toolFilter', () => {
    test('allow filter includes only listed tools', () => {
      const tools: McpToolDef[] = [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }]
      const client = makeMockClient()
      const filter: McpToolFilter = { allow: ['alpha', 'gamma'] }

      const result = convertMcpToolsToToolSet('srv', tools, client, filter)

      expect(Object.keys(result).sort()).toEqual(['mcp_srv__alpha', 'mcp_srv__gamma'])
    })

    test('deny filter excludes listed tools', () => {
      const tools: McpToolDef[] = [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }]
      const client = makeMockClient()
      const filter: McpToolFilter = { deny: ['beta'] }

      const result = convertMcpToolsToToolSet('srv', tools, client, filter)

      expect(Object.keys(result).sort()).toEqual(['mcp_srv__alpha', 'mcp_srv__gamma'])
    })

    test('returns empty ToolSet when allow filter matches nothing', () => {
      const tools: McpToolDef[] = [{ name: 'alpha' }]
      const client = makeMockClient()
      const filter: McpToolFilter = { allow: ['nonexistent'] }

      const result = convertMcpToolsToToolSet('srv', tools, client, filter)

      expect(Object.keys(result)).toEqual([])
    })

    test('returns all tools when filter is undefined', () => {
      const tools: McpToolDef[] = [{ name: 'alpha' }, { name: 'beta' }]
      const client = makeMockClient()

      const result = convertMcpToolsToToolSet('srv', tools, client)

      expect(Object.keys(result).sort()).toEqual(['mcp_srv__alpha', 'mcp_srv__beta'])
    })
  })

  describe('execute', () => {
    test('calls callTool with correct name and args', async () => {
      const callTool = mock(() => Promise.resolve({ content: [{ type: 'text', text: 'result' }] }))
      const tools: McpToolDef[] = [{ name: 'greet' }]
      const client: MockClient = { callTool }

      const result = convertMcpToolsToToolSet('srv', tools, client)
      const execute = getToolExecutor(result['mcp_srv__greet']!)

      await execute({ name: 'World' })

      expect(callTool).toHaveBeenCalledWith({
        name: 'greet',
        arguments: { name: 'World' },
      })
    })

    test('returns text content from callTool result', async () => {
      const callTool = mock(() =>
        Promise.resolve({
          content: [{ type: 'text', text: 'hello world' }],
        }),
      )
      const tools: McpToolDef[] = [{ name: 'greet' }]
      const client: MockClient = { callTool }

      const result = convertMcpToolsToToolSet('srv', tools, client)
      const execute = getToolExecutor(result['mcp_srv__greet']!)

      const output: unknown = await execute({})

      expect(output).toBe('hello world')
    })

    test('concatenates multiple text content blocks', async () => {
      const callTool = mock(() =>
        Promise.resolve({
          content: [
            { type: 'text', text: 'part1' },
            { type: 'text', text: 'part2' },
          ],
        }),
      )
      const tools: McpToolDef[] = [{ name: 'multi' }]
      const client: MockClient = { callTool }

      const result = convertMcpToolsToToolSet('srv', tools, client)
      const execute = getToolExecutor(result['mcp_srv__multi']!)

      const output: unknown = await execute({})

      expect(output).toBe('part1\npart2')
    })

    test('returns error object when isError is true', async () => {
      const callTool = mock(() =>
        Promise.resolve({
          content: [{ type: 'text', text: 'something went wrong' }],
          isError: true,
        }),
      )
      const tools: McpToolDef[] = [{ name: 'fail' }]
      const client: MockClient = { callTool }

      const result = convertMcpToolsToToolSet('srv', tools, client)
      const execute = getToolExecutor(result['mcp_srv__fail']!)

      const output: unknown = await execute({})

      expect(output).toEqual({ error: 'something went wrong' })
    })

    test('returns error object when callTool throws', async () => {
      const callTool = mock(() => Promise.reject(new Error('network timeout')))
      const tools: McpToolDef[] = [{ name: 'flaky' }]
      const client: MockClient = { callTool }

      const result = convertMcpToolsToToolSet('srv', tools, client)
      const execute = getToolExecutor(result['mcp_srv__flaky']!)

      const output: unknown = await execute({})

      expect(output).toEqual({ error: 'network timeout' })
    })
  })

  describe('inputSchema', () => {
    test('uses provided inputSchema', () => {
      const schema = {
        type: 'object' as const,
        properties: { name: { type: 'string' } },
        required: ['name'],
      }
      const tools: McpToolDef[] = [{ name: 'greet', inputSchema: schema }]
      const client = makeMockClient()

      const result = convertMcpToolsToToolSet('srv', tools, client)

      expect(result['mcp_srv__greet']!.inputSchema).toBeDefined()
    })

    test('defaults to empty object schema when no inputSchema', () => {
      const tools: McpToolDef[] = [{ name: 'noop' }]
      const client = makeMockClient()

      const result = convertMcpToolsToToolSet('srv', tools, client)

      expect(result['mcp_srv__noop']!.inputSchema).toBeDefined()
    })
  })
})
