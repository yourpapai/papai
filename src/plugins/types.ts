// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { ChatCapability } from '../chat/types.js'
import { mcpPluginConfigSchema } from '../mcp/types.js'
import type { TaskCapability } from '../providers/types.js'
import {
  PLUGIN_MANIFEST_PROVIDER_TRAITS,
  configKeySchema,
  hasAttachmentTransformerPermission,
  hasMatchingContextConfigKeys,
  hasProviderAllowedHostsFromConfig,
  hasProviderManifestPermission,
  hasRequiredMainForManifest,
  isValidMainPath,
  pluginContributesSchema,
  pluginIdSchema,
  providerConfigFieldKeySchema,
  providerHostSchema,
} from './manifest-validation.js'

export type { PluginAttachmentFacade, PluginAttachmentRecord } from './attachment-types.js'

export type {
  AttachmentTransformResult,
  PluginAttachmentTransformer,
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
  'attachments.read',
] as const

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number]

/** Runtime state machine states for a plugin. */
export type PluginState = 'discovered' | 'approved' | 'rejected' | 'incompatible' | 'active' | 'error'

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
      attachmentTransformers: [],
    }),
    permissions: z.array(z.enum(PLUGIN_PERMISSIONS)).optional().default([]),
    author: z.string().optional(),
    homepage: z.url().optional(),
    license: z.string().optional(),
    defaultEnabled: z.boolean().optional().default(false),
    requiredTaskCapabilities: z.array(z.enum(TASK_CAPABILITY_VALUES)).optional().default([]),
    requiredChatCapabilities: z.array(z.enum(CHAT_CAPABILITY_VALUES)).optional().default([]),
    configRequirements: z.array(pluginConfigRequirementSchema).optional().default([]),
    providerCapabilities: z.array(z.enum(TASK_CAPABILITY_VALUES)).optional().default([]),
    providerTraits: z.array(z.enum(PLUGIN_MANIFEST_PROVIDER_TRAITS)).optional().default([]),
    providerConfigSchema: z.array(providerInstanceConfigRequirementSchema).optional().default([]),
    providerContextConfigSchema: z.array(providerContextConfigRequirementSchema).optional().default([]),
    providerAllowedHosts: z.array(providerHostSchema).optional().default([]),
    providerAllowedHostsFromConfig: z.array(configKeySchema).optional().default([]),
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
  .refine(hasAttachmentTransformerPermission, {
    message: "Declaring contributes.attachmentTransformers requires the 'attachments.read' permission",
    path: ['contributes', 'attachmentTransformers'],
  })
  .refine(hasProviderAllowedHostsFromConfig, {
    message: 'providerAllowedHostsFromConfig keys must reference admin-scoped configRequirements',
    path: ['providerAllowedHostsFromConfig'],
  })

export type ParsedPluginManifest = z.output<typeof pluginManifestSchema>
// Fields with Zod `.default([])` are optional on the hand-constructed type; test fixtures and non-provider plugins may omit them.
export type PluginManifest = Omit<
  ParsedPluginManifest,
  'providerContextConfigSchema' | 'providerTraits' | 'contributes' | 'providerAllowedHostsFromConfig'
> & {
  providerContextConfigSchema?: ParsedPluginManifest['providerContextConfigSchema']
  providerTraits?: ParsedPluginManifest['providerTraits']
  providerAllowedHostsFromConfig?: ParsedPluginManifest['providerAllowedHostsFromConfig']
  contributes: Omit<ParsedPluginManifest['contributes'], 'attachmentTransformers'> & {
    attachmentTransformers?: ParsedPluginManifest['contributes']['attachmentTransformers']
  }
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
