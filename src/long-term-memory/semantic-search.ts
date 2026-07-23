// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, inArray, type SQL } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import { recordValidityCondition, threadScopeCondition } from './record-conditions.js'
import { deserializeEmbedding, rowToRecord } from './serialization.js'
import type { MemoryKind, MemoryRecord, MemoryScope, MemoryStatus } from './types.js'

export type SimilarityOptions = Readonly<{
  threshold?: number
  limit?: number
  statuses?: readonly MemoryStatus[]
  kind?: MemoryKind
  threadContextId?: string
  excludeThreadContextId?: string
  /** Identity of the querying config context. A null or absent value yields no dense hits. */
  embeddingVersion?: string | null
  now?: string
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

const denseConditions = (scope: MemoryScope, options: SimilarityOptions, version: string): SQL[] => {
  const conditions: SQL[] = [
    eq(memoryRecords.scopeId, scope.scopeId),
    eq(memoryRecords.scopeType, scope.scopeType),
    inArray(memoryRecords.status, [...(options.statuses ?? ['active'])]),
    eq(memoryRecords.embeddingVersion, version),
    recordValidityCondition(options.now ?? new Date().toISOString()),
  ]
  if (options.kind !== undefined) conditions.push(eq(memoryRecords.kind, options.kind))
  const thread = threadScopeCondition(options)
  if (thread !== undefined) conditions.push(thread)
  return conditions
}

/**
 * Dense retrieval channel. Only records whose stored embedding identity matches
 * the querying config context's identity are eligible — comparing vectors across
 * models produces meaningless cosine scores. Ineligible records drop out of this
 * channel only; they stay reachable lexically.
 * @public -- consumed by the hybrid search orchestrator and the promotion engine.
 */
export function rankRecordsBySimilarity(
  scope: MemoryScope,
  queryEmbedding: readonly number[],
  options: SimilarityOptions,
): readonly MemoryRecord[] {
  const version = options.embeddingVersion
  if (version === undefined || version === null) return []

  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const limit = options.limit ?? DEFAULT_LIMIT

  const rows = getDrizzleDb()
    .select()
    .from(memoryRecords)
    .where(and(...denseConditions(scope, options, version)))
    .all()

  return rows
    .map((row) => ({ row, vec: deserializeEmbedding(row.embedding) }))
    .filter((entry): entry is { row: (typeof rows)[number]; vec: Float32Array } => entry.vec !== null)
    .map((entry) => ({ row: entry.row, score: cosineSimilarity(queryEmbedding, entry.vec) }))
    .filter((entry) => entry.score >= threshold)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => rowToRecord(entry.row))
}
