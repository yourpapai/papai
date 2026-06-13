// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// The entry point must stay free of bare-module (e.g. `zod`) and out-of-plugin
// static imports: the discovery scanner walks the entry graph and rejects both.
// All real logic — including the `zod` schema — lives in `./runtime.ts`, loaded
// at activation time via `import.meta.require`, whose targets the scanner treats
// as opaque (require-mode files are not followed for static imports). This mirrors
// the `task-provider-kaneo` plugin's lazy-require pattern.

type PluginLoggerLike = {
  info(metadata: Record<string, unknown>, message: string): void
}

type PluginContextLike = {
  log: PluginLoggerLike
}

type PluginInstanceLike = {
  activate(ctx: PluginContextLike): Promise<void> | void
  deactivate?(ctx: PluginContextLike): Promise<void> | void
}

type PluginFactoryLike = () => PluginInstanceLike

type AudioTranscribeRuntimeModule = {
  registerAudioTranscribe(ctx: PluginContextLike): void
}

const requireModule = import.meta.require

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAudioTranscribeRuntimeModule(value: unknown): value is AudioTranscribeRuntimeModule {
  return isRecord(value) && typeof value['registerAudioTranscribe'] === 'function'
}

function getRuntimeModule(): AudioTranscribeRuntimeModule {
  const moduleValue: unknown = requireModule('./runtime.js')
  if (!isAudioTranscribeRuntimeModule(moduleValue)) {
    throw new Error('Invalid audio-transcribe runtime module contract')
  }
  return moduleValue
}

const factory: PluginFactoryLike = () => ({
  activate(ctx: PluginContextLike): void {
    getRuntimeModule().registerAudioTranscribe(ctx)
  },

  deactivate(ctx: PluginContextLike): void {
    ctx.log.info({}, 'audio-transcribe plugin deactivated')
  },
})

export default factory
