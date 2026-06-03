// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import type { ContextSection, ContextSnapshot } from '../chat/types.js'
import { logger } from '../logger.js'

export { defaultCountTokens, prepareDefaultCountTokens, type EncodingName } from './context-tokenizer.js'

const log = logger.child({ scope: 'commands:context-collector' })

type Fact = { identifier: string; title: string; url: string; last_seen: string }

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
  getProviderName: () => string
  countTokens: (text: string) => number
}

const FALLBACK_MODEL = 'unknown'

const MODEL_CONTEXT_WINDOWS: ReadonlyArray<readonly [prefix: string, tokens: number]> = [
  // OpenAI GPT-4.1 family (1M context)
  ['gpt-4.1-nano', 1_048_576],
  ['gpt-4.1-mini', 1_048_576],
  ['gpt-4.1', 1_048_576],
  // OpenAI GPT-4o family
  ['gpt-4o-mini', 128_000],
  ['gpt-4o', 128_000],
  ['gpt-4-turbo', 128_000],
  // OpenAI o-series reasoning models
  ['o4-mini', 200_000],
  ['o3-mini', 200_000],
  ['o1-preview', 128_000],
  ['o1-mini', 128_000],
  ['o1', 200_000],
  // Anthropic Claude 4 family
  ['claude-haiku-4-5', 200_000],
  ['claude-sonnet-4', 200_000],
  ['claude-opus-4', 200_000],
  // Google Gemini family (1M+ context)
  ['gemini-2.5-pro', 1_048_576],
  ['gemini-2.0-flash', 1_048_576],
  ['gemini-1.5-pro', 2_097_152],
  ['gemini-1.5-flash', 1_048_576],
  // Deepseek family
  ['deepseek-reasoner', 64_000],
  ['deepseek-chat', 64_000],
  // Meta Llama family
  ['llama-3.3-70b', 128_000],
  ['llama-3.2-90b', 128_000],
  ['llama-3.2-11b', 128_000],
  ['llama-3.2-3b', 128_000],
  ['llama-3.2-1b', 128_000],
  ['llama-3.1-405b', 128_000],
  ['llama-3.1-70b', 128_000],
  ['llama-3.1-8b', 128_000],
  // Mistral family
  ['mistral-large', 128_000],
  ['mistral-medium', 32_000],
  ['mistral-small', 32_000],
  ['mixtral-8x22b', 65_536],
  ['mixtral-8x7b', 32_000],
]

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

export const resolveMaxTokens = (modelName: string): number | null => {
  for (const [prefix, tokens] of MODEL_CONTEXT_WINDOWS) {
    if (modelName.startsWith(prefix)) return tokens
  }
  return null
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

const buildSystemPromptSection = (deps: ContextCollectorDeps, counter: SafeCounter): ContextSection => {
  const fullPrompt = deps.buildSystemPrompt()
  const customInstructions = deps.buildInstructionsBlock()
  const addendum = deps.getProviderAddendum()
  const totalTokens = counter.count(fullPrompt)
  const customTokens = counter.count(customInstructions)
  const addendumTokens = counter.count(addendum)
  const baseTokens = Math.max(0, totalTokens - customTokens - addendumTokens)

  const children: ContextSection[] = [{ label: 'Base instructions', tokens: baseTokens }]
  if (customTokens > 0) children.push({ label: 'Custom instructions', tokens: customTokens })
  if (addendumTokens > 0) children.push({ label: 'Provider addendum', tokens: addendumTokens })

  return { label: 'System prompt', tokens: totalTokens, children }
}

const buildMemorySection = (deps: ContextCollectorDeps, counter: SafeCounter): ContextSection => {
  const memoryMessage = deps.getMemoryMessage()
  const summary = deps.getSummary() ?? ''
  const facts = deps.getFacts()
  const factText = facts.map((f) => `${f.identifier}: ${f.title}`).join('\n')

  const totalTokens =
    memoryMessage === null ? counter.count(summary) + counter.count(factText) : counter.count(memoryMessage)
  const summaryTokens = counter.count(summary)
  const factsTokens = counter.count(factText)

  const children: ContextSection[] = [{ label: 'Summary', tokens: summaryTokens }]
  const factsChild: ContextSection = {
    label: 'Known entities',
    tokens: factsTokens,
    detail: `${String(facts.length)} fact${facts.length === 1 ? '' : 's'}`,
  }
  children.push(factsChild)

  return { label: 'Memory context', tokens: totalTokens, children }
}

const buildHistorySection = (deps: ContextCollectorDeps, counter: SafeCounter): ContextSection => {
  const history = deps.getHistory()
  const tokens = counter.count(serializeHistory(history))
  return {
    label: 'Conversation history',
    tokens,
    detail: `${String(history.length)} message${history.length === 1 ? '' : 's'}`,
  }
}

const buildToolsSection = (deps: ContextCollectorDeps, counter: SafeCounter): ContextSection => {
  const tools = deps.getActiveToolDefinitions()
  const count = Object.keys(tools).length
  const providerName = deps.getProviderName()
  const tokens = counter.count(serializeTools(tools))
  return {
    label: 'Tools',
    tokens,
    detail: `${String(count)} active, gated by ${providerName}`,
  }
}

export const collectContext = (contextId: string, deps: ContextCollectorDeps): ContextSnapshot => {
  log.debug({ contextId }, 'collectContext called')
  const modelName = deps.getMainModel() ?? FALLBACK_MODEL
  const counter = makeSafeCounter(deps.countTokens)

  const sections: ContextSection[] = [
    buildSystemPromptSection(deps, counter),
    buildMemorySection(deps, counter),
    buildHistorySection(deps, counter),
    buildToolsSection(deps, counter),
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

  return { modelName, sections, totalTokens, maxTokens, approximate: counter.approximate }
}
