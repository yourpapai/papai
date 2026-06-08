// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible'
import { embed } from 'ai'

import { resolveEffectiveLlmConfig } from './llm-config-resolver.js'
import { logger } from './logger.js'
import { recordUsage } from './usage/recorder.js'
import type { ContextType } from './usage/types.js'

const log = logger.child({ scope: 'embeddings' })

let cachedProvider: { key: string; provider: OpenAICompatibleProvider } | null = null

function getProvider(apiKey: string, baseUrl: string): OpenAICompatibleProvider {
  const key = `${apiKey}:${baseUrl}`
  if (cachedProvider !== null && cachedProvider.key === key) return cachedProvider.provider
  const provider = createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL: baseUrl })
  cachedProvider = { key, provider }
  return provider
}

export interface EmbeddingsDeps {
  embed: typeof embed
  getProvider: (apiKey: string, baseUrl: string) => OpenAICompatibleProvider
}

const defaultEmbeddingsDeps: EmbeddingsDeps = {
  embed: (...args) => embed(...args),
  getProvider,
}

export type EmbeddingCallContext = {
  storageContextId: string
  contextType: ContextType
  chatUserId: string
}

type EmbedReturnShape = { embedding: number[]; usage?: { tokens?: number } }

const extractInputTokens = (result: EmbedReturnShape): number | null => {
  const tokens = result.usage?.tokens
  return typeof tokens === 'number' ? tokens : null
}

const recordEmbeddingSuccess = (
  context: EmbeddingCallContext,
  model: string,
  startedAt: number,
  result: EmbedReturnShape,
): void => {
  recordUsage({
    occurredAt: startedAt,
    turnId: null,
    storageContextId: context.storageContextId,
    contextType: context.contextType,
    chatUserId: context.chatUserId,
    model,
    modelRole: 'embedding',
    inputTokens: extractInputTokens(result),
    outputTokens: null,
    stepCount: 0,
    toolCallCount: 0,
    messageCount: 0,
    finishReason: null,
    durationMs: Date.now() - startedAt,
    responseId: null,
    error: null,
  })
}

const recordEmbeddingFailure = (
  context: EmbeddingCallContext,
  model: string,
  startedAt: number,
  error: unknown,
): void => {
  recordUsage({
    occurredAt: startedAt,
    turnId: null,
    storageContextId: context.storageContextId,
    contextType: context.contextType,
    chatUserId: context.chatUserId,
    model,
    modelRole: 'embedding',
    inputTokens: null,
    outputTokens: null,
    stepCount: 0,
    toolCallCount: 0,
    messageCount: 0,
    finishReason: null,
    durationMs: Date.now() - startedAt,
    responseId: null,
    error: error instanceof Error ? error.message : String(error),
  })
}

export async function getEmbedding(
  text: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  context?: EmbeddingCallContext,
  deps: EmbeddingsDeps = defaultEmbeddingsDeps,
): Promise<number[]> {
  log.debug({ textLength: text.length, model }, 'getEmbedding called')
  const provider = deps.getProvider(apiKey, baseUrl)
  const startedAt = Date.now()
  try {
    const result = await deps.embed({
      model: provider.embeddingModel(model),
      value: text,
    })
    if (context !== undefined) recordEmbeddingSuccess(context, model, startedAt, result)
    log.info({ model, dimension: result.embedding.length }, 'Embedding generated')
    return result.embedding
  } catch (error) {
    if (context !== undefined) recordEmbeddingFailure(context, model, startedAt, error)
    throw error
  }
}

export async function tryGetEmbedding(
  text: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  context?: EmbeddingCallContext,
  deps: EmbeddingsDeps = defaultEmbeddingsDeps,
): Promise<number[] | null> {
  try {
    return await getEmbedding(text, apiKey, baseUrl, model, context, deps)
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error), model }, 'Embedding generation failed')
    return null
  }
}

export function getEmbeddingForContext(
  text: string,
  configContextId: string,
  context?: EmbeddingCallContext,
  deps: EmbeddingsDeps = defaultEmbeddingsDeps,
): Promise<number[] | null> {
  const resolved = resolveEffectiveLlmConfig(configContextId)
  if (!resolved.ok) {
    log.warn(
      {
        configContextId,
        source: resolved.source,
        type: resolved.type,
        missing: resolved.type === 'missing' ? resolved.missing : undefined,
        error: resolved.type === 'error' ? resolved.error : undefined,
      },
      'LLM config not available for embedding',
    )
    return Promise.resolve(null)
  }

  return tryGetEmbedding(text, resolved.llmApiKey, resolved.llmBaseUrl, resolved.embeddingModel, context, deps)
}
