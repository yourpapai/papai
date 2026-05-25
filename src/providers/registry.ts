// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { KaneoProvider, type KaneoConfig } from './kaneo/index.js'
import type { TaskCapability } from './task-capability.js'
import type { TaskProvider } from './types.js'
import { YouTrackProvider } from './youtrack/index.js'

const log = logger.child({ scope: 'provider:registry' })

export type TaskProviderFactory = (config: Record<string, string>) => TaskProvider

type ProviderFactory = TaskProviderFactory

const providers = new Map<string, ProviderFactory>()

/** Register the built-in Kaneo provider. */
providers.set('kaneo', (config) => {
  const apiKey = config['apiKey'] ?? ''
  const baseUrl = config['baseUrl'] ?? ''
  const sessionCookie = config['sessionCookie']
  const workspaceId = config['workspaceId'] ?? ''

  const kaneoConfig: KaneoConfig =
    sessionCookie === undefined ? { apiKey, baseUrl } : { apiKey: '', baseUrl, sessionCookie }

  return new KaneoProvider(kaneoConfig, workspaceId)
})

/** Register the built-in YouTrack provider. */
providers.set('youtrack', (config) => {
  const baseUrl = config['baseUrl'] ?? ''
  const token = config['token'] ?? ''
  return new YouTrackProvider({ baseUrl, token })
})

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
  if (factory === undefined) {
    log.error({ name }, 'Unknown provider requested')
    throw new Error(`Unknown provider: ${name}. Available providers: ${[...providers.keys()].join(', ')}`)
  }
  log.debug({ name }, 'Creating provider instance')
  return factory(config)
}

export type ContributedTaskProviderEntry = {
  pluginId: string
  factory: TaskProviderFactory
  capabilities: ReadonlySet<TaskCapability>
}

const pluginContributedTaskProviderFactories = new Map<string, ContributedTaskProviderEntry>()

/** Register a plugin-contributed task provider type. First-wins on duplicate type. */
export function registerContributedTaskProviderType(type: string, entry: ContributedTaskProviderEntry): void {
  const existing = pluginContributedTaskProviderFactories.get(type)
  if (existing !== undefined) {
    log.error({ type, existing: existing.pluginId, attempted: entry.pluginId }, 'Duplicate task provider type')
    throw new Error(`Task provider type '${type}' already registered by plugin '${existing.pluginId}'`)
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
