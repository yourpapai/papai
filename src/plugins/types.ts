// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions } from 'ai'
import { z } from 'zod'

import type { AuthorizationResult, ChatCapability, IncomingMessage, ReplyFn } from '../chat/types.js'
import type { TaskCapability, TaskProvider } from '../providers/types.js'
import type { PluginContext } from './context.js'

/** Current plugin API version. Plugins declaring a different apiVersion will be rejected as incompatible. */
export const PLUGIN_API_VERSION = 1

/** All permissions a plugin may request. */
export const PLUGIN_PERMISSIONS = [
  'storage',
  'scheduler',
  'commands',
  'chat.send',
  'tasks.read',
  'tasks.write',
  'provider.task',
  'identity',
  'http',
  'attachments.read',
] as const

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number]

/** Runtime state machine states for a plugin. */
export type PluginState =
  | 'discovered'
  | 'approved'
  | 'rejected'
  | 'incompatible'
  | 'config_missing'
  | 'active'
  | 'error'

/** All valid task capability strings (used for manifest validation). */
const TASK_CAPABILITY_VALUES = [
  'tasks.delete',
  'tasks.count',
  'tasks.relations',
  'tasks.watchers',
  'tasks.votes',
  'tasks.visibility',
  'tasks.commands',
  'projects.read',
  'projects.list',
  'projects.create',
  'projects.update',
  'projects.delete',
  'projects.team',
  'comments.read',
  'comments.create',
  'comments.update',
  'comments.delete',
  'comments.reactions',
  'labels.list',
  'labels.create',
  'labels.update',
  'labels.delete',
  'labels.assign',
  'statuses.list',
  'statuses.create',
  'statuses.update',
  'statuses.delete',
  'statuses.reorder',
  'attachments.list',
  'attachments.upload',
  'attachments.delete',
  'workItems.list',
  'workItems.create',
  'workItems.update',
  'workItems.delete',
  'agiles.list',
  'sprints.list',
  'sprints.create',
  'sprints.update',
  'sprints.assign',
  'activities.read',
  'queries.saved',
] as const satisfies readonly TaskCapability[]

/** All valid chat capability strings (used for manifest validation). */
const CHAT_CAPABILITY_VALUES = [
  'commands.menu',
  'interactions.callbacks',
  'messages.buttons',
  'messages.delete',
  'messages.files',
  'messages.redact',
  'messages.reply-context',
  'files.receive',
  'users.resolve',
] as const satisfies readonly ChatCapability[]

const pluginIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/u, 'Plugin ID must be lowercase kebab-case starting with a letter')

const toolNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/u, 'Tool name must be snake_case starting with a letter')

const commandNameSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9_-]*$/u, 'Command name must be lowercase')

const configKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/u, 'Config key must be snake_case starting with a letter')

const providerTypeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/u, 'Provider type must be lowercase kebab-case starting with a letter')

const providerHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu,
    'Provider allowed host must be a valid hostname',
  )

const pluginContributesSchema = z.object({
  tools: z.array(toolNameSchema).optional().default([]),
  promptFragments: z.array(z.string().min(1).max(64)).optional().default([]),
  commands: z.array(commandNameSchema).optional().default([]),
  jobs: z.array(z.string().min(1).max(64)).optional().default([]),
  configKeys: z.array(configKeySchema).optional().default([]),
  taskProviderTypes: z.array(providerTypeSchema).max(1).optional().default([]),
})

const pluginConfigRequirementSchema = z.object({
  key: configKeySchema,
  label: z.string().min(1),
  required: z.boolean(),
  sensitive: z.boolean().optional().default(false),
  scope: z.enum(['context', 'admin']).optional().default('context'),
})

const providerConfigRequirementSchema = z.object({
  key: configKeySchema,
  label: z.string().min(1),
  required: z.boolean(),
  sensitive: z.boolean().optional().default(false),
  scope: z.enum(['instance', 'user']).optional().default('instance'),
})

const mainPathSchema = z.string().refine(
  (v) => {
    if (v.startsWith('/')) return false
    if (v.includes('..')) return false
    if (!v.endsWith('.ts') && !v.endsWith('.js')) return false
    return true
  },
  {
    message: 'main must be a relative .ts or .js path without ".." components',
  },
)

const taskCapabilityTuple = TASK_CAPABILITY_VALUES
const chatCapabilityTuple = CHAT_CAPABILITY_VALUES
const permissionTuple = PLUGIN_PERMISSIONS

/** Zod schema for a plugin manifest (plugin.json). */
export const pluginManifestSchema = z
  .object({
    id: pluginIdSchema,
    name: z.string().min(1).max(128),
    version: z.string().regex(/^\d+\.\d+\.\d+/u, 'version must be semver (major.minor.patch)'),
    description: z.string().min(1).max(512),
    apiVersion: z.literal(PLUGIN_API_VERSION),
    main: mainPathSchema.optional().default('index.ts'),
    contributes: pluginContributesSchema.optional().default({
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
    }),
    permissions: z.array(z.enum(permissionTuple)).optional().default([]),
    author: z.string().optional(),
    homepage: z.url().optional(),
    license: z.string().optional(),
    defaultEnabled: z.boolean().optional().default(false),
    requiredTaskCapabilities: z.array(z.enum(taskCapabilityTuple)).optional().default([]),
    requiredChatCapabilities: z.array(z.enum(chatCapabilityTuple)).optional().default([]),
    configRequirements: z.array(pluginConfigRequirementSchema).optional().default([]),
    providerCapabilities: z.array(z.enum(taskCapabilityTuple)).optional().default([]),
    providerConfigSchema: z.array(providerConfigRequirementSchema).optional().default([]),
    providerAllowedHosts: z.array(providerHostSchema).optional().default([]),
    providerConfigValidator: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/u, 'Provider config validator must be a valid identifier')
      .optional(),
    activationTimeoutMs: z.number().int().min(100).max(10000).optional().default(5000),
  })
  .refine((m) => m.contributes.taskProviderTypes.length === 0 || m.permissions.includes('provider.task'), {
    message: "Declaring contributes.taskProviderTypes requires the 'provider.task' permission",
    path: ['permissions'],
  })

export type PluginManifest = z.output<typeof pluginManifestSchema>
/** A validated plugin discovered from the filesystem. */
export type DiscoveredPlugin = {
  manifest: PluginManifest
  /** Absolute path to the plugin directory. */
  pluginDir: string
  /** Absolute path to the entry point file. */
  entryPoint: string
  /** SHA-256 hex hash of the manifest + entry point content. */
  manifestHash: string
}

/** A tool contributed by a plugin. */
export type PluginTaskProviderFacade = Pick<
  TaskProvider,
  'getTask' | 'listTasks' | 'searchTasks' | 'createTask' | 'updateTask'
>

export type PluginToolRuntimeContext = {
  pluginId: string
  storageContextId: string
  chatUserId: string
  taskProvider: PluginTaskProviderFacade
  kv: PluginContext['kv']
  rateLimit: {
    check(actorId: string): { allowed: boolean; retryAfterSec?: number }
  }
}

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
  execute: (contextId: string) => Promise<void> | void
}

/** Registration result from a plugin's activate() call. */
export type PluginContributions = {
  tools: PluginTool[]
  promptFragments: PluginPromptFragment[]
  commands?: PluginCommand[]
  jobs?: PluginScheduledJob[]
}

/** Runtime plugin instance returned by a plugin factory. */
export type PluginInstance = {
  activate(ctx: PluginContext): Promise<void> | void
  deactivate?(ctx: PluginContext): Promise<void> | void
}

/** Interface that a plugin module's default export must satisfy. */
export type PluginFactory = () => PluginInstance
