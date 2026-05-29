// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { getPluginConfig } from '../config.js'
import { buildMcpToolSet, buildPluginMcpToolSet, mcpPool } from '../mcp/index.js'
import type { PluginMcpDescriptor } from '../mcp/plugin-endpoints.js'
import type { McpPluginConfig } from '../mcp/types.js'
import { buildPluginToolSet, contributionRegistry } from '../plugins/contributions.js'
import { getPluginsForContext } from '../plugins/registry.js'
import type { TaskProvider } from '../providers/types.js'
import { extendSchemaForAsk, gatedExecute, type AskPermissionFn } from './permission-gate.js'
import { getToolPrefs, resolveToolPermission } from './tool-preferences.js'
import { buildTools } from './tools-builder.js'
import type { MakeToolsOptions, ToolMode } from './types.js'
import { wrapToolExecution } from './wrap-tool-execution.js'

export type { MakeToolsOptions, ToolMode }

export function applyToolPreferences(
  tools: ToolSet,
  contextId: string | undefined,
  askPermission: AskPermissionFn | undefined,
): ToolSet {
  if (contextId === undefined) return tools
  const prefsContextId = getConfigContextIdFromStorageContextId(contextId)
  const prefs = getToolPrefs(prefsContextId)
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    if (t === undefined) continue
    const perm = resolveToolPermission(prefs, name)
    if (perm === 'deny') continue
    if (perm === 'allow') {
      out[name] = t
      continue
    }
    // perm === 'ask'
    const extendedSchema = extendSchemaForAsk(t.inputSchema)
    const boundExecute = t.execute === undefined ? undefined : wrapToolExecution(t.execute.bind(t), name)
    const wrappedExecute = boundExecute === undefined ? undefined : gatedExecute(boundExecute, name, askPermission)
    out[name] = { ...t, inputSchema: extendedSchema, execute: wrappedExecute }
  }
  return out
}

function wrapToolSet(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).flatMap(([name, tool]) => {
      if (tool === undefined || tool === null || tool.execute === undefined) return []
      return [[name, { ...tool, execute: wrapToolExecution(tool.execute.bind(tool), name) }]]
    }),
  )
}

function buildPluginMcpDescriptors(pluginIds: readonly string[], contextId: string): Map<string, PluginMcpDescriptor> {
  const result = new Map<string, PluginMcpDescriptor>()
  const activePlugins = getPluginsForContext(contextId)
  for (const pluginId of pluginIds) {
    const plugin = activePlugins.find((p) => p.manifest.id === pluginId)
    if (plugin === undefined || plugin.manifest.mcp === undefined) continue
    const requirements = plugin.manifest.configRequirements
    const configValues: Record<string, string> = {}
    for (const req of requirements) {
      const value = getPluginConfig(contextId, pluginId, req.key)
      if (value !== null) configValues[req.key] = value
    }
    result.set(pluginId, {
      mcp: plugin.manifest.mcp,
      configRequirements: requirements,
      configValues,
    })
  }
  return result
}

type PluginPoolAdapter = {
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

function adaptMcpPool(): PluginPoolAdapter {
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
                  (c: { type: unknown; text?: unknown }): c is { type: string; text?: string } =>
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

async function buildPluginAndMcpTools(
  provider: TaskProvider,
  contextId: string,
  chatUserId: string,
  wrappedBuiltins: ToolSet,
): Promise<{ pluginTools: ToolSet; extraMcpTools: ToolSet }> {
  const activePlugins = getPluginsForContext(contextId)
  if (activePlugins.length === 0) return { pluginTools: {}, extraMcpTools: {} }

  const activePluginIds = activePlugins
    .map((p) => p.manifest.id)
    .filter((id) => contributionRegistry.getContributions(id) !== undefined)
  const pluginTools = buildPluginToolSet(activePluginIds, new Set(Object.keys(wrappedBuiltins)), {
    provider,
    storageContextId: contextId,
    chatUserId,
  })

  const extraMcpTools: ToolSet = {}
  const mcpPluginIds = activePlugins.filter((p) => p.manifest.mcp !== undefined).map((p) => p.manifest.id)
  if (mcpPluginIds.length > 0) {
    const descriptors = buildPluginMcpDescriptors(mcpPluginIds, contextId)
    try {
      const pluginMcpTools = await buildPluginMcpToolSet(mcpPluginIds, descriptors, adaptMcpPool())
      Object.assign(extraMcpTools, pluginMcpTools)
    } catch {
      // MCP failures don't break the tool pipeline
    }
  }

  return { pluginTools, extraMcpTools }
}

/**
 * Build the raw (preference-unfiltered) tool set for the given provider and context.
 * The result may be cached by the orchestrator; per-turn preference application
 * (including ask-gating) is done separately via `applyToolPreferences`.
 */
export async function buildToolDescriptors(provider: TaskProvider, options: MakeToolsOptions): Promise<ToolSet> {
  const storageContextId = options.storageContextId
  const chatUserId = options.chatUserId
  const username = options.username
  const contextId = storageContextId
  const sharedContextId = contextId === undefined ? undefined : getConfigContextIdFromStorageContextId(contextId)
  const mode = options.mode ?? 'normal'
  const contextType = options.contextType
  const stagedDownloadFn = options.stagedDownloadFn

  const tools = buildTools(provider, chatUserId, contextId, mode, contextType, username, stagedDownloadFn)
  const wrappedBuiltins = wrapToolSet(tools)

  let mcpTools: ToolSet = {}
  if (sharedContextId !== undefined) {
    try {
      mcpTools = await buildMcpToolSet(sharedContextId)
    } catch {
      // MCP failures don't break the tool pipeline
    }
  }

  let pluginTools: ToolSet = {}
  if (sharedContextId !== undefined && chatUserId !== undefined) {
    const result = await buildPluginAndMcpTools(provider, sharedContextId, chatUserId, wrappedBuiltins)
    pluginTools = result.pluginTools
    Object.assign(mcpTools, result.extraMcpTools)
  }

  return { ...wrappedBuiltins, ...mcpTools, ...pluginTools }
}

/**
 * Build a tool set for the given provider and context, with preferences applied.
 *
 * Usage:
 * ```ts
 * await makeTools(provider, { storageContextId: 'user-1:group-1', chatUserId: 'user-1', mode: 'normal' })
 * ```
 */
export function makeTools(provider: TaskProvider): Promise<ToolSet>
export function makeTools(provider: TaskProvider, options: MakeToolsOptions): Promise<ToolSet>
export async function makeTools(
  provider: TaskProvider,
  ...args: readonly [MakeToolsOptions] | readonly []
): Promise<ToolSet> {
  const options = args[0] ?? { chatUserId: '' }
  const descriptors = await buildToolDescriptors(provider, options)
  return applyToolPreferences(descriptors, options.storageContextId, options.askPermission)
}
