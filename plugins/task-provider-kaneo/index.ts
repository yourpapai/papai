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
    // KNOWN GAP (#15): KaneoProvider's client.ts uses global fetch, not ctx.providerRuntime,
    // so the manifest's providerAllowedHosts ([]) is declared but NOT enforced. The factory
    // signature is (config) => TaskProvider and never receives ctx, so providerRuntime is
    // unreachable here today. Enforcing it needs factory/client plumbing plus a dynamic-host
    // admission mechanism (the instance baseUrl host is operator-configured) and an http://
    // policy decision. See docs/plugins/developer-guide.md "Known limitation".
    ctx.registration.registerTaskProviderType(
      'kaneo',
      (config): TaskProvider => new KaneoProvider(buildKaneoConfig(config), config['workspaceId'] ?? ''),
    )
  },
})

export default factory
