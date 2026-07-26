// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, inArray } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import {
  analyticsBackfillEventMap,
  analyticsDeletionRequests,
  analyticsDeliveries,
  analyticsDeliveryDeletionReceipts,
  analyticsEventCollectionRefs,
  analyticsEvents,
} from '../../db/schema.js'
import { logger } from '../../logger.js'
import {
  cancelNeverStartedIn,
  deleteDeliveryRowsForEventsIn,
  listDeliveryRowsForEvents,
  markSendingAmbiguousIn,
} from '../delivery/settlement.js'
import { purgeSupersededAuditIn } from '../governance/preference-lifecycle.js'
import { confirmRemoteDeletions, REMOTE_SETTLED_STATES } from '../governance/subject-deletion.js'
import type { RemoteDeletionRequest } from '../governance/subject-deletion.js'
import {
  deliveryReceiptDeadlineMs,
  governanceAuditDeadlineMs,
  pendingDeliveryDeadlineMs,
  resolveRetentionLimits,
} from '../retention/expiry-guard.js'
import type { RetentionLimits } from '../retention/expiry-guard.js'
import { purgeExpiredAggregatesIn } from '../storage/aggregate-store.js'
import { deleteEventRowsIn, listExpiredEventIds } from '../storage/event-store.js'

const log = logger.child({ scope: 'analytics:jobs:retention-purge' })

export type RetentionJobDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  requestRemoteDeletion?: RemoteDeletionRequest
}>

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

export type RetentionJobInput = Readonly<{
  nowMs: number
  limits?: Partial<RetentionLimits>
}>

export type PurgeResult = Readonly<{
  eventsRemoved: number
  deliveryRowsSettled: number
  deliveryRowsRemoved: number
  receiptsRemoved: number
  aggregateRowsRemoved: number
  auditRowsRemoved: number
  remoteDeletionsConfirmed: number
  remoteSettlementDeferred: number
}>

export type DeliveryJoinRow = Readonly<{
  eventId: string
  sinkVersionId: string
  state: string
  nextAttemptAtMs: number
  deliveredAtMs: number | null
  sendStartedAtMs: number | null
  occurredAtMs: number
  expiresAtMs: number
}>

export const listDeliveryJoinRows = (tx: Tx): readonly DeliveryJoinRow[] =>
  tx
    .select({
      eventId: analyticsDeliveries.eventId,
      sinkVersionId: analyticsDeliveries.sinkVersionId,
      state: analyticsDeliveries.state,
      nextAttemptAtMs: analyticsDeliveries.nextAttemptAtMs,
      deliveredAtMs: analyticsDeliveries.deliveredAtMs,
      sendStartedAtMs: analyticsDeliveries.sendStartedAtMs,
      occurredAtMs: analyticsEvents.occurredAtMs,
      expiresAtMs: analyticsEvents.expiresAtMs,
    })
    .from(analyticsDeliveries)
    .innerJoin(analyticsEvents, eq(analyticsEvents.eventId, analyticsDeliveries.eventId))
    .all()

const deleteDeliveryByKeys = (
  tx: Tx,
  keys: readonly Readonly<{ eventId: string; sinkVersionId: string }>[],
): number => {
  let removed = 0
  for (const key of keys) {
    const filter = and(
      eq(analyticsDeliveries.eventId, key.eventId),
      eq(analyticsDeliveries.sinkVersionId, key.sinkVersionId),
    )
    const count = tx
      .select({ eventId: analyticsDeliveries.eventId })
      .from(analyticsDeliveries)
      .where(filter)
      .all().length
    if (count === 0) continue
    tx.delete(analyticsDeliveries).where(filter).run()
    removed += count
  }
  return removed
}

export const EXPIRY_DELETION_REQUEST_ID = 'system:retention-expiry'
const EXPIRY_GOVERNANCE_ACTOR_KEY = 'system:retention-expiry'

type RemoteConfirmation = Readonly<{ sinkVersionId: string; remoteReceiptHash: string }>

type RemoteSettlement = Readonly<{
  purgeableIds: readonly string[]
  confirmations: readonly RemoteConfirmation[]
  deferred: number
}>

/**
 * Aligns expiry with the withdrawal/deletion settlement ordering: delivered
 * and ambiguous targets get a remote-deletion request plus confirmation
 * before any row is removed. When remote deletion is impossible (no requester
 * wired, or a sink refuses), the affected events are deferred untouched — the
 * same fail-and-retain branch the deletion workflow uses — and retried on the
 * next purge run.
 */
const settleRemoteCopies = (
  db: Db,
  expiredIds: readonly string[],
  requestRemoteDeletion: RemoteDeletionRequest | undefined,
): RemoteSettlement => {
  if (expiredIds.length === 0) return { purgeableIds: expiredIds, confirmations: [], deferred: 0 }
  const remoteRows = listDeliveryRowsForEvents(db, expiredIds).filter((row) => REMOTE_SETTLED_STATES.has(row.state))
  if (remoteRows.length === 0) return { purgeableIds: expiredIds, confirmations: [], deferred: 0 }
  const sinkVersionIds = [...new Set(remoteRows.map((row) => row.sinkVersionId))]
  const confirmations = confirmRemoteDeletions(sinkVersionIds, requestRemoteDeletion)
  if (confirmations === null) {
    const deferredIds = new Set(remoteRows.map((row) => row.eventId))
    log.warn({ deferred: deferredIds.size }, 'expiry settlement deferred: remote deletion was not confirmed')
    return {
      purgeableIds: expiredIds.filter((eventId) => !deferredIds.has(eventId)),
      confirmations: [],
      deferred: deferredIds.size,
    }
  }
  return { purgeableIds: expiredIds, confirmations, deferred: 0 }
}

const insertExpiryReceiptsIn = (tx: Tx, confirmations: readonly RemoteConfirmation[], nowMs: number): void => {
  if (confirmations.length === 0) return
  tx.insert(analyticsDeletionRequests)
    .values({
      requestId: EXPIRY_DELETION_REQUEST_ID,
      governanceActorKey: EXPIRY_GOVERNANCE_ACTOR_KEY,
      keyVersion: 'system',
      state: 'completed',
      policyVersion: 1,
      requestedAtMs: nowMs,
      completedAtMs: nowMs,
    })
    .onConflictDoNothing()
    .run()
  for (const confirmation of confirmations) {
    tx.insert(analyticsDeliveryDeletionReceipts)
      .values({
        deletionRequestId: EXPIRY_DELETION_REQUEST_ID,
        sinkVersionId: confirmation.sinkVersionId,
        state: 'reconciled',
        remoteReceiptHash: confirmation.remoteReceiptHash,
        requestedAtMs: nowMs,
        reconciledAtMs: nowMs,
      })
      .onConflictDoNothing()
      .run()
  }
}

const purgeExpiredEventGraph = (
  tx: Tx,
  expiredIds: readonly string[],
  result: { settled: number; removed: number },
): number => {
  if (expiredIds.length === 0) return 0
  result.settled += cancelNeverStartedIn(tx, expiredIds) + markSendingAmbiguousIn(tx, expiredIds)
  result.removed += deleteDeliveryRowsForEventsIn(tx, expiredIds)
  tx.delete(analyticsEventCollectionRefs)
    .where(inArray(analyticsEventCollectionRefs.eventId, [...expiredIds]))
    .run()
  tx.delete(analyticsBackfillEventMap)
    .where(inArray(analyticsBackfillEventMap.eventId, [...expiredIds]))
    .run()
  return deleteEventRowsIn(tx, expiredIds)
}

const purgeExpiredPendingDeliveries = (
  tx: Tx,
  rows: readonly DeliveryJoinRow[],
  nowMs: number,
  limits: RetentionLimits,
  result: { settled: number; removed: number },
): void => {
  const overdue = rows.filter(
    (row) =>
      (row.state === 'pending' || (row.state === 'leased' && row.sendStartedAtMs === null)) &&
      pendingDeliveryDeadlineMs({ occurredAtMs: row.occurredAtMs, expiresAtMs: row.expiresAtMs }, limits) <= nowMs,
  )
  if (overdue.length === 0) return
  result.settled += cancelNeverStartedIn(
    tx,
    overdue.map((row) => row.eventId),
  )
  result.removed += deleteDeliveryByKeys(tx, overdue)
}

const purgeExpiredReceipts = (
  tx: Tx,
  rows: readonly DeliveryJoinRow[],
  nowMs: number,
  limits: RetentionLimits,
): number => {
  const overdue = rows.filter((row) => {
    if (row.state === 'delivered') {
      return row.deliveredAtMs !== null && deliveryReceiptDeadlineMs(row.deliveredAtMs, limits) <= nowMs
    }
    if (row.state === 'dead' || row.state === 'cancelled') {
      return deliveryReceiptDeadlineMs(row.nextAttemptAtMs, limits) <= nowMs
    }
    return false
  })
  return deleteDeliveryByKeys(tx, overdue)
}

export const purgeExpired = (input: RetentionJobInput, deps: RetentionJobDeps): PurgeResult => {
  const limits = resolveRetentionLimits(input.limits)
  const db = deps.getDrizzleDb()
  const settlement = settleRemoteCopies(db, listExpiredEventIds(db, input.nowMs), deps.requestRemoteDeletion)
  const result = db.transaction((tx) => {
    const delivery = { settled: 0, removed: 0 }
    insertExpiryReceiptsIn(tx, settlement.confirmations, input.nowMs)
    const eventsRemoved = purgeExpiredEventGraph(tx, settlement.purgeableIds, delivery)
    const joinRows = listDeliveryJoinRows(tx).filter((row) => !settlement.purgeableIds.includes(row.eventId))
    purgeExpiredPendingDeliveries(tx, joinRows, input.nowMs, limits, delivery)
    const receiptsRemoved = purgeExpiredReceipts(tx, joinRows, input.nowMs, limits)
    const aggregateRowsRemoved = purgeExpiredAggregatesIn(tx, { nowMs: input.nowMs, limits })
    const auditRowsRemoved = purgeSupersededAuditIn(tx, {
      nowMs: input.nowMs,
      deadlineFor: (occurredAtMs) => governanceAuditDeadlineMs(occurredAtMs, limits),
    })
    return {
      eventsRemoved,
      deliveryRowsSettled: delivery.settled,
      deliveryRowsRemoved: delivery.removed,
      receiptsRemoved,
      aggregateRowsRemoved,
      auditRowsRemoved,
      remoteDeletionsConfirmed: settlement.confirmations.length,
      remoteSettlementDeferred: settlement.deferred,
    }
  })
  if (result.eventsRemoved > 0 || result.deliveryRowsRemoved > 0 || result.aggregateRowsRemoved > 0) {
    log.info({ ...result }, 'retention purge completed')
  }
  return result
}
