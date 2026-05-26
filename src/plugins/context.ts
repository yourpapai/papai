// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import {
  registerContributedTaskProviderType,
  type TaskProviderFactory,
  type TaskProviderConfigValidator,
} from '../providers/registry.js'
import { buildIdentityFacade, type PluginIdentityFacade } from './identity-facade.js'
import { buildProviderRuntime, type PluginProviderRuntime } from './provider-runtime.js'
import { kvDelete, kvGet, kvList, kvSet } from './store.js'
import type {
  PluginContributions,
  PluginManifest,
  PluginPermission,
  PluginCommand,
  PluginTool,
  PluginPromptFragment,
  PluginScheduledJob,
} from './types.js'

/** Context-scoped KV store exposed to a plugin. */
export type PluginKvStore = {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
  list(prefix?: string): Array<{ key: string; value: string }>
}

/** Logger facade exposed to plugins. */
export type PluginLogger = {
  debug(data: Record<string, unknown>, msg: string): void
  info(data: Record<string, unknown>, msg: string): void
  warn(data: Record<string, unknown>, msg: string): void
  error(data: Record<string, unknown>, msg: string): void
}

/** Registration API given to a plugin's activate() function. */
export type PluginRegistration = {
  /** Register a tool contribution. The name must match a declared contributes.tools entry. */
  registerTool(tool: PluginTool): void
  /** Register a prompt fragment. The name must match a declared contributes.promptFragments entry. */
  registerPromptFragment(fragment: PluginPromptFragment): void
  /** Register a command. The name must match a declared contributes.commands entry. */
  registerCommand(command: PluginCommand): void
  /** Register a scheduled job. The name must match a declared contributes.jobs entry. */
  registerScheduledJob(job: PluginScheduledJob): void
  /** Register the plugin's single declared task provider type. Requires the 'provider.task' permission. */
  registerTaskProviderType(
    type: string,
    descriptor: { factory: TaskProviderFactory; validateConfig?: TaskProviderConfigValidator },
  ): void
}

/** Full context passed to a plugin's activate() function. */
export type PluginContext = {
  readonly pluginId: string
  readonly contextId: string
  readonly permissions: ReadonlySet<PluginPermission>
  readonly kv: PluginKvStore
  readonly log: PluginLogger
  readonly registration: PluginRegistration
  /** Present only when the 'provider.task' permission is held. */
  readonly providerRuntime?: PluginProviderRuntime
  /** Present only when 'identity' is held and the plugin declares one task provider type. */
  readonly identity?: PluginIdentityFacade
}

function buildKvStore(pluginId: string, contextId: string): PluginKvStore {
  return Object.freeze({
    get(key: string): string | undefined {
      return kvGet(pluginId, contextId, key)
    },
    set(key: string, value: string): void {
      kvSet(pluginId, contextId, key, value)
    },
    delete(key: string): void {
      kvDelete(pluginId, contextId, key)
    },
    list(prefix?: string): Array<{ key: string; value: string }> {
      return kvList(pluginId, contextId, prefix).map((row) => ({ key: row.key, value: row.value }))
    },
  })
}

function buildPluginLogger(pluginId: string): PluginLogger {
  const scopedLog = logger.child({ scope: 'plugin', pluginId })
  return Object.freeze({
    debug(data: Record<string, unknown>, msg: string): void {
      scopedLog.debug(data, msg)
    },
    info(data: Record<string, unknown>, msg: string): void {
      scopedLog.info(data, msg)
    },
    warn(data: Record<string, unknown>, msg: string): void {
      scopedLog.warn(data, msg)
    },
    error(data: Record<string, unknown>, msg: string): void {
      scopedLog.error(data, msg)
    },
  })
}

function buildRegisterTaskProviderType(
  manifest: PluginManifest,
): (type: string, descriptor: { factory: TaskProviderFactory; validateConfig?: TaskProviderConfigValidator }) => void {
  return function registerTaskProviderType(
    type: string,
    descriptor: { factory: TaskProviderFactory; validateConfig?: TaskProviderConfigValidator },
  ): void {
    if (!manifest.permissions.includes('provider.task')) {
      throw new Error(`Plugin ${manifest.id} cannot register a task provider type without 'provider.task'`)
    }
    const declared = manifest.contributes.taskProviderTypes
    if (declared.length !== 1 || declared[0] !== type) {
      throw new Error(
        `Task provider type '${type}' is not declared in plugin manifest contributes.taskProviderTypes (declared: [${declared.join(', ')}])`,
      )
    }
    registerContributedTaskProviderType(type, {
      pluginId: manifest.id,
      factory: descriptor.factory,
      validateConfig: descriptor.validateConfig,
      capabilities: new Set(manifest.providerCapabilities),
      displayName: manifest.name,
      configSchema: manifest.providerConfigSchema,
    })
  }
}

function buildRegistration(manifest: PluginManifest, collected: PluginContributions): PluginRegistration {
  const declaredTools = new Set(manifest.contributes.tools)
  const declaredFragments = new Set(manifest.contributes.promptFragments)
  const declaredCommands = new Set(manifest.contributes.commands)
  const declaredJobs = new Set(manifest.contributes.jobs)

  return Object.freeze({
    registerTool(pluginTool: PluginTool): void {
      if (!declaredTools.has(pluginTool.name)) {
        throw new Error(`Tool '${pluginTool.name}' is not declared in plugin manifest contributes.tools`)
      }
      collected.tools.push(pluginTool)
    },
    registerPromptFragment(fragment: PluginPromptFragment): void {
      if (!declaredFragments.has(fragment.name)) {
        throw new Error(
          `Prompt fragment '${fragment.name}' is not declared in plugin manifest contributes.promptFragments`,
        )
      }
      collected.promptFragments.push(fragment)
    },
    registerCommand(command: PluginCommand): void {
      if (!declaredCommands.has(command.name)) {
        throw new Error(`Command '${command.name}' is not declared in plugin manifest contributes.commands`)
      }
      collected.commands = [...(collected.commands ?? []), command]
    },
    registerScheduledJob(job: PluginScheduledJob): void {
      if (!declaredJobs.has(job.name)) {
        throw new Error(`Scheduled job '${job.name}' is not declared in plugin manifest contributes.jobs`)
      }
      collected.jobs = [...(collected.jobs ?? []), job]
    },
    registerTaskProviderType: buildRegisterTaskProviderType(manifest),
  })
}

/**
 * Build a PluginContext for use during plugin activation.
 * Returns the context and the collected contributions (populated during activate()).
 */
export function buildPluginContext(
  manifest: PluginManifest,
  contextId: string,
): { ctx: PluginContext; collected: PluginContributions } {
  const permissions = new Set(manifest.permissions) as ReadonlySet<PluginPermission>
  const collected: PluginContributions = { tools: [], promptFragments: [], commands: [], jobs: [] }

  const kv = permissions.has('storage') ? buildKvStore(manifest.id, contextId) : buildDeniedKvStore(manifest.id)
  const log = buildPluginLogger(manifest.id)
  const providerRuntime = permissions.has('provider.task')
    ? buildProviderRuntime(manifest.providerAllowedHosts, log)
    : undefined

  const declaredTypes = manifest.contributes.taskProviderTypes
  const [declaredProviderType] = declaredTypes
  const identity =
    permissions.has('identity') && declaredTypes.length === 1 && declaredProviderType !== undefined
      ? buildIdentityFacade(declaredProviderType)
      : undefined

  const ctx: PluginContext = Object.freeze({
    pluginId: manifest.id,
    contextId,
    permissions,
    kv,
    log,
    registration: buildRegistration(manifest, collected),
    providerRuntime,
    identity,
  })

  return { ctx, collected }
}

function buildDeniedKvStore(pluginId: string): PluginKvStore {
  const deny = (): never => {
    throw new Error(`Plugin ${pluginId} does not have 'storage' permission`)
  }
  return Object.freeze({ get: deny, set: deny, delete: deny, list: deny })
}
