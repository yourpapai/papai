// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { McpEndpointConfig, McpPluginConfig } from '../../src/mcp/types.js'

// Mock the MCP SDK modules before importing the pool
const mockConnect = mock(() => Promise.resolve())
const mockClose = mock(() => Promise.resolve())
const mockListTools = mock(() => Promise.resolve({ tools: [] }))
const mockGetServerVersion = mock(() => ({ name: 'test-server', version: '1.0.0' }))

const mockClientInstance = {
  connect: mockConnect,
  close: mockClose,
  listTools: mockListTools,
  getServerVersion: mockGetServerVersion,
}

const MockClient = mock(() => mockClientInstance)
const MockStreamableHTTPClientTransport = mock(() => ({}))

void mock.module('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient,
}))

void mock.module('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: MockStreamableHTTPClientTransport,
}))

// Import after mocking
const { McpConnectionPool } = await import('../../src/mcp/client-pool.js')

describe('McpConnectionPool', () => {
  let pool: InstanceType<typeof McpConnectionPool>

  beforeEach(() => {
    mockConnect.mockClear()
    mockClose.mockClear()
    mockListTools.mockClear()
    mockGetServerVersion.mockClear()
    MockClient.mockClear()
    MockStreamableHTTPClientTransport.mockClear()
    mockConnect.mockImplementation(() => Promise.resolve())
    mockClose.mockImplementation(() => Promise.resolve())
    mockListTools.mockImplementation(() => Promise.resolve({ tools: [] }))
    mockGetServerVersion.mockImplementation(() => ({ name: 'test-server', version: '1.0.0' }))
    MockClient.mockImplementation(() => ({ ...mockClientInstance }))

    pool = new McpConnectionPool()
  })

  describe('getOrCreateFromUser', () => {
    test('creates new connection on first call', async () => {
      const endpoint: McpEndpointConfig = {
        id: 'test-server',
        url: 'https://example.com/mcp',
        enabled: true,
      }

      const conn = await pool.getOrCreateFromUser(endpoint)
      expect(conn).toBeDefined()
      expect(conn.hash).toBeDefined()
      expect(MockClient).toHaveBeenCalledTimes(1)
    })

    test('returns same connection for identical config', async () => {
      const endpoint: McpEndpointConfig = {
        id: 'test-server',
        url: 'https://example.com/mcp',
        enabled: true,
      }

      const conn1 = await pool.getOrCreateFromUser(endpoint)
      const conn2 = await pool.getOrCreateFromUser(endpoint)
      expect(conn1.hash).toBe(conn2.hash)
      expect(MockClient).toHaveBeenCalledTimes(1)
    })

    test('creates different connections for different URLs', async () => {
      const endpoint1: McpEndpointConfig = {
        id: 'server-1',
        url: 'https://example1.com/mcp',
        enabled: true,
      }
      const endpoint2: McpEndpointConfig = {
        id: 'server-2',
        url: 'https://example2.com/mcp',
        enabled: true,
      }

      const conn1 = await pool.getOrCreateFromUser(endpoint1)
      const conn2 = await pool.getOrCreateFromUser(endpoint2)
      expect(conn1.hash).not.toBe(conn2.hash)
      expect(MockClient).toHaveBeenCalledTimes(2)
    })

    test('creates different connections for different headers', async () => {
      const endpoint1: McpEndpointConfig = {
        id: 'test-server',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer token1' },
        enabled: true,
      }
      const endpoint2: McpEndpointConfig = {
        id: 'test-server',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer token2' },
        enabled: true,
      }

      const conn1 = await pool.getOrCreateFromUser(endpoint1)
      const conn2 = await pool.getOrCreateFromUser(endpoint2)
      expect(conn1.hash).not.toBe(conn2.hash)
    })
  })

  describe('getOrCreateFromPlugin', () => {
    test('creates new connection for plugin config', async () => {
      const mcp: McpPluginConfig = {
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
      }

      const conn = await pool.getOrCreateFromPlugin('my-plugin', mcp)
      expect(conn).toBeDefined()
      expect(conn.hash).toBeDefined()
      expect(MockClient).toHaveBeenCalledTimes(1)
    })

    test('returns same connection for identical plugin config', async () => {
      const mcp: McpPluginConfig = {
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
      }

      const conn1 = await pool.getOrCreateFromPlugin('my-plugin', mcp)
      const conn2 = await pool.getOrCreateFromPlugin('my-plugin', mcp)
      expect(conn1.hash).toBe(conn2.hash)
      expect(MockClient).toHaveBeenCalledTimes(1)
    })

    test('creates different connections for different plugin URLs', async () => {
      const mcp1: McpPluginConfig = {
        transport: 'streamable-http',
        url: 'https://example1.com/mcp',
      }
      const mcp2: McpPluginConfig = {
        transport: 'streamable-http',
        url: 'https://example2.com/mcp',
      }

      const conn1 = await pool.getOrCreateFromPlugin('my-plugin', mcp1)
      const conn2 = await pool.getOrCreateFromPlugin('my-plugin', mcp2)
      expect(conn1.hash).not.toBe(conn2.hash)
    })
  })

  describe('getServerInfos', () => {
    test('returns empty array when no connections', () => {
      const infos = pool.getServerInfos()
      expect(infos).toEqual([])
    })

    test('returns server info for active connections', async () => {
      const endpoint: McpEndpointConfig = {
        id: 'test-server',
        url: 'https://example.com/mcp',
        label: 'My Server',
        enabled: true,
      }

      const conn = await pool.getOrCreateFromUser(endpoint)
      const infos = pool.getServerInfos()
      expect(infos).toHaveLength(1)
      expect(infos[0]!.id).toBe(conn.hash)
      expect(infos[0]!.label).toBe('My Server')
      expect(infos[0]!.status).toBe('connected')
    })
  })

  describe('recordToolCall', () => {
    test('resets idle timer for existing connection', async () => {
      const endpoint: McpEndpointConfig = {
        id: 'test-server',
        url: 'https://example.com/mcp',
        enabled: true,
      }

      const conn = await pool.getOrCreateFromUser(endpoint)
      // Should not throw
      pool.recordToolCall(conn.hash)
    })
  })

  describe('updateToolCount', () => {
    test('updates tool count for existing connection', async () => {
      const endpoint: McpEndpointConfig = {
        id: 'test-server',
        url: 'https://example.com/mcp',
        enabled: true,
      }

      const conn = await pool.getOrCreateFromUser(endpoint)
      pool.updateToolCount(conn.hash, 5)
      const infos = pool.getServerInfos()
      expect(infos[0]!.toolCount).toBe(5)
    })
  })

  describe('shutdown', () => {
    test('closes all connections', async () => {
      const endpoint1: McpEndpointConfig = {
        id: 'server-1',
        url: 'https://example1.com/mcp',
        enabled: true,
      }
      const endpoint2: McpEndpointConfig = {
        id: 'server-2',
        url: 'https://example2.com/mcp',
        enabled: true,
      }

      await pool.getOrCreateFromUser(endpoint1)
      await pool.getOrCreateFromUser(endpoint2)

      await pool.shutdown()
      expect(mockClose).toHaveBeenCalledTimes(2)
    })

    test('handles empty pool gracefully', async () => {
      await pool.shutdown()
      expect(mockClose).not.toHaveBeenCalled()
    })
  })
})
