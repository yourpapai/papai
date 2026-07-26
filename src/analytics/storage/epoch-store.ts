// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq, inArray, sql } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import {
  analyticsDailyCounters,
  analyticsDailyHistograms,
  analyticsEpochSourceCounters,
  analyticsProcessEpochs,
} from '../../db/schema.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'analytics:storage:epoch-store' })

export type EpochStoreDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

type EpochState = 'open' | 'closed' | 'stale_open'

const DEFAULT_STALE_THRESHOLD_MS = 5 * 60 * 1000

const isEpochState = (value: string): value is EpochState =>
  value === 'open' || value === 'closed' || value === 'stale_open'

export const openEpoch = (
  input: { epochId: string; startedAtMs: number },
  deps: EpochStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  const db = deps.getDrizzleDb()
  db.insert(analyticsProcessEpochs)
    .values({ epochId: input.epochId, state: 'open', startedAtMs: input.startedAtMs })
    .run()
  log.debug({ epochId: input.epochId, startedAtMs: input.startedAtMs }, 'epoch opened')
}

export const getEpochState = (
  input: { epochId: string },
  deps: EpochStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): { state: EpochState } | undefined => {
  const db = deps.getDrizzleDb()
  const row = db
    .select({ state: analyticsProcessEpochs.state })
    .from(analyticsProcessEpochs)
    .where(eq(analyticsProcessEpochs.epochId, input.epochId))
    .get()
  if (row === undefined || !isEpochState(row.state)) return undefined
  return { state: row.state }
}

export const requireOpenEpoch = (
  input: { epochId: string },
  deps: EpochStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  const state = getEpochState(input, deps)?.state
  if (state !== 'open') {
    log.warn({ epochId: input.epochId, state }, 'event/aggregate rejected: epoch not open')
    throw new Error(`Epoch ${input.epochId} is not open (state=${state ?? 'missing'})`)
  }
}

export const closeEpoch = (
  input: { epochId: string; closedAtMs: number },
  deps: EpochStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  const db = deps.getDrizzleDb()
  const existing = getEpochState(input, deps)
  if (existing === undefined) {
    throw new Error(`Epoch ${input.epochId} not found`)
  }
  if (existing.state === 'closed') {
    const row = db
      .select({ closedAtMs: analyticsProcessEpochs.closedAtMs })
      .from(analyticsProcessEpochs)
      .where(eq(analyticsProcessEpochs.epochId, input.epochId))
      .get()
    if (typeof row?.closedAtMs === 'number' && input.closedAtMs < row.closedAtMs) {
      throw new Error(`closed_at_ms must be monotonic for epoch ${input.epochId}`)
    }
  }
  db.update(analyticsProcessEpochs)
    .set({ state: 'closed', closedAtMs: input.closedAtMs })
    .where(eq(analyticsProcessEpochs.epochId, input.epochId))
    .run()
  log.debug({ epochId: input.epochId, closedAtMs: input.closedAtMs }, 'epoch closed')
}

export const markEpochStale = (
  input: { epochId: string; staleAtMs: number },
  deps: EpochStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  const db = deps.getDrizzleDb()
  db.update(analyticsProcessEpochs)
    .set({ state: 'stale_open', staleMarkedAtMs: input.staleAtMs })
    .where(eq(analyticsProcessEpochs.epochId, input.epochId))
    .run()
  log.debug({ epochId: input.epochId, staleAtMs: input.staleAtMs }, 'epoch marked stale')
}

export const markOpenEpochsStaleOnStartup = (
  input: { nowMs: number; staleThresholdMs?: number },
  deps: EpochStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  const db = deps.getDrizzleDb()
  const threshold = input.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS
  const cutoff = input.nowMs - threshold
  const staleRows = db
    .select({ epochId: analyticsProcessEpochs.epochId, startedAtMs: analyticsProcessEpochs.startedAtMs })
    .from(analyticsProcessEpochs)
    .where(eq(analyticsProcessEpochs.state, 'open'))
    .all()
    .filter((row) => row.startedAtMs < cutoff)
  for (const row of staleRows) {
    markEpochStale({ epochId: row.epochId, staleAtMs: input.nowMs }, deps)
  }
  log.info({ count: staleRows.length, threshold }, 'startup stale epoch reconciliation complete')
}

const VALID_DISPOSITIONS = new Set([
  'opportunity',
  'canonical',
  'normalization_reject',
  'governance_ineligible',
  'aggregate_only',
  'controlled_overflow',
])

export const incrementEpochSourceCounter = (
  input: { epochId: string; utcDay: string; sourceFamily: string; disposition: string; value?: number },
  deps: EpochStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  if (!VALID_DISPOSITIONS.has(input.disposition)) {
    throw new Error(`Invalid disposition: ${input.disposition}`)
  }
  const db = deps.getDrizzleDb()
  const value = input.value ?? 1
  db.insert(analyticsEpochSourceCounters)
    .values({
      epochId: input.epochId,
      utcDay: input.utcDay,
      sourceFamily: input.sourceFamily,
      disposition: input.disposition,
      value,
    })
    .onConflictDoUpdate({
      target: [
        analyticsEpochSourceCounters.epochId,
        analyticsEpochSourceCounters.utcDay,
        analyticsEpochSourceCounters.sourceFamily,
        analyticsEpochSourceCounters.disposition,
      ],
      set: { value: sql`${analyticsEpochSourceCounters.value} + ${value}` },
    })
    .run()
  log.debug({ ...input, value }, 'epoch source counter incremented')
}

export type ProcessEpochSummary = Readonly<{
  epochId: string
  state: EpochState
  startedAtMs: number
  closedAtMs: number | null
  staleMarkedAtMs: number | null
}>

export const listProcessEpochs = (
  deps: EpochStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): readonly ProcessEpochSummary[] =>
  deps
    .getDrizzleDb()
    .select()
    .from(analyticsProcessEpochs)
    .all()
    .flatMap((row) =>
      isEpochState(row.state)
        ? [
            {
              epochId: row.epochId,
              state: row.state,
              startedAtMs: row.startedAtMs,
              closedAtMs: row.closedAtMs,
              staleMarkedAtMs: row.staleMarkedAtMs,
            },
          ]
        : [],
    )

export type EpochSourceCounterSummary = Readonly<{
  utcDay: string
  sourceFamily: string
  disposition: string
  value: number
}>

export const listEpochSourceCounters = (
  input: { epochId: string },
  deps: EpochStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): readonly EpochSourceCounterSummary[] =>
  deps
    .getDrizzleDb()
    .select()
    .from(analyticsEpochSourceCounters)
    .where(eq(analyticsEpochSourceCounters.epochId, input.epochId))
    .all()
    .map((row) => ({
      utcDay: row.utcDay,
      sourceFamily: row.sourceFamily,
      disposition: row.disposition,
      value: row.value,
    }))

export const markRestartGapBuckets = (
  input: { utcDays: readonly string[] },
  deps: EpochStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  if (input.utcDays.length === 0) return
  const db = deps.getDrizzleDb()
  const gap = {
    finalized: false,
    restartGapDetected: true,
    reconciliationStatus: 'unreconciled_restart_gap',
    contributorCount: null,
  }
  db.update(analyticsDailyCounters)
    .set(gap)
    .where(inArray(analyticsDailyCounters.utcDay, [...input.utcDays]))
    .run()
  db.update(analyticsDailyHistograms)
    .set(gap)
    .where(inArray(analyticsDailyHistograms.utcDay, [...input.utcDays]))
    .run()
  log.info({ days: input.utcDays.length }, 'buckets marked as unreconciled restart gap')
}
