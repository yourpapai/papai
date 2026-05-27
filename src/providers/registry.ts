// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskInstance } from '../instances/types.js'
import { logger } from '../logger.js'
import { ALL_CAPABILITIES } from './kaneo/constants.js'
import { isKaneoSessionCookie, KaneoProvider, type KaneoConfig } from './kaneo/index.js'
import type { TaskCapability } from './task-capability.js'
import type { ProviderConfigRequirement, TaskProvider } from './types.js'
import { YOUTRACK_CAPABILITIES } from './youtrack/constants.js'
import { YouTrackProvider } from './youtrack/index.js'

const log = logger.child({ scope: 'provider:registry' })

export type TaskProviderFactory = (config: Record<string, string>) => TaskProvider

export type TaskProviderConfigValidator = (
  config: Record<string, string>,
) => Promise<{ ok: true } | { ok: false; reason: string }>

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
  configSchema: readonly ProviderConfigRequirement[]
}

const pluginContributedTaskProviderFactories = new Map<string, ContributedTaskProviderEntry>()

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
  return contributed.factory(config)
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

/** Remove all contributed types owned by a plugin (deactivation / failure cleanup). */
export function unregisterContributedTaskProviderType(pluginId: string): void {
  for (const [type, entry] of pluginContributedTaskProviderFactories) {
    if (entry.pluginId === pluginId) {
      pluginContributedTaskProviderFactories.delete(type)
      log.debug({ type, pluginId }, 'Unregistered contributed task provider type')
    }
  }
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
  configSchema: readonly ProviderConfigRequirement[]
  capabilities: ReadonlySet<TaskCapability>
  source: 'builtin' | { plugin: string }
}

type BuiltinDescriptorSeed = {
  type: string
  displayName: string
  capabilities: ReadonlySet<TaskCapability>
  configSchema: readonly ProviderConfigRequirement[]
}

const builtinDescriptorSeeds: readonly BuiltinDescriptorSeed[] = [
  {
    type: 'kaneo',
    displayName: 'Kaneo',
    capabilities: ALL_CAPABILITIES,
    configSchema: [
      { key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false, scope: 'instance' },
      { key: 'internalUrl', label: 'Kaneo Internal URL', required: false, sensitive: false, scope: 'instance' },
      { key: 'credential', label: 'Kaneo API Key', required: true, sensitive: true, scope: 'user' },
      { key: 'workspaceId', label: 'Workspace ID', required: true, sensitive: false, scope: 'user' },
    ],
  },
  {
    type: 'youtrack',
    displayName: 'YouTrack',
    capabilities: YOUTRACK_CAPABILITIES,
    configSchema: [
      { key: 'baseUrl', label: 'YouTrack URL', required: true, sensitive: false, scope: 'instance' },
      { key: 'token', label: 'YouTrack Permanent Token', required: true, sensitive: true, scope: 'user' },
    ],
  },
]

/** Look up a single task-provider type descriptor (built-in or contributed). */
export function getTaskProviderDescriptor(type: string): TaskProviderTypeDescriptor | undefined {
  return listTaskProviderTypes().find((descriptor) => descriptor.type === type)
}

/** Merge built-in and plugin-contributed task provider types into a static catalog. */
export function listTaskProviderTypes(): TaskProviderTypeDescriptor[] {
  const builtin: TaskProviderTypeDescriptor[] = builtinDescriptorSeeds.map((seed) => ({
    type: seed.type,
    displayName: seed.displayName,
    configSchema: seed.configSchema,
    capabilities: seed.capabilities,
    source: 'builtin',
  }))
  const contributed: TaskProviderTypeDescriptor[] = [...pluginContributedTaskProviderFactories.entries()].map(
    ([type, entry]) => ({
      type,
      displayName: entry.displayName,
      configSchema: entry.configSchema,
      capabilities: entry.capabilities,
      source: { plugin: entry.pluginId },
    }),
  )
  return [...builtin, ...contributed]
}
