// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createYouTrackProvider } from './entry-runtime.js'

type TaskProviderLike = {
  readonly name: string
}

// `tool-apply-command.ts` uses `zod` (a bare/non-relative import). Plugin discovery requires the
// entry point's statically-imported graph to use only relative imports, so — mirroring
// `entry-runtime.ts`'s handling of `provider.ts` — the module is loaded lazily via
// `import.meta.require` instead of a static `import`, keeping `zod` out of the scanned graph.
type ApplyCommandModule = typeof import('./tool-apply-command.js')
type RuntimeContextLike = import('./tool-apply-command.js').RuntimeContextLike

const requireModule = import.meta.require

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isApplyCommandModule(value: unknown): value is ApplyCommandModule {
  return (
    isRecord(value) &&
    typeof value['executeApplyYouTrackCommand'] === 'function' &&
    isRecord(value['applyYouTrackCommandInputSchema'])
  )
}

function getApplyCommandModule(): ApplyCommandModule {
  const moduleValue: unknown = requireModule('./tool-apply-command.js')
  if (!isApplyCommandModule(moduleValue)) {
    throw new Error('Invalid apply-command module contract')
  }
  return moduleValue
}

type PluginToolLike = {
  name: string
  description: string
  inputSchema?: unknown
  execute: (input: unknown, runtimeContext: RuntimeContextLike, options: unknown) => Promise<unknown>
}

type PluginContextLike = {
  registration: {
    registerTaskProviderType(type: string, factory: (config: Record<string, string>) => TaskProviderLike): void
    registerTool(tool: PluginToolLike): void
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

    const { applyYouTrackCommandInputSchema, executeApplyYouTrackCommand } = getApplyCommandModule()

    ctx.registration.registerTool({
      name: 'apply_youtrack_command',
      description:
        'Apply a YouTrack command to a single YouTrack issue. Use this only for YouTrack-native command workflows that do not fit the structured tools.',
      inputSchema: applyYouTrackCommandInputSchema,
      execute: (input, runtimeContext) => executeApplyYouTrackCommand(input, runtimeContext),
    })
  },
})

export default factory
