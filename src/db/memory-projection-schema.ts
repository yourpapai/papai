// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * The shadow projection of `memory_canonical_events`. No reader queries this table: Gate 1b
 * runs dark, so the projection accrues state without changing an answer. `memory_records`
 * remains the reader's source until 1d reconciles the two.
 *
 * One row per projection key, which is the event's `record_id` when it has one and its
 * idempotency identity otherwise — so an event captured while the live save was suppressed
 * still reaches the snapshot rather than vanishing.
 */
export const memoryProjectionRecords = sqliteTable(
  'memory_projection_records',
  {
    projectionKey: text('projection_key').primaryKey(),
    recordId: text('record_id'),
    /** The winning event. Excluded from the snapshot: a fresh `randomUUID` on every run. */
    eventId: text('event_id').notNull(),
    idempotencyIdentity: text('idempotency_identity').notNull(),
    contentIdentity: text('content_identity').notNull(),
    scopeId: text('scope_id').notNull(),
    scopeType: text('scope_type', { enum: ['personal', 'group'] }).notNull(),
    threadContextId: text('thread_context_id'),
    kind: text('kind').notNull(),
    content: text('content').notNull(),
    summary: text('summary'),
    tags: text('tags').notNull().default('[]'),
    confidence: real('confidence').notNull(),
    source: text('source').notNull(),
    actorIds: text('actor_ids').notNull().default('[]'),
    provenance: text('provenance').notNull().default('{}'),
    /** The fold's ordering key. Supersession resolves by this, never by ingest order. */
    eventTime: text('event_time').notNull(),
    lastObservedAt: text('last_observed_at').notNull(),
    validFrom: text('valid_from'),
    validUntil: text('valid_until'),
    expiresAt: text('expires_at'),
    schemaVersion: integer('schema_version').notNull(),
    captureVersion: text('capture_version').notNull(),
    /** Operational only. Excluded from the snapshot: it varies with wall-clock, not with input. */
    projectedAt: text('projected_at').notNull(),
  },
  (table) => [index('idx_memory_projection_records_scope').on(table.scopeType, table.scopeId)],
)

export type MemoryProjectionRecordRow = typeof memoryProjectionRecords.$inferSelect
