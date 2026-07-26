// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { cosineSimilarity } from 'ai'
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { messageEmbeddings, messageMetadata } from '../db/schema.js'
import { logger } from '../logger.js'
import { scopeWhere } from './store.js'
import type { MessageScope, SearchFilters } from './store.js'

const log = logger.child({ scope: 'message-vector-store' })

export const SIMILARITY_THRESHOLD = 0.65
export const COSINE_COMFORT_WARN = 5000

/** Store (upsert) a Float32 embedding + its provenance for one message. */
export function storeEmbedding(
  contextId: string,
  messageId: string,
  vec: Float32Array,
  model: string,
  dim: number,
): void {
  log.debug({ contextId, messageId, model, dim }, 'storeEmbedding called')
  const buffer = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)
  getDrizzleDb()
    .insert(messageEmbeddings)
    .values({
      contextId,
      messageId,
      embedding: buffer,
      embeddingModel: model,
      embeddingDim: dim,
      embeddedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [messageEmbeddings.contextId, messageEmbeddings.messageId],
      set: {
        embedding: buffer,
        embeddingModel: model,
        embeddingDim: dim,
        embeddedAt: new Date().toISOString(),
      },
    })
    .run()
}

export type ScopedEmbedding = {
  messageId: string
  vec: Float32Array
  authorId: string | null
  authorUsername: string | null
  timestamp: number
  contextId: string
}

type EmbeddingRow = {
  messageId: string
  embedding: Buffer
  authorId: string | null
  authorUsername: string | null
  timestamp: number
  contextId: string
}

/** Load all embeddings in a scope (joins message_metadata to apply scope + carry filter columns). */
export function loadEmbeddingsForScope(scope: MessageScope): ScopedEmbedding[] {
  log.debug({ scopeKind: scope.kind }, 'loadEmbeddingsForScope called')
  const rows = getDrizzleDb()
    .select({
      messageId: messageMetadata.messageId,
      embedding: messageEmbeddings.embedding,
      authorId: messageMetadata.authorId,
      authorUsername: messageMetadata.authorUsername,
      timestamp: messageMetadata.timestamp,
      contextId: messageMetadata.contextId,
    })
    .from(messageEmbeddings)
    .innerJoin(
      messageMetadata,
      and(
        eq(messageEmbeddings.contextId, messageMetadata.contextId),
        eq(messageEmbeddings.messageId, messageMetadata.messageId),
      ),
    )
    .where(and(scopeWhere(scope), sql`${messageEmbeddings.embedding} IS NOT NULL`))
    .all()
  if (rows.length >= COSINE_COMFORT_WARN) {
    log.warn(
      { scopeKind: scope.kind, count: rows.length },
      'scope exceeding cosine-comfort threshold; consider sqlite-vec',
    )
  }
  return rows
    .filter((r): r is EmbeddingRow => r.embedding !== null)
    .map((r) => ({
      messageId: r.messageId,
      vec: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4),
      authorId: r.authorId,
      authorUsername: r.authorUsername,
      timestamp: r.timestamp,
      contextId: r.contextId,
    }))
}

const matchesFilters = (row: ScopedEmbedding, f: SearchFilters): boolean => {
  if (f.author !== undefined && row.authorId !== f.author && row.authorUsername !== f.author) {
    return false
  }
  if (f.contextId !== undefined && row.contextId !== f.contextId) {
    return false
  }
  if (f.since !== undefined && row.timestamp <= f.since) {
    return false
  }
  if (f.until !== undefined && row.timestamp >= f.until) {
    return false
  }
  return true
}

/** In-memory cosine KNN within a scope, filter-then-score. No indexed ANN. */
export function searchKnn(
  queryVec: number[],
  scope: MessageScope,
  filters: SearchFilters,
  limit: number,
  threshold: number = SIMILARITY_THRESHOLD,
): { messageId: string; score: number }[] {
  log.debug({ scopeKind: scope.kind, limit, threshold }, 'searchKnn called')
  const candidates = loadEmbeddingsForScope(scope).filter((r) => matchesFilters(r, filters))
  return candidates
    .map((r) => ({ messageId: r.messageId, score: cosineSimilarity(queryVec, Array.from(r.vec)) }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

const embeddingsJoin = and(
  eq(messageEmbeddings.contextId, messageMetadata.contextId),
  eq(messageEmbeddings.messageId, messageMetadata.messageId),
)

const configContextIdExpr = sql<string>`COALESCE(${messageMetadata.groupContextId}, ${messageMetadata.contextId})`

/** Distinct config-context ids (COALESCE(group_context_id, context_id)) that have NULL-embedding rows. */
export function pendingConfigContexts(limit: number): string[] {
  const rows = getDrizzleDb()
    .select({ configContextId: configContextIdExpr })
    .from(messageMetadata)
    .leftJoin(messageEmbeddings, embeddingsJoin)
    .where(isNull(messageEmbeddings.embedding))
    .groupBy(configContextIdExpr)
    .limit(limit)
    .all()
  return rows.map((r) => r.configContextId)
}

/** Pending rows for one config-context: NULL embedding OR model != currentModel. */
export function nextPendingBatchForContext(
  configContextId: string,
  currentModel: string,
  limit: number,
): { contextId: string; messageId: string; text: string | null }[] {
  return getDrizzleDb()
    .select({
      contextId: messageMetadata.contextId,
      messageId: messageMetadata.messageId,
      text: messageMetadata.text,
    })
    .from(messageMetadata)
    .leftJoin(messageEmbeddings, embeddingsJoin)
    .where(
      and(
        eq(configContextIdExpr, configContextId),
        or(isNull(messageEmbeddings.embedding), ne(messageEmbeddings.embeddingModel, currentModel)),
      ),
    )
    .limit(limit)
    .all()
}

/** Total message_metadata rows without an embedding (for info logging). */
export function countPending(): number {
  const row = getDrizzleDb()
    .select({ n: sql<number>`COUNT(*)` })
    .from(messageMetadata)
    .leftJoin(messageEmbeddings, embeddingsJoin)
    .where(isNull(messageEmbeddings.embedding))
    .get()
  return row?.n ?? 0
}
