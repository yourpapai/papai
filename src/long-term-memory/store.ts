// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryProfiles, memoryRecords } from '../db/schema.js'
import { parseEvidence, rowToProfile, rowToRecord, sanitizeFtsQuery, serializeEmbedding } from './serialization.js'
import type {
  MemoryEvidence,
  MemoryKind,
  MemoryProfile,
  MemoryRecord,
  MemoryRecordInput,
  MemoryScope,
  MemoryStatus,
} from './types.js'

export type ListMemoryRecordsFilter = Readonly<{
  status?: MemoryStatus
  kind?: MemoryKind
  limit?: number
}> &
  MemoryScope

export type SearchMemoryRecordsFilter = Readonly<{
  query: string
  includeStale?: boolean
  kind?: MemoryKind
  limit?: number
}> &
  MemoryScope

const DEFAULT_LIST_LIMIT = 50
const DEFAULT_SEARCH_LIMIT = 10

type MemoryRecordValues = typeof memoryRecords.$inferInsert

export { rowToProfile, rowToRecord } from './serialization.js'

const inputToRecordValues = (input: MemoryRecordInput): MemoryRecordValues => ({
  id: input.id,
  scopeId: input.scopeId,
  scopeType: input.scopeType,
  kind: input.kind,
  content: input.content,
  summary: input.summary,
  tags: JSON.stringify(input.tags),
  confidence: input.confidence,
  status: input.status,
  source: input.source,
  evidence: JSON.stringify(input.evidence),
  threadContextId: input.threadContextId ?? null,
  createdAt: input.createdAt,
  updatedAt: input.updatedAt,
  lastSeenAt: input.lastSeenAt,
  validFrom: input.validFrom ?? null,
  validUntil: input.validUntil ?? null,
  expiresAt: input.expiresAt ?? null,
  embedding: serializeEmbedding(input.embedding),
})

const profileScopeCondition = (scope: MemoryScope): SQL | undefined =>
  and(eq(memoryProfiles.scopeId, scope.scopeId), eq(memoryProfiles.scopeType, scope.scopeType))

const loadProfile = (scope: MemoryScope): MemoryProfile => {
  const row = getDrizzleDb().select().from(memoryProfiles).where(profileScopeCondition(scope)).get()
  if (row === undefined) {
    throw new Error(`Memory profile not found after save: ${scope.scopeType}:${scope.scopeId}`)
  }
  return rowToProfile(row)
}

const loadRecord = (recordId: string): MemoryRecord => {
  const row = getDrizzleDb().select().from(memoryRecords).where(eq(memoryRecords.id, recordId)).get()
  if (row === undefined) {
    throw new Error(`Memory record not found after save: ${recordId}`)
  }
  return rowToRecord(row)
}

export function getMemoryProfile(scope: MemoryScope): MemoryProfile | null {
  const row = getDrizzleDb().select().from(memoryProfiles).where(profileScopeCondition(scope)).get()
  return row === undefined ? null : rowToProfile(row)
}

export function saveMemoryProfile(scope: MemoryScope, profile: string, now: string): MemoryProfile {
  getDrizzleDb()
    .insert(memoryProfiles)
    .values({ scopeId: scope.scopeId, scopeType: scope.scopeType, profile, enabled: true, version: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [memoryProfiles.scopeType, memoryProfiles.scopeId],
      set: {
        profile,
        version: sql`${memoryProfiles.version} + 1`,
        updatedAt: now,
      },
    })
    .run()
  return loadProfile(scope)
}

export function setMemoryCaptureEnabled(scope: MemoryScope, enabled: boolean, now: string): MemoryProfile {
  getDrizzleDb()
    .insert(memoryProfiles)
    .values({ scopeId: scope.scopeId, scopeType: scope.scopeType, profile: '', enabled, version: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [memoryProfiles.scopeType, memoryProfiles.scopeId],
      set: {
        enabled,
        version: sql`${memoryProfiles.version} + 1`,
        updatedAt: now,
      },
    })
    .run()
  return loadProfile(scope)
}

export function saveMemoryRecord(input: MemoryRecordInput): MemoryRecord {
  const values = inputToRecordValues(input)

  getDrizzleDb()
    .insert(memoryRecords)
    .values(values)
    .onConflictDoUpdate({
      target: memoryRecords.id,
      set: values,
    })
    .run()
  return loadRecord(input.id)
}

export function listMemoryRecords(filter: ListMemoryRecordsFilter): readonly MemoryRecord[] {
  const conditions: SQL[] = [eq(memoryRecords.scopeId, filter.scopeId), eq(memoryRecords.scopeType, filter.scopeType)]
  if (filter.status !== undefined) conditions.push(eq(memoryRecords.status, filter.status))
  if (filter.kind !== undefined) conditions.push(eq(memoryRecords.kind, filter.kind))

  return getDrizzleDb()
    .select()
    .from(memoryRecords)
    .where(and(...conditions))
    .orderBy(desc(memoryRecords.lastSeenAt))
    .limit(filter.limit ?? DEFAULT_LIST_LIMIT)
    .all()
    .map(rowToRecord)
}

export function searchMemoryRecords(filter: SearchMemoryRecordsFilter): readonly MemoryRecord[] {
  const safeQuery = sanitizeFtsQuery(filter.query)
  const statusFilter =
    filter.includeStale === true
      ? inArray(memoryRecords.status, ['active', 'stale'])
      : eq(memoryRecords.status, 'active')
  const conditions: SQL[] = [
    eq(memoryRecords.scopeId, filter.scopeId),
    eq(memoryRecords.scopeType, filter.scopeType),
    statusFilter,
    sql`${memoryRecords.id} IN (
      SELECT m.id
      FROM memory_records m
      INNER JOIN memory_records_fts f ON m.rowid = f.rowid
      WHERE f.memory_records_fts MATCH ${safeQuery}
        AND m.scope_id = ${filter.scopeId}
        AND m.scope_type = ${filter.scopeType}
    )`,
  ]
  if (filter.kind !== undefined) conditions.push(eq(memoryRecords.kind, filter.kind))

  return getDrizzleDb()
    .select()
    .from(memoryRecords)
    .where(and(...conditions))
    .orderBy(desc(memoryRecords.lastSeenAt))
    .limit(filter.limit ?? DEFAULT_SEARCH_LIMIT)
    .all()
    .map(rowToRecord)
}

const recordScopeCondition = (scope: MemoryScope, recordId: string): SQL | undefined =>
  and(
    eq(memoryRecords.scopeId, scope.scopeId),
    eq(memoryRecords.scopeType, scope.scopeType),
    eq(memoryRecords.id, recordId),
  )

export function archiveMemoryRecord(scope: MemoryScope, recordId: string, now: string): boolean {
  const rows = getDrizzleDb()
    .update(memoryRecords)
    .set({ status: 'archived', updatedAt: now })
    .where(recordScopeCondition(scope, recordId))
    .returning({ id: memoryRecords.id })
    .all()
  return rows.length > 0
}

export function updateMemoryRecord(
  scope: MemoryScope,
  recordId: string,
  patch: Readonly<{ status?: MemoryStatus; content?: string; confidence?: number }>,
  now: string,
): MemoryRecord | null {
  const rows = getDrizzleDb()
    .update(memoryRecords)
    .set({
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.content === undefined ? {} : { content: patch.content }),
      ...(patch.confidence === undefined ? {} : { confidence: patch.confidence }),
      updatedAt: now,
      lastSeenAt: now,
    } satisfies Partial<MemoryRecordValues>)
    .where(recordScopeCondition(scope, recordId))
    .returning()
    .all()
  return rows[0] === undefined ? null : rowToRecord(rows[0])
}

export function clearMemoryScope(scope: MemoryScope): { profileDeleted: number; recordsDeleted: number } {
  const db = getDrizzleDb()
  const deletedRecords = db
    .delete(memoryRecords)
    .where(and(eq(memoryRecords.scopeId, scope.scopeId), eq(memoryRecords.scopeType, scope.scopeType)))
    .returning({ id: memoryRecords.id })
    .all()
  const deletedProfiles = db
    .delete(memoryProfiles)
    .where(profileScopeCondition(scope))
    .returning({ scopeId: memoryProfiles.scopeId })
    .all()
  return { profileDeleted: deletedProfiles.length, recordsDeleted: deletedRecords.length }
}

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
