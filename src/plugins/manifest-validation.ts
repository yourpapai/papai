// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { posix, win32 } from 'node:path'

import { z } from 'zod'

import type { TaskProviderTrait } from '../providers/types.js'

export const transformerNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/u, 'Transformer name must be lowercase (kebab-case or snake_case)')

export const pluginIdSchema = z
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

export const configKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/u, 'Config key must be snake_case starting with a letter')

const providerTypeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/u, 'Provider type must be lowercase kebab-case starting with a letter')

export const providerConfigFieldKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-zA-Z0-9_]*$/u, 'Provider config field key must start with a letter')

export const providerHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu,
    'Provider allowed host must be a valid hostname',
  )

export const pluginContributesSchema = z.strictObject({
  tools: z.array(toolNameSchema).optional().default([]),
  promptFragments: z.array(z.string().min(1).max(64)).optional().default([]),
  commands: z.array(commandNameSchema).optional().default([]),
  jobs: z.array(z.string().min(1).max(64)).optional().default([]),
  configKeys: z.array(configKeySchema).optional().default([]),
  taskProviderTypes: z.array(providerTypeSchema).max(1).optional().default([]),
  attachmentTransformers: z.array(transformerNameSchema).optional().default([]),
})

export const PLUGIN_MANIFEST_PROVIDER_TRAITS = [
  'workspace-scoped',
  'task-label-read-requires-provider-specific-api',
  'supports-command-language',
  'custom-fields',
] as const satisfies readonly TaskProviderTrait[]

type ManifestValidationInput = {
  permissions: readonly string[]
  providerCapabilities: readonly unknown[]
  providerConfigSchema: readonly unknown[]
  providerContextConfigSchema?: readonly unknown[]
  providerAllowedHosts: readonly string[]
  providerAllowedHostsFromConfig: readonly string[]
  providerConfigValidator?: string
  contributes: {
    configKeys: readonly string[]
    tools: readonly unknown[]
    promptFragments: readonly unknown[]
    commands: readonly unknown[]
    jobs: readonly unknown[]
    taskProviderTypes: readonly unknown[]
    attachmentTransformers: readonly unknown[]
  }
  configRequirements: readonly {
    key: string
    scope: 'context' | 'admin'
  }[]
  mcp?: unknown
  main?: string
}

export function isValidMainPath(path: string): boolean {
  if (path.startsWith('/')) return false
  if (win32.isAbsolute(path)) return false
  if (path.split('/').includes('..')) return false
  if (path.split('\\').includes('..')) return false
  if (posix.normalize(path).split('/').includes('..')) return false
  if (win32.normalize(path).split('\\').includes('..')) return false
  return path.endsWith('.ts') || path.endsWith('.js')
}

export function hasProviderManifestPermission(m: ManifestValidationInput): boolean {
  const hasTaskProviderPermission =
    m.permissions.includes('provider.task') && m.contributes.taskProviderTypes.length > 0
  const allowsProviderHosts =
    (m.providerAllowedHosts.length === 0 && m.providerAllowedHostsFromConfig.length === 0) ||
    m.permissions.includes('http') ||
    hasTaskProviderPermission
  const allowsTaskProviderFields =
    (m.providerCapabilities.length === 0 &&
      m.providerConfigSchema.length === 0 &&
      (m.providerContextConfigSchema?.length ?? 0) === 0 &&
      m.providerConfigValidator === undefined) ||
    hasTaskProviderPermission

  return allowsProviderHosts && allowsTaskProviderFields
}

export function hasMatchingContextConfigKeys(m: ManifestValidationInput): boolean {
  const configKeys = new Set(m.contributes.configKeys)
  if (configKeys.size === 0) return true

  return [...configKeys].every((key) =>
    m.configRequirements.some((requirement) => requirement.key === key && requirement.scope === 'context'),
  )
}

export function hasAttachmentTransformerPermission(m: ManifestValidationInput): boolean {
  return m.contributes.attachmentTransformers.length === 0 || m.permissions.includes('attachments.read')
}

export function hasProviderAllowedHostsFromConfig(m: ManifestValidationInput): boolean {
  return m.providerAllowedHostsFromConfig.every((key) => m.configRequirements.some((req) => req.key === key))
}

export function hasRequiredMainForManifest(m: ManifestValidationInput): boolean {
  const runtimeContributionCount =
    m.contributes.tools.length +
    m.contributes.promptFragments.length +
    m.contributes.commands.length +
    m.contributes.jobs.length +
    m.contributes.taskProviderTypes.length +
    m.contributes.attachmentTransformers.length
  const hasProviderMetadata =
    m.providerCapabilities.length > 0 ||
    m.providerConfigSchema.length > 0 ||
    (m.providerContextConfigSchema?.length ?? 0) > 0 ||
    m.providerAllowedHosts.length > 0 ||
    m.providerConfigValidator !== undefined
  const isMcpOnly = m.mcp !== undefined && runtimeContributionCount === 0 && !hasProviderMetadata

  if (isMcpOnly) return m.main === undefined
  return m.main !== undefined
}
