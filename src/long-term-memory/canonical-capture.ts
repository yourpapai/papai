// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryCanonicalCaptureAttempts, memoryCanonicalEvents, memoryProjectionOutbox } from '../db/schema.js'
import { logger } from '../logger.js'
import { isCanonicalCaptureEnabled } from './canonical-capture-config.js'
import { laterIso, toCanonicalPayload, toEventValues } from './canonical-event-values.js'
import { CAPTURE_VERSION, type CanonicalPayload, contentIdentity, idempotencyIdentity } from './canonical-identity.js'
import { isContentTombstoned } from './tombstone.js'
import type { MemoryRecord, MemoryRecordInput, MemoryScope } from './types.js'

const log = logger.child({ scope: 'long-term-memory:canonical-capture' })

export type CaptureOutcome = 'captured' | 'suppressed-duplicate' | 'suppressed-tombstoned' | 'failed'

/** The transaction handle passed to `db.transaction((tx) => ...)`, for helpers outside that closure. */
type MemoryTx = Parameters<Parameters<ReturnType<typeof getDrizzleDb>['transaction']>[0]>[0]

type AttemptArgs = Readonly<{
  identity: string
  payload: CanonicalPayload
  ingestTime: string
  outcome: CaptureOutcome
  eventId: string | null
}>

const insertAttempt = (tx: MemoryTx, args: AttemptArgs): void => {
  tx.insert(memoryCanonicalCaptureAttempts)
    .values({
      idempotencyIdentity: args.identity,
      contentIdentity: contentIdentity(args.payload),
      scopeId: args.payload.scopeId,
      scopeType: args.payload.scopeType,
      outcome: args.outcome,
      eventId: args.eventId,
      eventTime: args.payload.eventTime,
      ingestTime: args.ingestTime,
      captureVersion: CAPTURE_VERSION,
    })
    .run()
}

const enqueue = (tx: MemoryTx, eventId: string, op: 'capture' | 'observe', ingestTime: string): void => {
  tx.insert(memoryProjectionOutbox).values({ eventId, op, state: 'pending', enqueuedAt: ingestTime }).run()
}

type ExistingEvent = Readonly<{ eventId: string; lastObservedAt: string }>

/**
 * Handles a replay of an already-captured identity: advances `lastObservedAt` to the
 * monotonic event-time max when the new observation is genuinely later, and always logs the
 * attempt as `suppressed-duplicate` regardless of whether anything advanced.
 */
const captureDuplicate = (
  tx: MemoryTx,
  existing: ExistingEvent,
  args: Readonly<{ identity: string; payload: CanonicalPayload; now: string }>,
): CaptureOutcome => {
  const advanced = laterIso(existing.lastObservedAt, args.payload.eventTime)
  if (advanced !== existing.lastObservedAt) {
    tx.update(memoryCanonicalEvents)
      .set({ lastObservedAt: advanced })
      .where(eq(memoryCanonicalEvents.eventId, existing.eventId))
      .run()
    enqueue(tx, existing.eventId, 'observe', args.now)
  }
  insertAttempt(tx, {
    identity: args.identity,
    payload: args.payload,
    ingestTime: args.now,
    outcome: 'suppressed-duplicate',
    eventId: existing.eventId,
  })
  return 'suppressed-duplicate'
}

/** Writes a brand-new canonical event, its capture outbox item, and its attempt row. */
const captureNew = (
  tx: MemoryTx,
  args: Readonly<{
    identity: string
    payload: CanonicalPayload
    input: MemoryRecordInput
    now: string
    recordId: string | null
  }>,
): CaptureOutcome => {
  const eventId = randomUUID()
  tx.insert(memoryCanonicalEvents)
    .values(
      toEventValues({
        eventId,
        identity: args.identity,
        payload: args.payload,
        input: args.input,
        ingestTime: args.now,
        recordId: args.recordId,
      }),
    )
    .run()
  enqueue(tx, eventId, 'capture', args.now)
  insertAttempt(tx, {
    identity: args.identity,
    payload: args.payload,
    ingestTime: args.now,
    outcome: 'captured',
    eventId,
  })
  return 'captured'
}

/**
 * Records a rolled-back attempt in its own transaction.
 *
 * A `failed` outcome means the main transaction rolled back, which would have taken its own
 * attempt row with it — so the failure is written separately. If even this write fails there
 * is nowhere durable left to put it, and the log line is the last resort.
 */
const recordFailure = (identity: string, payload: CanonicalPayload, ingestTime: string, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error)
  try {
    getDrizzleDb().transaction((tx) => {
      insertAttempt(tx, { identity, payload, ingestTime, outcome: 'failed', eventId: null })
    })
    log.warn(
      { scopeType: payload.scopeType, scopeId: payload.scopeId, identity, error: message },
      'Canonical capture failed; attempt recorded',
    )
  } catch (recordingError) {
    const recordingMessage = recordingError instanceof Error ? recordingError.message : String(recordingError)
    log.error(
      { scopeType: payload.scopeType, scopeId: payload.scopeId, identity, error: message, recordingMessage },
      'Canonical capture failed and the failure could not be recorded',
    )
  }
}

/**
 * Records one capture attempt in the canonical log.
 *
 * The whole write is one synchronous transaction, which is what makes boundary B1 — a state
 * where an event exists without its outbox item — unreachable rather than merely unlikely:
 * there is no await point between the two inserts for an interleaving to enter, and no
 * partial commit for a crash to leave behind.
 *
 * The tombstone check is repeated here rather than trusted from the caller, so the function
 * is self-contained: both paths reach the same verdict from the same data, which is what the
 * forget-versus-ingest interleavings compare.
 *
 * Returns `null` when the kill switch is off — no attempt was made, so there is no outcome.
 *
 * Never throws: any failure of the canonical write is caught, recorded as a `failed` attempt
 * in its own transaction (see `recordFailure`), and reported as `'failed'` — the caller is
 * never affected by a canonical-capture fault.
 */
export function captureCanonicalEvent(
  input: MemoryRecordInput,
  recordId: string | null,
  now = new Date().toISOString(),
): CaptureOutcome | null {
  if (!isCanonicalCaptureEnabled()) return null

  const scope: MemoryScope = { scopeId: input.scopeId, scopeType: input.scopeType }
  const payload = toCanonicalPayload(input)
  const identity = idempotencyIdentity(scope, input.content)

  let outcome: CaptureOutcome
  try {
    outcome = getDrizzleDb().transaction((tx): CaptureOutcome => {
      if (input.source !== 'explicit' && isContentTombstoned(scope, input.content)) {
        insertAttempt(tx, { identity, payload, ingestTime: now, outcome: 'suppressed-tombstoned', eventId: null })
        return 'suppressed-tombstoned'
      }

      const existing = tx
        .select({ eventId: memoryCanonicalEvents.eventId, lastObservedAt: memoryCanonicalEvents.lastObservedAt })
        .from(memoryCanonicalEvents)
        .where(eq(memoryCanonicalEvents.idempotencyIdentity, identity))
        .get()

      // Monotonic max over event time: a replay of the same input advances nothing, while a
      // genuinely later observation advances even if it arrives out of ingest order.
      if (existing !== undefined) return captureDuplicate(tx, existing, { identity, payload, now })

      return captureNew(tx, { identity, payload, input, now, recordId })
    })
  } catch (error) {
    recordFailure(identity, payload, now, error)
    outcome = 'failed'
  }

  log.debug({ scopeType: input.scopeType, scopeId: input.scopeId, identity, outcome }, 'Canonical capture attempt')
  return outcome
}

/**
 * Captures the update side of the dual-write hook: a content-changing update is a real
 * capture; a status- or confidence-only update is not, so `contentChanged` gates the call.
 */
export function captureUpdateEvent(updated: MemoryRecord | null, contentChanged: boolean): void {
  if (updated !== null && contentChanged) {
    captureCanonicalEvent({ ...updated, embedding: null }, updated.id)
  }
}
