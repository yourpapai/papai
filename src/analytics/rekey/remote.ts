// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, asc, eq, isNull } from 'drizzle-orm'

import { analyticsDeliveries, analyticsEligibilityGrants, analyticsEvents, analyticsSinks } from '../../db/schema.js'
import type { AnalyticsRekeyRunRow } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { isUnexpired } from '../retention/expiry-guard.js'
import { REKEY_HELD_NEXT_ATTEMPT_MS } from './copy.js'
import type { RekeyTx } from './run-store.js'

const log = logger.child({ scope: 'analytics:rekey:remote' })

/**
 * Pseudonymous remote side of the transition. Egress stays paused from before
 * the cutover until remote_resend completes; implementations must make actor
 * deletion deterministic and idempotent per old actor version.
 */
export type RekeyRemoteEgress = Readonly<{
  pauseEgress: (input: Readonly<{ runId: string; nowMs: number }>) => void
  requestActorDeletion: (
    oldActorKey: string,
    input: Readonly<{ runId: string; nowMs: number }>,
  ) => Readonly<{ remoteReceiptHash: string }> | null
  resumeEgress: (input: Readonly<{ runId: string; nowMs: number }>) => void
}>

const REMOTE_SETTLED_STATES: ReadonlySet<string> = new Set(['delivered', 'sending', 'ambiguous'])

type HeldRow = Readonly<{
  delivery: typeof analyticsDeliveries.$inferSelect
  expiresAtMs: number
  sinkState: string
}>

/**
 * remote_delete: request deletion for every old remote actor version and
 * deterministically reconcile the receipts, preserving old versioned delivery
 * rows and independent deletion receipts. Old pending/leased rows are
 * cancelled so they can never send after the swap; held target-shadow rows
 * stay held.
 */
export const remoteDeleteIn = (
  tx: RekeyTx,
  run: AnalyticsRekeyRunRow,
  egress: RekeyRemoteEgress,
  nowMs: number,
): void => {
  const oldRows = tx
    .select({ delivery: analyticsDeliveries, actorKey: analyticsEvents.actorKey })
    .from(analyticsDeliveries)
    .innerJoin(analyticsEvents, eq(analyticsEvents.eventId, analyticsDeliveries.eventId))
    .where(eq(analyticsEvents.storageGeneration, run.sourceGeneration))
    .orderBy(asc(analyticsDeliveries.eventId), asc(analyticsDeliveries.sinkVersionId))
    .all()
  for (const row of oldRows) {
    if (REMOTE_SETTLED_STATES.has(row.delivery.state)) {
      if (row.delivery.deleteRequestedAtMs === null && row.actorKey !== null) {
        const confirmation = egress.requestActorDeletion(row.actorKey, { runId: run.runId, nowMs })
        tx.update(analyticsDeliveries)
          .set({
            deleteRequestedAtMs: nowMs,
            state: confirmation === null ? 'delete_pending' : 'deleted',
            deletedAtMs: confirmation === null ? null : nowMs,
            remoteReceiptHash: confirmation?.remoteReceiptHash ?? row.delivery.remoteReceiptHash,
          })
          .where(
            and(
              eq(analyticsDeliveries.eventId, row.delivery.eventId),
              eq(analyticsDeliveries.sinkVersionId, row.delivery.sinkVersionId),
            ),
          )
          .run()
      }
      continue
    }
    if (row.delivery.state === 'pending' || row.delivery.state === 'leased') {
      tx.update(analyticsDeliveries)
        .set({ state: 'cancelled', leaseUntilMs: null })
        .where(
          and(
            eq(analyticsDeliveries.eventId, row.delivery.eventId),
            eq(analyticsDeliveries.sinkVersionId, row.delivery.sinkVersionId),
          ),
        )
        .run()
    }
  }
  log.info('old remote actor versions deleted and reconciled')
}

const heldRowsIn = (tx: RekeyTx, run: AnalyticsRekeyRunRow): readonly HeldRow[] =>
  tx
    .select({
      delivery: analyticsDeliveries,
      expiresAtMs: analyticsEvents.expiresAtMs,
      sinkState: analyticsSinks.state,
    })
    .from(analyticsDeliveries)
    .innerJoin(analyticsEvents, eq(analyticsEvents.eventId, analyticsDeliveries.eventId))
    .innerJoin(analyticsSinks, eq(analyticsSinks.sinkVersionId, analyticsDeliveries.sinkVersionId))
    .where(
      and(
        eq(analyticsEvents.storageGeneration, run.targetGeneration),
        eq(analyticsDeliveries.state, 'pending'),
        eq(analyticsDeliveries.nextAttemptAtMs, REKEY_HELD_NEXT_ATTEMPT_MS),
        isNull(analyticsDeliveries.deletedAtMs),
      ),
    )
    .orderBy(asc(analyticsDeliveries.eventId), asc(analyticsDeliveries.sinkVersionId))
    .all()

const hasAllowingGrantIn = (
  tx: RekeyTx,
  delivery: Readonly<{ grantKey: string; grantKeyVersion: string; grantGeneration: number }>,
): boolean =>
  tx
    .select({ grantKey: analyticsEligibilityGrants.grantKey })
    .from(analyticsEligibilityGrants)
    .where(
      and(
        eq(analyticsEligibilityGrants.grantKey, delivery.grantKey),
        eq(analyticsEligibilityGrants.keyVersion, delivery.grantKeyVersion),
        eq(analyticsEligibilityGrants.generation, delivery.grantGeneration),
        eq(analyticsEligibilityGrants.state, 'allow'),
      ),
    )
    .get() !== undefined

/**
 * remote_resend: only after old-version deletions reconcile, still-eligible
 * new-generation rows are re-armed for delivery. Held rows whose grant,
 * expiry, or sink checks fail remain held; the target shadow is never
 * delivered early.
 */
export const remoteResendIn = (tx: RekeyTx, run: AnalyticsRekeyRunRow, nowMs: number): number => {
  let rearmed = 0
  for (const row of heldRowsIn(tx, run)) {
    if (!hasAllowingGrantIn(tx, row.delivery)) continue
    if (!isUnexpired(nowMs, row.expiresAtMs)) continue
    if (row.sinkState !== 'enabled') continue
    tx.update(analyticsDeliveries)
      .set({ nextAttemptAtMs: nowMs })
      .where(
        and(
          eq(analyticsDeliveries.eventId, row.delivery.eventId),
          eq(analyticsDeliveries.sinkVersionId, row.delivery.sinkVersionId),
        ),
      )
      .run()
    rearmed += 1
  }
  log.info({ rearmed }, 'still-eligible new-generation rows enqueued for resend')
  return rearmed
}
