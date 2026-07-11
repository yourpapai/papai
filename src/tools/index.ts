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
import { buildModuleToolSet } from './module-tool-set.js'
import { extendSchemaForAsk, gatedExecute, type AskPermissionFn } from './permission-gate.js'
import { getToolMetadata } from './tool-metadata.js'
import { getToolPrefs, resolveToolPermission } from './tool-preferences.js'
import { buildProviderlessTools, buildTools } from './tools-builder.js'
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

async function buildMcpToolsForPlugins(pluginIds: readonly string[], sharedContextId: string): Promise<ToolSet> {
  const extraMcpTools: ToolSet = {}
  if (pluginIds.length === 0) return extraMcpTools
  const descriptors = buildPluginMcpDescriptors(pluginIds, sharedContextId)
  try {
    const pluginMcpTools = await buildPluginMcpToolSet(pluginIds, descriptors, adaptMcpPool())
    Object.assign(extraMcpTools, pluginMcpTools)
  } catch {
    // MCP failures don't break the tool pipeline
  }
  return extraMcpTools
}

async function buildPluginAndMcpTools(
  provider: TaskProvider,
  sharedContextId: string,
  storageContextId: string,
  chatUserId: string,
  wrappedBuiltins: ToolSet,
  mode: MakeToolsOptions['mode'],
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
  const pluginTools = buildPluginToolSet(activePluginIds, new Set(Object.keys(wrappedBuiltins)), {
    provider,
    storageContextId,
    chatUserId,
    mode,
  })

  const mcpPluginIds = activePlugins.filter((p) => p.manifest.mcp !== undefined).map((p) => p.manifest.id)
  const extraMcpTools = await buildMcpToolsForPlugins(mcpPluginIds, sharedContextId)

  return { pluginTools, extraMcpTools }
}

async function buildProviderlessPluginAndMcpTools(
  sharedContextId: string,
  storageContextId: string,
  chatUserId: string,
  wrappedBuiltins: ToolSet,
  mode: MakeToolsOptions['mode'],
): Promise<{ pluginTools: ToolSet; extraMcpTools: ToolSet }> {
  const activePlugins = getPluginsForContext(sharedContextId)
  if (activePlugins.length === 0) return { pluginTools: {}, extraMcpTools: {} }

  const activePluginIds = activePlugins
    .map((p) => p.manifest.id)
    .filter((id) => contributionRegistry.getContributions(id) !== undefined)
  const providerlessPluginIds = filterProviderlessPluginIds(activePluginIds)
  // See buildPluginAndMcpTools: eligibility/MCP use the group-shared context id; the
  // runtime uses the raw thread-scoped storage context id.
  const pluginTools = buildPluginToolSet(providerlessPluginIds, new Set(Object.keys(wrappedBuiltins)), {
    provider: undefined,
    storageContextId,
    chatUserId,
    mode,
  })

  const mcpPluginIds = filterProviderlessPluginIds(
    activePlugins.filter((p) => p.manifest.mcp !== undefined).map((p) => p.manifest.id),
  )
  const extraMcpTools = await buildMcpToolsForPlugins(mcpPluginIds, sharedContextId)

  return { pluginTools, extraMcpTools }
}

type ResolvedToolAssemblyOptions = {
  chatUserId: string | undefined
  username: string | null | undefined
  contextId: string | undefined
  sharedContextId: string | undefined
  mode: ToolMode
  contextType: MakeToolsOptions['contextType']
  stagedDownloadFn: MakeToolsOptions['stagedDownloadFn']
}

function resolveToolAssemblyOptions(options: MakeToolsOptions): ResolvedToolAssemblyOptions {
  const contextId = options.storageContextId
  const sharedContextId = contextId === undefined ? undefined : getConfigContextIdFromStorageContextId(contextId)
  return {
    chatUserId: options.chatUserId,
    username: options.username,
    contextId,
    sharedContextId,
    mode: options.mode ?? 'normal',
    contextType: options.contextType,
    stagedDownloadFn: options.stagedDownloadFn,
  }
}

type BuildPluginAndMcpToolsFn = (
  sharedContextId: string,
  contextId: string,
  chatUserId: string,
  wrappedBuiltins: ToolSet,
) => Promise<{ pluginTools: ToolSet; extraMcpTools: ToolSet }>

async function assembleMcpPluginModuleTools(
  wrappedBuiltins: ToolSet,
  resolved: Pick<ResolvedToolAssemblyOptions, 'sharedContextId' | 'contextId' | 'chatUserId'>,
  buildPluginAndMcp: BuildPluginAndMcpToolsFn,
): Promise<ToolSet> {
  const { sharedContextId, contextId, chatUserId } = resolved

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
    const result = await buildPluginAndMcp(sharedContextId, contextId, chatUserId, wrappedBuiltins)
    pluginTools = result.pluginTools
    Object.assign(mcpTools, result.extraMcpTools)
  }

  let moduleTools: ToolSet = {}
  if (contextId !== undefined && chatUserId !== undefined) {
    const existing = new Set([...Object.keys(wrappedBuiltins), ...Object.keys(mcpTools), ...Object.keys(pluginTools)])
    moduleTools = buildModuleToolSet(existing, { storageContextId: contextId, chatUserId })
  }
  return { ...wrappedBuiltins, ...mcpTools, ...pluginTools, ...moduleTools }
}

/**
 * Build the raw (preference-unfiltered) tool set for the given provider and context.
 * The result may be cached by the orchestrator; per-turn preference application
 * (including ask-gating) is done separately via `applyToolPreferences`.
 */
export function buildToolDescriptors(provider: TaskProvider, options: MakeToolsOptions): Promise<ToolSet> {
  const resolved = resolveToolAssemblyOptions(options)
  const { chatUserId, username, contextId, mode, contextType, stagedDownloadFn } = resolved

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
  const wrappedBuiltins = wrapToolSet(tools)

  return assembleMcpPluginModuleTools(wrappedBuiltins, resolved, (sharedContextId, ctx, user, builtins) =>
    buildPluginAndMcpTools(provider, sharedContextId, ctx, user, builtins, mode),
  )
}

export function buildProviderlessToolDescriptors(options: MakeToolsOptions): Promise<ToolSet> {
  const resolved = resolveToolAssemblyOptions(options)
  const { chatUserId, username, contextId, mode, contextType, stagedDownloadFn } = resolved

  const tools = buildProviderlessTools(
    chatUserId,
    contextId,
    mode,
    contextType,
    username,
    stagedDownloadFn,
    options.chatParticipantResolver,
  )
  const wrappedBuiltins = wrapToolSet(tools)

  return assembleMcpPluginModuleTools(wrappedBuiltins, resolved, (sharedContextId, ctx, user, builtins) =>
    buildProviderlessPluginAndMcpTools(sharedContextId, ctx, user, builtins, mode),
  )
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
