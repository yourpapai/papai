// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PluginContext } from '../../src/plugins/context.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { createKaneoProvider } from './entry-runtime'
import { kaneoAutoProvision } from './provision'

type PluginInstanceLike = {
  activate(ctx: PluginContext): void
}

type PluginFactoryLike = () => PluginInstanceLike

// Named export resolved by the plugin loader from the manifest's `providerConfigValidator`.
export { validateConfig } from './validate-config'

const factory: PluginFactoryLike = () => ({
  activate(ctx: PluginContext): void {
    ctx.registration.registerTaskProviderType('kaneo', {
      factory: (config): TaskProvider => createKaneoProvider(config),
      autoProvision: kaneoAutoProvision,
    })
  },
})

export default factory
