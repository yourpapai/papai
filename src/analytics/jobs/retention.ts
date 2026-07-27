// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import {
  analyticsDailyCounters,
  analyticsDailyHistograms,
  analyticsEvents,
  analyticsPolicyAudit,
} from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { RekeyCutoverFence } from '../rekey/cutover-fence.js'
import {
  aggregateDeadlineMs,
  deliveryReceiptDeadlineMs,
  governanceAuditDeadlineMs,
  MINUTE_MS,
  pendingDeliveryDeadlineMs,
  resolveRetentionLimits,
} from '../retention/expiry-guard.js'
import type { RetentionLimits } from '../retention/expiry-guard.js'
import { listDeliveryJoinRows, purgeExpired } from './retention-purge.js'
import type { DeliveryJoinRow, PurgeResult, RetentionJobDeps, RetentionJobInput } from './retention-purge.js'

export { purgeExpired } from './retention-purge.js'
export type { PurgeResult, RetentionJobDeps, RetentionJobInput } from './retention-purge.js'

const log = logger.child({ scope: 'analytics:jobs:retention' })

export type RetentionSweepDeps = RetentionJobDeps &
  Readonly<{
    fence?: RekeyCutoverFence
  }>

export type RetentionSweepResult = Readonly<{
  status: 'purged' | 'fence_held'
  purge: PurgeResult | null
  nextWakeMs: number
}>

/**
 * Scheduled expiry purge. Retention is never gated by collection mode (a kill
 * switch must never block deletion), but it admits to the rekey cutover fence:
 * while a cutover is held the sweep skips its mutable phase entirely and only
 * reports the next wake, so no generation is mutated mid-swap.
 */
export const runExpirySweep = (input: RetentionJobInput, deps: RetentionSweepDeps): RetentionSweepResult => {
  const admission = deps.fence?.admit('retention')
  if (deps.fence !== undefined && admission === null) {
    log.warn('expiry sweep skipped: the cutover fence is held')
    return { status: 'fence_held', purge: null, nextWakeMs: nextExpiryDeadline(input, deps) }
  }
  try {
    const purge = purgeExpired(input, deps)
    return { status: 'purged', purge, nextWakeMs: nextExpiryDeadline(input, deps) }
  } finally {
    admission?.release()
  }
}

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

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
