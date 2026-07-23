// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import { logger } from '../logger.js'
import { buildFtsMatchQuery } from './lexical-query.js'
import { recordValidityCondition, threadScopeCondition } from './record-conditions.js'
import { rowToRecord } from './serialization.js'
import type { MemoryKind, MemoryRecord, MemoryScope, MemoryStatus } from './types.js'

const log = logger.child({ scope: 'memory:lexical-search' })

const DEFAULT_LIMIT = 10
// Pull more FTS candidates than we return so the post-filters (status, kind,
// thread, validity) have something to work with before truncation.
const CANDIDATE_MULTIPLIER = 5

export type LexicalSearchFilter = MemoryScope &
  Readonly<{
    query: string
    statuses: readonly MemoryStatus[]
    kind?: MemoryKind
    threadContextId?: string
    excludeThreadContextId?: string
    limit?: number
    now?: string
  }>

const rankedIds = (filter: LexicalSearchFilter, match: string, candidateLimit: number): readonly string[] =>
  getDrizzleDb()
    .all<{ id: string }>(
      sql`SELECT m.id AS id
            FROM memory_records_fts f
            JOIN memory_records m ON m.rowid = f.rowid
           WHERE f.memory_records_fts MATCH ${match}
             AND m.scope_id = ${filter.scopeId}
             AND m.scope_type = ${filter.scopeType}
           ORDER BY bm25(memory_records_fts) ASC
           LIMIT ${candidateLimit}`,
    )
    .map((row) => row.id)

/**
 * Lexical retrieval channel: FTS5 with the unicode61 tokenizer, ranked by bm25().
 * Returns records best-first. Never throws on a degenerate query — an
 * untokenizable query yields no lexical hits and the caller falls back to the
 * dense channel alone.
 * @public -- consumed by the hybrid search orchestrator.
 */
export function searchLexical(filter: LexicalSearchFilter): readonly MemoryRecord[] {
  const match = buildFtsMatchQuery(filter.query)
  if (match === null) {
    log.debug({ scopeId: filter.scopeId }, 'Query produced no lexical tokens; skipping FTS channel')
    return []
  }

  const limit = filter.limit ?? DEFAULT_LIMIT
  const ordered = rankedIds(filter, match, limit * CANDIDATE_MULTIPLIER)
  if (ordered.length === 0) return []

  const conditions: SQL[] = [
    inArray(memoryRecords.id, [...ordered]),
    eq(memoryRecords.scopeId, filter.scopeId),
    eq(memoryRecords.scopeType, filter.scopeType),
    inArray(memoryRecords.status, [...filter.statuses]),
    recordValidityCondition(filter.now ?? new Date().toISOString()),
  ]
  if (filter.kind !== undefined) conditions.push(eq(memoryRecords.kind, filter.kind))
  const thread = threadScopeCondition(filter)
  if (thread !== undefined) conditions.push(thread)

  const byId = new Map(
    getDrizzleDb()
      .select()
      .from(memoryRecords)
      .where(and(...conditions))
      .all()
      .map((row) => [row.id, rowToRecord(row)] as const),
  )

  const out: MemoryRecord[] = []
  for (const id of ordered) {
    const record = byId.get(id)
    if (record === undefined) continue
    out.push(record)
    if (out.length >= limit) break
  }
  return out
}
