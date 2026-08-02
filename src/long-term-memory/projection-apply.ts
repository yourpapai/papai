// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import {
  memoryCanonicalEvents,
  type MemoryCanonicalEventRow,
  memoryProjectionOutbox,
  memoryProjectionRecords,
} from '../db/schema.js'
import { logger } from '../logger.js'
import { projectionKeyFor, winsAgainst } from './projection-fold.js'

const log = logger.child({ scope: 'long-term-memory:projection-apply' })

/** After this many failed attempts an item stops being retried and waits for repair. */
export const MAX_PROJECTION_ATTEMPTS = 5

export type ApplyOutcome = 'applied' | 'superseded' | 'missing-event' | 'failed'

/** The transaction handle passed to `db.transaction((tx) => ...)`, for helpers outside that closure. */
type MemoryTx = Parameters<Parameters<ReturnType<typeof getDrizzleDb>['transaction']>[0]>[0]

const toProjectionValues = (
  event: MemoryCanonicalEventRow,
  projectionKey: string,
  now: string,
): typeof memoryProjectionRecords.$inferInsert =>
  ({
    projectionKey,
    recordId: event.recordId,
    eventId: event.eventId,
    idempotencyIdentity: event.idempotencyIdentity,
    contentIdentity: event.contentIdentity,
    scopeId: event.scopeId,
    scopeType: event.scopeType,
    threadContextId: event.threadContextId,
    kind: event.kind,
    content: event.content,
    summary: event.summary,
    tags: event.tags,
    confidence: event.confidence,
    source: event.source,
    actorIds: event.actorIds,
    provenance: event.provenance,
    eventTime: event.eventTime,
    lastObservedAt: event.lastObservedAt,
    validFrom: event.validFrom,
    validUntil: event.validUntil,
    expiresAt: event.expiresAt,
    schemaVersion: event.schemaVersion,
    captureVersion: event.captureVersion,
    projectedAt: now,
  }) satisfies typeof memoryProjectionRecords.$inferInsert

const upsertShadowRow = (tx: MemoryTx, event: MemoryCanonicalEventRow, projectionKey: string, now: string): void => {
  const values = toProjectionValues(event, projectionKey, now)
  tx.insert(memoryProjectionRecords)
    .values(values)
    .onConflictDoUpdate({ target: memoryProjectionRecords.projectionKey, set: values })
    .run()
}

const completeItem = (tx: MemoryTx, position: number, attemptCount: number, now: string): void => {
  tx.update(memoryProjectionOutbox)
    .set({ state: 'complete', attemptCount: attemptCount + 1, lastAttemptAt: now })
    .where(eq(memoryProjectionOutbox.position, position))
    .run()
}

const failTerminally = (tx: MemoryTx, position: number, attemptCount: number, now: string, reason: string): void => {
  tx.update(memoryProjectionOutbox)
    .set({ state: 'failed', attemptCount: attemptCount + 1, lastAttemptAt: now, lastError: reason })
    .where(eq(memoryProjectionOutbox.position, position))
    .run()
}

/**
 * Applies one outbox item to the shadow projection.
 *
 * The shadow upsert and the outbox state change are one transaction, which is what makes
 * boundaries B3 (partial projection writes) and B4 (projected but not checkpointed) unreachable
 * rather than merely unlikely: there is no window between them and no partial commit for a
 * crash to leave behind. The checkpoint is not written at all — it is `max(position)` over
 * completed rows, derived on read.
 *
 * Apply reads the canonical event rather than branching on the outbox `op`, so `capture` and
 * `observe` share one path and re-driving any position converges on the same state. `op`
 * survives as an O3 observability field.
 */
export function applyOutboxItem(position: number, now = new Date().toISOString()): ApplyOutcome {
  const outcome = applyWithinTransaction(position, now)
  if (outcome === 'missing-event') {
    log.warn({ position, outcome }, 'Projection apply found no canonical event; outbox item failed terminally')
  } else {
    log.debug({ position, outcome }, 'Projection apply attempt')
  }
  return outcome
}

function applyWithinTransaction(position: number, now: string): ApplyOutcome {
  return getDrizzleDb().transaction((tx): ApplyOutcome => {
    const item = tx
      .select({ eventId: memoryProjectionOutbox.eventId, attemptCount: memoryProjectionOutbox.attemptCount })
      .from(memoryProjectionOutbox)
      .where(eq(memoryProjectionOutbox.position, position))
      .get()
    if (item === undefined) return 'missing-event'

    const event = tx.select().from(memoryCanonicalEvents).where(eq(memoryCanonicalEvents.eventId, item.eventId)).get()
    if (event === undefined) {
      // Unreachable while B1 holds. Retrying cannot conjure the event, so this fails terminally
      // and waits for a human rather than burning the retry budget.
      failTerminally(tx, position, item.attemptCount, now, `canonical event missing: ${item.eventId}`)
      return 'missing-event'
    }

    const projectionKey = projectionKeyFor(event.recordId, event.idempotencyIdentity)
    const incumbent = tx
      .select({
        eventTime: memoryProjectionRecords.eventTime,
        idempotencyIdentity: memoryProjectionRecords.idempotencyIdentity,
      })
      .from(memoryProjectionRecords)
      .where(eq(memoryProjectionRecords.projectionKey, projectionKey))
      .get()

    const wins = incumbent === undefined || winsAgainst(event, incumbent)
    if (wins) upsertShadowRow(tx, event, projectionKey, now)
    completeItem(tx, position, item.attemptCount, now)
    return wins ? 'applied' : 'superseded'
  })
}
