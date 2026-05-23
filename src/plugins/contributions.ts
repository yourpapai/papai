// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'
import { tool } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { scheduler } from '../scheduler-instance.js'
import { wrapToolExecution } from '../tools/wrap-tool-execution.js'
import { namespacedJobName, namespacedToolName } from './contribution-names.js'
import { getEnabledContextsForPlugin } from './store.js'
import { buildPluginToolRuntimeContext, type PluginToolSetRuntime } from './tool-runtime.js'
import type {
  PluginCommand,
  PluginContributions,
  PluginManifest,
  PluginPromptFragment,
  PluginScheduledJob,
  PluginTool,
} from './types.js'

const log = logger.child({ scope: 'plugins:contributions' })
export { namespacedJobName, namespacedToolName, sanitizePluginId } from './contribution-names.js'

/** Active contributions from a single plugin. */
export type ActivePluginContributions = {
  pluginId: string
  manifest: PluginManifest
  tools: PluginTool[]
  promptFragments: PluginPromptFragment[]
  commands: PluginCommand[]
  jobs: PluginScheduledJob[]
}

export type { PluginToolSetRuntime } from './tool-runtime.js'

/** Registry of active plugin contributions (in-memory, per-process). */
class PluginContributionRegistry {
  private readonly activeContributions = new Map<string, ActivePluginContributions>()

  private unregisterPluginJobs(pluginId: string): void {
    const existing = this.activeContributions.get(pluginId)
    if (existing === undefined) return
    existing.jobs.forEach((job) => {
      const owner = namespacedJobName(pluginId, job.name)
      if (scheduler.hasTask(owner)) scheduler.unregister(owner)
    })
  }

  private registerPluginJobs(pluginId: string, jobs: readonly PluginScheduledJob[]): void {
    jobs.forEach((job) => {
      const owner = namespacedJobName(pluginId, job.name)
      if (scheduler.hasTask(owner)) scheduler.unregister(owner)
      scheduler.register(owner, {
        interval: job.intervalMs,
        handler: () => runPluginScheduledJob(pluginId, job.name),
        options: { immediate: false },
      })
      scheduler.start(owner)
    })
  }

  private getValidTools(
    pluginId: string,
    rawContributions: PluginContributions,
    manifest: PluginManifest,
  ): PluginTool[] {
    const declaredTools = new Set(manifest.contributes.tools)
    return rawContributions.tools.filter((t) => {
      if (declaredTools.has(t.name)) return true
      log.warn({ pluginId, toolName: t.name }, 'Plugin contributed undeclared tool — skipping')
      return false
    })
  }

  private getValidPromptFragments(
    pluginId: string,
    rawContributions: PluginContributions,
    manifest: PluginManifest,
  ): PluginPromptFragment[] {
    const declaredFragments = new Set(manifest.contributes.promptFragments)
    return rawContributions.promptFragments.filter((f) => {
      if (declaredFragments.has(f.name)) return true
      log.warn({ pluginId, fragmentName: f.name }, 'Plugin contributed undeclared prompt fragment — skipping')
      return false
    })
  }

  private getValidCommands(
    pluginId: string,
    rawContributions: PluginContributions,
    manifest: PluginManifest,
  ): PluginCommand[] {
    const declaredCommands = new Set(manifest.contributes.commands)
    return (rawContributions.commands ?? []).filter((command) => {
      if (declaredCommands.has(command.name)) return true
      log.warn({ pluginId, commandName: command.name }, 'Plugin contributed undeclared command — skipping')
      return false
    })
  }

  private getValidJobs(
    pluginId: string,
    rawContributions: PluginContributions,
    manifest: PluginManifest,
  ): PluginScheduledJob[] {
    const declaredJobs = new Set(manifest.contributes.jobs)
    return (rawContributions.jobs ?? []).filter((job) => {
      if (declaredJobs.has(job.name)) return true
      log.warn({ pluginId, jobName: job.name }, 'Plugin contributed undeclared scheduled job — skipping')
      return false
    })
  }

  register(pluginId: string, rawContributions: PluginContributions, manifest: PluginManifest): void {
    this.unregisterPluginJobs(pluginId)
    const validTools = this.getValidTools(pluginId, rawContributions, manifest)
    const validFragments = this.getValidPromptFragments(pluginId, rawContributions, manifest)
    const validCommands = this.getValidCommands(pluginId, rawContributions, manifest)
    const validJobs = this.getValidJobs(pluginId, rawContributions, manifest)

    this.activeContributions.set(pluginId, {
      pluginId,
      manifest,
      tools: validTools,
      promptFragments: validFragments,
      commands: validCommands,
      jobs: validJobs,
    })
    this.registerPluginJobs(pluginId, validJobs)
    log.info(
      {
        pluginId,
        toolCount: validTools.length,
        fragmentCount: validFragments.length,
        commandCount: validCommands.length,
        jobCount: validJobs.length,
      },
      'Plugin contributions registered',
    )
  }

  deregister(pluginId: string): void {
    this.unregisterPluginJobs(pluginId)
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

export async function runPluginScheduledJob(pluginId: string, jobName: string): Promise<void> {
  const contributions = contributionRegistry.getContributions(pluginId)
  const job = contributions?.jobs.find((candidate) => candidate.name === jobName)
  if (job === undefined) return

  await getEnabledContextsForPlugin(pluginId).reduce(
    (chain, contextId) => chain.then(() => Promise.resolve(job.execute(contextId))),
    Promise.resolve(),
  )
}

/**
 * Build a ToolSet from the active plugin contributions for a given set of active plugin IDs.
 * Collisions with built-in tool names or other plugin tools are rejected with a warning.
 */
export function buildPluginToolSet(
  activePluginIds: string[],
  existingToolNames: ReadonlySet<string>,
  runtime: PluginToolSetRuntime,
): ToolSet {
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
      const wrappedExecute = wrapToolExecution((input, options) => {
        return pluginTool.execute(
          input,
          buildPluginToolRuntimeContext(pluginId, contributions.manifest, runtime),
          options,
        )
      }, namespacedName)

      pluginTools[namespacedName] = tool({
        description: pluginTool.description,
        inputSchema: schema,
        execute: wrappedExecute,
      })
    }
  }

  return pluginTools
}
