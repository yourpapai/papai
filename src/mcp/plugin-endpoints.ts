// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'
import pLimit from 'p-limit'

import { classifyProviderError, createProviderRequestClock } from '../analytics/provider-observer.js'
import { type ProviderRequestScope, requireProviderRequestScope } from '../analytics/provider-request-scope.js'
import { logger } from '../logger.js'
import { convertMcpToolsToToolSet } from './tool-adapter.js'
import type { McpPluginConfig } from './types.js'

export type PluginConfigRequirement = {
  readonly key: string
  readonly label: string
  readonly required: boolean
}

export type PluginMcpDescriptor = {
  readonly mcp: McpPluginConfig
  readonly configRequirements: ReadonlyArray<PluginConfigRequirement>
  readonly configValues?: Record<string, string>
}

function resolvePlaceholders(
  record: Record<string, string>,
  configValues: Record<string, string>,
): Record<string, string> | null {
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    const replaced = value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/gu, (_match, varName: string) => {
      const lower = varName.toLowerCase()
      const cfgValue = configValues[lower]
      if (cfgValue !== undefined) return cfgValue
      return `\0MISSING:${lower}\0`
    })

    if (replaced.includes('\0MISSING:')) return null
    resolved[key] = replaced
  }
  return resolved
}

function resolveMcpConfig(mcp: McpPluginConfig, configValues: Record<string, string>): McpPluginConfig | null {
  let headers: Record<string, string> | undefined
  if (mcp.headers) {
    const resolved = resolvePlaceholders(mcp.headers, configValues)
    if (resolved === null) return null
    headers = resolved
  }

  let env: Record<string, string> | undefined
  if (mcp.env) {
    const resolved = resolvePlaceholders(mcp.env, configValues)
    if (resolved === null) return null
    env = resolved
  }

  const result: McpPluginConfig = { ...mcp }
  if (headers !== undefined) result.headers = headers
  if (env !== undefined) result.env = env
  return result
}

type PoolLike = {
  getOrCreateFromPlugin: (
    pluginId: string,
    mcp: McpPluginConfig,
  ) => Promise<{
    hash: string
    client: {
      listTools: () => Promise<{
        tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
      }>
      callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<{
        content: Array<{ type: string; text?: string }>
        isError?: boolean
      }>
    }
  }>
}

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

type PluginPoolClient = Awaited<ReturnType<PoolLike['getOrCreateFromPlugin']>>['client']

const listToolsObserved = async (
  scope: ProviderRequestScope,
  client: PluginPoolClient,
): ReturnType<PluginPoolClient['listTools']> => {
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

export async function buildPluginMcpToolSet(
  activePluginIds: readonly string[],
  pluginDescriptors: Map<string, PluginMcpDescriptor>,
  pool: PoolLike,
): Promise<ToolSet> {
  // No endpoints means no I/O — no provider request scope is required.
  if (activePluginIds.length === 0) return {}
  const scope = requireProviderRequestScope()

  const limit = pLimit(3)
  const merged: ToolSet = {}

  const results = await Promise.all(
    activePluginIds.map((pluginId) =>
      limit(async () => {
        const desc = pluginDescriptors.get(pluginId)
        if (!desc) return null

        const configValues = desc.configValues ?? {}
        const resolved = resolveMcpConfig(desc.mcp, configValues)
        if (resolved === null) {
          logger.debug({ pluginId }, 'Skipping plugin MCP: unresolved required config placeholders')
          return null
        }

        try {
          const { client } = await pool.getOrCreateFromPlugin(pluginId, resolved)
          const { tools } = await listToolsObserved(scope, client)
          return { pluginId, tools, client, toolFilter: resolved.toolFilter }
        } catch (err) {
          const errorClass = classifyProviderError(err).statusClass
          logger.warn({ pluginId, errorClass }, 'Skipping plugin MCP: connection failed')
          return null
        }
      }),
    ),
  )

  for (const r of results) {
    if (r === null) continue
    const mcpToolSet = convertMcpToolsToToolSet(r.pluginId, r.tools, r.client, r.toolFilter)
    for (const [key, value] of Object.entries(mcpToolSet)) {
      const pluginKey = key.replace(/^mcp_/u, 'plugin_')
      merged[pluginKey] = value
    }
  }

  return merged
}
