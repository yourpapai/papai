// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import type { TaskProviderAutoProvision, TaskProviderFactory, TaskProviderProvision } from '../providers/registry.js'
import type { ProviderConfigField } from '../providers/types.js'
import { buildIdentityLookupFacade, type PluginIdentityLookupFacade } from './identity-facade.js'
import { buildPermissions, type PluginPermissionSet } from './permission-set.js'
import { buildProviderRuntime, type PluginProviderRuntime } from './provider-runtime.js'
import { buildActivationGuard, buildNamedRegistrationHandlers, type ActivationGuard } from './registration-support.js'
import type { PluginContributions } from './runtime-types.js'
import { getPluginAdminConfig, kvDelete, kvGet, kvList, kvSet } from './store.js'
import type { PluginManifest, PluginCommand, PluginTool, PluginPromptFragment, PluginScheduledJob } from './types.js'

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

/** Registration API given to a plugin's activate() function. */
type TaskProviderRegistrationInput =
  | TaskProviderFactory
  | {
      factory: TaskProviderFactory
      autoProvision?: TaskProviderAutoProvision
      provision?: TaskProviderProvision
    }

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
  registerTaskProviderType(type: string, input: TaskProviderRegistrationInput): void
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
  readonly identity?: PluginIdentityLookupFacade
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
      const rows = prefix === undefined ? kvList(pluginId, contextId) : kvList(pluginId, contextId, prefix)
      return rows.map((row) => ({ key: row.key, value: row.value }))
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

const toProviderConfigField = (
  field: { key: string; label: string; required: boolean; sensitive: boolean; storageKey?: string },
  scope: ProviderConfigField['scope'],
): ProviderConfigField => ({
  key: field.key,
  label: field.label,
  required: field.required,
  sensitive: field.sensitive,
  scope,
  ...(field.storageKey === undefined ? {} : { storageKey: field.storageKey }),
})

function buildRegisterTaskProviderType(
  manifest: PluginManifest,
  collected: PluginContributions,
  activationGuard: ActivationGuard,
): (type: string, input: TaskProviderRegistrationInput) => void {
  return function registerTaskProviderType(type: string, input: TaskProviderRegistrationInput): void {
    activationGuard.assertOpen()
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
    const registration = typeof input === 'function' ? { factory: input } : input
    collected.taskProviderRegistration = {
      type,
      factory: registration.factory,
      autoProvision: registration.autoProvision,
      provision: registration.provision,
      capabilities: new Set(manifest.providerCapabilities),
      displayName: manifest.name,
      instanceConfigSchema: manifest.providerConfigSchema.map((field) => toProviderConfigField(field, 'instance')),
      contextConfigSchema: (manifest.providerContextConfigSchema ?? []).map((field) =>
        toProviderConfigField(field, 'context'),
      ),
      traits: new Set(manifest.providerTraits),
    }
  }
}

function buildRegistration(
  manifest: PluginManifest,
  collected: PluginContributions,
  activationGuard: ActivationGuard,
): PluginRegistration {
  const namedRegistrations = buildNamedRegistrationHandlers(manifest, {
    activationGuard,
    registerTool: (tool) => {
      collected.tools.push(tool)
    },
    registerPromptFragment: (fragment) => {
      collected.promptFragments.push(fragment)
    },
    registerCommand: (command) => {
      collected.commands = [...(collected.commands ?? []), command]
    },
    registerScheduledJob: (job) => {
      collected.jobs = [...(collected.jobs ?? []), job]
    },
  })
  return Object.freeze({
    registerTool(tool: PluginTool): void {
      namedRegistrations.registerTool(tool)
    },
    registerPromptFragment(fragment: PluginPromptFragment): void {
      namedRegistrations.registerPromptFragment(fragment)
    },
    registerCommand(command: PluginCommand): void {
      namedRegistrations.registerCommand(command)
    },
    registerScheduledJob(job: PluginScheduledJob): void {
      namedRegistrations.registerScheduledJob(job)
    },
    registerTaskProviderType: buildRegisterTaskProviderType(manifest, collected, activationGuard),
  })
}

type BuildPluginContextOptions = {
  registrationInitiallyOpen?: boolean
}

export type BuiltPluginContext = {
  ctx: PluginContext
  collected: PluginContributions
  closeRegistration(): void
}

/**
 * Build a PluginContext for use during plugin activation.
 * Returns the context and the collected contributions (populated during activate()).
 */
export function buildPluginContext(
  manifest: PluginManifest,
  contextId: string,
  options: BuildPluginContextOptions = {},
): BuiltPluginContext {
  const permissions = buildPermissions(manifest.permissions)
  const collected: PluginContributions = { tools: [], promptFragments: [], commands: [], jobs: [] }
  const activationGuard = buildActivationGuard()
  if (options.registrationInitiallyOpen === false) {
    activationGuard.close()
  }

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
      ? buildIdentityLookupFacade(declaredProviderType)
      : undefined

  const ctx: PluginContext = Object.freeze({
    pluginId: manifest.id,
    contextId,
    permissions,
    kv,
    log,
    registration: buildRegistration(manifest, collected, activationGuard),
    providerRuntime,
    identity,
    adminConfig: buildAdminConfig(manifest),
  })

  return {
    ctx,
    collected,
    closeRegistration(): void {
      activationGuard.close()
    },
  }
}

export async function runWithClosedRegistration<T>(
  builtContext: BuiltPluginContext,
  callback: (ctx: PluginContext) => Promise<T> | T,
): Promise<T> {
  const result = callback(builtContext.ctx)
  if (!(result instanceof Promise)) {
    builtContext.closeRegistration()
    return result
  }
  try {
    return await result
  } finally {
    builtContext.closeRegistration()
  }
}

function buildDeniedKvStore(pluginId: string): PluginKvStore {
  const deny = (): never => {
    throw new Error(`Plugin ${pluginId} does not have 'storage' permission`)
  }
  return Object.freeze({ get: deny, set: deny, delete: deny, list: deny })
}
