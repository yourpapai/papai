// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Analytics tool classification: maps a registered tool name to its bounded
 * fact classification (slug, origin, domain, risk). User MCP and external
 * plugin tools collapse to `external_other`; classification never carries raw
 * external names. When a name-key deriver is supplied, external tools also
 * carry a purpose-separated pseudonym of the raw name so distinct external
 * tools get distinct `tool_key` values without leaking the name.
 */

import { META_TOOL_NAMES } from '../tools/disclosure/core.js'
import { getToolMetadata } from '../tools/tool-metadata.js'
import type { ToolDomain, ToolRisk } from '../tools/tool-metadata.js'
import type { Pseudonym } from './controlled-types.js'
import { EXTERNAL_OTHER_TOOL_SLUG, KNOWN_TOOL_SLUG_SET } from './generated/tool-slugs.js'
import { resolveAnalyticsToolSlug } from './tool-slug-generation.js'

export type AnalyticsToolOrigin = 'core' | 'first_party_plugin' | 'external_plugin' | 'user_mcp'
export type AnalyticsToolDomain =
  | 'task'
  | 'memo'
  | 'schedule'
  | 'attachment'
  | 'web'
  | 'identity'
  | 'coding'
  | 'config'
  | 'meta'
  | 'diagnostics'
  | 'other'
export type AnalyticsToolRisk = 'read' | 'write' | 'destructive' | 'open_world'

/** Derives the `tool:v1` pseudonym for an external tool's raw name (origin-separated). */
export type ExternalToolNameKeyDeriver = (origin: AnalyticsToolOrigin, rawToolName: string) => Pseudonym

export type AnalyticsToolClassification = Readonly<{
  toolSlug: string
  toolOrigin: AnalyticsToolOrigin
  toolDomain: AnalyticsToolDomain
  risk: AnalyticsToolRisk
  toolNameKey: Pseudonym | null
}>

const ACP_PLUGIN_PREFIX = 'plugin_acp__'

const originOf = (toolName: string, slug: string): AnalyticsToolOrigin => {
  if (toolName.startsWith('mcp_')) return 'user_mcp'
  if (toolName.startsWith('plugin_'))
    return slug === EXTERNAL_OTHER_TOOL_SLUG ? 'external_plugin' : 'first_party_plugin'
  return slug === EXTERNAL_OTHER_TOOL_SLUG ? 'external_plugin' : 'core'
}

export const DOMAIN_MAP: Readonly<Record<ToolDomain, AnalyticsToolDomain>> = {
  task: 'task',
  project: 'task',
  comment: 'task',
  label: 'task',
  status: 'task',
  work: 'task',
  sprint: 'task',
  query: 'task',
  history: 'task',
  memo: 'memo',
  instruction: 'memo',
  memory: 'memo',
  recurring: 'schedule',
  deferred: 'schedule',
  attachment: 'attachment',
  web: 'web',
  identity: 'identity',
  collaboration: 'identity',
  time: 'other',
  mcp: 'other',
  plugin: 'other',
  diagnostics: 'diagnostics',
}

const riskOf = (risk: ToolRisk): AnalyticsToolRisk => (risk === 'open-world' ? 'open_world' : risk)

export const classifyAnalyticsTool = (
  toolName: string,
  deriveNameKey?: ExternalToolNameKeyDeriver,
): AnalyticsToolClassification => {
  const toolSlug = resolveAnalyticsToolSlug(toolName, KNOWN_TOOL_SLUG_SET)
  const base = classifyBase(toolName, toolSlug)
  const toolNameKey =
    toolSlug === EXTERNAL_OTHER_TOOL_SLUG && deriveNameKey !== undefined
      ? deriveNameKey(base.toolOrigin, toolName)
      : null
  return { ...base, toolNameKey }
}

const classifyBase = (
  toolName: string,
  toolSlug: string,
): Readonly<{
  toolSlug: string
  toolOrigin: AnalyticsToolOrigin
  toolDomain: AnalyticsToolDomain
  risk: AnalyticsToolRisk
}> => {
  if (META_TOOL_NAMES.has(toolName)) {
    return { toolSlug, toolOrigin: 'core', toolDomain: 'meta', risk: 'read' }
  }
  if (toolName.startsWith(ACP_PLUGIN_PREFIX)) {
    return { toolSlug, toolOrigin: 'first_party_plugin', toolDomain: 'coding', risk: 'open_world' }
  }
  const metadata = getToolMetadata(toolName)
  if (metadata === undefined) {
    return { toolSlug, toolOrigin: originOf(toolName, toolSlug), toolDomain: 'other', risk: 'open_world' }
  }
  return {
    toolSlug,
    toolOrigin: originOf(toolName, toolSlug),
    toolDomain: DOMAIN_MAP[metadata.domain],
    risk: riskOf(metadata.risk),
  }
}
