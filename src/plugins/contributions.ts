// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'
import { tool } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { wrapToolExecution } from '../tools/wrap-tool-execution.js'
import type { PluginContributions, PluginManifest, PluginPromptFragment, PluginTool } from './types.js'

const log = logger.child({ scope: 'plugins:contributions' })

/** Maximum prompt fragment length per plugin (characters). */
export const MAX_FRAGMENT_LENGTH_PER_PLUGIN = 2000

/** Maximum total plugin prompt budget (characters). */
export const MAX_TOTAL_PLUGIN_PROMPT_LENGTH = 8000

/** Sanitize a plugin ID to a valid tool name prefix (replace hyphens with underscores). */
export function sanitizePluginId(pluginId: string): string {
  return pluginId.replace(/-/gu, '_')
}

/** Namespace a tool name under a plugin. */
export function namespacedToolName(pluginId: string, toolName: string): string {
  return `plugin_${sanitizePluginId(pluginId)}__${toolName}`
}

/** Active contributions from a single plugin. */
export type ActivePluginContributions = {
  pluginId: string
  tools: PluginTool[]
  promptFragments: PluginPromptFragment[]
}

/** Registry of active plugin contributions (in-memory, per-process). */
class PluginContributionRegistry {
  private readonly activeContributions = new Map<string, ActivePluginContributions>()

  register(pluginId: string, rawContributions: PluginContributions, manifest: PluginManifest): void {
    // Validate all contributed tools are in the manifest
    const declaredTools = new Set(manifest.contributes.tools)
    const validTools = rawContributions.tools.filter((t) => {
      if (declaredTools.has(t.name)) return true
      log.warn({ pluginId, toolName: t.name }, 'Plugin contributed undeclared tool — skipping')
      return false
    })

    // Validate all contributed prompt fragments are in the manifest
    const declaredFragments = new Set(manifest.contributes.promptFragments)
    const validFragments = rawContributions.promptFragments.filter((f) => {
      if (declaredFragments.has(f.name)) return true
      log.warn({ pluginId, fragmentName: f.name }, 'Plugin contributed undeclared prompt fragment — skipping')
      return false
    })

    this.activeContributions.set(pluginId, {
      pluginId,
      tools: validTools,
      promptFragments: validFragments,
    })
    log.info(
      { pluginId, toolCount: validTools.length, fragmentCount: validFragments.length },
      'Plugin contributions registered',
    )
  }

  deregister(pluginId: string): void {
    this.activeContributions.delete(pluginId)
    log.debug({ pluginId }, 'Plugin contributions deregistered')
  }

  getActivePluginIds(): string[] {
    return Array.from(this.activeContributions.keys())
  }

  getContributions(pluginId: string): ActivePluginContributions | undefined {
    return this.activeContributions.get(pluginId)
  }

  getAllContributions(): ActivePluginContributions[] {
    return Array.from(this.activeContributions.values())
  }
}

/** Singleton contribution registry. */
export const contributionRegistry = new PluginContributionRegistry()

/**
 * Build a ToolSet from the active plugin contributions for a given set of active plugin IDs.
 * Collisions with built-in tool names or other plugin tools are rejected with a warning.
 */
export function buildPluginToolSet(activePluginIds: string[], existingToolNames: ReadonlySet<string>): ToolSet {
  const pluginTools: ToolSet = {}
  const usedNames = new Set<string>(existingToolNames)

  for (const pluginId of activePluginIds) {
    const contributions = contributionRegistry.getContributions(pluginId)
    if (contributions === undefined) continue

    for (const pluginTool of contributions.tools) {
      const namespacedName = namespacedToolName(pluginId, pluginTool.name)

      if (usedNames.has(namespacedName)) {
        log.warn({ pluginId, toolName: namespacedName }, 'Plugin tool name collision — skipping')
        continue
      }

      usedNames.add(namespacedName)

      const schema = pluginTool.inputSchema ?? z.object({})
      const wrappedExecute = wrapToolExecution(pluginTool.execute, namespacedName)

      pluginTools[namespacedName] = tool({
        description: pluginTool.description,
        inputSchema: schema,
        execute: wrappedExecute,
      })
    }
  }

  return pluginTools
}

/**
 * Build prompt fragment text for the active plugin IDs.
 * Enforces per-plugin and total length budgets.
 */
export function buildPluginPromptSection(activePluginIds: string[]): string {
  const sections: string[] = []
  let totalLength = 0

  for (const pluginId of activePluginIds) {
    const contributions = contributionRegistry.getContributions(pluginId)
    if (contributions === undefined || contributions.promptFragments.length === 0) continue

    for (const fragment of contributions.promptFragments) {
      if (totalLength >= MAX_TOTAL_PLUGIN_PROMPT_LENGTH) {
        log.warn({ pluginId }, 'Total plugin prompt budget exceeded — stopping')
        break
      }

      const rawContent = typeof fragment.content === 'function' ? fragment.content() : fragment.content
      const truncated =
        rawContent.length > MAX_FRAGMENT_LENGTH_PER_PLUGIN
          ? rawContent.slice(0, MAX_FRAGMENT_LENGTH_PER_PLUGIN - '[truncated]'.length) + '[truncated]'
          : rawContent

      const section = `<!-- plugin:${pluginId}:${fragment.name} -->\n${truncated}\n<!-- /plugin:${pluginId}:${fragment.name} -->`
      sections.push(section)
      totalLength += section.length
    }

    if (totalLength >= MAX_TOTAL_PLUGIN_PROMPT_LENGTH) break
  }

  return sections.join('\n\n')
}
