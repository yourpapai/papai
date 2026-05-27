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

const MockClient = mock(() => ({ ...mockClientInstance }))
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

    test('throws when connection fails after retry', async () => {
      const failConnect = mock(() => Promise.reject(new Error('connection refused')))
      MockClient.mockImplementation(() => ({
        ...mockClientInstance,
        connect: failConnect,
        close: mock(() => Promise.resolve()),
      }))

      const endpoint: McpEndpointConfig = {
        id: 'bad-server',
        url: 'https://bad.example.com/mcp',
        enabled: true,
      }

      // initial + retry = 2 calls
      await expect(pool.getOrCreateFromUser(endpoint)).rejects.toThrow('MCP connection failed')
      expect(failConnect).toHaveBeenCalledTimes(2)
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

    test('throws on unsupported transport', async () => {
      // Build a config with stdio transport (unsupported by pool) to verify rejection
      // The cast widers the literal to the union — intentional for this negative test
      const mcp = {
        transport: 'stdio',
        command: 'echo',
        url: 'https://placeholder.example.com/mcp',
      } as McpPluginConfig

      await expect(pool.getOrCreateFromPlugin('my-plugin', mcp)).rejects.toThrow('Unsupported MCP transport')
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

    test('recordToolCall resets the idle timer so connection stays connected', async () => {
      const endpoint: McpEndpointConfig = {
        id: 'test-server',
        url: 'https://example.com/mcp',
        enabled: true,
      }

      const conn = await pool.getOrCreateFromUser(endpoint)
      expect(pool.getServerInfos()[0]!.status).toBe('connected')

      // Record a tool call — should reset the idle timer
      pool.recordToolCall(conn.hash)

      // Status should still be connected (timer was reset)
      expect(pool.getServerInfos()[0]!.status).toBe('connected')
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

  describe('idle timeout', () => {
    test('connection becomes idle after timeout fires', async () => {
      // Use a very short idle timeout by creating a plugin config with idleTimeoutMs
      const mcp: McpPluginConfig = {
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        idleTimeoutMs: 50,
      }

      await pool.getOrCreateFromPlugin('my-plugin', mcp)
      expect(pool.getServerInfos()[0]!.status).toBe('connected')

      // Wait for the idle timer to fire
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 100)
      })

      const infos = pool.getServerInfos()
      expect(infos[0]!.status).toBe('idle')
    })

    test('idle timeout closes the client connection', async () => {
      const closeMock = mock(() => Promise.resolve())
      MockClient.mockImplementation(() => ({
        ...mockClientInstance,
        close: closeMock,
      }))

      const mcp: McpPluginConfig = {
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        idleTimeoutMs: 50,
      }

      await pool.getOrCreateFromPlugin('my-plugin', mcp)

      // Wait for the idle timer to fire
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 100)
      })

      expect(closeMock).toHaveBeenCalledTimes(1)
    })

    test('reconnects on next access after idle', async () => {
      let connectCount = 0
      MockClient.mockImplementation(() => ({
        ...mockClientInstance,
        connect: mock(() => {
          connectCount++
          return Promise.resolve()
        }),
        close: mock(() => Promise.resolve()),
      }))

      const mcp: McpPluginConfig = {
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        idleTimeoutMs: 50,
      }

      await pool.getOrCreateFromPlugin('my-plugin', mcp)
      expect(connectCount).toBe(1)

      // Wait for idle timeout
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 100)
      })
      expect(pool.getServerInfos()[0]!.status).toBe('idle')

      // Next access should reconnect
      await pool.getOrCreateFromPlugin('my-plugin', mcp)
      expect(connectCount).toBe(2)
      expect(pool.getServerInfos()[0]!.status).toBe('connected')
    })
  })

  describe('reconnect retry', () => {
    test('reconnect retries once on failure then succeeds', async () => {
      const connectMock = mock(() => Promise.resolve())

      MockClient.mockImplementation(() => ({
        ...mockClientInstance,
        connect: connectMock,
        close: mock(() => Promise.resolve()),
      }))

      const mcp: McpPluginConfig = {
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        idleTimeoutMs: 50,
      }

      // First connection succeeds
      await pool.getOrCreateFromPlugin('my-plugin', mcp)
      expect(connectMock).toHaveBeenCalledTimes(1)

      // Wait for idle
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 100)
      })

      // Queue: reconnect fails, then retry succeeds
      connectMock.mockImplementationOnce(() => Promise.reject(new Error('transient failure')))
      connectMock.mockImplementationOnce(() => Promise.resolve())

      await pool.getOrCreateFromPlugin('my-plugin', mcp)
      // 1 initial + 1 failed reconnect + 1 retry = 3 total
      expect(connectMock).toHaveBeenCalledTimes(3)
      expect(pool.getServerInfos()[0]!.status).toBe('connected')
    })

    test('reconnect throws after both attempts fail', async () => {
      const connectMock = mock(() => Promise.resolve())

      MockClient.mockImplementation(() => ({
        ...mockClientInstance,
        connect: connectMock,
        close: mock(() => Promise.resolve()),
      }))

      const mcp: McpPluginConfig = {
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        idleTimeoutMs: 50,
      }

      await pool.getOrCreateFromPlugin('my-plugin', mcp)

      // Wait for idle
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 100)
      })

      // Both reconnect attempts fail
      connectMock.mockImplementation(() => Promise.reject(new Error('connection refused')))

      await expect(pool.getOrCreateFromPlugin('my-plugin', mcp)).rejects.toThrow('MCP connection failed')
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

    test('clears idle timers on shutdown', async () => {
      const mcp: McpPluginConfig = {
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        idleTimeoutMs: 10_000,
      }

      await pool.getOrCreateFromPlugin('my-plugin', mcp)
      await pool.shutdown()

      // After shutdown, the pool should be empty
      expect(pool.getServerInfos()).toEqual([])
    })
  })
})
