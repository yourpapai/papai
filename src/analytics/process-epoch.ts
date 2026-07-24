// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, inArray, lt } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../db/drizzle.js'
import { analyticsDailyCounters, analyticsDailyHistograms, analyticsProcessEpochs } from '../db/schema.js'
import { logger } from '../logger.js'
import { utcDayOfMs } from './aggregate.js'
import { closeEpoch, markEpochStale, openEpoch } from './storage/epoch-store.js'

const log = logger.child({ scope: 'analytics:process-epoch' })

const DAY_MS = 86_400_000
const DEFAULT_STALE_THRESHOLD_MS = 5 * 60 * 1000
const DEFAULT_DRAIN_TIMEOUT_MS = 5000
const MAX_RECOVERY_DAYS = 400

export type ProcessEpochCoordinatorDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  nowMs?: () => number
  newEpochId?: () => string
  drain?: () => Promise<void>
  drainTimeoutMs?: number
  staleThresholdMs?: number
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

const markBucketsUnreconciled = (db: ReturnType<typeof defaultGetDrizzleDb>, days: readonly string[]): void => {
  if (days.length === 0) return
  const quality = {
    restartGapDetected: true,
    reconciliationStatus: 'unreconciled_restart_gap',
    contributorCount: null,
  }
  db.update(analyticsDailyCounters)
    .set(quality)
    .where(inArray(analyticsDailyCounters.utcDay, [...days]))
    .run()
  db.update(analyticsDailyHistograms)
    .set(quality)
    .where(inArray(analyticsDailyHistograms.utcDay, [...days]))
    .run()
}

const listStaleOpenEpochs = (
  db: ReturnType<typeof defaultGetDrizzleDb>,
  cutoffMs: number,
): readonly { epochId: string; startedAtMs: number }[] =>
  db
    .select({ epochId: analyticsProcessEpochs.epochId, startedAtMs: analyticsProcessEpochs.startedAtMs })
    .from(analyticsProcessEpochs)
    .where(and(eq(analyticsProcessEpochs.state, 'open'), lt(analyticsProcessEpochs.startedAtMs, cutoffMs)))
    .all()

const runRecovery = (deps: ProcessEpochCoordinatorDeps, staleThresholdMs: number): void => {
  const db = deps.getDrizzleDb()
  const now = (deps.nowMs ?? systemNowMs)()
  const staleRows = listStaleOpenEpochs(db, now - staleThresholdMs)
  for (const row of staleRows) {
    markBucketsUnreconciled(db, daysInInterval(row.startedAtMs, now))
    markEpochStale({ epochId: row.epochId, staleAtMs: now }, { getDrizzleDb: deps.getDrizzleDb })
  }
  if (staleRows.length > 0) {
    log.info({ count: staleRows.length }, 'stale epochs recovered and buckets marked unreconciled')
  }
}

const systemNowMs = (): number => Date.now()

const defaultDrain = (): Promise<void> => Promise.resolve()

export const createProcessEpochCoordinator = (deps: ProcessEpochCoordinatorDeps): ProcessEpochCoordinator => {
  const nowMs = deps.nowMs ?? systemNowMs
  const epochId = deps.newEpochId?.() ?? `epoch-${nowMs()}`
  const staleThresholdMs = deps.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS
  const drainTimeoutMs = deps.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS

  return {
    epochId,
    recoverStaleEpochs: () => {
      runRecovery(deps, staleThresholdMs)
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
