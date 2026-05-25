// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { embedMany } from 'ai'

import {
  CONSOLIDATION_EMBED_BATCH_SIZE,
  EMBEDDING_BASE_URL,
  EMBEDDING_MODEL,
  MAX_RETRIES,
  RETRY_BACKOFF_MS,
} from './config.js'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

type EmbedManyInput = Parameters<typeof embedMany>[0]
type EmbeddingModel = EmbedManyInput['model']

export interface EmbedSlugBatchDeps {
  readonly embedMany: (input: {
    readonly model: EmbeddingModel
    readonly values: readonly string[]
  }) => Promise<{ readonly embeddings: readonly (readonly number[])[] }>
  readonly buildEmbeddingModel: (apiKey: string) => EmbeddingModel
}

function defaultBuildEmbeddingModel(apiKey: string): EmbeddingModel {
  const provider = createOpenAICompatible({
    name: 'behavior-audit-embed',
    apiKey,
    baseURL: EMBEDDING_BASE_URL,
  })
  return provider.embeddingModel(EMBEDDING_MODEL)
}

async function retryEmbedBatch(
  batch: readonly string[],
  model: EmbeddingModel,
  deps: EmbedSlugBatchDeps,
  attempt: number,
  offset: number,
): Promise<readonly (readonly number[])[]> {
  try {
    const { embeddings } = await deps.embedMany({ model, values: batch })
    return embeddings
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.log(`✗ embedSlugBatch attempt ${attempt + 1}: ${msg}`)
    const nextAttempt = attempt + 1
    if (nextAttempt >= MAX_RETRIES) {
      throw new Error(`Failed to embed batch at offset ${offset} after ${MAX_RETRIES} attempts`, {
        cause: error,
      })
    }
    const backoff = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]!
    await sleep(backoff)
    return retryEmbedBatch(batch, model, deps, nextAttempt, offset)
  }
}

const defaultEmbedSlugBatchDeps: EmbedSlugBatchDeps = {
  embedMany: async ({ model, values }) => {
    const result = await embedMany({ model, values: [...values] })
    return { embeddings: result.embeddings }
  },
  buildEmbeddingModel: defaultBuildEmbeddingModel,
}

export function embedSlugBatch(
  slugInputs: readonly string[],
  deps: EmbedSlugBatchDeps = defaultEmbedSlugBatchDeps,
): Promise<readonly (readonly number[])[]> {
  if (slugInputs.length === 0) return Promise.resolve([])
  const apiKey = process.env['OPENAI_API_KEY'] ?? 'no-key'
  const model = deps.buildEmbeddingModel(apiKey)

  const batchSize = CONSOLIDATION_EMBED_BATCH_SIZE
  const offsets = Array.from({ length: Math.ceil(slugInputs.length / batchSize) }, (_, i) => i * batchSize)

  return offsets.reduce<Promise<readonly (readonly number[])[]>>(async (accP, offset) => {
    const acc = await accP
    const batch = slugInputs.slice(offset, offset + batchSize)
    const batchResult = await retryEmbedBatch(batch, model, deps, 0, offset)
    return [...acc, ...batchResult]
  }, Promise.resolve([]))
}
