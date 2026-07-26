// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tryGetEmbedding, type EmbeddingCallContext } from '../embeddings.js'
import { resolveLlmConfig } from '../llm-providers/resolver.js'
import { logger } from '../logger.js'
import { storeEmbedding } from './vector-store.js'

const log = logger.child({ scope: 'embed-message' })

export type EmbedMessageDeps = {
  resolve: typeof resolveLlmConfig
  embedOne: (
    text: string,
    apiKey: string,
    baseUrl: string,
    model: string,
    ctx: EmbeddingCallContext,
  ) => Promise<number[] | null>
}

const defaultDeps: EmbedMessageDeps = {
  resolve: resolveLlmConfig,
  embedOne: (text, apiKey, baseUrl, model, ctx) => tryGetEmbedding(text, apiKey, baseUrl, model, ctx),
}

export type EmbedAndStoreArgs = {
  text: string
  contextId: string
  messageId: string
  configContextId: string
  embeddingCtx: EmbeddingCallContext
}

/**
 * Resolve the embedding model for the config-context, embed the text, and store
 * the result with its provenance. Never throws — failures are logged and the
 * row is left without an embedding (the sweep retries).
 */
export async function embedAndStoreMessage(
  args: EmbedAndStoreArgs,
  deps: EmbedMessageDeps = defaultDeps,
): Promise<void> {
  const { text, contextId, messageId, configContextId, embeddingCtx } = args
  log.debug({ contextId, messageId, configContextId, textLength: text.length }, 'embedAndStoreMessage called')
  const resolved = deps.resolve(configContextId)
  if (!resolved.ok) {
    log.debug({ configContextId }, 'embedding config not available; skipping')
    return
  }
  const { apiKey, baseUrl, model } = resolved.embedding
  let vec: number[] | null
  try {
    vec = await deps.embedOne(text, apiKey, baseUrl, model, embeddingCtx)
  } catch (error) {
    log.warn(
      { messageId, error: error instanceof Error ? error.message : String(error) },
      'inline embed failed; sweep will retry',
    )
    return
  }
  if (vec === null || vec.length === 0) {
    log.debug({ messageId }, 'embed returned null; skipping')
    return
  }
  storeEmbedding(contextId, messageId, new Float32Array(vec), model, vec.length)
  log.debug({ messageId, model, dim: vec.length }, 'embedding stored')
}
