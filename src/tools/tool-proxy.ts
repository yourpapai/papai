import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { buildToolMetadata } from './tool-metadata.js'
import { executeProxyCall, executeProxyDescribe, executeProxySearch, executeProxyStatus } from './tool-proxy-modes.js'

const proxyInputSchema = z.object({
  tool: z.string().optional().describe('Exact internal tool name to call, for example get_task or search_tasks.'),
  args: z.string().optional().describe('JSON object string with arguments for the selected tool.'),
  describe: z.string().optional().describe('Exact internal tool name to describe before calling.'),
  search: z.string().optional().describe('Words or regex pattern used to search available internal tools.'),
  regex: z.boolean().optional().describe('Whether search should be interpreted as a JavaScript regular expression.'),
  includeSchemas: z.boolean().optional().describe('Whether search results should include parameter schemas.'),
})

export function makeToolProxy(internalTools: ToolSet): ToolSet[string] {
  const runtime = { tools: internalTools, metadata: buildToolMetadata(internalTools) }

  return tool({
    description: [
      'Single entry point for all Papai task, memo, instruction, identity, file, and web tools.',
      'Use search to discover tools, describe to inspect a tool schema, then call tool with JSON string args.',
    ].join(' '),
    inputSchema: proxyInputSchema,
    execute: (input, options) => {
      const { tool: toolName, args, describe, search, regex, includeSchemas } = input
      if (toolName !== undefined) return executeProxyCall(runtime, toolName, args, options)
      if (describe !== undefined) return executeProxyDescribe(runtime.metadata, describe)
      if (search !== undefined) return executeProxySearch(runtime.metadata, search, regex, includeSchemas)
      return executeProxyStatus(runtime.metadata)
    },
  })
}
