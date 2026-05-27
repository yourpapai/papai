// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { logger } from '../logger.js'
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
  lastError: string | null
  lastConnectedAt: number | null
  idleTimer: ReturnType<typeof setTimeout> | null
  idleTimeoutMs: number
}

function computeHash(parts: Record<string, unknown>): string {
  const sorted = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${JSON.stringify(parts[k])}`)
    .join('&')
  return createHash('sha256').update(sorted).digest('hex')
}

function endpointHash(endpoint: McpEndpointConfig): string {
  return computeHash({
    transport: 'streamable-http',
    url: endpoint.url,
    headers: endpoint.headers ?? {},
  })
}

function pluginHash(pluginId: string, mcp: McpPluginConfig): string {
  return computeHash({
    transport: mcp.transport,
    url: mcp.url ?? '',
    headers: mcp.headers ?? {},
    command: mcp.command ?? '',
    args: mcp.args ?? [],
    pluginId,
  })
}

export class McpConnectionPool {
  private entries = new Map<string, PoolEntry>()

  async getOrCreateFromUser(endpoint: McpEndpointConfig): Promise<{ hash: string; client: Client }> {
    const hash = endpointHash(endpoint)
    const existing = this.entries.get(hash)
    if (existing) {
      return { hash, client: existing.client }
    }

    const label = endpoint.label ?? endpoint.id
    const entry = await this.createEntry(hash, label, {
      url: endpoint.url,
      headers: endpoint.headers,
    })
    return { hash, client: entry.client }
  }

  async getOrCreateFromPlugin(pluginId: string, mcp: McpPluginConfig): Promise<{ hash: string; client: Client }> {
    const hash = pluginHash(pluginId, mcp)
    const existing = this.entries.get(hash)
    if (existing) {
      return { hash, client: existing.client }
    }

    // Stdio transport is a future extension — only streamable-http is supported today
    if (mcp.transport !== 'streamable-http') {
      throw new Error(`Unsupported MCP transport: ${mcp.transport}`)
    }

    const label = pluginId
    const entry = await this.createEntry(hash, label, {
      url: mcp.url!,
      headers: mcp.headers,
      idleTimeoutMs: mcp.idleTimeoutMs,
    })
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
      closePromises.push(entry.client.close())
    }
    await Promise.all(closePromises)
    this.entries.clear()
  }

  private async createEntry(
    hash: string,
    label: string,
    opts: { url: string; headers?: Record<string, string>; idleTimeoutMs?: number },
  ): Promise<PoolEntry> {
    const client = new Client({ name: 'papai-mcp-client', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(opts.url), {
      requestInit: opts.headers ? { headers: opts.headers } : undefined,
    })

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
    }

    this.entries.set(hash, entry)

    try {
      await client.connect(transport)
      entry.status = 'connected'
      entry.lastConnectedAt = Date.now()
      entry.lastError = null
      this.resetIdleTimer(entry)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn({ hash, error: msg }, 'MCP connection failed, retrying once')
      try {
        await client.connect(transport)
        entry.status = 'connected'
        entry.lastConnectedAt = Date.now()
        entry.lastError = null
        this.resetIdleTimer(entry)
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
        entry.status = 'error'
        entry.lastError = retryMsg
        logger.error({ hash, error: retryMsg }, 'MCP connection failed after retry')
      }
    }

    return entry
  }

  private resetIdleTimer(entry: PoolEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
    }
    entry.idleTimer = setTimeout(() => {
      entry.status = 'idle'
    }, entry.idleTimeoutMs)
  }
}

export const mcpPool = new McpConnectionPool()
