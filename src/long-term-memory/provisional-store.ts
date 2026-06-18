// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, desc, eq, isNull, ne, or, type SQL } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import { recordScopeCondition } from './record-conditions.js'
import { parseEvidence, rowToRecord } from './serialization.js'
import type { MemoryEvidence, MemoryRecord, MemoryScope } from './types.js'

const DEFAULT_LIST_LIMIT = 50

export type ListProvisionalFilter = MemoryScope &
  Readonly<{ threadContextId?: string; excludeThreadContextId?: string; limit?: number }>

/** @public -- consumed by the Plan 2 recall cascade + promotion engine (cross-thread memory bridge). */
export function listProvisionalRecords(filter: ListProvisionalFilter): readonly MemoryRecord[] {
  const conditions: SQL[] = [
    eq(memoryRecords.scopeId, filter.scopeId),
    eq(memoryRecords.scopeType, filter.scopeType),
    eq(memoryRecords.status, 'provisional'),
  ]
  if (filter.threadContextId !== undefined) {
    conditions.push(eq(memoryRecords.threadContextId, filter.threadContextId))
  }
  if (filter.excludeThreadContextId !== undefined) {
    const cond: SQL | undefined = or(
      ne(memoryRecords.threadContextId, filter.excludeThreadContextId),
      isNull(memoryRecords.threadContextId),
    )
    if (cond !== undefined) conditions.push(cond)
  }
  return getDrizzleDb()
    .select()
    .from(memoryRecords)
    .where(and(...conditions))
    .orderBy(desc(memoryRecords.lastSeenAt))
    .limit(filter.limit ?? DEFAULT_LIST_LIMIT)
    .all()
    .map(rowToRecord)
}

/** @public -- consumed by the promotion engine (Plan 2 T3/T7). */
export function promoteProvisionalToActive(
  scope: MemoryScope,
  recordId: string,
  threads: readonly string[],
  now: string,
): MemoryRecord | null {
  const existing = getDrizzleDb().select().from(memoryRecords).where(recordScopeCondition(scope, recordId)).get()
  if (existing === undefined) return null
  const prev = parseEvidence(existing.evidence)
  const evidence: MemoryEvidence = { ...prev, threads: [...new Set(threads)], promotionRejectedAt: undefined }
  const rows = getDrizzleDb()
    .update(memoryRecords)
    .set({
      status: 'active',
      threadContextId: null,
      evidence: JSON.stringify(evidence),
      updatedAt: now,
      lastSeenAt: now,
    })
    .where(recordScopeCondition(scope, recordId))
    .returning()
    .all()
  return rows[0] === undefined ? null : rowToRecord(rows[0])
}

/** @public -- consumed by the promotion engine (Plan 2 T3/T7). */
export function markPromotionRejected(scope: MemoryScope, recordId: string, now: string): void {
  const existing = getDrizzleDb().select().from(memoryRecords).where(recordScopeCondition(scope, recordId)).get()
  if (existing === undefined) return
  const evidence: MemoryEvidence = { ...parseEvidence(existing.evidence), promotionRejectedAt: now }
  getDrizzleDb()
    .update(memoryRecords)
    .set({ evidence: JSON.stringify(evidence), updatedAt: now })
    .where(recordScopeCondition(scope, recordId))
    .run()
}
