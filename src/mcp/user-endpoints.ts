// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'
import pLimit from 'p-limit'

import { classifyProviderError, createProviderRequestClock } from '../analytics/provider-observer.js'
import { type ProviderRequestScope, requireProviderRequestScope } from '../analytics/provider-request-scope.js'
import { getCachedConfig } from '../cache.js'
import { mcpPool } from './client-pool.js'
import { convertMcpToolsToToolSet } from './tool-adapter.js'
import { type McpEndpointConfig, mcpEndpointConfigSchema } from './types.js'

/** Emits the controlled listTools observation; never throws, never carries server URLs or tool names. */
const observeListTools = (
  scope: ProviderRequestScope,
  clock: Readonly<{ elapsedMs: () => number }>,
  caught: unknown,
): void => {
  if (scope.kind !== 'actor') return
  const classification =
    caught === null ? { statusClass: '2xx' as const, retryable: null } : classifyProviderError(caught)
  try {
    scope.observeProviderRequest(scope.requestContext, {
      provider: 'mcp',
      operation: 'read',
      durationMs: clock.elapsedMs(),
      outcome: caught === null ? 'success' : 'failure',
      statusClass: classification.statusClass,
      retryable: classification.retryable,
    })
  } catch {
    // Observation must never change MCP behavior.
  }
}

const listToolsObserved = async (
  scope: ProviderRequestScope,
  client: McpClientHandle,
): ReturnType<McpClientHandle['listTools']> => {
  const clock = createProviderRequestClock()
  let caught: unknown = null
  try {
    return await client.listTools()
  } catch (error) {
    caught = error
    throw error
  } finally {
    observeListTools(scope, clock, caught)
  }
}

export type McpClientHandle = {
  listTools: () => Promise<{
    tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
  }>
  callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<{
    content: unknown
    isError?: boolean
  }>
}

export type UserEndpointDeps = {
  getCachedConfig: (userId: string, key: string) => string | null
  getOrCreate: (endpoint: McpEndpointConfig) => Promise<{ hash: string; client: McpClientHandle }>
}

async function poolGetOrCreate(endpoint: McpEndpointConfig): Promise<{ hash: string; client: McpClientHandle }> {
  const { hash, client } = await mcpPool.getOrCreateFromUser(endpoint)
  return {
    hash,
    client: {
      listTools: () => client.listTools(),
      callTool: async (params) => {
        const result = await client.callTool(params)
        return { content: result.content, isError: typeof result.isError === 'boolean' ? result.isError : undefined }
      },
    },
  }
}

export function parseMcpEndpoints(raw: string | null): McpEndpointConfig[] {
  if (raw === null) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) return []

  const results: McpEndpointConfig[] = []
  for (const entry of parsed) {
    const result = mcpEndpointConfigSchema.safeParse(entry)
    if (result.success) {
      results.push(result.data)
    }
  }
  return results
}

export async function buildMcpToolSet(contextId: string, deps?: UserEndpointDeps): Promise<ToolSet> {
  const cfg = deps?.getCachedConfig ?? getCachedConfig
  const getOrCreate = deps?.getOrCreate ?? poolGetOrCreate

  const raw = cfg(contextId, 'mcp_endpoints')
  const endpoints = parseMcpEndpoints(raw)

  const enabled = endpoints.filter((e) => e.enabled ?? true)
  // No endpoints means no I/O — no provider request scope is required.
  if (enabled.length === 0) return {}

  const scope = requireProviderRequestScope()

  const limit = pLimit(3)
  const merged: ToolSet = {}

  const results = await Promise.all(
    enabled.map((endpoint) =>
      limit(async () => {
        try {
          const { client } = await getOrCreate(endpoint)
          const { tools } = await listToolsObserved(scope, client)
          return { serverId: endpoint.id, tools, client, toolFilter: endpoint.toolFilter }
        } catch {
          return null
        }
      }),
    ),
  )

  for (const r of results) {
    if (r === null) continue
    const toolSet = convertMcpToolsToToolSet(r.serverId, r.tools, r.client, r.toolFilter)
    Object.assign(merged, toolSet)
  }

  return merged
}
