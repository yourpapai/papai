// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq, inArray } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../db/drizzle.js'
import {
  analyticsAggregateEpochContributions,
  analyticsDailyCounters,
  analyticsDailyHistograms,
  analyticsEpochSourceCounters,
  analyticsProcessEpochs,
} from '../db/schema.js'
import { logger } from '../logger.js'
import { utcDayOfMs } from './aggregate.js'
import { closeEpoch, openEpoch } from './storage/epoch-store.js'

const log = logger.child({ scope: 'analytics:process-epoch' })

const DAY_MS = 86_400_000
const DEFAULT_DRAIN_TIMEOUT_MS = 5000
const MAX_RECOVERY_DAYS = 400
const UTC_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

export type ProcessEpochCoordinatorDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  nowMs?: () => number
  newEpochId?: () => string
  drain?: () => Promise<void>
  drainTimeoutMs?: number
  onEpochRecovered?: (epochId: string) => void
}>

export type ProcessEpochCoordinator = Readonly<{
  readonly epochId: string
  recoverStaleEpochs: () => void
  open: () => void
  close: () => Promise<Readonly<{ closed: boolean }>>
}>

const daysInInterval = (startedAtMs: number, nowMs: number): readonly string[] => {
  const days: string[] = []
  const startDay = Math.floor(startedAtMs / DAY_MS) * DAY_MS
  for (let day = startDay; day <= nowMs && days.length < MAX_RECOVERY_DAYS; day += DAY_MS) {
    days.push(utcDayOfMs(day))
  }
  return days
}

const contributionDays = (tx: Tx, epochId: string): readonly string[] => {
  const sourceDays = tx
    .selectDistinct({ utcDay: analyticsEpochSourceCounters.utcDay })
    .from(analyticsEpochSourceCounters)
    .where(eq(analyticsEpochSourceCounters.epochId, epochId))
    .all()
    .map((row) => row.utcDay)
  const cellDays = tx
    .selectDistinct({
      cellKey: analyticsAggregateEpochContributions.aggregateCellKey,
    })
    .from(analyticsAggregateEpochContributions)
    .where(eq(analyticsAggregateEpochContributions.epochId, epochId))
    .all()
    .map((row) => row.cellKey.split('|')[0] ?? '')
    .filter((day) => UTC_DAY_PATTERN.test(day))
  return [...new Set([...sourceDays, ...cellDays])]
}

const markBucketsUnreconciled = (tx: Tx, days: readonly string[]): void => {
  if (days.length === 0) return
  const quality = {
    finalized: false,
    restartGapDetected: true,
    reconciliationStatus: 'unreconciled_restart_gap',
    contributorCount: null,
  }
  tx.update(analyticsDailyCounters)
    .set(quality)
    .where(inArray(analyticsDailyCounters.utcDay, [...days]))
    .run()
  tx.update(analyticsDailyHistograms)
    .set(quality)
    .where(inArray(analyticsDailyHistograms.utcDay, [...days]))
    .run()
}

const recoverAllOpenEpochs = (tx: Tx, now: number, deps: ProcessEpochCoordinatorDeps): readonly string[] => {
  const staleRows = tx
    .select({
      epochId: analyticsProcessEpochs.epochId,
      startedAtMs: analyticsProcessEpochs.startedAtMs,
    })
    .from(analyticsProcessEpochs)
    .where(eq(analyticsProcessEpochs.state, 'open'))
    .all()
  for (const row of staleRows) {
    const days = [...new Set([...daysInInterval(row.startedAtMs, now), ...contributionDays(tx, row.epochId)])]
    markBucketsUnreconciled(tx, days)
    tx.update(analyticsProcessEpochs)
      .set({ state: 'stale_open', staleMarkedAtMs: now })
      .where(eq(analyticsProcessEpochs.epochId, row.epochId))
      .run()
    deps.onEpochRecovered?.(row.epochId)
  }
  return staleRows.map((row) => row.epochId)
}

const runRecovery = (deps: ProcessEpochCoordinatorDeps): void => {
  const db = deps.getDrizzleDb()
  const now = (deps.nowMs ?? systemNowMs)()
  const recovered = db.transaction((tx) => recoverAllOpenEpochs(tx, now, deps))
  if (recovered.length > 0) {
    log.info({ count: recovered.length }, 'stale epochs recovered and buckets marked unreconciled')
  }
}

const systemNowMs = (): number => Date.now()

const defaultDrain = (): Promise<void> => Promise.resolve()

export const createProcessEpochCoordinator = (deps: ProcessEpochCoordinatorDeps): ProcessEpochCoordinator => {
  const nowMs = deps.nowMs ?? systemNowMs
  const epochId = deps.newEpochId?.() ?? `epoch-${nowMs()}`
  const drainTimeoutMs = deps.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS

  return {
    epochId,
    recoverStaleEpochs: () => {
      runRecovery(deps)
    },
    open: () => {
      openEpoch({ epochId, startedAtMs: nowMs() }, { getDrizzleDb: deps.getDrizzleDb })
      log.debug({ epochId }, 'process epoch opened before producers')
    },
    close: async () => {
      const drain = deps.drain ?? defaultDrain
      const drained = await Promise.race([
        drain().then(() => true),
        new Promise<boolean>((resolve) => {
          setTimeout(() => {
            resolve(false)
          }, drainTimeoutMs)
        }),
      ])
      if (!drained) {
        log.warn({ epochId }, 'drain timed out; epoch left open for startup recovery')
        return { closed: false }
      }
      closeEpoch({ epochId, closedAtMs: nowMs() }, { getDrizzleDb: deps.getDrizzleDb })
      log.debug({ epochId }, 'process epoch closed after drain')
      return { closed: true }
    },
  }
}
