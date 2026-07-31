// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import {
  analyticsAggregateEpochContributions,
  analyticsBackfillAggregateContributions,
  analyticsDailyCounters,
  analyticsDailyHistograms,
} from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { RetentionLimits } from '../retention/expiry-guard.js'
import { aggregateDeadlineMs } from '../retention/expiry-guard.js'
import { buildQualityColumns, type DailyAggregateKey, type QualityDisclosure } from './aggregate-store-helpers.js'
import { requireOpenEpoch } from './epoch-store.js'

export { rebuildDailyAggregatesForDays } from './aggregate-rebuild.js'
export { type MergeHistogramInput, mergeHistogram } from './aggregate-histogram-store.js'

const log = logger.child({ scope: 'analytics:storage:aggregate-store' })

export type AggregateStoreDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

export type IncrementCounterInput = DailyAggregateKey &
  QualityDisclosure & {
    aggregateCellKey?: string
    delta: number
    epochId?: string
    runId?: string
    sourceRefKey?: string
  }

const recordCounterEpochContribution = (
  tx: Tx,
  input: { epochId: string; aggregateCellKey: string; delta: number },
): void => {
  tx.insert(analyticsAggregateEpochContributions)
    .values({
      epochId: input.epochId,
      aggregateCellKey: input.aggregateCellKey,
      measureKind: 'counter',
      counterDelta: input.delta,
      sampleCountDelta: 0,
      sumDelta: 0,
      fixedBucketCountsDeltaJson: JSON.stringify([]),
    })
    .onConflictDoUpdate({
      target: [analyticsAggregateEpochContributions.epochId, analyticsAggregateEpochContributions.aggregateCellKey],
      set: {
        counterDelta: sql`${analyticsAggregateEpochContributions.counterDelta} + ${input.delta}`,
      },
    })
    .run()
}

const recordBackfillCounterContribution = (
  tx: Tx,
  input: { runId: string; aggregateCellKey: string; metric: string; delta: number; sourceRefKey: string },
): void => {
  tx.insert(analyticsBackfillAggregateContributions)
    .values({
      runId: input.runId,
      aggregateCellKey: input.aggregateCellKey,
      metric: input.metric,
      delta: input.delta,
      sourceRefKey: input.sourceRefKey,
    })
    .run()
}

const upsertDailyCounter = (tx: Tx, input: IncrementCounterInput, quality: Record<string, unknown>): void => {
  tx.insert(analyticsDailyCounters)
    .values({ ...input, ...quality, value: input.delta })
    .onConflictDoUpdate({
      target: [
        analyticsDailyCounters.utcDay,
        analyticsDailyCounters.definitionVersion,
        analyticsDailyCounters.platform,
        analyticsDailyCounters.contextType,
        analyticsDailyCounters.actorRole,
        analyticsDailyCounters.taskProvider,
        analyticsDailyCounters.appVersion,
        analyticsDailyCounters.metric,
      ],
      set: {
        value: sql`${analyticsDailyCounters.value} + ${input.delta}`,
        ...quality,
      },
    })
    .run()
}

const purgeExpiredRollupRows = (
  tx: Tx,
  table: typeof analyticsDailyCounters | typeof analyticsDailyHistograms,
  nowMs: number,
  limits: RetentionLimits,
): number => {
  const rows = tx.select({ utcDay: table.utcDay, threshold: table.threshold }).from(table).all()
  const expired = new Map<string, { utcDay: string; assessed: boolean }>()
  for (const row of rows) {
    const assessed = row.threshold !== null
    if (aggregateDeadlineMs(row.utcDay, assessed, limits) > nowMs) continue
    expired.set(`${row.utcDay}|${assessed}`, { utcDay: row.utcDay, assessed })
  }
  let removed = 0
  for (const group of expired.values()) {
    const filter = group.assessed
      ? sql`${table.utcDay} = ${group.utcDay} AND ${table.threshold} IS NOT NULL`
      : sql`${table.utcDay} = ${group.utcDay} AND ${table.threshold} IS NULL`
    const count = tx.select({ utcDay: table.utcDay }).from(table).where(filter).all().length
    if (count === 0) continue
    tx.delete(table).where(filter).run()
    removed += count
  }
  return removed
}

export const purgeExpiredAggregatesIn = (
  tx: Tx,
  input: Readonly<{ nowMs: number; limits: RetentionLimits }>,
): number => {
  const counters = purgeExpiredRollupRows(tx, analyticsDailyCounters, input.nowMs, input.limits)
  const histograms = purgeExpiredRollupRows(tx, analyticsDailyHistograms, input.nowMs, input.limits)
  const removed = counters + histograms
  if (removed > 0) log.info({ counters, histograms }, 'expired daily rollups removed')
  return removed
}

export const incrementCounter = (
  input: IncrementCounterInput,
  deps: AggregateStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  if (input.epochId !== undefined) {
    requireOpenEpoch({ epochId: input.epochId }, { getDrizzleDb: deps.getDrizzleDb })
  }

  const db = deps.getDrizzleDb()
  const quality = buildQualityColumns(input)

  db.transaction((tx: Tx) => {
    upsertDailyCounter(tx, input, quality)

    if (input.epochId !== undefined && input.aggregateCellKey !== undefined) {
      recordCounterEpochContribution(tx, {
        epochId: input.epochId,
        aggregateCellKey: input.aggregateCellKey,
        delta: input.delta,
      })
    }

    if (input.runId !== undefined && input.aggregateCellKey !== undefined && input.sourceRefKey !== undefined) {
      recordBackfillCounterContribution(tx, {
        runId: input.runId,
        aggregateCellKey: input.aggregateCellKey,
        metric: input.metric,
        delta: input.delta,
        sourceRefKey: input.sourceRefKey,
      })
    }
  })

  log.debug({ ...input }, 'counter incremented')
}
