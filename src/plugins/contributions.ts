// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'
import { tool } from 'ai'

import { logger } from '../logger.js'
import { defaultTaskProviderResolver } from '../providers/resolver.js'
import type { TaskProvider } from '../providers/types.js'
import { scheduler } from '../scheduler-instance.js'
import { wrapToolExecution } from '../tools/wrap-tool-execution.js'
import {
  getValidAttachmentTransformers,
  getValidCommands,
  getValidJobs,
  getValidPromptFragments,
  getValidTools,
} from './contribution-filter.js'
import { namespacedJobName, namespacedToolName } from './contribution-names.js'
import { getPluginToolInputSchema } from './input-schema.js'
import { getPluginContextEligibility } from './registry.js'
import { getScheduledJobContextIds } from './scheduled-contexts.js'
import { recordRuntimeEvent } from './store.js'
import {
  buildPluginScheduledJobRuntimeContext,
  buildPluginToolRuntimeContext,
  type PluginToolSetRuntime,
} from './tool-runtime.js'
import type {
  PluginAttachmentTransformer,
  PluginCommand,
  PluginContributions,
  PluginManifest,
  PluginPromptFragment,
  PluginScheduledJob,
  PluginTool,
} from './types.js'

const log = logger.child({ scope: 'plugins:contributions' })
const recordedToolCollisionEvents = new Set<string>()
export { namespacedJobName, namespacedToolName, sanitizePluginId } from './contribution-names.js'

export function resetContributionCollisionStateForTesting(): void {
  recordedToolCollisionEvents.clear()
}

export type ActivePluginContributions = {
  pluginId: string
  manifest: PluginManifest
  tools: PluginTool[]
  promptFragments: PluginPromptFragment[]
  commands: PluginCommand[]
  jobs: PluginScheduledJob[]
  attachmentTransformers: PluginAttachmentTransformer[]
}

export type { PluginToolSetRuntime } from './tool-runtime.js'

export type PluginScheduledJobDeps = Readonly<{
  resolveTaskProvider: (contextId: string) => Promise<TaskProvider | null> | TaskProvider | null
}>

const defaultScheduledJobDeps: PluginScheduledJobDeps = {
  resolveTaskProvider: (contextId) => defaultTaskProviderResolver.resolve(contextId),
}

const manifestUsesTaskProviderFacade = (manifest: PluginManifest): boolean => {
  if (manifest.permissions.includes('tasks.read')) return true
  return manifest.permissions.includes('tasks.write')
}

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

  register(pluginId: string, rawContributions: PluginContributions, manifest: PluginManifest): void {
    this.unregisterPluginJobs(pluginId)
    const validTools = getValidTools(pluginId, rawContributions, manifest)
    const validFragments = getValidPromptFragments(pluginId, rawContributions, manifest)
    const validCommands = getValidCommands(pluginId, rawContributions, manifest)
    const validJobs = getValidJobs(pluginId, rawContributions, manifest)
    const validTransformers = getValidAttachmentTransformers(pluginId, rawContributions, manifest)

    this.activeContributions.set(pluginId, {
      pluginId,
      manifest,
      tools: validTools,
      promptFragments: validFragments,
      commands: validCommands,
      jobs: validJobs,
      attachmentTransformers: validTransformers,
    })
    this.registerPluginJobs(pluginId, validJobs)
    log.info(
      {
        pluginId,
        toolCount: validTools.length,
        fragmentCount: validFragments.length,
        commandCount: validCommands.length,
        jobCount: validJobs.length,
        transformerCount: validTransformers.length,
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

export const contributionRegistry = new PluginContributionRegistry()

type RunPluginScheduledJobArgs =
  | readonly [pluginId: string, jobName: string]
  | readonly [pluginId: string, jobName: string, deps: PluginScheduledJobDeps]

const getScheduledJobDeps = (args: RunPluginScheduledJobArgs): PluginScheduledJobDeps => {
  if (args.length === 3) return args[2]
  return defaultScheduledJobDeps
}

export async function runPluginScheduledJob(...args: RunPluginScheduledJobArgs): Promise<void> {
  const [pluginId, jobName] = args
  const contributions = contributionRegistry.getContributions(pluginId)
  if (contributions === undefined) return

  const job = contributions.jobs.find((candidate) => candidate.name === jobName)
  if (job === undefined) return

  const deps = getScheduledJobDeps(args)

  await getScheduledJobContextIds(pluginId, contributions.manifest).reduce(async (chain, contextId) => {
    await chain
    try {
      const eligibility = getPluginContextEligibility(pluginId, contextId)
      if (!eligibility.eligible) {
        log.warn({ pluginId, jobName, contextId, reason: eligibility.reason }, 'Plugin job skipping ineligible context')
        return
      }

      const provider = manifestUsesTaskProviderFacade(contributions.manifest)
        ? await deps.resolveTaskProvider(contextId)
        : undefined
      if (provider === null) {
        log.warn({ pluginId, jobName, contextId }, 'Plugin job skipping context with unresolved task provider')
        return
      }

      await job.execute(buildPluginScheduledJobRuntimeContext(pluginId, contextId, contributions.manifest, provider))
    } catch (error) {
      log.error(
        { pluginId, jobName, contextId, error: error instanceof Error ? error.message : String(error) },
        'Plugin job context processing threw',
      )
    }
  }, Promise.resolve())
}

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
        const message = `Tool contribution '${namespacedName}' skipped because the name already exists`
        const collisionKey = `${pluginId}:${namespacedName}`
        log.warn({ pluginId, toolName: namespacedName }, 'Plugin tool name collision — skipping')
        if (!recordedToolCollisionEvents.has(collisionKey)) {
          recordedToolCollisionEvents.add(collisionKey)
          recordRuntimeEvent(pluginId, 'skipped', message)
        }
        continue
      }

      usedNames.add(namespacedName)

      const schema = getPluginToolInputSchema(pluginTool)
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
