// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, inArray } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import { deserializeEmbedding } from './serialization.js'
import { listMemoryRecords } from './store.js'
import type { MemoryRecord, MemoryScope, MemoryStatus } from './types.js'

export type SimilarityOptions = Readonly<{
  threshold?: number
  limit?: number
  statuses?: readonly MemoryStatus[]
}>

const DEFAULT_THRESHOLD = 0.65
const DEFAULT_LIMIT = 10

/** @public -- consumed by the Plan 2 recall cascade + promotion engine. */
export const cosineSimilarity = (a: readonly number[], b: Float32Array): number => {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** @public -- consumed by the Plan 2 recall cascade + promotion engine. */
export function rankRecordsBySimilarity(
  scope: MemoryScope,
  queryEmbedding: readonly number[],
  options: SimilarityOptions,
): readonly MemoryRecord[] {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const limit = options.limit ?? DEFAULT_LIMIT
  const statuses = options.statuses ?? ['active']

  const rows = getDrizzleDb()
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.scopeId, scope.scopeId),
        eq(memoryRecords.scopeType, scope.scopeType),
        inArray(memoryRecords.status, [...statuses]),
      ),
    )
    .all()

  const scored = rows
    .map((row) => ({ row, vec: deserializeEmbedding(row.embedding) }))
    .filter((entry): entry is { row: (typeof rows)[number]; vec: Float32Array } => entry.vec !== null)
    .map((entry) => ({ id: entry.row.id, score: cosineSimilarity(queryEmbedding, entry.vec) }))
    .filter((entry) => entry.score >= threshold)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)

  if (scored.length === 0) return []

  const byId = new Map(
    listMemoryRecords({ scopeId: scope.scopeId, scopeType: scope.scopeType, limit: 1000 }).map((r) => [r.id, r]),
  )
  return scored.map((entry) => byId.get(entry.id)).filter((r): r is MemoryRecord => r !== undefined)
}
