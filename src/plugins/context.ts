// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import type { TaskProviderFactory } from '../providers/registry.js'
import type { ProviderConfigField } from '../providers/types.js'
import { buildIdentityFacade, type PluginIdentityFacade } from './identity-facade.js'
import { buildProviderRuntime, type PluginProviderRuntime } from './provider-runtime.js'
import type { PluginContributions } from './runtime-types.js'
import { getPluginAdminConfig, kvDelete, kvGet, kvList, kvSet } from './store.js'
import type {
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

/** Admin-scoped config facade exposed to plugins. */
export type PluginAdminConfig = {
  get(key: string): string | undefined
}

export type PluginPermissionSet = Pick<
  ReadonlySet<PluginPermission>,
  'has' | 'forEach' | 'entries' | 'keys' | 'values' | 'size'
> & {
  [Symbol.iterator](): SetIterator<PluginPermission>
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
  registerTaskProviderType(type: string, factory: TaskProviderFactory): void
}

/** Full context passed to a plugin's activate() function. */
export type PluginContext = {
  readonly pluginId: string
  readonly contextId: string
  readonly permissions: PluginPermissionSet
  readonly kv: PluginKvStore
  readonly log: PluginLogger
  readonly registration: PluginRegistration
  /** Present only when the 'provider.task' or 'http' permission is held. */
  readonly providerRuntime?: PluginProviderRuntime
  /** Present only when 'identity' is held and the plugin declares one task provider type. */
  readonly identity?: PluginIdentityFacade
  readonly adminConfig: PluginAdminConfig
}

function buildAdminConfig(manifest: PluginManifest): PluginAdminConfig {
  const adminKeys = new Set(manifest.configRequirements.filter((req) => req.scope === 'admin').map((req) => req.key))
  return Object.freeze({
    get(key: string): string | undefined {
      if (!adminKeys.has(key)) return undefined
      return getPluginAdminConfig(manifest.id, key)
    },
  })
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

function buildPermissions(manifest: PluginManifest): PluginPermissionSet {
  const permissions = new Set(manifest.permissions)
  return Object.freeze({
    get size(): number {
      return permissions.size
    },
    has(permission: PluginPermission): boolean {
      return permissions.has(permission)
    },
    forEach(
      callbackfn: (value: PluginPermission, value2: PluginPermission, set: ReadonlySet<PluginPermission>) => void,
      thisArg?: unknown,
    ): void {
      permissions.forEach((value) => {
        callbackfn.call(thisArg, value, value, permissions)
      })
    },
    entries(): SetIterator<[PluginPermission, PluginPermission]> {
      return permissions.entries()
    },
    keys(): SetIterator<PluginPermission> {
      return permissions.keys()
    },
    values(): SetIterator<PluginPermission> {
      return permissions.values()
    },
    [Symbol.iterator](): SetIterator<PluginPermission> {
      return permissions[Symbol.iterator]()
    },
  })
}

const toProviderConfigField = (
  field: { key: string; label: string; required: boolean; sensitive: boolean },
  scope: ProviderConfigField['scope'],
): ProviderConfigField => ({
  key: field.key,
  label: field.label,
  required: field.required,
  sensitive: field.sensitive,
  scope,
})

function buildRegisterTaskProviderType(
  manifest: PluginManifest,
  collected: PluginContributions,
): (type: string, factory: TaskProviderFactory) => void {
  return function registerTaskProviderType(type: string, factory: TaskProviderFactory): void {
    if (!manifest.permissions.includes('provider.task')) {
      throw new Error(`Plugin ${manifest.id} cannot register a task provider type without 'provider.task'`)
    }
    const declared = manifest.contributes.taskProviderTypes
    if (declared.length !== 1 || declared[0] !== type) {
      throw new Error(
        `Task provider type '${type}' is not declared in plugin manifest contributes.taskProviderTypes (declared: [${declared.join(', ')}])`,
      )
    }
    if (collected.taskProviderRegistration !== undefined) {
      throw new Error(`Task provider type '${type}' was registered more than once`)
    }
    collected.taskProviderRegistration = {
      type,
      factory,
      capabilities: new Set(manifest.providerCapabilities),
      displayName: manifest.name,
      instanceConfigSchema: manifest.providerConfigSchema.map((field) => toProviderConfigField(field, 'instance')),
      contextConfigSchema: (manifest.providerContextConfigSchema ?? []).map((field) =>
        toProviderConfigField(field, 'context'),
      ),
      traits: new Set(),
    }
  }
}

function rejectDuplicateRegistration(kind: string, name: string, duplicate: boolean): void {
  if (duplicate) {
    throw new Error(`${kind} '${name}' was registered more than once`)
  }
}

function buildRegistration(manifest: PluginManifest, collected: PluginContributions): PluginRegistration {
  const declaredTools = new Set(manifest.contributes.tools)
  const declaredFragments = new Set(manifest.contributes.promptFragments)
  const declaredCommands = new Set(manifest.contributes.commands)
  const declaredJobs = new Set(manifest.contributes.jobs)
  const registeredTools = new Set<string>()
  const registeredFragments = new Set<string>()
  const registeredCommands = new Set<string>()
  const registeredJobs = new Set<string>()

  return Object.freeze({
    registerTool(pluginTool: PluginTool): void {
      if (!declaredTools.has(pluginTool.name)) {
        throw new Error(`Tool '${pluginTool.name}' is not declared in plugin manifest contributes.tools`)
      }
      rejectDuplicateRegistration('Tool', pluginTool.name, registeredTools.has(pluginTool.name))
      registeredTools.add(pluginTool.name)
      collected.tools.push(pluginTool)
    },
    registerPromptFragment(fragment: PluginPromptFragment): void {
      if (!declaredFragments.has(fragment.name)) {
        throw new Error(
          `Prompt fragment '${fragment.name}' is not declared in plugin manifest contributes.promptFragments`,
        )
      }
      rejectDuplicateRegistration('Prompt fragment', fragment.name, registeredFragments.has(fragment.name))
      registeredFragments.add(fragment.name)
      collected.promptFragments.push(fragment)
    },
    registerCommand(command: PluginCommand): void {
      if (!declaredCommands.has(command.name)) {
        throw new Error(`Command '${command.name}' is not declared in plugin manifest contributes.commands`)
      }
      rejectDuplicateRegistration('Command', command.name, registeredCommands.has(command.name))
      registeredCommands.add(command.name)
      collected.commands = [...(collected.commands ?? []), command]
    },
    registerScheduledJob(job: PluginScheduledJob): void {
      if (!declaredJobs.has(job.name)) {
        throw new Error(`Scheduled job '${job.name}' is not declared in plugin manifest contributes.jobs`)
      }
      rejectDuplicateRegistration('Scheduled job', job.name, registeredJobs.has(job.name))
      registeredJobs.add(job.name)
      collected.jobs = [...(collected.jobs ?? []), job]
    },
    registerTaskProviderType: buildRegisterTaskProviderType(manifest, collected),
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
  const permissions = buildPermissions(manifest)
  const collected: PluginContributions = { tools: [], promptFragments: [], commands: [], jobs: [] }

  const kv = permissions.has('storage') ? buildKvStore(manifest.id, contextId) : buildDeniedKvStore(manifest.id)
  const log = buildPluginLogger(manifest.id)
  const providerRuntime =
    permissions.has('provider.task') || permissions.has('http')
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
    adminConfig: buildAdminConfig(manifest),
  })

  return { ctx, collected }
}

function buildDeniedKvStore(pluginId: string): PluginKvStore {
  const deny = (): never => {
    throw new Error(`Plugin ${pluginId} does not have 'storage' permission`)
  }
  return Object.freeze({ get: deny, set: deny, delete: deny, list: deny })
}
