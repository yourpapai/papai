// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { asc, count, desc, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryProjectionOutbox } from '../db/schema.js'
import { logger } from '../logger.js'
import { applyOutboxItem } from './projection-apply.js'
import { isCanonicalProjectionEnabled } from './projection-config.js'

const log = logger.child({ scope: 'long-term-memory:projection-drain' })

/** One drain run applies at most this many items, so a backlog cannot monopolise a tick. */
export const PROJECTION_DRAIN_LIMIT = 200

export type DrainResult = Readonly<{
  applied: number
  superseded: number
  failed: number
  remaining: number
}>

const EMPTY: DrainResult = {
  applied: 0,
  superseded: 0,
  failed: 0,
  remaining: 0,
}

const pendingPositions = (): readonly number[] =>
  getDrizzleDb()
    .select({ position: memoryProjectionOutbox.position })
    .from(memoryProjectionOutbox)
    .where(eq(memoryProjectionOutbox.state, 'pending'))
    .orderBy(asc(memoryProjectionOutbox.position))
    .limit(PROJECTION_DRAIN_LIMIT)
    .all()
    .map((row) => row.position)

const pendingCount = (): number =>
  getDrizzleDb()
    .select({ value: count() })
    .from(memoryProjectionOutbox)
    .where(eq(memoryProjectionOutbox.state, 'pending'))
    .get()?.value ?? 0

/**
 * Applies pending outbox items in position order, one transaction each.
 *
 * The loop holds no state of its own: every decision lives in `applyOutboxItem`, which is what
 * lets the boundary tests drive a single item without a scheduler. A run bounded by the cap
 * logs the remaining depth, so a partial drain is never mistaken for a drained queue.
 */
export function drainProjectionOutbox(now = new Date().toISOString()): DrainResult {
  if (!isCanonicalProjectionEnabled()) {
    log.debug('Projection drain skipped: kill switch off')
    return EMPTY
  }

  let applied = 0
  let superseded = 0
  let failed = 0
  for (const position of pendingPositions()) {
    const outcome = applyOutboxItem(position, now)
    if (outcome === 'applied') applied += 1
    else if (outcome === 'superseded') superseded += 1
    else failed += 1
  }

  const remaining = pendingCount()
  const result: DrainResult = { applied, superseded, failed, remaining }
  if (remaining > 0) log.info(result, 'Projection drain stopped with work remaining')
  else log.debug(result, 'Projection drain complete')
  return result
}

/**
 * The projection checkpoint, derived rather than stored: the highest position whose item is
 * complete. Nothing writes it, so it cannot drift from the work it describes — which is the
 * failure a stored checkpoint would hand to Gate 1d as an ambiguous discrepancy.
 */
export function projectionCheckpoint(): number | null {
  return (
    getDrizzleDb()
      .select({ position: memoryProjectionOutbox.position })
      .from(memoryProjectionOutbox)
      .where(eq(memoryProjectionOutbox.state, 'complete'))
      .orderBy(desc(memoryProjectionOutbox.position))
      .limit(1)
      .get()?.position ?? null
  )
}

/**
 * Re-drives terminally failed items. Repair is a data operation over the existing machinery
 * rather than new machinery: the canonical evidence was never touched, so returning an item to
 * `pending` is enough for the next drain to converge it.
 */
export function repairFailedProjections(): number {
  const db = getDrizzleDb()
  const repaired =
    db.select({ value: count() }).from(memoryProjectionOutbox).where(eq(memoryProjectionOutbox.state, 'failed')).get()
      ?.value ?? 0
  if (repaired === 0) return 0

  db.update(memoryProjectionOutbox)
    .set({ state: 'pending', attemptCount: 0, lastError: null })
    .where(eq(memoryProjectionOutbox.state, 'failed'))
    .run()
  log.info({ repaired }, 'Failed projection items re-driven to pending')
  return repaired
}
