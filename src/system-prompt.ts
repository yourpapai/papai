// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigContextIdFromStorageContextId } from './chat/scoped-context.js'
import type { ContextType } from './chat/types.js'
import { getDictionary, type Locale } from './i18n/index.js'
import { buildInstructionsBlock } from './instructions.js'
import { buildPluginPromptSection } from './plugins/prompt-contributions.js'
import { filterProviderlessPluginIds } from './plugins/providerless.js'
import { getPluginsForContext } from './plugins/registry.js'
import type { TaskProvider } from './providers/types.js'
import { buildDeferredFragment } from './system-prompt-group.js'
import { buildAskToolsLine, buildUnavailableLine } from './system-prompt-prefs.js'
import { getToolPrefs } from './tools/tool-preferences.js'
import { getContextLanguage } from './utils/config-language.js'

interface PromptFragment {
  readonly key: FragmentKey
  /** Fragment is included when at least one of these tools is enabled. Empty = always. */
  readonly requiredTools: readonly string[]
}

type FragmentKey =
  | 'dueDates'
  | 'recurring'
  | 'deferred'
  | 'proactive'
  | 'userFacingWords'
  | 'webFetch'
  | 'chatLink'
  | 'workflow'
  | 'destructive'
  | 'relations'
  | 'memos'
  | 'memorySearch'
  | 'groupFindUser'

// Order here defines prompt order. Empty requiredTools = always included.
const FRAGMENTS: readonly PromptFragment[] = [
  { key: 'dueDates', requiredTools: ['create_task', 'update_task'] },
  { key: 'recurring', requiredTools: ['create_recurring_task', 'list_recurring_tasks'] },
  { key: 'deferred', requiredTools: ['create_reminder', 'create_alert', 'list_reminders'] },
  { key: 'proactive', requiredTools: [] },
  { key: 'userFacingWords', requiredTools: [] },
  { key: 'webFetch', requiredTools: ['web_fetch'] },
  { key: 'chatLink', requiredTools: ['fetch_chat_link'] },
  { key: 'workflow', requiredTools: [] },
  {
    key: 'destructive',
    requiredTools: ['delete_task', 'delete_project', 'delete_status', 'remove_label'],
  },
  { key: 'relations', requiredTools: ['add_task_relation', 'update_task_relation'] },
  { key: 'memos', requiredTools: ['save_memo', 'search_memos', 'list_memos'] },
  { key: 'memorySearch', requiredTools: ['search_memory'] },
  { key: 'groupFindUser', requiredTools: ['find_user'] },
]

function fragmentIncluded(fragment: PromptFragment, enabled: ReadonlySet<string> | undefined): boolean {
  if (enabled === undefined) return true
  if (fragment.requiredTools.length === 0) return true
  return fragment.requiredTools.some((name) => enabled.has(name))
}

function buildOutputRules(enabled: ReadonlySet<string> | undefined, locale: Locale): string {
  const texts = getDictionary(locale).systemPrompt
  const core = `${texts.outputCore}\n${texts.languageInstruction}`
  if (enabled === undefined) return `${core}\n${texts.instructionsRule}`
  if (enabled.has('save_instruction')) return `${core}\n${texts.instructionsRule}`
  return core
}

function buildDisclosureFragment(enabledToolNames: ReadonlySet<string> | undefined, locale: Locale): string {
  const texts = getDictionary(locale).systemPrompt
  const hasExpand = enabledToolNames?.has('expand_result') === true
  const always = hasExpand ? texts.disclosureAlwaysToolsWithExpand : texts.disclosureAlwaysTools
  return `${texts.disclosureProtocol}\n${always}`
}

interface AssembleOptions {
  readonly askPermissionAvailable: boolean
  readonly deferredFragmentText?: string
  readonly progressiveDisclosure?: boolean
  readonly contextType?: ContextType
  readonly locale?: Locale
}

function assembleSystemPrompt(
  intro: string,
  contextId: string,
  enabledToolNames: ReadonlySet<string> | undefined,
  options: AssembleOptions,
): string {
  const locale = options.locale ?? 'en'
  const texts = getDictionary(locale).systemPrompt
  const sharedContextId = getConfigContextIdFromStorageContextId(contextId)
  const parts: string[] = [intro]
  if (options.progressiveDisclosure === true) parts.push(buildDisclosureFragment(enabledToolNames, locale))
  parts.push(texts.steering)
  for (const fragment of FRAGMENTS) {
    if (!fragmentIncluded(fragment, enabledToolNames)) continue
    if (fragment.key === 'deferred') {
      const deferredText = options.deferredFragmentText ?? texts.deferred
      parts.push(buildDeferredFragment(deferredText, options.contextType, enabledToolNames, locale))
      continue
    }
    if (fragment.key === 'groupFindUser' && options.contextType !== 'group') continue
    parts.push(texts[fragment.key])
  }
  parts.push(buildOutputRules(enabledToolNames, locale))

  if (enabledToolNames !== undefined) {
    const prefs = getToolPrefs(sharedContextId)
    const line = buildUnavailableLine(prefs, enabledToolNames, locale)
    if (line !== null) parts.push(line)
    if (options.askPermissionAvailable) {
      const askLine = buildAskToolsLine(prefs, enabledToolNames, locale)
      if (askLine !== null) parts.push(askLine)
    }
  }

  return `${buildInstructionsBlock(sharedContextId)}${parts.join('\n\n')}`
}

function appendPluginPromptSection(basePrompt: string, sharedContextId: string): string {
  const activePlugins = getPluginsForContext(sharedContextId)
  if (activePlugins.length === 0) return basePrompt
  const activePluginIds = activePlugins.map((p) => p.manifest.id)
  const pluginSection = buildPluginPromptSection(activePluginIds)
  if (pluginSection === '') return basePrompt

  return `${basePrompt}\n\n${pluginSection}`
}

function appendProviderlessPluginPromptSection(basePrompt: string, sharedContextId: string): string {
  const activePlugins = getPluginsForContext(sharedContextId)
  if (activePlugins.length === 0) return basePrompt
  const providerlessPluginIds = filterProviderlessPluginIds(activePlugins.map((p) => p.manifest.id))
  if (providerlessPluginIds.length === 0) return basePrompt

  const pluginSection = buildPluginPromptSection(providerlessPluginIds)
  if (pluginSection === '') return basePrompt

  return `${basePrompt}\n\n${pluginSection}`
}

export function buildSystemPrompt(provider: TaskProvider, contextId: string): string
export function buildSystemPrompt(
  provider: TaskProvider,
  contextId: string,
  enabledToolNames: ReadonlySet<string>,
): string
export function buildSystemPrompt(
  provider: TaskProvider,
  contextId: string,
  enabledToolNames: ReadonlySet<string>,
  options: { askPermissionAvailable: boolean; progressiveDisclosure?: boolean; contextType?: ContextType },
): string
export function buildSystemPrompt(
  provider: TaskProvider,
  contextId: string,
  ...args:
    | readonly [
        ReadonlySet<string>,
        { askPermissionAvailable: boolean; progressiveDisclosure?: boolean; contextType?: ContextType }?,
      ]
    | readonly []
): string {
  const enabledToolNames = args[0]
  const options: AssembleOptions = {
    askPermissionAvailable: args[1]?.askPermissionAvailable ?? true,
    progressiveDisclosure: args[1]?.progressiveDisclosure,
    contextType: args[1]?.contextType,
  }
  const sharedContextId = getConfigContextIdFromStorageContextId(contextId)
  const locale = getContextLanguage(sharedContextId)
  const texts = getDictionary(locale).systemPrompt
  const addendum = provider.getPromptAddendum()
  const basePrompt = assembleSystemPrompt(texts.coreIntro, contextId, enabledToolNames, { ...options, locale })
  const withAddendum = addendum === '' ? basePrompt : `${basePrompt}\n\n${addendum}`
  return appendPluginPromptSection(withAddendum, sharedContextId)
}

export function buildProviderlessSystemPrompt(
  contextId: string,
  enabledToolNames: ReadonlySet<string>,
  options: { askPermissionAvailable: boolean; progressiveDisclosure?: boolean; contextType?: ContextType } = {
    askPermissionAvailable: true,
  },
): string {
  const sharedContextId = getConfigContextIdFromStorageContextId(contextId)
  const locale = getContextLanguage(sharedContextId)
  const texts = getDictionary(locale).systemPrompt
  const basePrompt = assembleSystemPrompt(texts.providerlessIntro, contextId, enabledToolNames, {
    ...options,
    locale,
    deferredFragmentText: texts.providerlessDeferred,
  })
  return appendProviderlessPluginPromptSection(basePrompt, sharedContextId)
}
