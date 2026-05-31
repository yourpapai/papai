// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mcpPool } from './client-pool.js'
import type { McpPluginConfig } from './types.js'

type PluginPoolTool = {
  name: string
} & Partial<{
  description: string
  inputSchema: Record<string, unknown>
}>

type PluginPoolCallParams = {
  name: string
} & Partial<{ arguments: Record<string, unknown> }>

type PluginPoolCallContent = {
  type: string
} & Partial<{ text: string }>

type PluginPoolCallResult = {
  content: PluginPoolCallContent[]
} & Partial<{ isError: boolean }>

export type PluginPoolAdapter = {
  getOrCreateFromPlugin: (
    pluginId: string,
    mcp: McpPluginConfig,
  ) => Promise<{
    hash: string
    client: {
      listTools: () => Promise<{
        tools: PluginPoolTool[]
      }>
      callTool: (params: PluginPoolCallParams) => Promise<PluginPoolCallResult>
    }
  }>
}

export function adaptMcpPool(): PluginPoolAdapter {
  return {
    async getOrCreateFromPlugin(pluginId, mcp) {
      const { hash, client } = await mcpPool.getOrCreateFromPlugin(pluginId, mcp)
      return {
        hash,
        client: {
          listTools: () => client.listTools(),
          callTool: async (params) => {
            const result = await client.callTool(params)
            const content = Array.isArray(result.content)
              ? result.content.filter(
                  (c: { type: unknown } & Partial<{ text: unknown }>): c is PluginPoolCallContent =>
                    typeof c === 'object' && c !== null && typeof c.type === 'string',
                )
              : []
            const isError = typeof result.isError === 'boolean' ? result.isError : undefined
            return { content, isError }
          },
        },
      }
    },
  }
}
