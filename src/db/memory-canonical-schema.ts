// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * The canonical capture log: one row per captured memory item, keyed by its idempotency
 * identity. `memory_records` is its projection. Append-only apart from `last_observed_at`,
 * which advances monotonically when the same item is observed again.
 */
export const memoryCanonicalEvents = sqliteTable(
  'memory_canonical_events',
  {
    eventId: text('event_id').primaryKey(),
    idempotencyIdentity: text('idempotency_identity').notNull().unique(),
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
    eventTime: text('event_time').notNull(),
    ingestTime: text('ingest_time').notNull(),
    lastObservedAt: text('last_observed_at').notNull(),
    validFrom: text('valid_from'),
    validUntil: text('valid_until'),
    expiresAt: text('expires_at'),
    /** Reserved for 1b's supersession resolution; always null in 1a. */
    supersedes: text('supersedes'),
    /** The `memory_records` row this event corresponds to, for 1d's reconciliation. */
    recordId: text('record_id'),
    schemaVersion: integer('schema_version').notNull(),
    captureVersion: text('capture_version').notNull(),
  },
  (table) => [index('idx_memory_canonical_events_scope_time').on(table.scopeType, table.scopeId, table.eventTime)],
)

/**
 * Projection work queue. `position` is the checkpoint position 1b consumes: monotonic and
 * never reused, so a checkpoint can never be overtaken by a lower-numbered later row.
 */
export const memoryProjectionOutbox = sqliteTable(
  'memory_projection_outbox',
  {
    position: integer('position').primaryKey({ autoIncrement: true }),
    eventId: text('event_id').notNull(),
    op: text('op', { enum: ['capture', 'observe'] }).notNull(),
    state: text('state', { enum: ['pending', 'complete', 'failed'] })
      .notNull()
      .default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    enqueuedAt: text('enqueued_at').notNull(),
    lastAttemptAt: text('last_attempt_at'),
    lastError: text('last_error'),
  },
  (table) => [index('idx_memory_projection_outbox_state_position').on(table.state, table.position)],
)

/**
 * Every capture attempt, including the ones that wrote no event. Required by observable O1,
 * which this spec reads as "suppressed attempts are themselves enumerable from storage".
 */
export const memoryCanonicalCaptureAttempts = sqliteTable(
  'memory_canonical_capture_attempts',
  {
    position: integer('position').primaryKey({ autoIncrement: true }),
    idempotencyIdentity: text('idempotency_identity').notNull(),
    contentIdentity: text('content_identity').notNull(),
    scopeId: text('scope_id').notNull(),
    scopeType: text('scope_type', { enum: ['personal', 'group'] }).notNull(),
    outcome: text('outcome', {
      enum: ['captured', 'suppressed-duplicate', 'suppressed-tombstoned', 'failed'],
    }).notNull(),
    eventId: text('event_id'),
    eventTime: text('event_time').notNull(),
    ingestTime: text('ingest_time').notNull(),
    captureVersion: text('capture_version').notNull(),
  },
  (table) => [index('idx_memory_canonical_capture_attempts_identity').on(table.idempotencyIdentity)],
)

/**
 * Single-row marker recording when canonical capture started. 1d scopes its reconciliation to
 * records created at or after this instant, because nothing before it was ever captured
 * canonically and no history is fabricated to pretend otherwise.
 */
export const memoryCanonicalState = sqliteTable('memory_canonical_state', {
  id: text('id').primaryKey(),
  cutoverAt: text('cutover_at').notNull(),
})

export type MemoryCanonicalEventRow = typeof memoryCanonicalEvents.$inferSelect
export type MemoryProjectionOutboxRow = typeof memoryProjectionOutbox.$inferSelect
export type MemoryCanonicalCaptureAttemptRow = typeof memoryCanonicalCaptureAttempts.$inferSelect
export type MemoryCanonicalStateRow = typeof memoryCanonicalState.$inferSelect
