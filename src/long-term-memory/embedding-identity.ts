// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolveLlmConfig } from '../llm-providers/resolver.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'memory:embedding-identity' })

/** Stamped by migration 072 on vectors that predate identity tracking. Never dense-eligible. */
export const UNKNOWN_EMBEDDING_VERSION = 'unknown'

/**
 * The compatibility identity of a vector: the two properties that make two
 * vectors comparable at all. Cosine similarity across different models is
 * meaningless, which is what this identity exists to prevent.
 * @public -- consumed by the dense channel, the embedding writer, and the backfill.
 */
export const embeddingVersionOf = (model: string, dimension: number): string => `${model}:${dimension}`

/**
 * The embedding model configured for one config context. BYOK means two scopes
 * can legitimately sit on different models, so there is no global "current model".
 * @public -- consumed by the recall cascade, the embedding writer, and the backfill.
 */
export const resolveEmbeddingModel = (configContextId: string): string | null => {
  const resolved = resolveLlmConfig(configContextId)
  if (!resolved.ok) {
    log.warn({ configContextId, source: resolved.source, type: resolved.type }, 'No embedding model for config context')
    return null
  }
  return resolved.embedding.model
}
