// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible'
import { embed, embedMany } from 'ai'

import { resolveLlmConfig } from './llm-providers/resolver.js'
import { logger } from './logger.js'
import { recordUsage } from './usage/recorder.js'
import type { ContextType } from './usage/types.js'

const log = logger.child({ scope: 'embeddings' })

/**
 * Bounds every embedding HTTP call: a throttling or queueing endpoint must
 * fail fast into the lexical/neutral fallbacks instead of hanging a turn.
 */
export const EMBED_TIMEOUT_MS = 10_000
export const EMBED_MAX_RETRIES = 1

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
      maxRetries: EMBED_MAX_RETRIES,
      abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
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

export interface EmbedManyDeps {
  embedMany: typeof embedMany
  getProvider: (apiKey: string, baseUrl: string) => OpenAICompatibleProvider
}

const defaultEmbedManyDeps: EmbedManyDeps = {
  embedMany: (...args) => embedMany(...args),
  getProvider,
}

type EmbedManyResult = { embeddings: number[][]; usage?: { tokens: number } }

const extractBatchInputTokens = (result: EmbedManyResult): number | null => {
  const tokens = result.usage?.tokens
  return typeof tokens === 'number' ? tokens : null
}

const recordBatchUsage = (
  context: EmbeddingCallContext,
  model: string,
  startedAt: number,
  inputTokens: number | null,
  error: string | null,
): void => {
  recordUsage({
    occurredAt: startedAt,
    turnId: null,
    storageContextId: context.storageContextId,
    contextType: context.contextType,
    chatUserId: context.chatUserId,
    model,
    modelRole: 'embedding',
    inputTokens,
    outputTokens: null,
    stepCount: 0,
    toolCallCount: 0,
    messageCount: 0,
    finishReason: null,
    durationMs: Date.now() - startedAt,
    responseId: null,
    error,
  })
}

/**
 * Embeds a batch of texts in one bounded HTTP call. Throws on failure (after
 * recording the usage row when a context is supplied), so callers decide their
 * own degradation; the shared call bounds (`EMBED_TIMEOUT_MS`,
 * `EMBED_MAX_RETRIES`) apply.
 */
export async function embedManyTexts(
  texts: readonly string[],
  apiKey: string,
  baseUrl: string,
  model: string,
  context?: EmbeddingCallContext,
  deps: EmbedManyDeps = defaultEmbedManyDeps,
): Promise<number[][]> {
  log.debug({ count: texts.length, model }, 'embedManyTexts called')
  const provider = deps.getProvider(apiKey, baseUrl)
  const startedAt = Date.now()
  try {
    const result = await deps.embedMany({
      model: provider.embeddingModel(model),
      values: [...texts],
      maxRetries: EMBED_MAX_RETRIES,
      abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    })
    if (context !== undefined) recordBatchUsage(context, model, startedAt, extractBatchInputTokens(result), null)
    log.info({ model, count: result.embeddings.length }, 'Batch embeddings generated')
    return result.embeddings
  } catch (error) {
    if (context !== undefined) {
      recordBatchUsage(context, model, startedAt, null, error instanceof Error ? error.message : String(error))
    }
    throw error
  }
}

export function getEmbeddingForContext(
  text: string,
  configContextId: string,
  context?: EmbeddingCallContext,
  deps: EmbeddingsDeps = defaultEmbeddingsDeps,
): Promise<number[] | null> {
  const resolved = resolveLlmConfig(configContextId)
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

  return tryGetEmbedding(
    text,
    resolved.embedding.apiKey,
    resolved.embedding.baseUrl,
    resolved.embedding.model,
    context,
    deps,
  )
}
