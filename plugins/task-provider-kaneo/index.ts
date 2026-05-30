// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PluginContext, TaskProvider } from 'papai/plugin-types'

import type { PluginFactory, PluginInstance } from '../../src/plugins/types.js'
import { isKaneoSessionCookie, type KaneoConfig } from './client.js'
import { KaneoProvider } from './provider.js'

// Named export resolved by the plugin loader from the manifest's `providerConfigValidator`.
export { validateConfig } from './validate-config.js'

const buildKaneoConfig = (config: Record<string, string>): KaneoConfig => {
  const baseUrl = config['baseUrl'] ?? ''
  const credential = config['credential'] ?? ''
  return isKaneoSessionCookie(credential)
    ? { apiKey: '', baseUrl, sessionCookie: credential }
    : { apiKey: credential, baseUrl }
}

const factory: PluginFactory = (): PluginInstance => ({
  activate(ctx: PluginContext): void {
    ctx.registration.registerTaskProviderType(
      'kaneo',
      (config): TaskProvider => new KaneoProvider(buildKaneoConfig(config), config['workspaceId'] ?? ''),
    )
  },
})

export default factory
