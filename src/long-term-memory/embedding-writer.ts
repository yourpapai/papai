// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import { getEmbeddingForContext } from '../embeddings.js'
import { logger } from '../logger.js'
import { embeddingVersionOf, resolveEmbeddingModel } from './embedding-identity.js'
import { saveMemoryRecord } from './store.js'
import type { MemoryRecord, MemoryRecordInput } from './types.js'

const log = logger.child({ scope: 'memory:embedding-writer' })

export type EmbeddingWriterDeps = Readonly<{
  getEmbedding: (text: string, configContextId: string) => Promise<number[] | null>
  resolveEmbeddingModel: (configContextId: string) => string | null
  now: () => string
}>

const defaultDeps: EmbeddingWriterDeps = {
  getEmbedding: (text, configContextId) =>
    getEmbeddingForContext(text, configContextId, {
      storageContextId: configContextId,
      contextType: 'group',
      chatUserId: configContextId,
    }),
  resolveEmbeddingModel,
  now: () => new Date().toISOString(),
}

const persistEmbedding = (recordId: string, embedding: number[], model: string, now: string): void => {
  getDrizzleDb()
    .update(memoryRecords)
    .set({
      embedding: Buffer.from(new Float32Array(embedding).buffer),
      embeddingModel: model,
      embeddingDimension: embedding.length,
      embeddingVersion: embeddingVersionOf(model, embedding.length),
      embeddedAt: now,
    })
    .where(eq(memoryRecords.id, recordId))
    .run()
}

/**
 * Save a record, then compute + persist its embedding with its identity metadata.
 * Awaits embedding completion (so the promotion clustering in Plan 2 can rely on it)
 * but never throws on embed failure — an unembedded record stays lexically retrievable.
 * @public -- consumed by the memory capture executor (Plan 1 T7).
 */
export async function saveMemoryRecordWithEmbedding(
  input: MemoryRecordInput,
  configContextId: string,
  overrides: Partial<EmbeddingWriterDeps> = {},
): Promise<MemoryRecord | null> {
  const deps: EmbeddingWriterDeps = { ...defaultDeps, ...overrides }
  const saved = saveMemoryRecord(input)
  if (saved === null) return null
  try {
    const model = deps.resolveEmbeddingModel(configContextId)
    if (model === null) {
      log.warn({ recordId: saved.id }, 'No embedding model for context; record stays lexical-only')
      return saved
    }
    const embedding = await deps.getEmbedding(input.content, configContextId)
    if (embedding !== null) persistEmbedding(saved.id, embedding, model, deps.now())
  } catch (error) {
    log.warn(
      { recordId: saved.id, error: error instanceof Error ? error.message : String(error) },
      'Embedding failed; FTS fallback',
    )
  }
  return saved
}
