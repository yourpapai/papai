// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// The entry point must stay free of bare-module (e.g. `zod`) and out-of-plugin
// static imports: the discovery scanner walks the entry graph and rejects both.
// All real logic lives in `./runtime.ts`, loaded at activation time via
// `import.meta.require`, whose targets the scanner treats as opaque. This
// mirrors the `audio-transcribe` plugin's lazy-require pattern.

type PluginContextLike = {
  log: {
    info(metadata: Record<string, unknown>, message: string): void
  }
}

type PluginInstanceLike = {
  activate(ctx: PluginContextLike): Promise<void> | void
}

type ContextVaultRuntimeModule = {
  registerContextVault(ctx: PluginContextLike): void
}

const requireModule = import.meta.require

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isContextVaultRuntimeModule(value: unknown): value is ContextVaultRuntimeModule {
  return isRecord(value) && typeof value['registerContextVault'] === 'function'
}

function getRuntimeModule(): ContextVaultRuntimeModule {
  const moduleValue: unknown = requireModule('./runtime.js')
  if (!isContextVaultRuntimeModule(moduleValue)) {
    throw new Error('Invalid context-vault runtime module contract')
  }
  return moduleValue
}

const factory = (): PluginInstanceLike => ({
  activate(ctx: PluginContextLike): void {
    getRuntimeModule().registerContextVault(ctx)
  },
})

export default factory
