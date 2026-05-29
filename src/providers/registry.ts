// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { YouTrackProvider } from '../../plugins/task-provider-youtrack/provider.js'
import type { TaskInstance } from '../instances/types.js'
import { logger } from '../logger.js'
import { builtinDescriptorSeeds } from './builtin-descriptors.js'
import type { TaskCapability } from './task-capability.js'
import type { ProviderConfigField, TaskProvider, TaskProviderTrait } from './types.js'

const log = logger.child({ scope: 'provider:registry' })

export type TaskProviderFactory = (config: Record<string, string>) => TaskProvider

export type TaskProviderConfigValidator = (
  config: Record<string, string>,
) => Promise<{ ok: true } | { ok: false; reason: string }>

type LegacyProviderConfigField = Omit<ProviderConfigField, 'scope' | 'sensitive'> & {
  sensitive?: boolean
  scope?: 'instance' | 'context' | 'user'
}

const configValue = (config: Record<string, string>, key: string): string => {
  const value = config[key]
  if (value === undefined) return ''
  return value
}

/** Register the built-in YouTrack provider. */
const createYouTrackProvider: TaskProviderFactory = (config) => {
  const baseUrl = configValue(config, 'baseUrl')
  const token = configValue(config, 'token')
  return new YouTrackProvider({ baseUrl, token })
}

const providers = new Map<string, TaskProviderFactory>([['youtrack', createYouTrackProvider]])

export type ContributedTaskProviderEntry = {
  pluginId: string
  factory: TaskProviderFactory
  validateConfig?: TaskProviderConfigValidator
  capabilities: ReadonlySet<TaskCapability>
  displayName: string
  instanceConfigSchema?: readonly LegacyProviderConfigField[]
  contextConfigSchema?: readonly LegacyProviderConfigField[]
  traits?: ReadonlySet<TaskProviderTrait>
  configSchema?: readonly LegacyProviderConfigField[]
}

const pluginContributedTaskProviderFactories = new Map<string, ContributedTaskProviderEntry>()

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
  pluginContributedTaskProviderFactories.set(type, entry)
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
  /** Temporary compatibility surface for code that still reads the legacy combined configSchema. */
  configSchema: readonly ProviderConfigField[]
}

const legacyConfigSchema = (descriptor: TaskProviderTypeDescriptor): readonly ProviderConfigField[] => [
  ...descriptor.instanceConfigSchema,
  ...descriptor.contextConfigSchema,
]

const normalizeConfigField = (field: LegacyProviderConfigField): ProviderConfigField => ({
  key: field.key,
  label: field.label,
  required: field.required,
  sensitive: field.sensitive ?? false,
  scope: field.scope === 'user' ? 'context' : (field.scope ?? 'instance'),
  ...(field.storageKey === undefined ? {} : { storageKey: field.storageKey }),
})

const normalizeContributedFields = (fields: readonly LegacyProviderConfigField[] | undefined): ProviderConfigField[] =>
  (fields ?? []).map((field) => normalizeConfigField(field))

const contributedInstanceFields = (entry: ContributedTaskProviderEntry): readonly ProviderConfigField[] => {
  if (entry.instanceConfigSchema !== undefined) return normalizeContributedFields(entry.instanceConfigSchema)
  return normalizeContributedFields(entry.configSchema).filter((field) => field.scope === 'instance')
}

const contributedContextFields = (entry: ContributedTaskProviderEntry): readonly ProviderConfigField[] => {
  if (entry.contextConfigSchema !== undefined) return normalizeContributedFields(entry.contextConfigSchema)
  return normalizeContributedFields(entry.configSchema).filter((field) => field.scope === 'context')
}

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
      configSchema: [],
    }
    return { ...descriptor, configSchema: legacyConfigSchema(descriptor) }
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
        configSchema: [],
      }
      return { ...descriptor, configSchema: legacyConfigSchema(descriptor) }
    },
  )
  return [...builtin, ...contributed]
}
