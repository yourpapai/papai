// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsAggregateDeliveries, analyticsAggregateReleases } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { RekeyCutoverFence } from '../rekey/cutover-fence.js'
import { pendingAggregateDeliveryDeadlineMs } from '../retention/expiry-guard.js'

const log = logger.child({ scope: 'analytics:delivery:aggregate-delivery-store' })

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

export type AggregateDeliveryStoreDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  fence?: RekeyCutoverFence
}>

export const admitFence = (deps: AggregateDeliveryStoreDeps): (() => void) | null => {
  if (deps.fence === undefined) return (): void => undefined
  const admission = deps.fence.admit('delivery')
  if (admission === null) return null
  return admission.release
}

export const keyFilter = (releaseId: string, sinkVersionId: string): SQL | undefined =>
  and(
    eq(analyticsAggregateDeliveries.releaseId, releaseId),
    eq(analyticsAggregateDeliveries.sinkVersionId, sinkVersionId),
  )

const releaseUtcDay = (payloadJson: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(payloadJson)
    if (typeof parsed !== 'object' || parsed === null || !('utc_day' in parsed)) return null
    const { utc_day: utcDay } = parsed
    return typeof utcDay === 'string' ? utcDay : null
  } catch {
    return null
  }
}

const isReleaseExpired = (payloadJson: string, nowMs: number): boolean => {
  const utcDay = releaseUtcDay(payloadJson)
  if (utcDay === null) return true
  return pendingAggregateDeliveryDeadlineMs(utcDay) <= nowMs
}

export type LeasedAggregateDelivery = Readonly<{
  releaseId: string
  sinkVersionId: string
  attempts: number
  leaseUntilMs: number
  payloadJson: string
}>

export type LeaseAggregateDeliveriesInput = Readonly<{
  nowMs: number
  leaseMs: number
  limit: number
  maxAttempts: number
}>

type CandidateRow = Readonly<{
  releaseId: string
  sinkVersionId: string
  attempts: number
  payloadJson: string
}>

const recoverOrphanedIn = (tx: Tx, nowMs: number): void => {
  tx.update(analyticsAggregateDeliveries)
    .set({ state: 'ambiguous', leaseUntilMs: null })
    .where(
      and(
        eq(analyticsAggregateDeliveries.state, 'sending'),
        sql`${analyticsAggregateDeliveries.leaseUntilMs} IS NULL OR ${analyticsAggregateDeliveries.leaseUntilMs} < ${nowMs}`,
      ),
    )
    .run()
}

const releaseExpiredLeasesIn = (tx: Tx, nowMs: number): void => {
  tx.update(analyticsAggregateDeliveries)
    .set({ state: 'pending', leaseUntilMs: null })
    .where(
      and(
        eq(analyticsAggregateDeliveries.state, 'leased'),
        isNull(analyticsAggregateDeliveries.sendStartedAtMs),
        lt(analyticsAggregateDeliveries.leaseUntilMs, nowMs),
      ),
    )
    .run()
}

const exhaustDeadRowsIn = (tx: Tx, maxAttempts: number): void => {
  tx.update(analyticsAggregateDeliveries)
    .set({ state: 'dead' })
    .where(
      and(
        eq(analyticsAggregateDeliveries.state, 'pending'),
        sql`${analyticsAggregateDeliveries.attempts} >= ${maxAttempts}`,
      ),
    )
    .run()
}

const cancelExpiredPendingIn = (tx: Tx, nowMs: number): void => {
  const pending = tx
    .select({ releaseId: analyticsAggregateDeliveries.releaseId, payloadJson: analyticsAggregateReleases.payloadJson })
    .from(analyticsAggregateDeliveries)
    .innerJoin(
      analyticsAggregateReleases,
      eq(analyticsAggregateReleases.releaseId, analyticsAggregateDeliveries.releaseId),
    )
    .where(eq(analyticsAggregateDeliveries.state, 'pending'))
    .all()
  const expired = pending.filter((row) => isReleaseExpired(row.payloadJson, nowMs))
  for (const row of expired) {
    tx.update(analyticsAggregateDeliveries)
      .set({ state: 'cancelled', leaseUntilMs: null })
      .where(
        and(
          eq(analyticsAggregateDeliveries.releaseId, row.releaseId),
          eq(analyticsAggregateDeliveries.state, 'pending'),
        ),
      )
      .run()
  }
  if (expired.length > 0) log.info({ count: expired.length }, 'expired aggregate deliveries cancelled at lease scan')
}

const leaseOneIn = (tx: Tx, row: CandidateRow, leaseUntilMs: number): void => {
  tx.update(analyticsAggregateDeliveries)
    .set({ state: 'leased', attempts: row.attempts + 1, leaseUntilMs, sendStartedAtMs: null })
    .where(
      and(
        eq(analyticsAggregateDeliveries.releaseId, row.releaseId),
        eq(analyticsAggregateDeliveries.sinkVersionId, row.sinkVersionId),
        eq(analyticsAggregateDeliveries.state, 'pending'),
      ),
    )
    .run()
}

const toLeased = (row: CandidateRow, leaseUntilMs: number): LeasedAggregateDelivery => ({
  releaseId: row.releaseId,
  sinkVersionId: row.sinkVersionId,
  attempts: row.attempts + 1,
  leaseUntilMs,
  payloadJson: row.payloadJson,
})

export const leaseAggregateDeliveries = (
  input: LeaseAggregateDeliveriesInput,
  deps: AggregateDeliveryStoreDeps,
): LeasedAggregateDelivery[] => {
  if (input.limit <= 0) return []
  const releaseFence = admitFence(deps)
  if (releaseFence === null) {
    log.warn('aggregate delivery lease refused: cutover fence held')
    return []
  }
  try {
    const db = deps.getDrizzleDb()
    const leaseUntilMs = input.nowMs + input.leaseMs
    return db.transaction((tx) => {
      recoverOrphanedIn(tx, input.nowMs)
      releaseExpiredLeasesIn(tx, input.nowMs)
      exhaustDeadRowsIn(tx, input.maxAttempts)
      cancelExpiredPendingIn(tx, input.nowMs)
      const candidates = tx
        .select({
          releaseId: analyticsAggregateDeliveries.releaseId,
          sinkVersionId: analyticsAggregateDeliveries.sinkVersionId,
          attempts: analyticsAggregateDeliveries.attempts,
          payloadJson: analyticsAggregateReleases.payloadJson,
        })
        .from(analyticsAggregateDeliveries)
        .innerJoin(
          analyticsAggregateReleases,
          eq(analyticsAggregateReleases.releaseId, analyticsAggregateDeliveries.releaseId),
        )
        .where(
          and(
            eq(analyticsAggregateDeliveries.state, 'pending'),
            sql`${analyticsAggregateDeliveries.nextAttemptAtMs} <= ${input.nowMs}`,
            sql`${analyticsAggregateDeliveries.attempts} < ${input.maxAttempts}`,
          ),
        )
        .orderBy(analyticsAggregateDeliveries.nextAttemptAtMs)
        .limit(input.limit)
        .all()
      const eligible = candidates.filter((row) => !isReleaseExpired(row.payloadJson, input.nowMs))
      for (const row of eligible) leaseOneIn(tx, row, leaseUntilMs)
      return eligible.map((row) => toLeased(row, leaseUntilMs))
    })
  } finally {
    releaseFence()
  }
}

export type MarkAggregateSendStartedResult =
  | 'started'
  | 'not_leased'
  | 'lease_expired'
  | 'release_expired'
  | 'fence_held'

export const markAggregateSendStarted = (
  input: Readonly<{ releaseId: string; sinkVersionId: string; nowMs: number }>,
  deps: AggregateDeliveryStoreDeps,
): MarkAggregateSendStartedResult => {
  const releaseFence = admitFence(deps)
  if (releaseFence === null) {
    log.warn({ sinkVersionId: input.sinkVersionId }, 'aggregate send-start refused: cutover fence held')
    return 'fence_held'
  }
  try {
    const db = deps.getDrizzleDb()
    return db.transaction((tx) => {
      const row = tx
        .select()
        .from(analyticsAggregateDeliveries)
        .where(keyFilter(input.releaseId, input.sinkVersionId))
        .get()
      if (row === undefined || row.state !== 'leased') return 'not_leased'
      if (row.leaseUntilMs === null || row.leaseUntilMs < input.nowMs) {
        tx.update(analyticsAggregateDeliveries)
          .set({ state: 'pending', leaseUntilMs: null })
          .where(keyFilter(input.releaseId, input.sinkVersionId))
          .run()
        return 'lease_expired'
      }
      const release = tx
        .select({ payloadJson: analyticsAggregateReleases.payloadJson })
        .from(analyticsAggregateReleases)
        .where(eq(analyticsAggregateReleases.releaseId, input.releaseId))
        .get()
      if (release === undefined || isReleaseExpired(release.payloadJson, input.nowMs)) {
        tx.update(analyticsAggregateDeliveries)
          .set({ state: 'cancelled', leaseUntilMs: null })
          .where(keyFilter(input.releaseId, input.sinkVersionId))
          .run()
        log.warn({ sinkVersionId: input.sinkVersionId }, 'aggregate send-start blocked: release expired')
        return 'release_expired'
      }
      tx.update(analyticsAggregateDeliveries)
        .set({ state: 'sending', sendStartedAtMs: input.nowMs })
        .where(and(keyFilter(input.releaseId, input.sinkVersionId), eq(analyticsAggregateDeliveries.state, 'leased')))
        .run()
      return 'started'
    })
  } finally {
    releaseFence()
  }
}
