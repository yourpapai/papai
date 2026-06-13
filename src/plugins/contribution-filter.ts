// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import type {
  PluginAttachmentTransformer,
  PluginCommand,
  PluginContributions,
  PluginManifest,
  PluginPromptFragment,
  PluginScheduledJob,
  PluginTool,
} from './types.js'

const log = logger.child({ scope: 'plugins:contribution-filter' })

export function getValidTools(
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

export function getValidPromptFragments(
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

export function getValidCommands(
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

export function getValidJobs(
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

export function getValidAttachmentTransformers(
  pluginId: string,
  rawContributions: PluginContributions,
  manifest: PluginManifest,
): PluginAttachmentTransformer[] {
  const declaredTransformers = new Set(manifest.contributes.attachmentTransformers)
  return (rawContributions.attachmentTransformers ?? []).filter((transformer) => {
    if (declaredTransformers.has(transformer.name)) return true
    log.warn(
      { pluginId, transformerName: transformer.name },
      'Plugin contributed undeclared attachment transformer — skipping',
    )
    return false
  })
}
