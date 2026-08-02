// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, asc, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryProjectionRecords, type MemoryProjectionRecordRow } from '../db/schema.js'
import { CAPTURE_VERSION, stableStringify } from './canonical-identity.js'
import type { MemoryScope } from './types.js'

/**
 * The replay-stable view of one shadow row.
 *
 * Every field here derives from the winning event, and the winner is chosen by event time, so
 * ingest order cannot reach any of them. `lastObservedAt` is included deliberately: it looks
 * ingest-dependent and is not, because capture advances it by monotonic event-time max, so any
 * ingest order converges on the same value. Excluding it would leave that designed property
 * unasserted.
 *
 * `eventId` and `projectedAt` are excluded because they genuinely vary per run — a fresh UUID
 * and a wall clock — and including either would make the byte-identity contract unsatisfiable
 * for reasons that have nothing to do with correctness. Outbox fields are excluded for the
 * same reason.
 */
const snapshotRow = (row: MemoryProjectionRecordRow): Record<string, unknown> => ({
  projectionKey: row.projectionKey,
  recordId: row.recordId,
  idempotencyIdentity: row.idempotencyIdentity,
  contentIdentity: row.contentIdentity,
  scopeId: row.scopeId,
  scopeType: row.scopeType,
  threadContextId: row.threadContextId,
  kind: row.kind,
  content: row.content,
  summary: row.summary,
  tags: row.tags,
  confidence: row.confidence,
  source: row.source,
  actorIds: row.actorIds,
  provenance: row.provenance,
  eventTime: row.eventTime,
  lastObservedAt: row.lastObservedAt,
  validFrom: row.validFrom,
  validUntil: row.validUntil,
  expiresAt: row.expiresAt,
  schemaVersion: row.schemaVersion,
  captureVersion: row.captureVersion,
})

/**
 * Observable O2: a deterministic, order-stable serialization of a scope's projection state,
 * comparable byte-for-byte across runs.
 *
 * Defined **at quiescence** — the outbox drained. That is the only point at which byte-identity
 * is a meaningful claim; mid-drain the shadow table is legitimately partial.
 *
 * Serialized by the same `stableStringify` that backs `canonicalJson`, imported rather than
 * reimplemented so the two cannot drift.
 */
export function projectionSnapshot(scope: MemoryScope): string {
  const rows = getDrizzleDb()
    .select()
    .from(memoryProjectionRecords)
    .where(
      and(eq(memoryProjectionRecords.scopeType, scope.scopeType), eq(memoryProjectionRecords.scopeId, scope.scopeId)),
    )
    .orderBy(asc(memoryProjectionRecords.projectionKey))
    .all()

  return stableStringify({
    captureVersion: CAPTURE_VERSION,
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    rows: rows.map(snapshotRow),
  })
}
