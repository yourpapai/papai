// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import {
  analyticsAggregateEpochContributions,
  analyticsBackfillAggregateContributions,
  analyticsDailyHistograms,
} from '../../db/schema.js'
import { logger } from '../../logger.js'
import { FIXED_HISTOGRAM_BUCKETS_MS } from '../aggregate-contract.js'
import {
  arraysEqual,
  buildQualityColumns,
  type DailyAggregateKey,
  type QualityDisclosure,
} from './aggregate-store-helpers.js'
import { recordLiveAggregateDisposition } from './epoch-source-counters.js'
import { requireOpenEpoch } from './epoch-store.js'

const log = logger.child({ scope: 'analytics:storage:aggregate-histogram-store' })

export type AggregateHistogramStoreDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

export type MergeHistogramInput = DailyAggregateKey &
  QualityDisclosure & {
    aggregateCellKey?: string
    fixedBuckets: readonly number[]
    counts: readonly number[]
    sum: number
    sampleCount: number
    epochId?: string
    runId?: string
    sourceRefKey?: string
  }

const FixedBucketCountsSchema = z.array(z.number().int().nonnegative()).length(FIXED_HISTOGRAM_BUCKETS_MS.length)

const parseFixedBucketCounts = (value: string, label: string): number[] => {
  const parsed: unknown = JSON.parse(value)
  const result = FixedBucketCountsSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `Invalid ${label} JSON: expected ${FIXED_HISTOGRAM_BUCKETS_MS.length} non-negative integer bucket counts`,
    )
  }
  return result.data
}

const validateBucketCounts = (counts: readonly number[]): number[] => {
  const result = FixedBucketCountsSchema.safeParse([...counts])
  if (!result.success) {
    throw new Error(
      `Invalid histogram counts: expected ${FIXED_HISTOGRAM_BUCKETS_MS.length} non-negative integer bucket counts`,
    )
  }
  return result.data
}

const findExistingContribution = (
  tx: Tx,
  epochId: string,
  aggregateCellKey: string,
): { fixedBucketCountsDeltaJson: string } | undefined =>
  tx
    .select({ fixedBucketCountsDeltaJson: analyticsAggregateEpochContributions.fixedBucketCountsDeltaJson })
    .from(analyticsAggregateEpochContributions)
    .where(
      and(
        eq(analyticsAggregateEpochContributions.epochId, epochId),
        eq(analyticsAggregateEpochContributions.aggregateCellKey, aggregateCellKey),
      ),
    )
    .get()

const buildMergedBucketCounts = (existingJson: string, deltaCounts: readonly number[]): number[] => {
  const existing = parseFixedBucketCounts(existingJson, 'fixedBucketCountsDeltaJson')
  return existing.map((value, index) => value + (deltaCounts[index] ?? 0))
}

const insertHistogramContribution = (
  tx: Tx,
  input: { epochId: string; aggregateCellKey: string; sampleCount: number; sum: number },
  counts: number[],
): void => {
  tx.insert(analyticsAggregateEpochContributions)
    .values({
      epochId: input.epochId,
      aggregateCellKey: input.aggregateCellKey,
      measureKind: 'histogram',
      counterDelta: 0,
      sampleCountDelta: input.sampleCount,
      sumDelta: input.sum,
      fixedBucketCountsDeltaJson: JSON.stringify(counts),
    })
    .run()
}

const updateHistogramContribution = (
  tx: Tx,
  input: { epochId: string; aggregateCellKey: string; sampleCount: number; sum: number },
  counts: number[],
): void => {
  tx.update(analyticsAggregateEpochContributions)
    .set({
      sampleCountDelta: sql`${analyticsAggregateEpochContributions.sampleCountDelta} + ${input.sampleCount}`,
      sumDelta: sql`${analyticsAggregateEpochContributions.sumDelta} + ${input.sum}`,
      fixedBucketCountsDeltaJson: JSON.stringify(counts),
    })
    .where(
      and(
        eq(analyticsAggregateEpochContributions.epochId, input.epochId),
        eq(analyticsAggregateEpochContributions.aggregateCellKey, input.aggregateCellKey),
      ),
    )
    .run()
}

const recordHistogramEpochContribution = (
  tx: Tx,
  input: { epochId: string; aggregateCellKey: string; sampleCount: number; sum: number; counts: readonly number[] },
): void => {
  const inputCounts = validateBucketCounts(input.counts)
  const existing = findExistingContribution(tx, input.epochId, input.aggregateCellKey)
  if (existing === undefined) {
    insertHistogramContribution(tx, input, inputCounts)
    return
  }
  const mergedCounts = buildMergedBucketCounts(existing.fixedBucketCountsDeltaJson, inputCounts)
  updateHistogramContribution(tx, input, mergedCounts)
}

const findExistingHistogram = (
  tx: Tx,
  input: MergeHistogramInput,
): typeof analyticsDailyHistograms.$inferSelect | undefined =>
  tx
    .select()
    .from(analyticsDailyHistograms)
    .where(
      and(
        eq(analyticsDailyHistograms.utcDay, input.utcDay),
        eq(analyticsDailyHistograms.definitionVersion, input.definitionVersion),
        eq(analyticsDailyHistograms.metric, input.metric),
        eq(analyticsDailyHistograms.platform, input.platform),
        eq(analyticsDailyHistograms.contextType, input.contextType),
        eq(analyticsDailyHistograms.actorRole, input.actorRole),
        eq(analyticsDailyHistograms.taskProvider, input.taskProvider),
        eq(analyticsDailyHistograms.appVersion, input.appVersion),
      ),
    )
    .get()

const insertHistogram = (tx: Tx, input: MergeHistogramInput, quality: Record<string, unknown>): void => {
  tx.insert(analyticsDailyHistograms)
    .values({
      ...input,
      ...quality,
      fixedBucketsJson: JSON.stringify([...input.fixedBuckets]),
      countsJson: JSON.stringify([...input.counts]),
    })
    .run()
}

const updateHistogram = (
  tx: Tx,
  input: MergeHistogramInput,
  existing: typeof analyticsDailyHistograms.$inferSelect,
  quality: Record<string, unknown>,
): void => {
  const existingBuckets = parseFixedBucketCounts(existing.fixedBucketsJson, 'fixedBucketsJson')
  if (!arraysEqual(existingBuckets, [...input.fixedBuckets])) {
    throw new Error('Histogram bucket layout mismatch on merge')
  }
  const existingCounts = parseFixedBucketCounts(existing.countsJson, 'countsJson')
  const mergedCounts = existingCounts.map((value, index) => value + (input.counts[index] ?? 0))
  tx.update(analyticsDailyHistograms)
    .set({
      countsJson: JSON.stringify(mergedCounts),
      sum: existing.sum + input.sum,
      sampleCount: existing.sampleCount + input.sampleCount,
      ...quality,
    })
    .where(
      and(
        eq(analyticsDailyHistograms.utcDay, input.utcDay),
        eq(analyticsDailyHistograms.definitionVersion, input.definitionVersion),
        eq(analyticsDailyHistograms.metric, input.metric),
        eq(analyticsDailyHistograms.platform, input.platform),
        eq(analyticsDailyHistograms.contextType, input.contextType),
        eq(analyticsDailyHistograms.actorRole, input.actorRole),
        eq(analyticsDailyHistograms.taskProvider, input.taskProvider),
        eq(analyticsDailyHistograms.appVersion, input.appVersion),
      ),
    )
    .run()
}

const recordEpochAccounting = (tx: Tx, input: MergeHistogramInput): void => {
  if (input.epochId === undefined || input.aggregateCellKey === undefined) return
  recordHistogramEpochContribution(tx, {
    epochId: input.epochId,
    aggregateCellKey: input.aggregateCellKey,
    sampleCount: input.sampleCount,
    sum: input.sum,
    counts: input.counts,
  })
  if (input.runId === undefined) {
    recordLiveAggregateDisposition(tx, { epochId: input.epochId, utcDay: input.utcDay, value: input.sampleCount })
  }
}

export const mergeHistogram = (
  input: MergeHistogramInput,
  deps: AggregateHistogramStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  if (input.epochId !== undefined) {
    requireOpenEpoch({ epochId: input.epochId }, { getDrizzleDb: deps.getDrizzleDb })
  }
  if (!arraysEqual(input.fixedBuckets, FIXED_HISTOGRAM_BUCKETS_MS)) {
    throw new Error('Histogram bucket layout does not match registered fixed buckets')
  }

  const db = deps.getDrizzleDb()
  const quality = buildQualityColumns(input)

  db.transaction((tx: Tx) => {
    const existing = findExistingHistogram(tx, input)
    if (existing === undefined) {
      insertHistogram(tx, input, quality)
    } else {
      updateHistogram(tx, input, existing, quality)
    }

    recordEpochAccounting(tx, input)

    if (input.runId !== undefined && input.aggregateCellKey !== undefined && input.sourceRefKey !== undefined) {
      tx.insert(analyticsBackfillAggregateContributions)
        .values({
          runId: input.runId,
          aggregateCellKey: input.aggregateCellKey,
          metric: input.metric,
          delta: input.sampleCount,
          sourceRefKey: input.sourceRefKey,
        })
        .run()
    }
  })

  log.debug({ ...input }, 'histogram merged')
}
