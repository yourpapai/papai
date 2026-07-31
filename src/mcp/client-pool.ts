// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import type { McpAvailabilityOrigin } from '../analytics/feature-observer.js'
import { classifyProviderError, createProviderRequestClock } from '../analytics/provider-observer.js'
import { type ProviderRequestScope, requireProviderRequestScope } from '../analytics/provider-request-scope.js'
import { logger } from '../logger.js'
import { endpointHash, observeMcpConnect, pluginHash } from './connect-observation.js'
import type { McpEndpointConfig, McpPluginConfig, McpServerInfo, McpServerStatus } from './types.js'

// 10 minutes
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000

type PoolEntry = {
  hash: string
  client: Client
  transport: StreamableHTTPClientTransport
  status: McpServerStatus
  label: string | null
  toolCount: number
  /** Controlled status class only ('network'|'timeout'|'auth'|'4xx'|'5xx'|'other') — never raw upstream messages. */
  lastError: string | null
  lastConnectedAt: number | null
  idleTimer: ReturnType<typeof setTimeout> | null
  idleTimeoutMs: number
  url: string
  headers?: Record<string, string>
  availabilityOrigin: McpAvailabilityOrigin
  serverRawId: string
}

function buildClientAndTransport(
  url: string,
  headers?: Record<string, string>,
): { client: Client; transport: StreamableHTTPClientTransport } {
  const client = new Client({ name: 'papai-mcp-client', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: headers ? { headers } : undefined,
  })
  return { client, transport }
}

export class McpConnectionPool {
  private entries = new Map<string, PoolEntry>()

  /**
   * Returns a connection handle for the given user endpoint config.
   * Connection is eager: the MCP client connects immediately on first call
   * or when the previous idle connection needs to be re-established.
   *
   * Throws if the connection fails after retry — callers should catch and
   * skip the server for that invocation.
   */
  async getOrCreateFromUser(endpoint: McpEndpointConfig): Promise<{ hash: string; client: Client }> {
    const scope = requireProviderRequestScope()
    const hash = endpointHash(endpoint)
    const existing = this.entries.get(hash)
    if (existing) {
      if (existing.status === 'idle' || existing.status === 'error') {
        await this.reconnectEntry(existing, scope)
      }
      return { hash, client: existing.client }
    }

    const label = endpoint.label ?? endpoint.id
    const entry = await this.createEntry(
      hash,
      label,
      {
        url: endpoint.url,
        headers: endpoint.headers,
      },
      'user_endpoint',
      endpoint.id,
      scope,
    )
    return { hash, client: entry.client }
  }

  /**
   * Returns a connection handle for the given plugin MCP config.
   * Connection is eager: the MCP client connects immediately on first call
   * or when the previous idle connection needs to be re-established.
   *
   * Throws if the connection fails after retry — callers should catch and
   * skip the server for that invocation.
   */
  async getOrCreateFromPlugin(pluginId: string, mcp: McpPluginConfig): Promise<{ hash: string; client: Client }> {
    const scope = requireProviderRequestScope()
    const hash = pluginHash(pluginId, mcp)
    const existing = this.entries.get(hash)
    if (existing) {
      if (existing.status === 'idle' || existing.status === 'error') {
        await this.reconnectEntry(existing, scope)
      }
      return { hash, client: existing.client }
    }

    // Stdio transport is a future extension — only streamable-http is supported today
    if (mcp.transport !== 'streamable-http') {
      throw new Error(`Unsupported MCP transport: ${mcp.transport}`)
    }

    const label = pluginId
    const entry = await this.createEntry(
      hash,
      label,
      {
        url: mcp.url!,
        headers: mcp.headers,
        idleTimeoutMs: mcp.idleTimeoutMs,
      },
      'plugin_endpoint',
      pluginId,
      scope,
    )
    return { hash, client: entry.client }
  }

  recordToolCall(hash: string): void {
    const entry = this.entries.get(hash)
    if (!entry) return
    this.resetIdleTimer(entry)
  }

  getServerInfos(): McpServerInfo[] {
    const infos: McpServerInfo[] = []
    for (const entry of this.entries.values()) {
      infos.push({
        id: entry.hash,
        label: entry.label,
        status: entry.status,
        toolCount: entry.toolCount,
        lastError: entry.lastError,
        lastConnectedAt: entry.lastConnectedAt,
        url: entry.url,
      })
    }
    return infos
  }

  updateToolCount(hash: string, count: number): void {
    const entry = this.entries.get(hash)
    if (entry) {
      entry.toolCount = count
    }
  }

  async shutdown(): Promise<void> {
    const closePromises: Promise<void>[] = []
    for (const entry of this.entries.values()) {
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer)
        entry.idleTimer = null
      }
      if (entry.status === 'connected' || entry.status === 'connecting') {
        closePromises.push(
          entry.client.close().catch(() => {
            // ignore close errors during shutdown
          }),
        )
      }
    }
    await Promise.all(closePromises)
    this.entries.clear()
  }

  private async createEntry(
    hash: string,
    label: string,
    opts: { url: string; headers?: Record<string, string>; idleTimeoutMs?: number },
    availabilityOrigin: McpAvailabilityOrigin,
    serverRawId: string,
    scope: ProviderRequestScope,
  ): Promise<PoolEntry> {
    const { client, transport } = buildClientAndTransport(opts.url, opts.headers)

    const entry: PoolEntry = {
      hash,
      client,
      transport,
      status: 'connecting',
      label,
      toolCount: 0,
      lastError: null,
      lastConnectedAt: null,
      idleTimer: null,
      idleTimeoutMs: opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      url: opts.url,
      headers: opts.headers,
      availabilityOrigin,
      serverRawId,
    }

    this.entries.set(hash, entry)
    try {
      await this.connectWithRetry(entry, scope)
    } catch (err) {
      this.entries.delete(hash)
      throw err
    }
    return entry
  }

  private async reconnectEntry(entry: PoolEntry, scope: ProviderRequestScope): Promise<void> {
    const { client, transport } = buildClientAndTransport(entry.url, entry.headers)

    entry.client = client
    entry.transport = transport
    entry.status = 'connecting'
    try {
      await this.connectWithRetry(entry, scope)
    } catch (err) {
      this.entries.delete(entry.hash)
      throw err
    }
  }

  private async connectWithRetry(entry: PoolEntry, scope: ProviderRequestScope): Promise<void> {
    const clock = createProviderRequestClock()
    try {
      await entry.client.connect(entry.transport)
      this.markConnected(entry)
      observeMcpConnect(scope, clock, entry, null)
    } catch (err) {
      logger.warn(
        { hash: entry.hash, errorClass: classifyProviderError(err).statusClass },
        'MCP connection failed, retrying once',
      )
      try {
        await entry.client.connect(entry.transport)
        this.markConnected(entry)
        observeMcpConnect(scope, clock, entry, null)
      } catch (retryErr) {
        const errorClass = classifyProviderError(retryErr).statusClass
        entry.status = 'error'
        entry.lastError = errorClass
        observeMcpConnect(scope, clock, entry, retryErr)
        logger.error({ hash: entry.hash, errorClass }, 'MCP connection failed after retry')
        throw new Error(`MCP connection failed (${errorClass})`, { cause: retryErr })
      }
    }
  }

  private markConnected(entry: PoolEntry): void {
    entry.status = 'connected'
    entry.lastConnectedAt = Date.now()
    entry.lastError = null
    this.resetIdleTimer(entry)
  }

  private resetIdleTimer(entry: PoolEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
    }
    entry.idleTimer = setTimeout(() => {
      void this.disconnectIdle(entry)
    }, entry.idleTimeoutMs)
  }

  private async disconnectIdle(entry: PoolEntry): Promise<void> {
    if (entry.status !== 'connected') return
    try {
      await entry.client.close()
    } catch {
      // ignore close errors during idle disconnect
    }
    entry.status = 'idle'
    entry.idleTimer = null
    logger.info({ hash: entry.hash, label: entry.label }, 'MCP connection closed (idle timeout)')
  }
}

export const mcpPool = new McpConnectionPool()
