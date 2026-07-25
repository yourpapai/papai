// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryProfiles, memoryRecallShadowLog, memoryRecords, memoryTombstones } from '../db/schema.js'
import { profileScopeCondition, recordScopeCondition, recordValidityCondition } from './record-conditions.js'
import { rowToProfile, rowToRecord, sanitizeFtsQuery, serializeEmbedding } from './serialization.js'
import type { ShadowLogRow } from './shadow-log-row.js'
import { tombstoneValues } from './tombstone.js'
import type { MemoryKind, MemoryProfile, MemoryRecord, MemoryRecordInput, MemoryScope, MemoryStatus } from './types.js'

export type ListMemoryRecordsFilter = Readonly<{
  status?: MemoryStatus
  statuses?: readonly MemoryStatus[]
  kind?: MemoryKind
  limit?: number
  now?: string
}> &
  MemoryScope

export type SearchMemoryRecordsFilter = Readonly<{
  query: string
  includeStale?: boolean
  kind?: MemoryKind
  limit?: number
  now?: string
}> &
  MemoryScope

const DEFAULT_LIST_LIMIT = 50
const DEFAULT_SEARCH_LIMIT = 10

type MemoryRecordValues = typeof memoryRecords.$inferInsert

export { rowToProfile, rowToRecord } from './serialization.js'
export {
  listProvisionalRecords,
  markPromotionRejected,
  promoteProvisionalToActive,
  type ListProvisionalFilter,
} from './provisional-store.js'
export { clearMemoryScope } from './scope-clear.js'

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
  embeddingModel: input.embeddingModel ?? null,
  embeddingDimension: input.embeddingDimension ?? null,
  embeddingVersion: input.embeddingVersion ?? null,
  embeddedAt: input.embeddedAt ?? null,
})

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

export function setMemoryRecordInjectionEnabled(scope: MemoryScope, enabled: boolean, now: string): MemoryProfile {
  getDrizzleDb()
    .insert(memoryProfiles)
    .values({
      scopeId: scope.scopeId,
      scopeType: scope.scopeType,
      profile: '',
      injectRecords: enabled,
      version: 1,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [memoryProfiles.scopeType, memoryProfiles.scopeId],
      set: {
        injectRecords: enabled,
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
  const conditions: SQL[] = [
    eq(memoryRecords.scopeId, filter.scopeId),
    eq(memoryRecords.scopeType, filter.scopeType),
    recordValidityCondition(filter.now ?? new Date().toISOString()),
  ]
  if (filter.statuses !== undefined && filter.statuses.length > 0) {
    conditions.push(inArray(memoryRecords.status, [...filter.statuses]))
  } else if (filter.status !== undefined) {
    conditions.push(eq(memoryRecords.status, filter.status))
  }
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
    recordValidityCondition(filter.now ?? new Date().toISOString()),
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

export function archiveMemoryRecord(scope: MemoryScope, recordId: string, now: string): boolean {
  const rows = getDrizzleDb()
    .update(memoryRecords)
    .set({ status: 'archived', updatedAt: now })
    .where(recordScopeCondition(scope, recordId))
    .returning({ id: memoryRecords.id })
    .all()
  return rows.length > 0
}

export function purgeMemoryRecord(scope: MemoryScope, recordId: string, now: string): boolean {
  const db = getDrizzleDb()
  return db.transaction((tx) => {
    const deleted = tx
      .delete(memoryRecords)
      .where(recordScopeCondition(scope, recordId))
      .returning({ content: memoryRecords.content })
      .all()
    const row = deleted[0]
    if (row === undefined) return false
    tx.insert(memoryTombstones)
      .values(tombstoneValues(scope, row.content, now))
      .onConflictDoNothing()
      .run()
    return true
  })
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

/**
 * Appends a shadow-log row to `memory_recall_shadow_log`. Accepts only `ShadowLogRow`
 * (hashes/counts/enums) — never the raw `ShadowOutcome` — so raw memory content is
 * structurally unable to reach this table. `id`/`createdAt` are assigned here.
 */
export function insertShadowLogRow(row: ShadowLogRow): void {
  getDrizzleDb()
    .insert(memoryRecallShadowLog)
    .values({ id: randomUUID(), createdAt: Date.now(), ...row })
    .run()
}
