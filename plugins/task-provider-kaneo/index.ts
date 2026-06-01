// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createKaneoProvider } from './entry-runtime.js'

type TaskProviderLike = {
  readonly name: string
}

type TaskProviderAutoProvisionLike = (context: {
  contextId: string
  chatUserId: string
  username: string | null
  reply: unknown
}) => Promise<boolean> | boolean

type TaskProviderProvisionLike = (context: {
  contextId: string
  username: string | null
  publicUrl: string | undefined
  internalUrl: string | undefined
}) => Promise<
  | { status: 'provisioned'; email: string; password: string; kaneoUrl: string; apiKey: string; workspaceId: string }
  | { status: 'registration_disabled' }
  | { status: 'failed'; error: string }
>

type PluginContextLike = {
  registration: {
    registerTaskProviderType(
      type: string,
      input:
        | ((config: Record<string, string>) => TaskProviderLike)
        | {
            factory: (config: Record<string, string>) => TaskProviderLike
            autoProvision?: TaskProviderAutoProvisionLike
            provision?: TaskProviderProvisionLike
          },
    ): void
  }
}

type KaneoProvisionModule = {
  kaneoAutoProvision: TaskProviderAutoProvisionLike
  kaneoProvision: TaskProviderProvisionLike
}

type PluginInstanceLike = {
  activate(ctx: PluginContextLike): void
}

type PluginFactoryLike = () => PluginInstanceLike

const requireModule = import.meta.require

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isKaneoProvisionModule(value: unknown): value is KaneoProvisionModule {
  return (
    isRecord(value) &&
    typeof value['kaneoAutoProvision'] === 'function' &&
    typeof value['kaneoProvision'] === 'function'
  )
}

function getKaneoProvisionModule(): KaneoProvisionModule {
  const moduleValue: unknown = requireModule('./auto-provision.js')
  if (!isKaneoProvisionModule(moduleValue)) {
    throw new Error('Invalid Kaneo provision module contract')
  }
  return moduleValue
}

// Named export resolved by the plugin loader from the manifest's `providerConfigValidator`.
export { validateConfig } from './validate-config.js'

const factory: PluginFactoryLike = () => ({
  activate(ctx: PluginContextLike): void {
    // KNOWN GAP (#15): provider clients still use global fetch instead of ctx.providerRuntime.
    // Provider runtime enforcement needs factory/client plumbing plus dynamic-host admission.
    const provisionModule = getKaneoProvisionModule()
    ctx.registration.registerTaskProviderType('kaneo', {
      factory: (config): TaskProviderLike => createKaneoProvider(config),
      autoProvision: provisionModule.kaneoAutoProvision,
      provision: provisionModule.kaneoProvision,
    })
  },
})

export default factory
