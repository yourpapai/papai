// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { embedMany } from 'ai'
import pLimit from 'p-limit'

import { resolveLlmConfig } from './llm-providers/resolver.js'
import { logger } from './logger.js'
import {
  countPending,
  embeddedConfigContexts,
  nextPendingBatchForContext,
  pendingConfigContexts,
  storeEmbedding,
} from './message-cache/vector-store.js'

const log = logger.child({ scope: 'message-embedding-sweep' })

const CONTEXT_FETCH_LIMIT = 50
const BATCH_PER_CONTEXT = 25
const CONCURRENCY = 3

export type SweepDeps = Readonly<{
  resolve: typeof resolveLlmConfig
  embedMany: (
    values: readonly string[],
    apiKey: string,
    baseUrl: string,
    model: string,
  ) => Promise<{ readonly embeddings: readonly number[][] }>
}>

const defaultDeps: SweepDeps = {
  resolve: resolveLlmConfig,
  embedMany: async (values, apiKey, baseUrl, model) => {
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
    const provider = createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL: baseUrl })
    return embedMany({ model: provider.embeddingModel(model), values: [...values] })
  },
}

export type SweepOutcome = { embedded: number; contexts: number }

/**
 * Embed one config-context's pending batch (NULL-embedding rows plus rows whose
 * stored model differs from the currently-resolved model). Returns the number of
 * embeddings stored; never throws — failures are logged and rows stay pending.
 */
async function sweepContext(configContextId: string, deps: SweepDeps): Promise<number> {
  const resolved = deps.resolve(configContextId)
  if (!resolved.ok) {
    log.debug({ configContextId }, 'config not available; skipping context')
    return 0
  }
  const { apiKey, baseUrl, model } = resolved.embedding
  const rows = nextPendingBatchForContext(configContextId, model, BATCH_PER_CONTEXT)
  if (rows.length === 0) return 0
  const texts = rows.map((r) => r.text ?? '')
  let result: { readonly embeddings: readonly number[][] }
  try {
    result = await deps.embedMany(texts, apiKey, baseUrl, model)
  } catch (error) {
    log.warn(
      { configContextId, count: rows.length, error: error instanceof Error ? error.message : String(error) },
      'batch embed failed; rows remain pending',
    )
    return 0
  }
  let embedded = 0
  for (const [idx, row] of rows.entries()) {
    const vec = result.embeddings[idx]
    if (vec === undefined) continue
    storeEmbedding(row.contextId, row.messageId, new Float32Array(vec), model, vec.length)
    embedded += 1
  }
  log.debug({ configContextId, embedded, model }, 'context embeddings stored')
  return embedded
}

/**
 * Sweep pending message embeddings: for each config-context with NULL or
 * model-mismatched rows, resolve the current embedding model, batch-embed, and
 * store with provenance. Bounded concurrency across contexts. Never throws.
 */
export async function runMessageEmbeddingSweep(deps: SweepDeps = defaultDeps): Promise<SweepOutcome> {
  log.debug('runMessageEmbeddingSweep called')
  const ctxIds = [
    ...new Set([...pendingConfigContexts(CONTEXT_FETCH_LIMIT), ...embeddedConfigContexts(CONTEXT_FETCH_LIMIT)]),
  ]
  if (ctxIds.length === 0) {
    log.debug('no contexts with pending embeddings')
    return { embedded: 0, contexts: 0 }
  }
  log.info({ pending: countPending(), contexts: ctxIds.length }, 'message embedding sweep starting')

  const limit = pLimit(CONCURRENCY)
  const results = await Promise.all(ctxIds.map((ctxId) => limit(() => sweepContext(ctxId, deps))))
  const embedded = results.reduce((sum, n) => sum + n, 0)
  const contexts = results.filter((n) => n > 0).length
  log.info({ embedded, contexts, remaining: countPending() }, 'message embedding sweep complete')
  return { embedded, contexts }
}
