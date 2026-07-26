// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, inArray } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import {
  analyticsBackfillEventMap,
  analyticsDailyCounters,
  analyticsDailyHistograms,
  analyticsDeliveries,
  analyticsEventCollectionRefs,
  analyticsEvents,
  analyticsPolicyAudit,
} from '../../db/schema.js'
import { logger } from '../../logger.js'
import { cancelNeverStartedIn, deleteDeliveryRowsForEventsIn, markSendingAmbiguousIn } from '../delivery/settlement.js'
import { purgeSupersededAuditIn } from '../governance/preference-lifecycle.js'
import {
  aggregateDeadlineMs,
  deliveryReceiptDeadlineMs,
  governanceAuditDeadlineMs,
  MINUTE_MS,
  pendingDeliveryDeadlineMs,
  resolveRetentionLimits,
} from '../retention/expiry-guard.js'
import type { RetentionLimits } from '../retention/expiry-guard.js'
import { purgeExpiredAggregatesIn } from '../storage/aggregate-store.js'
import { deleteEventRowsIn, listExpiredEventIds } from '../storage/event-store.js'

const log = logger.child({ scope: 'analytics:jobs:retention' })

export type RetentionJobDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

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
}>

type DeliveryJoinRow = Readonly<{
  eventId: string
  sinkVersionId: string
  state: string
  nextAttemptAtMs: number
  deliveredAtMs: number | null
  sendStartedAtMs: number | null
  occurredAtMs: number
  expiresAtMs: number
}>

const listDeliveryJoinRows = (tx: Tx): readonly DeliveryJoinRow[] =>
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
  const result = db.transaction((tx) => {
    const delivery = { settled: 0, removed: 0 }
    const expiredIds = listExpiredEventIds(tx, input.nowMs)
    const eventsRemoved = purgeExpiredEventGraph(tx, expiredIds, delivery)
    const joinRows = listDeliveryJoinRows(tx).filter((row) => !expiredIds.includes(row.eventId))
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
    }
  })
  if (result.eventsRemoved > 0 || result.deliveryRowsRemoved > 0 || result.aggregateRowsRemoved > 0) {
    log.info({ ...result }, 'retention purge completed')
  }
  return result
}

export const purgeExpiredBeforeStart = (input: RetentionJobInput, deps: RetentionJobDeps): PurgeResult =>
  purgeExpired(input, deps)

export class ReadersBeforePurgeError extends Error {
  constructor() {
    super('analytics readers are unavailable until purgeExpiredBeforeStart completes')
    this.name = 'ReadersBeforePurgeError'
  }
}

export type RetentionBarrier = Readonly<{
  purgeExpiredBeforeStart: (input: RetentionJobInput) => PurgeResult
  assertReadersAllowed: () => void
}>

export const createRetentionBarrier = (deps: RetentionJobDeps): RetentionBarrier => {
  let purged = false
  return {
    purgeExpiredBeforeStart: (input) => {
      const result = purgeExpired(input, deps)
      purged = true
      return result
    },
    assertReadersAllowed: () => {
      if (!purged) throw new ReadersBeforePurgeError()
    },
  }
}

const earliestOf = (candidates: readonly (number | null)[], nowMs: number): number | null => {
  let earliest: number | null = null
  for (const candidate of candidates) {
    if (candidate === null || candidate <= nowMs) continue
    if (earliest === null || candidate < earliest) earliest = candidate
  }
  return earliest
}

const deliveryDeadlineCandidates = (
  rows: readonly DeliveryJoinRow[],
  limits: RetentionLimits,
): readonly (number | null)[] =>
  rows.map((row) => {
    if (row.state === 'pending' || (row.state === 'leased' && row.sendStartedAtMs === null)) {
      return pendingDeliveryDeadlineMs({ occurredAtMs: row.occurredAtMs, expiresAtMs: row.expiresAtMs }, limits)
    }
    if (row.state === 'delivered') {
      return row.deliveredAtMs === null ? null : deliveryReceiptDeadlineMs(row.deliveredAtMs, limits)
    }
    if (row.state === 'dead' || row.state === 'cancelled') {
      return deliveryReceiptDeadlineMs(row.nextAttemptAtMs, limits)
    }
    return null
  })

const rollupDeadlineCandidates = (tx: Tx, limits: RetentionLimits): readonly number[] => {
  const candidates: number[] = []
  for (const table of [analyticsDailyCounters, analyticsDailyHistograms] as const) {
    const rows = tx.select({ utcDay: table.utcDay, threshold: table.threshold }).from(table).all()
    for (const row of rows) candidates.push(aggregateDeadlineMs(row.utcDay, row.threshold !== null, limits))
  }
  return candidates
}

const auditDeadlineCandidates = (tx: Tx, limits: RetentionLimits): readonly number[] => {
  const rows = tx
    .select({
      governanceActorKey: analyticsPolicyAudit.governanceActorKey,
      occurredAt: analyticsPolicyAudit.occurredAt,
    })
    .from(analyticsPolicyAudit)
    .all()
  const latestByActor = new Map<string, number>()
  for (const row of rows) {
    const latest = latestByActor.get(row.governanceActorKey)
    if (latest === undefined || row.occurredAt > latest) latestByActor.set(row.governanceActorKey, row.occurredAt)
  }
  return rows
    .filter((row) => row.occurredAt < (latestByActor.get(row.governanceActorKey) ?? 0))
    .map((row) => governanceAuditDeadlineMs(row.occurredAt, limits))
}

export const nextExpiryDeadline = (input: RetentionJobInput, deps: RetentionJobDeps): number => {
  const limits = resolveRetentionLimits(input.limits)
  const db = deps.getDrizzleDb()
  return db.transaction((tx) => {
    const eventDeadlines = tx
      .select({ expiresAtMs: analyticsEvents.expiresAtMs })
      .from(analyticsEvents)
      .all()
      .map((row) => row.expiresAtMs)
    const deliveryDeadlines = deliveryDeadlineCandidates(listDeliveryJoinRows(tx), limits)
    const candidates = [
      ...eventDeadlines,
      ...deliveryDeadlines,
      ...rollupDeadlineCandidates(tx, limits),
      ...auditDeadlineCandidates(tx, limits),
    ]
    const earliest = earliestOf(candidates, input.nowMs)
    return Math.min(earliest ?? Number.POSITIVE_INFINITY, input.nowMs + MINUTE_MS)
  })
}
