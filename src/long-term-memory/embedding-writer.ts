// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import { getEmbeddingForContext } from '../embeddings.js'
import { logger } from '../logger.js'
import { saveMemoryRecord } from './store.js'
import type { MemoryRecord, MemoryRecordInput } from './types.js'

const log = logger.child({ scope: 'memory:embedding-writer' })

export type EmbeddingWriterDeps = Readonly<{
  getEmbedding: (text: string, configContextId: string) => Promise<number[] | null>
}>

const defaultDeps: EmbeddingWriterDeps = {
  getEmbedding: (text, configContextId) =>
    getEmbeddingForContext(text, configContextId, {
      storageContextId: configContextId,
      contextType: 'group',
      chatUserId: configContextId,
    }),
}

const persistEmbedding = (recordId: string, embedding: number[]): void => {
  const buffer = Buffer.from(new Float32Array(embedding).buffer)
  getDrizzleDb().update(memoryRecords).set({ embedding: buffer }).where(eq(memoryRecords.id, recordId)).run()
}

/**
 * Save a record, then compute + persist its embedding. Awaits embedding completion (so the
 * promotion clustering in Plan 2 can rely on it) but never throws on embed failure.
 * @public -- consumed by the memory capture executor (Plan 1 T7).
 */
export async function saveMemoryRecordWithEmbedding(
  input: MemoryRecordInput,
  configContextId: string,
  deps: EmbeddingWriterDeps = defaultDeps,
): Promise<MemoryRecord> {
  const saved = saveMemoryRecord(input)
  try {
    const embedding = await deps.getEmbedding(input.content, configContextId)
    if (embedding !== null) persistEmbedding(saved.id, embedding)
  } catch (error) {
    log.warn(
      { recordId: saved.id, error: error instanceof Error ? error.message : String(error) },
      'Embedding failed; FTS fallback',
    )
  }
  return saved
}
