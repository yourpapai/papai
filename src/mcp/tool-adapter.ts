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

export function convertMcpToolsToToolSet(
  serverId: string,
  mcpTools: McpToolDef[],
  client: {
    callTool: (params: {
      name: string
      arguments?: Record<string, unknown>
    }) => Promise<{ content: unknown; isError?: boolean }>
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
            arguments: toRecord(args),
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

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value))
  }
  return {}
}

function extractText(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const results: string[] = []
  for (const item of content) {
    if (isTextContent(item)) results.push(item.text)
  }
  return results
}

function isTextContent(item: unknown): item is { type: string; text: string } {
  if (typeof item !== 'object' || item === null) return false
  if (!('type' in item) || !('text' in item)) return false
  const { type, text } = item as { type: unknown; text: unknown }
  return type === 'text' && typeof text === 'string'
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
