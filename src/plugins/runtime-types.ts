// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions } from 'ai'
import type { z } from 'zod'

import type { AuthorizationResult, IncomingMessage, ReplyFn } from '../chat/types.js'
import type {
  TaskProviderAutoProvision,
  TaskProviderConfigValidator,
  TaskProviderFactory,
  TaskProviderProvision,
} from '../providers/registry.js'
import type { TaskCapability, ProviderConfigField, TaskProvider, TaskProviderTrait } from '../providers/types.js'
import type { PluginAttachmentFacade, PluginAttachmentRecord } from './attachment-types.js'
import type { PluginAdminConfig } from './context.js'
import type { PluginContext } from './context.js'
import type { PluginIdentityFacade } from './identity-facade.js'

export type PluginTaskProviderFacade = Pick<
  TaskProvider,
  'getTask' | 'listTasks' | 'searchTasks' | 'createTask' | 'updateTask'
>

/** Context-scoped plugin config declared in configRequirements with scope 'context'. */
export type PluginContextConfig = {
  get(key: string): string | undefined
}

export type PluginToolRuntimeContext = {
  pluginId: string
  storageContextId: string
  chatUserId: string
  taskProvider?: PluginTaskProviderFacade
  kv: PluginContext['kv']
  adminConfig: PluginAdminConfig
  /** Context-scoped plugin config declared in configRequirements with scope 'context'. */
  contextConfig: PluginContextConfig
  /** Identity claims are bound to this runtime actor. */
  identity?: PluginIdentityFacade
  rateLimit: {
    check(actorId: string): { allowed: boolean; retryAfterSec?: number }
  }
  attachments: PluginAttachmentFacade
  codingSecrets: {
    resolve(): Record<string, string> | null
    resolveForgeToken(): string | null
    resolveAgent(): string | null
    resolveForge(): { kind: 'github' | 'gitlab'; apiBaseUrl: string } | null
    resolveProviderHost(): string | null
  }
  codingRepos: {
    list(): { name: string; baseBranch: string }[]
    get(name: string): { name: string; repoUrl: string; baseBranch: string; permissionPreset: string } | null
  }
}

export type PluginScheduledJobRuntimeContext = {
  pluginId: string
  contextId: string
} & Partial<{
  taskProvider: PluginTaskProviderFacade
}>

export type PluginTool = {
  /** Raw tool name as declared in the manifest (snake_case). */
  name: string
  description: string
  inputSchema?: z.ZodType
  execute: (input: unknown, runtimeContext: PluginToolRuntimeContext, options: ToolExecutionOptions) => Promise<unknown>
}

/** A prompt fragment contributed by a plugin. */
export type PluginPromptFragment = {
  /** Fragment key matching a name in contributes.promptFragments. */
  name: string
  /** The fragment text or a synchronous function returning it. */
  content: string | (() => string)
}

export type PluginCommand = {
  name: string
  description: string
  execute: (message: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult) => Promise<void> | void
}

export type PluginScheduledJob = {
  name: string
  intervalMs: number
  execute: (runtime: PluginScheduledJobRuntimeContext) => Promise<void> | void
}

export type AttachmentTransformResult =
  | { ok: true; text: string; meta?: { language?: string; durationSec?: number } }
  | { ok: false; reason: string }

export type PluginAttachmentTransformer = {
  name: string
  /** Matched against attachment mimeType, e.g. ['audio/'] */
  mimePrefixes: readonly string[]
  /** Fallback match when the attachment has no MIME type, e.g. ['.ogg', '.mp3'] */
  filenameExtensions?: readonly string[]
  /** Restrict to attachment origins; omitted means all origins */
  origins?: readonly ('voice' | 'file')[]
  /** Per-call budget enforced by core; bounded 1000–120000, default 30000 */
  timeoutMs?: number
  transform(
    record: PluginAttachmentRecord,
    runtimeContext: PluginToolRuntimeContext,
  ): Promise<AttachmentTransformResult>
}

/** Registration result from a plugin's activate() call. */
export type PluginContributions = {
  tools: PluginTool[]
  promptFragments: PluginPromptFragment[]
  commands?: PluginCommand[]
  jobs?: PluginScheduledJob[]
  attachmentTransformers?: PluginAttachmentTransformer[]
  taskProviderRegistration?: {
    type: string
    factory: TaskProviderFactory
    autoProvision?: TaskProviderAutoProvision
    provision?: TaskProviderProvision
    validateConfig?: TaskProviderConfigValidator
    capabilities: ReadonlySet<TaskCapability>
    displayName: string
    instanceConfigSchema: readonly ProviderConfigField[]
    contextConfigSchema: readonly ProviderConfigField[]
    traits: ReadonlySet<TaskProviderTrait>
  }
}

/** Runtime plugin instance returned by a plugin factory. */
export type PluginInstance = {
  activate(ctx: PluginContext): Promise<void> | void
  deactivate?(ctx: PluginContext): Promise<void> | void
}

/** Interface that a plugin module's default export must satisfy. */
export type PluginFactory = () => PluginInstance
