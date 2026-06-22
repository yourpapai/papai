// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getToolMetadata, TOOL_METADATA, type ToolDomain } from '../tools/tool-metadata.js'
import { getToolPrefs, resolveToolPermission } from '../tools/tool-preferences.js'
import { PROMPT_SURFACE_EXAMPLES, type PromptExample } from './examples.js'

export type PromptSurfaceMode = 'task-provider' | 'providerless'
export type PromptSurfaceContextType = 'dm' | 'group'

export interface PromptSurfaceModelInput {
  readonly mode: PromptSurfaceMode
  readonly contextType: PromptSurfaceContextType
  readonly contextId: string
  readonly enabledToolNames: ReadonlySet<string>
  readonly askPermissionAvailable: boolean
  readonly providerAddendum: string
  readonly pluginGuidance: string
}

export interface PromptSurfaceCapabilities {
  readonly providerless: boolean
  readonly enabledToolNames: readonly string[]
  readonly availableDomains: readonly ToolDomain[]
  readonly askGatedTools: readonly string[]
  readonly deniedTools: readonly string[]
}

export interface PromptSurfaceModel {
  readonly mode: PromptSurfaceMode
  readonly contextType: PromptSurfaceContextType
  readonly contextId: string
  readonly capabilities: PromptSurfaceCapabilities
  readonly providerAddendum: string
  readonly pluginGuidance: string
  readonly examples: readonly PromptExample[]
}

function collectDeniedTools(enabledToolNames: ReadonlySet<string>, contextId: string): readonly string[] {
  const prefs = getToolPrefs(contextId)
  const enabledDomains = new Set<ToolDomain>()
  for (const toolName of enabledToolNames) {
    const meta = getToolMetadata(toolName)
    if (meta !== undefined) enabledDomains.add(meta.domain)
  }

  const denied = new Set<string>()
  for (const toolName of [...Object.keys(TOOL_METADATA), ...Object.keys(prefs.toolOverrides)]) {
    if (enabledToolNames.has(toolName)) continue
    const meta = getToolMetadata(toolName)
    if (prefs.toolOverrides[toolName] === 'deny') {
      denied.add(toolName)
      continue
    }
    if (meta === undefined || !enabledDomains.has(meta.domain)) continue
    if (resolveToolPermission(prefs, toolName) === 'deny') denied.add(toolName)
  }
  return [...denied].toSorted()
}

function buildCapabilities(input: PromptSurfaceModelInput): PromptSurfaceCapabilities {
  const prefs = getToolPrefs(input.contextId)
  const enabledToolNames = [...input.enabledToolNames].toSorted()
  const availableDomains = [
    ...new Set(
      enabledToolNames.flatMap((toolName) => {
        const meta = getToolMetadata(toolName)
        return meta === undefined ? [] : [meta.domain]
      }),
    ),
  ].toSorted()
  const askGatedTools = input.askPermissionAvailable
    ? enabledToolNames.filter((toolName) => resolveToolPermission(prefs, toolName) === 'ask')
    : []

  return {
    providerless: input.mode === 'providerless',
    enabledToolNames,
    availableDomains,
    askGatedTools,
    deniedTools: collectDeniedTools(input.enabledToolNames, input.contextId),
  }
}

function selectExamples(
  model: Pick<PromptSurfaceModel, 'mode' | 'contextType' | 'capabilities'>,
): readonly PromptExample[] {
  const tags = new Set<string>()
  if (model.mode === 'providerless') tags.add('providerless')
  if (model.capabilities.availableDomains.includes('task')) tags.add('task')
  if (model.capabilities.availableDomains.includes('memory')) tags.add('memory')
  if (model.contextType === 'group') tags.add('group')
  if (model.capabilities.askGatedTools.length > 0) tags.add('ask-gated')

  return PROMPT_SURFACE_EXAMPLES.filter((example) => example.appliesWhen.some((tag) => tags.has(tag)))
}

export function buildPromptSurfaceModel(input: PromptSurfaceModelInput): PromptSurfaceModel {
  const capabilities = buildCapabilities(input)
  const baseModel = {
    mode: input.mode,
    contextType: input.contextType,
    contextId: input.contextId,
    capabilities,
    providerAddendum: input.providerAddendum,
    pluginGuidance: input.pluginGuidance,
  }

  return { ...baseModel, examples: selectExamples(baseModel) }
}
