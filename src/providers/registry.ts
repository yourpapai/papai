// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskInstance } from '../instances/types.js'
import { logger } from '../logger.js'
import { builtinDescriptorSeeds } from './builtin-descriptors.js'
import { isKaneoSessionCookie, KaneoProvider, type KaneoConfig } from './kaneo/index.js'
import type { TaskCapability } from './task-capability.js'
import type { ProviderConfigField, TaskProvider, TaskProviderTrait } from './types.js'
import { YouTrackProvider } from './youtrack/index.js'

const log = logger.child({ scope: 'provider:registry' })

export type TaskProviderFactory = (config: Record<string, string>) => TaskProvider

export type TaskProviderConfigValidator = (
  config: Record<string, string>,
) => Promise<{ ok: true } | { ok: false; reason: string }>

type TaskProviderConfigValidatorResult = Awaited<ReturnType<TaskProviderConfigValidator>>

type ProviderFactory = TaskProviderFactory

const configValue = (config: Record<string, string>, key: string): string => {
  const value = config[key]
  if (value === undefined) return ''
  return value
}

/** Register the built-in Kaneo provider. */
const createKaneoProvider: ProviderFactory = (config) => {
  const baseUrl = configValue(config, 'baseUrl')
  const workspaceId = configValue(config, 'workspaceId')
  const credential = configValue(config, 'credential')

  const kaneoConfig: KaneoConfig = isKaneoSessionCookie(credential)
    ? { apiKey: '', baseUrl, sessionCookie: credential }
    : { apiKey: credential, baseUrl }

  return new KaneoProvider(kaneoConfig, workspaceId)
}

/** Register the built-in YouTrack provider. */
const createYouTrackProvider: ProviderFactory = (config) => {
  const baseUrl = configValue(config, 'baseUrl')
  const token = configValue(config, 'token')
  return new YouTrackProvider({ baseUrl, token })
}

const providers = new Map<string, ProviderFactory>([
  ['kaneo', createKaneoProvider],
  ['youtrack', createYouTrackProvider],
])

export type ContributedTaskProviderEntry = {
  pluginId: string
  factory: TaskProviderFactory
  validateConfig?: TaskProviderConfigValidator
  capabilities: ReadonlySet<TaskCapability>
  displayName: string
  instanceConfigSchema?: readonly ProviderConfigField[]
  contextConfigSchema?: readonly ProviderConfigField[]
  traits?: ReadonlySet<TaskProviderTrait>
}

const pluginContributedTaskProviderFactories = new Map<string, ContributedTaskProviderEntry>()

const isTaskProviderConfigValidatorResult = (value: unknown): value is TaskProviderConfigValidatorResult => {
  if (typeof value !== 'object' || value === null) return false
  if (!('ok' in value)) return false
  const ok = value.ok
  if (ok === true) return true
  if (ok !== false || !('reason' in value)) return false
  return typeof value.reason === 'string' && value.reason !== ''
}

const normalizeTaskProviderConfigValidator = (
  validator: TaskProviderConfigValidator | undefined,
): TaskProviderConfigValidator | undefined => {
  if (validator === undefined) return undefined
  return async (config) => {
    const result: unknown = await validator(config)
    if (isTaskProviderConfigValidatorResult(result)) return result
    return { ok: false, reason: 'Contributed task provider validator returned an invalid result' }
  }
}

const normalizeContributedProviderTraits = (
  provider: TaskProvider,
  traits: ReadonlySet<TaskProviderTrait>,
): TaskProvider => {
  Object.defineProperty(provider, 'traits', { value: traits, configurable: true, enumerable: true })
  return provider
}

/**
 * Create a TaskProvider instance by name.
 *
 * @param name - The provider name (e.g. "kaneo")
 * @param config - Provider-specific config key-value pairs
 * @returns A TaskProvider instance
 * @throws Error if the provider name is not registered
 */
export function createProvider(name: string, config: Record<string, string>): TaskProvider {
  const factory = providers.get(name)
  if (factory !== undefined) {
    log.debug({ name }, 'Creating provider instance')
    return factory(config)
  }
  const contributed = pluginContributedTaskProviderFactories.get(name)
  if (contributed === undefined) {
    log.error({ name }, 'Unknown provider requested')
    throw new Error(
      `Unknown provider: ${name}. Available providers: ${[
        ...providers.keys(),
        ...pluginContributedTaskProviderFactories.keys(),
      ].join(', ')}`,
    )
  }
  log.debug({ name, pluginId: contributed.pluginId }, 'Creating contributed provider instance')
  return normalizeContributedProviderTraits(
    contributed.factory(config),
    contributed.traits ?? new Set<TaskProviderTrait>(),
  )
}

export function getCapabilitiesForTaskInstance(instance: TaskInstance): ReadonlySet<TaskCapability> {
  const descriptor = getTaskProviderDescriptor(instance.type)
  if (descriptor !== undefined) return descriptor.capabilities
  throw new Error(`Unknown provider: ${instance.type}`)
}

/** Register a plugin-contributed task provider type. First-wins on duplicate type. */
export function registerContributedTaskProviderType(type: string, entry: ContributedTaskProviderEntry): void {
  if (providers.has(type)) {
    log.error({ type, attempted: entry.pluginId }, 'Contributed type shadows built-in provider')
    throw new Error(`Task provider type '${type}' is a built-in and cannot be overridden by plugin '${entry.pluginId}'`)
  }
  const existing = pluginContributedTaskProviderFactories.get(type)
  if (existing !== undefined) {
    log.error(
      { type, existing: existing.pluginId, attempted: entry.pluginId },
      'Duplicate task provider type; keeping first registration',
    )
    return
  }
  pluginContributedTaskProviderFactories.set(type, {
    ...entry,
    validateConfig: normalizeTaskProviderConfigValidator(entry.validateConfig),
  })
  log.info({ type, pluginId: entry.pluginId }, 'Registered contributed task provider type')
}

/** List contributed types owned by a plugin. */
export function listContributedTaskProviderTypesForPlugin(pluginId: string): string[] {
  return [...pluginContributedTaskProviderFactories.entries()]
    .filter(([, entry]) => entry.pluginId === pluginId)
    .map(([type]) => type)
}

/** Remove all contributed types owned by a plugin (deactivation / failure cleanup). */
export function unregisterContributedTaskProviderType(pluginId: string): string[] {
  const removedTypes: string[] = []
  for (const [type, entry] of pluginContributedTaskProviderFactories) {
    if (entry.pluginId === pluginId) {
      pluginContributedTaskProviderFactories.delete(type)
      removedTypes.push(type)
      log.debug({ type, pluginId }, 'Unregistered contributed task provider type')
    }
  }
  return removedTypes
}

/** Look up a contributed task provider entry by type. */
export function getContributedTaskProviderType(type: string): ContributedTaskProviderEntry | undefined {
  return pluginContributedTaskProviderFactories.get(type)
}

/** Resolve the optional instance-config validator for a task-provider type. */
export function getTaskProviderConfigValidator(type: string): TaskProviderConfigValidator | undefined {
  return pluginContributedTaskProviderFactories.get(type)?.validateConfig
}

export type TaskProviderTypeDescriptor = {
  type: string
  displayName: string
  source: 'builtin' | { plugin: string }
  instanceConfigSchema: readonly ProviderConfigField[]
  contextConfigSchema: readonly ProviderConfigField[]
  capabilities: ReadonlySet<TaskCapability>
  traits: ReadonlySet<TaskProviderTrait>
}

const normalizeConfigField = (field: ProviderConfigField): ProviderConfigField => ({
  key: field.key,
  label: field.label,
  required: field.required,
  sensitive: field.sensitive,
  scope: field.scope,
  ...(field.storageKey === undefined ? {} : { storageKey: field.storageKey }),
})

const normalizeContributedFields = (fields: readonly ProviderConfigField[] | undefined): ProviderConfigField[] =>
  (fields ?? []).map((field) => normalizeConfigField(field))

const contributedInstanceFields = (entry: ContributedTaskProviderEntry): readonly ProviderConfigField[] =>
  normalizeContributedFields(entry.instanceConfigSchema)

const contributedContextFields = (entry: ContributedTaskProviderEntry): readonly ProviderConfigField[] =>
  normalizeContributedFields(entry.contextConfigSchema)

/** Look up a single task-provider type descriptor (built-in or contributed). */
export function getTaskProviderDescriptor(type: string): TaskProviderTypeDescriptor | undefined {
  return listTaskProviderTypes().find((descriptor) => descriptor.type === type)
}

/** Merge built-in and plugin-contributed task provider types into a static catalog. */
export function listTaskProviderTypes(): TaskProviderTypeDescriptor[] {
  const builtin: TaskProviderTypeDescriptor[] = builtinDescriptorSeeds.map((seed) => {
    const descriptor: TaskProviderTypeDescriptor = {
      type: seed.type,
      displayName: seed.displayName,
      source: 'builtin',
      instanceConfigSchema: seed.instanceConfigSchema,
      contextConfigSchema: seed.contextConfigSchema,
      capabilities: seed.capabilities,
      traits: seed.traits,
    }
    return descriptor
  })
  const contributed: TaskProviderTypeDescriptor[] = [...pluginContributedTaskProviderFactories.entries()].map(
    ([type, entry]) => {
      const instanceConfigSchema = contributedInstanceFields(entry)
      const contextConfigSchema = contributedContextFields(entry)
      const descriptor: TaskProviderTypeDescriptor = {
        type,
        displayName: entry.displayName,
        source: { plugin: entry.pluginId },
        instanceConfigSchema,
        contextConfigSchema,
        capabilities: entry.capabilities,
        traits: entry.traits ?? new Set<TaskProviderTrait>(),
      }
      return descriptor
    },
  )
  return [...builtin, ...contributed]
}
