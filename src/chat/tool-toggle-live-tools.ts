// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigContextIdFromStorageContextId, parseScopedContextId } from '../chat/scoped-context.js'
import { getPluginConfig } from '../config.js'
import { adaptMcpPool, buildMcpToolSet, buildPluginMcpToolSet } from '../mcp/index.js'
import type { PluginMcpDescriptor } from '../mcp/plugin-endpoints.js'
import { buildPluginToolSet, contributionRegistry } from '../plugins/contributions.js'
import { getPluginsForContext } from '../plugins/registry.js'
import type { TaskProvider } from '../providers/types.js'
import { getToolMetadata } from '../tools/tool-metadata.js'
import { buildTools } from '../tools/tools-builder.js'
import type { IncomingInteraction } from './types.js'

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

export function resolveTargetContextType(interaction: IncomingInteraction, targetContextId: string): 'dm' | 'group' {
  if (interaction.contextType !== 'dm') return interaction.contextType
  if (targetContextId === interaction.user.id || targetContextId === interaction.storageContextId) return 'dm'

  const parsedTarget = parseScopedContextId(targetContextId)
  if (
    parsedTarget !== null &&
    parsedTarget.threadId === undefined &&
    parsedTarget.platformInstanceId === interaction.platformInstanceId &&
    parsedTarget.nativeContextId === interaction.user.id
  ) {
    return 'dm'
  }

  return 'group'
}

function addToolNames(target: Set<string>, toolNames: readonly string[]): void {
  toolNames.forEach((name) => {
    target.add(name)
  })
}

async function addMcpToolNames(target: Set<string>, sharedContextId: string): Promise<void> {
  try {
    addToolNames(target, Object.keys(await buildMcpToolSet(sharedContextId)))
  } catch {
    // MCP failures should not break the tool toggle UI.
  }
}

async function addPluginMcpToolNames(
  target: Set<string>,
  pluginMcpIds: readonly string[],
  sharedContextId: string,
): Promise<void> {
  try {
    const pluginMcpTools = await buildPluginMcpToolSet(
      pluginMcpIds,
      buildPluginMcpDescriptors(pluginMcpIds, sharedContextId),
      adaptMcpPool(),
    )
    addToolNames(target, Object.keys(pluginMcpTools))
  } catch {
    // Plugin MCP failures should not break the tool toggle UI.
  }
}

async function addPluginToolNames(
  target: Set<string>,
  sharedContextId: string,
  provider: TaskProvider,
  actorUserId: string,
): Promise<void> {
  const activePlugins = getPluginsForContext(sharedContextId)
  if (activePlugins.length === 0) return

  const activePluginIds = activePlugins
    .map((plugin) => plugin.manifest.id)
    .filter((pluginId) => contributionRegistry.getContributions(pluginId) !== undefined)
  const pluginTools = buildPluginToolSet(activePluginIds, target, {
    provider,
    storageContextId: sharedContextId,
    chatUserId: actorUserId,
  })
  addToolNames(target, Object.keys(pluginTools))

  const pluginMcpIds = activePlugins
    .filter((plugin) => plugin.manifest.mcp !== undefined)
    .map((plugin) => plugin.manifest.id)
  if (pluginMcpIds.length === 0) return
  await addPluginMcpToolNames(target, pluginMcpIds, sharedContextId)
}

export async function availableToolNamesWithProvider(
  interaction: IncomingInteraction,
  targetContextId: string,
  actorUserId: string,
  provider: TaskProvider | null,
): Promise<string[]> {
  if (provider === null) return []

  const contextType = resolveTargetContextType(interaction, targetContextId)
  const sharedContextId = getConfigContextIdFromStorageContextId(targetContextId)
  const builtinTools = buildTools(provider, actorUserId, targetContextId, 'normal', contextType)
  const toolNames = new Set(Object.keys(builtinTools))

  await addMcpToolNames(toolNames, sharedContextId)
  await addPluginToolNames(toolNames, sharedContextId, provider, actorUserId)

  return [...toolNames].filter((name) => getToolMetadata(name) !== undefined)
}
