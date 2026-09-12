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
/** Backoff between embed retries: attempt → 500ms → attempt → 1s → attempt → give up. */
const EMBED_RETRY_BACKOFF_MS = [500, 1000] as const
/**
 * Per-context dead-letter bound for per-row embed-failure counts (the inner
 * map is keyed `messageId`). A failing batch never exceeds BATCH_PER_CONTEXT
 * rows, so a row's count survives sweep to sweep and can reach the retire
 * threshold; beyond the bound the oldest entry is evicted and that row is
 * retried again (bounded memory over permanent remembering).
 */
const SWEEP_FAILURE_MAP_CAP = BATCH_PER_CONTEXT
/** Failed sweeps after which a row is excluded from the embed batch. */
const SWEEP_FAILURE_RETIRE_THRESHOLD = 5

export type SweepDeps = Readonly<{
  resolve: typeof resolveLlmConfig
  embedMany: (
    values: readonly string[],
    apiKey: string,
    baseUrl: string,
    model: string,
  ) => Promise<{ readonly embeddings: readonly number[][] }>
  /** Test seam backing off between embed retries; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>
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

type EmbedResult = { readonly embeddings: readonly number[][] }

const defaultSleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms)

/** Retry an exhausted embed batch with the injected backoff sleep; rethrows after the final attempt. */
function embedWithRetries(
  texts: readonly string[],
  apiKey: string,
  baseUrl: string,
  model: string,
  deps: SweepDeps,
): Promise<EmbedResult> {
  const sleep = deps.sleep ?? defaultSleep
  return EMBED_RETRY_BACKOFF_MS.reduce<Promise<EmbedResult>>(
    (prev, delay) =>
      prev.catch(async () => {
        await sleep(delay)
        return deps.embedMany(texts, apiKey, baseUrl, model)
      }),
    deps.embedMany(texts, apiKey, baseUrl, model),
  )
}

/** AI SDK error class for the embed-failure warn: error name, plus the status when present. */
const providerErrorClass = (error: Error): string => {
  const status: unknown = Reflect.get(error, 'statusCode')
  if (status === undefined) return error.name
  const statusText = typeof status === 'string' ? status : JSON.stringify(status)
  return `${error.name}:${statusText}`
}

/** Per-row embed-failure counts, one capped map per storage context. */
const failureCounts = new Map<string, Map<string, number>>()

/**
 * Count one failed batch per row, then trim each touched context's map to its
 * cap, evicting the oldest entries. A batch is one config-context's rows and
 * may span storage contexts, so counts key on the full row identity.
 */
const recordBatchFailures = (rows: ReadonlyArray<{ contextId: string; messageId: string }>): void => {
  for (const row of rows) {
    let counts = failureCounts.get(row.contextId)
    if (counts === undefined) {
      counts = new Map<string, number>()
      failureCounts.set(row.contextId, counts)
    }
    counts.set(row.messageId, (counts.get(row.messageId) ?? 0) + 1)
    while (counts.size > SWEEP_FAILURE_MAP_CAP) {
      const oldest = counts.keys().next().value
      if (oldest === undefined) break
      counts.delete(oldest)
    }
  }
}

/** Forget a row's failures once its embedding is stored. */
const clearFailure = (contextId: string, messageId: string): void => {
  failureCounts.get(contextId)?.delete(messageId)
}

type PendingRow = { contextId: string; messageId: string; text: string | null }

/** Drop rows whose failure count reached the retire threshold; report how many were dropped. */
const excludeDeadLettered = (rows: readonly PendingRow[]): { batch: PendingRow[]; deadLettered: number } => {
  const batch = rows.filter((row) => {
    const failures = failureCounts.get(row.contextId)?.get(row.messageId) ?? 0
    return failures < SWEEP_FAILURE_RETIRE_THRESHOLD
  })
  return { batch, deadLettered: rows.length - batch.length }
}

/**
 * Embed one config-context's pending batch (NULL-embedding rows plus rows whose
 * stored model differs from the currently-resolved model). Rows whose failure
 * count reached the retire threshold are dead-lettered out of the batch; the
 * fetch window extends past them so live rows behind dead-lettered rows are
 * still embedded. Returns the number of embeddings stored and the
 * dead-lettered count; never throws — failures are logged (with the provider
 * error class) and rows stay pending.
 */
async function sweepContext(
  configContextId: string,
  deps: SweepDeps,
): Promise<{ embedded: number; deadLettered: number }> {
  const resolved = deps.resolve(configContextId)
  if (!resolved.ok) {
    log.debug({ configContextId }, 'config not available; skipping context')
    return { embedded: 0, deadLettered: 0 }
  }
  const { apiKey, baseUrl, model } = resolved.embedding
  const rows = nextPendingBatchForContext(configContextId, model, BATCH_PER_CONTEXT + SWEEP_FAILURE_MAP_CAP)
  const { batch: liveRows, deadLettered } = excludeDeadLettered(rows)
  const batch = liveRows.slice(0, BATCH_PER_CONTEXT)
  if (batch.length === 0) {
    if (deadLettered > 0) {
      log.debug({ configContextId, deadLettered }, 'all rows dead-lettered; skipping context')
    }
    return { embedded: 0, deadLettered }
  }
  const texts = batch.map((r) => r.text ?? '')
  let result: EmbedResult
  try {
    result = await embedWithRetries(texts, apiKey, baseUrl, model, deps)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    recordBatchFailures(batch)
    log.warn(
      {
        configContextId,
        count: batch.length,
        errorClass: providerErrorClass(err),
        error: err.message,
      },
      'batch embed failed; rows remain pending',
    )
    return { embedded: 0, deadLettered }
  }
  let embedded = 0
  for (const [idx, row] of batch.entries()) {
    const vec = result.embeddings[idx]
    if (vec === undefined) continue
    storeEmbedding(row.contextId, row.messageId, new Float32Array(vec), model, vec.length)
    clearFailure(row.contextId, row.messageId)
    embedded += 1
  }
  log.debug({ configContextId, embedded, model }, 'context embeddings stored')
  return { embedded, deadLettered }
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
  const embedded = results.reduce((sum, r) => sum + r.embedded, 0)
  const deadLettered = results.reduce((sum, r) => sum + r.deadLettered, 0)
  const contexts = results.filter((r) => r.embedded > 0).length
  log.info({ embedded, contexts, remaining: countPending(), deadLettered }, 'message embedding sweep complete')
  return { embedded, contexts }
}
