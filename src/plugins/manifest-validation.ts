// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { posix, win32 } from 'node:path'

import type { TaskProviderTrait } from '../providers/types.js'

export const PLUGIN_MANIFEST_PROVIDER_TRAITS = [
  'workspace-scoped',
  'task-label-read-requires-provider-specific-api',
  'supports-command-language',
  'command-language:youtrack',
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
    m.providerAllowedHosts.length === 0 || m.permissions.includes('http') || hasTaskProviderPermission
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
  return m.providerAllowedHostsFromConfig.every((key) =>
    m.configRequirements.some((req) => req.key === key && req.scope === 'admin'),
  )
}

export function hasRequiredMainForManifest(m: ManifestValidationInput): boolean {
  const runtimeContributionCount =
    m.contributes.tools.length +
    m.contributes.promptFragments.length +
    m.contributes.commands.length +
    m.contributes.jobs.length +
    m.contributes.taskProviderTypes.length
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
