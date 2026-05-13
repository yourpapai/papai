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

export interface EmbedSlugBatchDeps {
  readonly embedMany: typeof embedMany
}

async function retryEmbedBatch(
  batch: readonly string[],
  model: Parameters<typeof embedMany>[0]['model'],
  deps: EmbedSlugBatchDeps,
  attempt: number,
  offset: number,
): Promise<readonly number[][]> {
  try {
    const { embeddings } = await deps.embedMany({ model, values: [...batch] })
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

export function embedSlugBatch(
  slugInputs: readonly string[],
  deps: EmbedSlugBatchDeps = { embedMany },
): Promise<readonly (readonly number[])[]> {
  if (slugInputs.length === 0) return Promise.resolve([])
  const apiKey = process.env['OPENAI_API_KEY'] ?? 'no-key'
  const provider = createOpenAICompatible({
    name: 'behavior-audit-embed',
    apiKey,
    baseURL: EMBEDDING_BASE_URL,
  })
  const model = provider.embeddingModel(EMBEDDING_MODEL)

  const batchSize = CONSOLIDATION_EMBED_BATCH_SIZE
  const offsets = Array.from({ length: Math.ceil(slugInputs.length / batchSize) }, (_, i) => i * batchSize)

  return offsets.reduce<Promise<readonly (readonly number[])[]>>(async (accP, offset) => {
    const acc = await accP
    const batch = slugInputs.slice(offset, offset + batchSize)
    const batchResult = await retryEmbedBatch(batch, model, deps, 0, offset)
    return [...acc, ...batchResult]
  }, Promise.resolve([]))
}
