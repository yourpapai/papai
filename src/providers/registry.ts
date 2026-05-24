// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskInstance } from '../instances/types.js'
import { logger } from '../logger.js'
import { KaneoProvider, type KaneoConfig } from './kaneo/index.js'
import type { TaskCapability, TaskProvider } from './types.js'
import { YouTrackProvider } from './youtrack/index.js'

const log = logger.child({ scope: 'provider:registry' })

type ProviderFactory = (config: Record<string, string>) => TaskProvider

const configValue = (config: Record<string, string>, key: string): string => {
  const value = config[key]
  if (value === undefined) return ''
  return value
}

/** Register the built-in Kaneo provider. */
const createKaneoProvider: ProviderFactory = (config) => {
  const apiKey = configValue(config, 'apiKey')
  const baseUrl = configValue(config, 'baseUrl')
  const sessionCookie = config['sessionCookie']
  const workspaceId = configValue(config, 'workspaceId')

  const kaneoConfig: KaneoConfig =
    sessionCookie === undefined ? { apiKey, baseUrl } : { apiKey: '', baseUrl, sessionCookie }

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

const capabilityConfigForTaskInstance = (instance: TaskInstance): Record<string, string> => {
  const configuredBaseUrl = instance.config['baseUrl']
  if (configuredBaseUrl !== undefined) {
    if (instance.type === 'kaneo') return { apiKey: '', baseUrl: configuredBaseUrl, workspaceId: '' }
    return { baseUrl: configuredBaseUrl, token: '' }
  }

  const baseUrl = configValue(instance.config, 'url')
  if (instance.type === 'kaneo') return { apiKey: '', baseUrl, workspaceId: '' }
  return { baseUrl, token: '' }
}

export function getCapabilitiesForTaskInstance(instance: TaskInstance): ReadonlySet<TaskCapability> {
  return createProvider(instance.type, capabilityConfigForTaskInstance(instance)).capabilities
}
