// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible'
import { embed } from 'ai'

import { logger } from './logger.js'

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

export async function getEmbedding(
  text: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  deps: EmbeddingsDeps = defaultEmbeddingsDeps,
): Promise<number[]> {
  log.debug({ textLength: text.length, model }, 'getEmbedding called')
  const provider = deps.getProvider(apiKey, baseUrl)
  const { embedding } = await deps.embed({
    model: provider.embeddingModel(model),
    value: text,
  })
  log.info({ model, dimension: embedding.length }, 'Embedding generated')
  return embedding
}

export async function tryGetEmbedding(
  text: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  deps: EmbeddingsDeps = defaultEmbeddingsDeps,
): Promise<number[] | null> {
  try {
    return await getEmbedding(text, apiKey, baseUrl, model, deps)
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error), model }, 'Embedding generation failed')
    return null
  }
}
