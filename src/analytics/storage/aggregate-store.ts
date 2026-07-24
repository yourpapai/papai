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
} from '../../db/schema.js'
import { logger } from '../../logger.js'
import { buildQualityColumns, type DailyAggregateKey, type QualityDisclosure } from './aggregate-store-helpers.js'
import { requireOpenEpoch } from './epoch-store.js'

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
