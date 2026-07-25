// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { getPluginConfig } from '../config.js'
import { adaptMcpPool, buildMcpToolSet, buildPluginMcpToolSet } from '../mcp/index.js'
import type { PluginMcpDescriptor } from '../mcp/plugin-endpoints.js'
import { buildPluginToolSet, contributionRegistry } from '../plugins/contributions.js'
import { filterProviderlessPluginIds } from '../plugins/providerless.js'
import { getPluginsForContext } from '../plugins/registry.js'
import type { TaskProvider } from '../providers/types.js'
import { maybeSeedAdminToolDefaults } from './admin-tool-defaults.js'
import { BUILTIN_TOOL_NAMES } from './builtin-names.js'
import { extendSchemaForAsk, gatedExecute, type AskPermissionFn } from './permission-gate.js'
import { getToolMetadata } from './tool-metadata.js'
import { getToolPrefs, resolveToolPermission } from './tool-preferences.js'
import { buildProviderlessTools, buildTools } from './tools-builder.js'
import type { MakeToolsOptions, ToolMode } from './types.js'

export type { MakeToolsOptions, ToolMode }

/**
 * Static snapshot of builtin tool names the behavior-audit closure verifier
 * should recognize in entry-point hints. Derived from `BUILTIN_TOOL_NAMES`
 * (the keys of `TOOL_METADATA`), so it stays in sync with the canonical
 * per-tool classification table. Plugin/MCP tools are dynamic and excluded.
 */
export function listToolNames(): readonly string[] {
  return BUILTIN_TOOL_NAMES
}

export function applyToolPreferences(
  tools: ToolSet,
  contextId: string | undefined,
  askPermission: AskPermissionFn | undefined,
): ToolSet {
  if (contextId === undefined) return tools
  const prefsContextId = getConfigContextIdFromStorageContextId(contextId)
  maybeSeedAdminToolDefaults(prefsContextId)
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
    const wrappedExecute =
      t.execute === undefined
        ? undefined
        : gatedExecute((input, opts) => Promise.resolve(t.execute!(input, opts)), name, askPermission)
    out[name] = { ...t, inputSchema: extendedSchema, execute: wrappedExecute }
  }
  return out
}

/**
 * Guest enforcement: keep only read-risk tools, dropping all write/destructive/open-world
 * (and unknown) tools. Bypasses per-context tool_prefs entirely — guests get a fixed,
 * non-overridable read-only toolset. Tools with unknown metadata are dropped (fail-closed).
 */
export function applyGuestReadOnlyFilter(tools: ToolSet): ToolSet {
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    if (t === undefined) continue
    if (getToolMetadata(name)?.risk === 'read') out[name] = t
  }
  return out
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

async function buildPluginAndMcpTools(
  provider: TaskProvider,
  sharedContextId: string,
  storageContextId: string,
  chatUserId: string,
  builtins: ToolSet,
): Promise<{ pluginTools: ToolSet; extraMcpTools: ToolSet }> {
  const activePlugins = getPluginsForContext(sharedContextId)
  if (activePlugins.length === 0) return { pluginTools: {}, extraMcpTools: {} }

  const activePluginIds = activePlugins
    .map((p) => p.manifest.id)
    .filter((id) => contributionRegistry.getContributions(id) !== undefined)
  // Plugin eligibility and MCP descriptors are group-scoped (shared context id), but
  // the per-tool runtime receives the raw thread-scoped storage context id so plugins
  // route/deliver to the originating thread. `buildPluginToolRuntimeContext` re-derives
  // the group context for the KV of `storageScope: 'group'` plugins.
  const pluginTools = buildPluginToolSet(activePluginIds, new Set(Object.keys(builtins)), {
    provider,
    storageContextId,
    chatUserId,
  })

  const extraMcpTools: ToolSet = {}
  const mcpPluginIds = activePlugins.filter((p) => p.manifest.mcp !== undefined).map((p) => p.manifest.id)
  if (mcpPluginIds.length > 0) {
    const descriptors = buildPluginMcpDescriptors(mcpPluginIds, sharedContextId)
    try {
      const pluginMcpTools = await buildPluginMcpToolSet(mcpPluginIds, descriptors, adaptMcpPool())
      Object.assign(extraMcpTools, pluginMcpTools)
    } catch {
      // MCP failures don't break the tool pipeline
    }
  }

  return { pluginTools, extraMcpTools }
}

async function buildProviderlessPluginAndMcpTools(
  sharedContextId: string,
  storageContextId: string,
  chatUserId: string,
  builtins: ToolSet,
): Promise<{ pluginTools: ToolSet; extraMcpTools: ToolSet }> {
  const activePlugins = getPluginsForContext(sharedContextId)
  if (activePlugins.length === 0) return { pluginTools: {}, extraMcpTools: {} }

  const activePluginIds = activePlugins
    .map((p) => p.manifest.id)
    .filter((id) => contributionRegistry.getContributions(id) !== undefined)
  const providerlessPluginIds = filterProviderlessPluginIds(activePluginIds)
  // See buildPluginAndMcpTools: eligibility/MCP use the group-shared context id; the
  // runtime uses the raw thread-scoped storage context id.
  const pluginTools = buildPluginToolSet(providerlessPluginIds, new Set(Object.keys(builtins)), {
    provider: undefined,
    storageContextId,
    chatUserId,
  })

  const extraMcpTools: ToolSet = {}
  const mcpPluginIds = filterProviderlessPluginIds(
    activePlugins.filter((p) => p.manifest.mcp !== undefined).map((p) => p.manifest.id),
  )
  if (mcpPluginIds.length > 0) {
    const descriptors = buildPluginMcpDescriptors(mcpPluginIds, sharedContextId)
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
  let mode: MakeToolsOptions['mode'] = 'normal'
  if (options.mode !== undefined) mode = options.mode
  const contextType = options.contextType
  const stagedDownloadFn = options.stagedDownloadFn

  const tools = buildTools(
    provider,
    chatUserId,
    contextId,
    mode,
    contextType,
    username,
    stagedDownloadFn,
    options.chatParticipantResolver,
  )

  let mcpTools: ToolSet = {}
  if (sharedContextId !== undefined) {
    try {
      mcpTools = await buildMcpToolSet(sharedContextId)
    } catch {
      // MCP failures don't break the tool pipeline
    }
  }

  let pluginTools: ToolSet = {}
  if (sharedContextId !== undefined && contextId !== undefined && chatUserId !== undefined) {
    const result = await buildPluginAndMcpTools(provider, sharedContextId, contextId, chatUserId, tools)
    pluginTools = result.pluginTools
    Object.assign(mcpTools, result.extraMcpTools)
  }

  return { ...tools, ...mcpTools, ...pluginTools }
}

export async function buildProviderlessToolDescriptors(options: MakeToolsOptions): Promise<ToolSet> {
  const storageContextId = options.storageContextId
  const chatUserId = options.chatUserId
  const username = options.username
  const contextId = storageContextId
  const sharedContextId = contextId === undefined ? undefined : getConfigContextIdFromStorageContextId(contextId)
  let mode: MakeToolsOptions['mode'] = 'normal'
  if (options.mode !== undefined) mode = options.mode
  const contextType = options.contextType
  const stagedDownloadFn = options.stagedDownloadFn

  const tools = buildProviderlessTools(
    chatUserId,
    contextId,
    mode,
    contextType,
    username,
    stagedDownloadFn,
    options.chatParticipantResolver,
  )

  let mcpTools: ToolSet = {}
  if (sharedContextId !== undefined) {
    try {
      mcpTools = await buildMcpToolSet(sharedContextId)
    } catch {
      // MCP failures don't break the tool pipeline
    }
  }

  let pluginTools: ToolSet = {}
  if (sharedContextId !== undefined && contextId !== undefined && chatUserId !== undefined) {
    const result = await buildProviderlessPluginAndMcpTools(sharedContextId, contextId, chatUserId, tools)
    pluginTools = result.pluginTools
    Object.assign(mcpTools, result.extraMcpTools)
  }

  return { ...tools, ...mcpTools, ...pluginTools }
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
  const options: MakeToolsOptions = args.length === 0 ? {} : args[0]
  const descriptors = await buildToolDescriptors(provider, options)
  return applyToolPreferences(descriptors, options.storageContextId, options.askPermission)
}
