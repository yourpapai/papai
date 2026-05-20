// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, type LanguageModel } from 'ai'

import { logger } from '../logger.js'
import { getSystemConfig, type SystemConfigKey } from '../system-config.js'
import { recordUsage } from '../usage/recorder.js'
import type { ContextType } from '../usage/types.js'
import { fetchWithoutTimeout } from '../utils/fetch.js'

const log = logger.child({ scope: 'web:distill' })

export const MAX_EXCERPT_CHARS = 8_000

const DEFAULT_GOAL = 'Summarize the page for later memo/task use.'

type DistilledContent = { summary: string; excerpt: string; truncated: boolean }

const buildPrompt = (title: string, goal: string, content: string): string =>
  [
    `Title: ${title}`,
    `Goal: ${goal}`,
    'Reply with a 1-3 sentence summary, then a blank line, then an excerpt under 8000 chars.',
    '',
    content,
  ].join('\n')

const splitParagraphs = (text: string): readonly string[] =>
  text
    .trim()
    .split(/\n\s*\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)

const requireSystemValue = (key: SystemConfigKey): string => {
  const value = getSystemConfig(key)
  if (value !== null) {
    return value
  }

  throw new Error(`Missing required system_config: ${key}`)
}

const bypassDistillation = (storageContextId: string, content: string): DistilledContent => {
  log.info({ storageContextId, contentLength: content.length }, 'Bypassed distillation')
  return { summary: content, excerpt: content, truncated: false }
}

const getModelConfig = (): { apiKey: string; baseUrl: string; modelId: string } => ({
  apiKey: requireSystemValue('llm_apikey'),
  baseUrl: requireSystemValue('llm_baseurl'),
  modelId: getSystemConfig('small_model') ?? requireSystemValue('main_model'),
})

const parseDistilledContent = (text: string): DistilledContent => {
  const [summary = '', ...excerptParts] = splitParagraphs(text)
  const excerptSource = excerptParts.length > 0 ? excerptParts.join('\n\n') : summary
  return {
    summary: summary || excerptSource,
    excerpt: excerptSource.slice(0, MAX_EXCERPT_CHARS),
    truncated: true,
  }
}

const logDistilledContent = (storageContextId: string, modelId: string, result: DistilledContent): DistilledContent => {
  log.info(
    {
      storageContextId,
      modelId,
      summaryLength: result.summary.length,
      excerptLength: result.excerpt.length,
    },
    'Distilled web content',
  )
  return result
}

export interface DistillDeps {
  readonly generateText: typeof generateText
  readonly buildModel: (apiKey: string, baseUrl: string, modelId: string) => LanguageModel
}

const defaultDeps: DistillDeps = {
  generateText: (...args) => generateText(...args),
  buildModel: (apiKey, baseUrl, modelId) =>
    createOpenAICompatible({
      name: 'openai-compatible',
      apiKey,
      baseURL: baseUrl,
      fetch: fetchWithoutTimeout,
    })(modelId),
}

export type DistillCallContext = {
  contextType: ContextType
  chatUserId: string
}

type DistillInput = {
  readonly storageContextId: string
  readonly title: string
  readonly content: string
  readonly goal?: string
  readonly contextType?: ContextType
  readonly chatUserId?: string
}

type GenerateTextLikeResult = {
  text: string
  usage?: { inputTokens?: number; outputTokens?: number }
  finishReason?: string
  steps?: ReadonlyArray<unknown>
}

const getDistillCallContext = (input: DistillInput): DistillCallContext | null => {
  if (input.contextType === undefined || input.chatUserId === undefined) return null
  return { contextType: input.contextType, chatUserId: input.chatUserId }
}

const recordDistillSuccess = (
  input: DistillInput,
  context: DistillCallContext,
  modelId: string,
  startedAt: number,
  result: GenerateTextLikeResult,
): void => {
  recordUsage({
    occurredAt: startedAt,
    turnId: null,
    storageContextId: input.storageContextId,
    contextType: context.contextType,
    chatUserId: context.chatUserId,
    model: modelId,
    modelRole: 'small',
    inputTokens: typeof result.usage?.inputTokens === 'number' ? result.usage.inputTokens : null,
    outputTokens: typeof result.usage?.outputTokens === 'number' ? result.usage.outputTokens : null,
    stepCount: Array.isArray(result.steps) ? Math.max(result.steps.length, 1) : 1,
    toolCallCount: 0,
    messageCount: 1,
    finishReason: typeof result.finishReason === 'string' ? result.finishReason : null,
    durationMs: Date.now() - startedAt,
    responseId: null,
    error: null,
  })
}

const recordDistillFailure = (
  input: DistillInput,
  context: DistillCallContext,
  modelId: string,
  startedAt: number,
  error: unknown,
): void => {
  recordUsage({
    occurredAt: startedAt,
    turnId: null,
    storageContextId: input.storageContextId,
    contextType: context.contextType,
    chatUserId: context.chatUserId,
    model: modelId,
    modelRole: 'small',
    inputTokens: null,
    outputTokens: null,
    stepCount: 0,
    toolCallCount: 0,
    messageCount: 1,
    finishReason: null,
    durationMs: Date.now() - startedAt,
    responseId: null,
    error: error instanceof Error ? error.message : String(error),
  })
}

export async function distillWebContent(
  input: DistillInput,
  deps: DistillDeps = defaultDeps,
): Promise<DistilledContent> {
  log.debug(
    {
      storageContextId: input.storageContextId,
      title: input.title,
      contentLength: input.content.length,
      hasGoal: input.goal !== undefined,
    },
    'distillWebContent called',
  )

  if (input.content.length <= MAX_EXCERPT_CHARS) {
    return bypassDistillation(input.storageContextId, input.content)
  }

  const { apiKey, baseUrl, modelId } = getModelConfig()
  const model = deps.buildModel(apiKey, baseUrl, modelId)
  const prompt = buildPrompt(input.title, input.goal ?? DEFAULT_GOAL, input.content)
  const callContext = getDistillCallContext(input)
  const startedAt = Date.now()
  let result: GenerateTextLikeResult
  try {
    result = await deps.generateText({
      model,
      prompt,
      timeout: 1_200_000,
    })
  } catch (error) {
    if (callContext !== null) recordDistillFailure(input, callContext, modelId, startedAt, error)
    throw error
  }
  if (callContext !== null) recordDistillSuccess(input, callContext, modelId, startedAt, result)

  return logDistilledContent(input.storageContextId, modelId, parseDistilledContent(result.text))
}
