// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ToolSet } from 'ai'
import { jsonSchema } from 'ai'

import { userCachesForTesting } from '../../src/cache.js'
import { makeTools } from '../../src/tools/index.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const CONTEXT = 'test-mcp-integration-user'

mockLogger()

const buildMcpToolSetSpy = mock((_contextId: string): Promise<ToolSet> => Promise.resolve({}))

void mock.module('../../src/mcp/user-endpoints.js', () => ({
  buildMcpToolSet: buildMcpToolSetSpy,
}))

void mock.module('../../src/mcp/index.js', () => ({
  buildMcpToolSet: buildMcpToolSetSpy,
  buildPluginMcpToolSet: mock(
    (_ids: string[], _desc: unknown, _pool: unknown): Promise<ToolSet> => Promise.resolve({}),
  ),
  mcpPool: { getOrCreateFromPlugin: mock(() => Promise.resolve({ hash: 'h', client: {} })) },
  convertMcpToolsToToolSet: mock(() => ({})),
}))

beforeEach(async () => {
  void mock.module('../../src/mcp/user-endpoints.js', () => ({
    buildMcpToolSet: buildMcpToolSetSpy,
  }))
  void mock.module('../../src/mcp/index.js', () => ({
    buildMcpToolSet: buildMcpToolSetSpy,
    buildPluginMcpToolSet: mock(
      (_ids: string[], _desc: unknown, _pool: unknown): Promise<ToolSet> => Promise.resolve({}),
    ),
    mcpPool: { getOrCreateFromPlugin: mock(() => Promise.resolve({ hash: 'h', client: {} })) },
    convertMcpToolsToToolSet: mock(() => ({})),
  }))
  await setupTestDb()
  userCachesForTesting.delete(CONTEXT)
  buildMcpToolSetSpy.mockClear()
  buildMcpToolSetSpy.mockResolvedValue({})
})

afterEach(() => {
  userCachesForTesting.delete(CONTEXT)
})

describe('makeTools async + MCP integration', () => {
  test('makeTools returns a Promise', () => {
    const provider = createMockProvider()
    const result = makeTools(provider, { storageContextId: CONTEXT, chatUserId: CONTEXT, contextType: 'dm' })
    expect(result).toBeInstanceOf(Promise)
  })

  test('makeTools resolves to a ToolSet with built-in tools', async () => {
    const provider = createMockProvider()
    const tools = await makeTools(provider, { storageContextId: CONTEXT, chatUserId: CONTEXT, contextType: 'dm' })
    expect(Object.keys(tools)).toContain('create_task')
    expect(Object.keys(tools)).toContain('save_memo')
  })

  test('makeTools merges MCP tools from buildMcpToolSet', async () => {
    buildMcpToolSetSpy.mockResolvedValueOnce({
      mcp_server1__remote_search: {
        description: 'Search via MCP',
        inputSchema: jsonSchema({ type: 'object' as const, properties: {} }),
        execute: () => Promise.resolve('result'),
      },
    })

    const provider = createMockProvider()
    const tools = await makeTools(provider, { storageContextId: CONTEXT, chatUserId: CONTEXT, contextType: 'dm' })
    expect(Object.keys(tools)).toContain('mcp_server1__remote_search')
    expect(Object.keys(tools)).toContain('create_task')
  })

  test('makeTools continues when buildMcpToolSet throws', async () => {
    buildMcpToolSetSpy.mockRejectedValueOnce(new Error('MCP connection failed'))

    const provider = createMockProvider()
    const tools = await makeTools(provider, { storageContextId: CONTEXT, chatUserId: CONTEXT, contextType: 'dm' })
    expect(Object.keys(tools)).toContain('create_task')
  })

  test('makeTools does not call buildMcpToolSet when no contextId', async () => {
    buildMcpToolSetSpy.mockClear()
    const provider = createMockProvider()
    const tools = await makeTools(provider)
    expect(Object.keys(tools).length).toBeGreaterThan(0)
    expect(buildMcpToolSetSpy).not.toHaveBeenCalled()
  })
})
