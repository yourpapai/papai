// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions } from 'ai'
import { asSchema } from 'ai'

import { parseScopedContextId } from '../chat/scoped-context.js'
import { resolveMcpRedactionConfig } from '../coding-credentials/mcp-redaction.js'
import { logger } from '../logger.js'
import { contributionRegistry } from '../plugins/contributions.js'
import { getPluginToolInputSchema } from '../plugins/input-schema.js'
import { buildPluginToolRuntimeContext } from '../plugins/tool-runtime.js'
import type { PluginTool } from '../plugins/types.js'
import { BLOCK_PREFIX, DEFAULT_REDACTION_PROMPT, redactText, sizeGuard } from './redaction.js'

const log = logger.child({ scope: 'mcp-server:plugin-bridge' })

// Loose JSON-schema-object type rather than `ai`'s JSONSchema7: the `json-schema` npm
// package (JSONSchema7's origin, re-exported transitively via @ai-sdk/provider) ships no
// type declarations here and adding @types/json-schema surfaces unrelated pre-existing
// type mismatches elsewhere in the codebase. Structurally this is still a JSON Schema object.
export type McpJsonSchema = Record<string, unknown>

export interface McpToolDescriptor {
  name: string
  description: string
  inputSchema: McpJsonSchema
}

export interface McpCallResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

const EMPTY_OBJECT_SCHEMA: McpJsonSchema = { type: 'object', properties: {} }

function isJsonSchemaObject(value: unknown): value is McpJsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function resolveToolJsonSchema(pluginId: string, pluginTool: PluginTool): Promise<McpJsonSchema> {
  try {
    const resolved: unknown = await asSchema(getPluginToolInputSchema(pluginTool)).jsonSchema
    return isJsonSchemaObject(resolved) ? resolved : EMPTY_OBJECT_SCHEMA
  } catch (err) {
    log.warn(
      { pluginId, tool: pluginTool.name, error: err instanceof Error ? err.message : String(err) },
      'failed to derive tool json schema; falling back to empty object schema',
    )
    return EMPTY_OBJECT_SCHEMA
  }
}

/** Lists a plugin's registered MCP tool descriptors (raw, unnamespaced tool names). */
export function listPluginMcpTools(pluginId: string): Promise<McpToolDescriptor[]> {
  const contributions = contributionRegistry.getContributions(pluginId)
  if (contributions === undefined) return Promise.resolve([])

  return Promise.all(
    contributions.tools.map(async (pluginTool) => ({
      name: pluginTool.name,
      description: pluginTool.description,
      inputSchema: await resolveToolJsonSchema(pluginId, pluginTool),
    })),
  )
}

export interface CallPluginMcpToolArgs {
  pluginId: string
  toolName: string
  input: unknown
  storageContextId: string
  chatUserId: string
  abortSignal?: AbortSignal
}

function textResult(text: string, isError?: boolean): McpCallResult {
  return isError === true ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] }
}

function buildExecutionOptions(args: CallPluginMcpToolArgs): ToolExecutionOptions {
  return {
    toolCallId: `mcp-${args.pluginId}-${args.toolName}`,
    messages: [],
    ...(args.abortSignal === undefined ? {} : { abortSignal: args.abortSignal }),
  }
}

/** Executes a plugin's registered tool by raw name in a runtime context bound to the caller. */
export async function callPluginMcpTool(args: CallPluginMcpToolArgs): Promise<McpCallResult> {
  const contributions = contributionRegistry.getContributions(args.pluginId)
  if (contributions === undefined) return textResult(`plugin not active: ${args.pluginId}`, true)

  const pluginTool = contributions.tools.find((candidate) => candidate.name === args.toolName)
  if (pluginTool === undefined) return textResult(`unknown tool: ${args.toolName}`, true)

  const runtimeContext = buildPluginToolRuntimeContext(args.pluginId, contributions.manifest, {
    provider: undefined,
    storageContextId: args.storageContextId,
    chatUserId: args.chatUserId,
  })

  try {
    const result = await pluginTool.execute(args.input, runtimeContext, buildExecutionOptions(args))
    const rawText = typeof result === 'string' ? result : JSON.stringify(result)
    if (contributions.manifest.mcpResponseRedaction !== true) return textResult(rawText)

    const platformInstanceId = parseScopedContextId(args.storageContextId)?.platformInstanceId
    const config = platformInstanceId === undefined ? null : resolveMcpRedactionConfig(platformInstanceId)
    if (config === null) {
      return textResult(`${BLOCK_PREFIX}: mcp_redaction is not configured]`, true)
    }
    const redacted = await redactText(rawText, DEFAULT_REDACTION_PROMPT, config, fetch, args.abortSignal)
    const guarded = sizeGuard(redacted)
    return textResult(guarded, guarded.startsWith(BLOCK_PREFIX) ? true : undefined)
  } catch (err) {
    log.warn(
      { pluginId: args.pluginId, tool: args.toolName, error: err instanceof Error ? err.message : String(err) },
      'plugin tool execution failed',
    )
    return textResult(err instanceof Error ? err.message : String(err), true)
  }
}
