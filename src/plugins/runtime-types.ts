// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions } from 'ai'
import type { z } from 'zod'

import type { ChatProviderConfigField } from '../chat/provider-descriptor.js'
import type {
  AuthorizationResult,
  ChatCapability,
  ChatProviderTraits,
  IncomingMessage,
  ReplyFn,
  ThreadCapabilities,
} from '../chat/types.js'
import type { InstanceConfig } from '../instances/types.js'
import type {
  TaskProviderAutoProvision,
  TaskProviderConfigValidator,
  TaskProviderFactory,
  TaskProviderProvision,
} from '../providers/registry.js'
import type { TaskCapability, ProviderConfigField, TaskProvider, TaskProviderTrait } from '../providers/types.js'
import type { PluginAdminConfig } from './context.js'
import type { PluginContext } from './context.js'
import type { PluginIdentityFacade } from './identity-facade.js'

export type PluginTaskProviderFacade = Pick<
  TaskProvider,
  'getTask' | 'listTasks' | 'searchTasks' | 'createTask' | 'updateTask'
>

export type PluginToolRuntimeContext = {
  pluginId: string
  storageContextId: string
  chatUserId: string
  taskProvider?: PluginTaskProviderFacade
  kv: PluginContext['kv']
  adminConfig: PluginAdminConfig
  /** Identity claims are bound to this runtime actor. */
  identity?: PluginIdentityFacade
  rateLimit: {
    check(actorId: string): { allowed: boolean; retryAfterSec?: number }
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

/** Factory function for creating chat provider instances. */
export type ChatProviderFactory = (id: string, config: InstanceConfig) => import('../chat/types.js').ChatProvider

/** Registration result from a plugin's activate() call. */
export type PluginContributions = {
  tools: PluginTool[]
  promptFragments: PluginPromptFragment[]
  commands?: PluginCommand[]
  jobs?: PluginScheduledJob[]
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
  chatProviderRegistration?: {
    type: string
    factory: ChatProviderFactory
    capabilities: ReadonlySet<ChatCapability>
    traits: ChatProviderTraits
    threadCapabilities: ThreadCapabilities
    displayName: string
    instanceConfigSchema: readonly ChatProviderConfigField[]
  }
}

/** Runtime plugin instance returned by a plugin factory. */
export type PluginInstance = {
  activate(ctx: PluginContext): Promise<void> | void
  deactivate?(ctx: PluginContext): Promise<void> | void
}

/** Interface that a plugin module's default export must satisfy. */
export type PluginFactory = () => PluginInstance
