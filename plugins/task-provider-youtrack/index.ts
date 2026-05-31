// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createYouTrackProvider } from './entry-runtime.js'

type TaskProviderLike = {
  readonly name: string
}

type PluginContextLike = {
  registration: {
    registerTaskProviderType(type: string, factory: (config: Record<string, string>) => TaskProviderLike): void
  }
}

type PluginInstanceLike = {
  activate(ctx: PluginContextLike): void
}

type PluginFactoryLike = () => PluginInstanceLike

// Named export resolved by the plugin loader from the manifest's `providerConfigValidator`.
export { validateConfig } from './validate-config.js'

const factory: PluginFactoryLike = () => ({
  activate(ctx: PluginContextLike): void {
    // KNOWN GAP (#15): provider clients still use global fetch instead of ctx.providerRuntime.
    // Provider runtime enforcement needs factory/client plumbing plus dynamic-host admission.
    ctx.registration.registerTaskProviderType('youtrack', (config): TaskProviderLike => createYouTrackProvider(config))
  },
})

export default factory
