// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type PluginContextLike = import('../../src/plugins/context.js').PluginContext
type PluginFactoryLike = import('../../src/plugins/types.js').PluginFactory
type TaskProviderLike = import('../../src/providers/types.js').TaskProvider

import { createYouTrackProvider } from './entry-runtime'

// Named export resolved by the plugin loader from the manifest's `providerConfigValidator`.
export { validateConfig } from './validate-config'

const factory: PluginFactoryLike = () => ({
  activate(ctx: PluginContextLike): void {
    ctx.registration.registerTaskProviderType('youtrack', (config): TaskProviderLike => createYouTrackProvider(config))
  },
})

export default factory
