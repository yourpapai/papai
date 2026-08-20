// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import type { ContextSection, ContextSnapshot } from '../chat/types.js'
import { t } from '../i18n/index.js'
import type { Dictionary, Locale } from '../i18n/index.js'
import { logger } from '../logger.js'
import { resolveMaxTokens } from '../model-context.js'

export { defaultCountTokens, prepareDefaultCountTokens } from './context-tokenizer.js'
export { resolveMaxTokens } from '../model-context.js'

const log = logger.child({ scope: 'commands:context-collector' })

type Fact = { identifier: string; title: string; url: string; last_seen: string }

/** Section ids the collector emits; each has a `contextView.sections.<id>` catalog entry. */
type SectionId = keyof Dictionary['contextView']['sections']

export interface ContextCollectorDeps {
  getMainModel: () => string | null
  buildSystemPrompt: () => string
  buildInstructionsBlock: () => string
  getProviderAddendum: () => string
  getHistory: () => readonly ModelMessage[]
  getMemoryMessage: () => string | null
  getSummary: () => string | null
  getFacts: () => readonly Fact[]
  getActiveToolDefinitions: () => Record<string, unknown>
  getDisclosedToolDefinitions: () => Record<string, unknown>
  countTokens: (text: string) => number
  /** Locale for section labels and detail strings; defaults to `en`. */
  locale?: Locale
}

const sectionLabel = (id: SectionId, locale: Locale): string => t(`contextView.sections.${id}`, locale)

const FALLBACK_MODEL = 'unknown'

/**
 * Resolve encoding name for a given model.
 * Uses specific patterns to avoid matching unrelated models.
 * Fixes: Issue where ^o1, ^o3 could match unrelated models like "o1-custom"
 */
export const resolveEncodingName = (modelName: string): 'o200k_base' | 'cl100k_base' => {
  // Match specific OpenAI model families exactly
  // gpt-4o family: gpt-4o, gpt-4o-mini, etc.
  if (/^gpt-4o/u.test(modelName)) return 'o200k_base'
  // gpt-4.1 family: gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, etc.
  if (/^gpt-4\.1/u.test(modelName)) return 'o200k_base'
  // o-series models with specific allowed patterns only
  // Match: o1, o1-preview, o1-mini, o3-mini, o4-mini (exact or with dash suffix for known variants)
  // Do NOT match: o1-custom, o3-other, etc.
  // o1 requires exact match or -preview/-mini suffix only
  if (modelName === 'o1') return 'o200k_base'
  if (/^(o1-preview|o1-mini)(-|$)/u.test(modelName)) return 'o200k_base'
  // o3-mini and o4-mini require exact match or known suffix pattern
  if (/^(o3-mini|o4-mini)(-|$)/u.test(modelName)) return 'o200k_base'

  return 'cl100k_base'
}

const serializeMessage = (message: ModelMessage): string => {
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
  return `${message.role}: ${content}`
}

const serializeHistory = (history: readonly ModelMessage[]): string => history.map(serializeMessage).join('\n')

const serializeTools = (tools: Record<string, unknown>): string => {
  try {
    const seen = new WeakSet<object>()
    return JSON.stringify(tools, (_key, value: unknown) => {
      if (typeof value === 'function') return '[function]'
      if (value !== null && typeof value === 'object') {
        if (seen.has(value)) return undefined
        seen.add(value)
      }
      return value
    })
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to serialize tools')
    return Object.keys(tools).join(',')
  }
}

type SafeCounter = { count: (text: string) => number; approximate: boolean }

const makeSafeCounter = (raw: (text: string) => number): SafeCounter => {
  let approximate = false
  return {
    count: (text: string): number => {
      if (text.length === 0) return 0
      if (approximate) return Math.ceil(text.length / 4)
      try {
        return raw(text)
      } catch (error) {
        approximate = true
        log.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'Tokenizer threw, falling back to char/4 estimate',
        )
        return Math.ceil(text.length / 4)
      }
    },
    get approximate(): boolean {
      return approximate
    },
  }
}

const buildSystemPromptSection = (deps: ContextCollectorDeps, counter: SafeCounter, locale: Locale): ContextSection => {
  const fullPrompt = deps.buildSystemPrompt()
  const customInstructions = deps.buildInstructionsBlock()
  const addendum = deps.getProviderAddendum()
  const totalTokens = counter.count(fullPrompt)
  const customTokens = counter.count(customInstructions)
  const addendumTokens = counter.count(addendum)
  const baseTokens = Math.max(0, totalTokens - customTokens - addendumTokens)

  const children: ContextSection[] = [
    { id: 'base_instructions', label: sectionLabel('base_instructions', locale), tokens: baseTokens },
  ]
  if (customTokens > 0) {
    children.push({
      id: 'custom_instructions',
      label: sectionLabel('custom_instructions', locale),
      tokens: customTokens,
    })
  }
  if (addendumTokens > 0) {
    children.push({
      id: 'provider_addendum',
      label: sectionLabel('provider_addendum', locale),
      tokens: addendumTokens,
    })
  }

  return { id: 'system_prompt', label: sectionLabel('system_prompt', locale), tokens: totalTokens, children }
}

const buildMemorySection = (deps: ContextCollectorDeps, counter: SafeCounter, locale: Locale): ContextSection => {
  const memoryMessage = deps.getMemoryMessage()
  const summary = deps.getSummary() ?? ''
  const facts = deps.getFacts()
  const factText = facts.map((f) => `${f.identifier}: ${f.title}`).join('\n')

  const totalTokens =
    memoryMessage === null ? counter.count(summary) + counter.count(factText) : counter.count(memoryMessage)
  const summaryTokens = counter.count(summary)
  const factsTokens = counter.count(factText)

  const children: ContextSection[] = [{ id: 'summary', label: sectionLabel('summary', locale), tokens: summaryTokens }]
  const factsChild: ContextSection = {
    id: 'known_entities',
    label: sectionLabel('known_entities', locale),
    tokens: factsTokens,
    detail: t(facts.length === 1 ? 'contextView.factSingular' : 'contextView.factPlural', locale, {
      count: facts.length,
    }),
  }
  children.push(factsChild)

  return { id: 'memory_context', label: sectionLabel('memory_context', locale), tokens: totalTokens, children }
}

const buildHistorySection = (deps: ContextCollectorDeps, counter: SafeCounter, locale: Locale): ContextSection => {
  const history = deps.getHistory()
  const tokens = counter.count(serializeHistory(history))
  return {
    id: 'conversation_history',
    label: sectionLabel('conversation_history', locale),
    tokens,
    detail: t(history.length === 1 ? 'contextView.messageSingular' : 'contextView.messagePlural', locale, {
      count: history.length,
    }),
  }
}

const buildToolsSection = (deps: ContextCollectorDeps, counter: SafeCounter, locale: Locale): ContextSection => {
  // Progressive disclosure only exposes the always-on/meta tools at a turn's first step; the
  // rest of the catalog is discoverable via search_tools but its schemas only enter context
  // when load_tool pulls them in. Count the disclosed surface (what actually costs tokens now)
  // and report the full catalog size as available context.
  const disclosed = deps.getDisclosedToolDefinitions()
  const activeCount = Object.keys(disclosed).length
  const availableCount = Object.keys(deps.getActiveToolDefinitions()).length
  const tokens = counter.count(serializeTools(disclosed))
  return {
    id: 'tools',
    label: sectionLabel('tools', locale),
    tokens,
    detail: t('contextView.progressiveDisclosure', locale, { active: activeCount, available: availableCount }),
  }
}

export const collectContext = (contextId: string, deps: ContextCollectorDeps): ContextSnapshot => {
  log.debug({ contextId }, 'collectContext called')
  const modelName = deps.getMainModel() ?? FALLBACK_MODEL
  const counter = makeSafeCounter(deps.countTokens)
  const locale = deps.locale ?? 'en'

  const sections: ContextSection[] = [
    buildSystemPromptSection(deps, counter, locale),
    buildMemorySection(deps, counter, locale),
    buildHistorySection(deps, counter, locale),
    buildToolsSection(deps, counter, locale),
  ]

  const totalTokens = sections.reduce((acc, s) => acc + s.tokens, 0)
  const maxTokens = resolveMaxTokens(modelName)

  log.info(
    {
      contextId,
      modelName,
      totalTokens,
      maxTokens,
      approximate: counter.approximate,
      sectionTokens: sections.map((s) => ({ label: s.label, tokens: s.tokens })),
    },
    'Context collected',
  )

  return { modelName, sections, totalTokens, maxTokens, approximate: counter.approximate, locale }
}
