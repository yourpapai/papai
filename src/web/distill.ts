// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, type LanguageModel } from 'ai'

import { logger } from '../logger.js'
import { getSystemConfig, type SystemConfigKey } from '../system-config.js'
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

export async function distillWebContent(
  input: {
    readonly storageContextId: string
    readonly title: string
    readonly content: string
    readonly goal?: string
  },
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
  const result = await deps.generateText({
    model,
    prompt,
    timeout: 1_200_000,
  })

  return logDistilledContent(input.storageContextId, modelId, parseDistilledContent(result.text))
}
