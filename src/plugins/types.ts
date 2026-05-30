// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { ChatCapability } from '../chat/types.js'
import { mcpPluginConfigSchema } from '../mcp/types.js'
import type { TaskCapability, TaskProviderTrait } from '../providers/types.js'
import {
  hasMatchingContextConfigKeys,
  hasProviderManifestPermission,
  hasRequiredMainForManifest,
  isValidMainPath,
} from './manifest-validation.js'

export type {
  PluginCommand,
  PluginContributions,
  PluginFactory,
  PluginInstance,
  PluginPromptFragment,
  PluginScheduledJob,
  PluginScheduledJobRuntimeContext,
  PluginTaskProviderFacade,
  PluginTool,
  PluginToolRuntimeContext,
} from './runtime-types.js'

/** Current plugin API version. Plugins declaring a different apiVersion will be rejected as incompatible. */
export const PLUGIN_API_VERSION = 1

/** All permissions a plugin may request. */
export const PLUGIN_PERMISSIONS = [
  'storage',
  'scheduler',
  'commands',
  'tasks.read',
  'tasks.write',
  'provider.task',
  'identity',
  'http',
] as const

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number]

/** Runtime state machine states for a plugin. */
export type PluginState = 'discovered' | 'approved' | 'rejected' | 'incompatible' | 'active' | 'error'

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

const providerConfigFieldKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-zA-Z0-9_]*$/u, 'Provider config field key must start with a letter')

const providerHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu,
    'Provider allowed host must be a valid hostname',
  )

const pluginContributesSchema = z.strictObject({
  tools: z.array(toolNameSchema).optional().default([]),
  promptFragments: z.array(z.string().min(1).max(64)).optional().default([]),
  commands: z.array(commandNameSchema).optional().default([]),
  jobs: z.array(z.string().min(1).max(64)).optional().default([]),
  configKeys: z.array(configKeySchema).optional().default([]),
  taskProviderTypes: z.array(providerTypeSchema).max(1).optional().default([]),
})

const configRequirementBaseSchema = z.strictObject({
  key: configKeySchema,
  label: z.string().min(1),
  required: z.boolean(),
  sensitive: z.boolean().optional().default(false),
})

const pluginConfigRequirementSchema = configRequirementBaseSchema.extend({
  scope: z.enum(['context', 'admin']).optional().default('context'),
})

const providerInstanceConfigRequirementSchema = configRequirementBaseSchema.extend({
  key: providerConfigFieldKeySchema,
  storageKey: configKeySchema.optional(),
  scope: z.literal('instance').optional().default('instance'),
})

const providerContextConfigRequirementSchema = configRequirementBaseSchema.extend({
  key: providerConfigFieldKeySchema,
  storageKey: configKeySchema.optional(),
  scope: z.literal('context').optional().default('context'),
})

const mainPathSchema = z.string().refine(isValidMainPath, {
  message: 'main must be a relative .ts or .js path without ".." components',
})

const taskCapabilityTuple = TASK_CAPABILITY_VALUES
const taskProviderTraitTuple = [
  'workspace-scoped',
  'task-label-read-requires-provider-specific-api',
  'supports-command-language',
  'command-language:youtrack',
  'custom-fields',
] as const satisfies readonly TaskProviderTrait[]
const chatCapabilityTuple = CHAT_CAPABILITY_VALUES
const permissionTuple = PLUGIN_PERMISSIONS

/** Zod schema for a plugin manifest (plugin.json). */
export const pluginManifestSchema = z
  .strictObject({
    id: pluginIdSchema,
    name: z.string().min(1).max(128),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/u, 'version must be semver (major.minor.patch)'),
    description: z.string().min(1).max(512),
    apiVersion: z.literal(PLUGIN_API_VERSION),
    main: mainPathSchema.optional(),
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
    providerTraits: z.array(z.enum(taskProviderTraitTuple)).optional().default([]),
    providerConfigSchema: z.array(providerInstanceConfigRequirementSchema).optional().default([]),
    providerContextConfigSchema: z.array(providerContextConfigRequirementSchema).optional().default([]),
    providerAllowedHosts: z.array(providerHostSchema).optional().default([]),
    providerConfigValidator: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/u, 'Provider config validator must be a valid identifier')
      .optional(),
    activationTimeoutMs: z.number().int().min(100).max(10000).optional().default(5000),
    mcp: mcpPluginConfigSchema.optional(),
  })
  .refine((m) => m.contributes.commands.length === 0 || m.permissions.includes('commands'), {
    message: "Declaring contributes.commands requires the 'commands' permission",
    path: ['permissions'],
  })
  .refine((m) => m.contributes.jobs.length === 0 || m.permissions.includes('scheduler'), {
    message: "Declaring contributes.jobs requires the 'scheduler' permission",
    path: ['permissions'],
  })
  .refine((m) => m.contributes.taskProviderTypes.length === 0 || m.permissions.includes('provider.task'), {
    message: "Declaring contributes.taskProviderTypes requires the 'provider.task' permission",
    path: ['permissions'],
  })
  .refine((m) => m.providerConfigValidator === undefined || m.contributes.taskProviderTypes.length > 0, {
    message: 'providerConfigValidator requires contributes.taskProviderTypes',
    path: ['providerConfigValidator'],
  })
  .refine(hasProviderManifestPermission, {
    message: "Provider-only manifest fields require the 'provider.task' permission",
    path: ['permissions'],
  })
  .refine(hasMatchingContextConfigKeys, {
    message: 'Every contributes.configKeys entry must match a context-scoped configRequirements entry',
    path: ['contributes', 'configKeys'],
  })
  .refine(hasRequiredMainForManifest, {
    message: 'main is required unless the manifest is an explicit MCP-only plugin',
    path: ['main'],
  })

type ParsedPluginManifest = z.output<typeof pluginManifestSchema>
export type PluginManifest = Omit<ParsedPluginManifest, 'providerContextConfigSchema' | 'providerTraits'> & {
  providerContextConfigSchema?: ParsedPluginManifest['providerContextConfigSchema']
  providerTraits?: ParsedPluginManifest['providerTraits']
}
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
