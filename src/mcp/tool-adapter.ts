// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { jsonSchema, tool, type ToolSet } from 'ai'

import { type McpToolFilter, sanitizeServerId } from './types.js'

export type McpToolDef = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export type McpCallToolFn = (params: { name: string; arguments?: unknown }) => Promise<{
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}>

export function convertMcpToolsToToolSet(
  serverId: string,
  mcpTools: McpToolDef[],
  client: {
    callTool: (params: {
      name: string
      arguments?: Record<string, unknown>
    }) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>
  },
  toolFilter?: McpToolFilter,
): ToolSet {
  const filtered = applyToolFilter(mcpTools, toolFilter)
  const result: ToolSet = {}

  for (const mcpTool of filtered) {
    const namespacedName = `mcp_${sanitizeServerId(serverId)}__${mcpTool.name}`
    const schema = mcpTool.inputSchema ?? { type: 'object' as const, properties: {} }
    const inputSchema = jsonSchema(schema)

    result[namespacedName] = tool({
      description: mcpTool.description ?? '',
      inputSchema,
      execute: async (args) => {
        try {
          const response = await client.callTool({
            name: mcpTool.name,
            arguments: args as Record<string, unknown>,
          })

          if (response.isError === true) {
            const textParts = extractText(response.content)
            return { error: textParts.join('\n') || 'MCP tool returned an error' }
          }

          const textParts = extractText(response.content)
          return textParts.join('\n')
        } catch (error: unknown) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      },
    })
  }

  return result
}

function extractText(content: Array<{ type: string; text?: string }>): string[] {
  return content
    .filter((c): c is { type: string; text: string } => c.type === 'text' && c.text !== undefined)
    .map((c) => c.text)
}

function applyToolFilter(tools: McpToolDef[], filter?: McpToolFilter): McpToolDef[] {
  if (filter === undefined) return tools

  let result = tools

  if (filter.allow !== undefined) {
    const allowSet = new Set(filter.allow)
    result = result.filter((t) => allowSet.has(t.name))
  }

  if (filter.deny !== undefined) {
    const denySet = new Set(filter.deny)
    result = result.filter((t) => !denySet.has(t.name))
  }

  return result
}
