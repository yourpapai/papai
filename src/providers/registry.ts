// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from '../chat/types.js'
import type { TaskInstance } from '../instances/types.js'
import { logger } from '../logger.js'
import { builtinDescriptorSeeds } from './builtin-descriptors.js'
import type { TaskCapability } from './task-capability.js'
import type { ProviderConfigField, TaskProvider, TaskProviderTrait } from './types.js'

const log = logger.child({ scope: 'provider:registry' })

export type TaskProviderFactory = (config: Record<string, string>) => TaskProvider

export type TaskProviderAutoProvisionContext = {
  contextId: string
  chatUserId: string
  username: string | null
  reply: ReplyFn
}

export type TaskProviderAutoProvision = (context: TaskProviderAutoProvisionContext) => Promise<boolean> | boolean

export type TaskProviderProvisionContext = Readonly<{
  contextId: string
  username: string | null
  publicUrl: string | undefined
  internalUrl: string | undefined
}>

export type TaskProviderProvisionOutcome =
  | {
      status: 'provisioned'
      email: string
      password: string
      instanceUrl: string
      apiKey: string
      workspaceId: string
    }
  | { status: 'registration_disabled' }
  | { status: 'failed'; error: string }

export type TaskProviderProvision = (context: TaskProviderProvisionContext) => Promise<TaskProviderProvisionOutcome>

export type TaskProviderConfigValidator = (
  config: Record<string, string>,
) => Promise<{ ok: true } | { ok: false; reason: string }>

type TaskProviderConfigValidatorResult = Awaited<ReturnType<TaskProviderConfigValidator>>

/**
 * Built-in provider factory map.
 *
 * All task providers (Kaneo, YouTrack) are now plugin-contributed exclusively.
 * This map is intentionally empty; it is still checked in registerContributedTaskProviderType
 * to guard against future accidental built-in registrations.
 */
const providers = new Map<string, TaskProviderFactory>()

export type ContributedTaskProviderEntry = {
  pluginId: string
  factory: TaskProviderFactory
  autoProvision?: TaskProviderAutoProvision
  provision?: TaskProviderProvision
  capabilities: ReadonlySet<TaskCapability>
  displayName: string
  validateConfig?: TaskProviderConfigValidator
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

const emptyTaskProviderTraits = (): ReadonlySet<TaskProviderTrait> => new Set<TaskProviderTrait>()

const contributedTraits = (entry: ContributedTaskProviderEntry): ReadonlySet<TaskProviderTrait> => {
  if (entry.traits !== undefined) return entry.traits
  return emptyTaskProviderTraits()
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
  return normalizeContributedProviderTraits(contributed.factory(config), contributedTraits(contributed))
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

/** Resolve the optional instance-config validator for a task-provider type. */
export function getTaskProviderConfigValidator(type: string): TaskProviderConfigValidator | undefined {
  const contributed = pluginContributedTaskProviderFactories.get(type)
  if (contributed === undefined) return undefined
  return contributed.validateConfig
}

/** Resolve the optional HTTP provision hook for a task-provider type. */
export function getTaskProviderProvision(type: string): TaskProviderProvision | undefined {
  const descriptor = getTaskProviderDescriptor(type)
  if (descriptor === undefined) return undefined
  return descriptor.provision
}

export type TaskProviderTypeDescriptor = {
  type: string
  displayName: string
  source: 'builtin' | { plugin: string }
  autoProvision?: TaskProviderAutoProvision
  provision?: TaskProviderProvision
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
    return {
      type: seed.type,
      displayName: seed.displayName,
      source: 'builtin',
      instanceConfigSchema: seed.instanceConfigSchema,
      contextConfigSchema: seed.contextConfigSchema,
      capabilities: seed.capabilities,
      traits: seed.traits,
    }
  })
  const contributed: TaskProviderTypeDescriptor[] = [...pluginContributedTaskProviderFactories.entries()].map(
    ([type, entry]) => {
      const instanceConfigSchema = contributedInstanceFields(entry)
      const contextConfigSchema = contributedContextFields(entry)
      return {
        type,
        displayName: entry.displayName,
        source: { plugin: entry.pluginId },
        autoProvision: entry.autoProvision,
        provision: entry.provision,
        instanceConfigSchema,
        contextConfigSchema,
        capabilities: entry.capabilities,
        traits: contributedTraits(entry),
      }
    },
  )
  return [...builtin, ...contributed]
}
