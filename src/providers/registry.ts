// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { KaneoProvider, type KaneoConfig } from './kaneo/index.js'
import type { TaskProvider } from './types.js'
import { YouTrackProvider } from './youtrack/index.js'

const log = logger.child({ scope: 'provider:registry' })

type ProviderFactory = (config: Record<string, string>) => TaskProvider

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
