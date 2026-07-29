// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { FIXED_HISTOGRAM_BUCKETS_MS } from './aggregate-contract.js'
import type { AnalyticsAggregateV1 } from './aggregate-contract.js'
import type { ContributorTracker } from './aggregate-contributors.js'
import { type AggregateIncrement, incrementsForEvent } from './aggregate-increments.js'
import type { AnalyticsEventV1 } from './contracts.js'
import type { AggregateCounterV1, AggregateHistogramV1 } from './controlled-types.js'

export { incrementsForEvent } from './aggregate-increments.js'
export type { AggregateIncrement } from './aggregate-increments.js'

export const histogramBucketIndex = (valueMs: number): number => {
  let index = 0
  FIXED_HISTOGRAM_BUCKETS_MS.forEach((boundary, i) => {
    if (valueMs >= boundary) index = i
  })
  return index
}

export const utcDayOfMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

type Dimensions = AnalyticsAggregateV1['dimensions']
type ContributorBasis = AnalyticsAggregateV1['disclosure']['contributor_basis']
type CounterCell = {
  day: string
  dimensions: Dimensions
  metric: AggregateCounterV1
  value: number
  basis: ContributorBasis
}
type HistogramCell = {
  day: string
  dimensions: Dimensions
  metric: AggregateHistogramV1
  counts: number[]
  sum: number
  sampleCount: number
  basis: ContributorBasis
}

export type DailyAggregator = Readonly<{
  apply: (event: AnalyticsEventV1) => 'applied' | 'late'
  finalize: (utcDay: string, opts: Readonly<{ restartGap: boolean }>) => readonly AnalyticsAggregateV1[]
  lateEventCount: (utcDay: string) => number
}>

export const aggregateDimensionsOf = (event: AnalyticsEventV1): Dimensions => ({
  platform: event.identity.platform,
  context_type: event.context.context_type,
  actor_role: event.context.actor_role,
  task_provider: event.context.task_provider,
  app_version: event.app.version,
})

const basisOf = (metric: string): ContributorBasis => (metric === 'guest_turn' ? 'context' : 'eligible_actor')

export const contributorBasisForMetric = (metric: string): ContributorBasis => basisOf(metric)

export const contributorKeyForIncrement = (inc: AggregateIncrement, event: AnalyticsEventV1): string | null =>
  basisOf(inc.metric) === 'context' ? event.identity.context_key : event.identity.actor_key

const buildRecord = (
  cell: { day: string; dimensions: Dimensions; basis: ContributorBasis },
  measure: AnalyticsAggregateV1['measure'],
  contributorCount: number | null,
  restartGap: boolean,
  lateEventCount: number,
): AnalyticsAggregateV1 => ({
  schema: { name: 'papai.analytics.aggregate', version: 1 },
  bucket: { utc_day: cell.day, definition_version: 1, finalized: true },
  dimensions: cell.dimensions,
  measure,
  quality: {
    source: 'live',
    partial_day: false,
    restart_gap_detected: restartGap,
    reconciliation: restartGap ? 'unreconciled_restart_gap' : 'complete_epoch',
    late_event_count: lateEventCount,
  },
  disclosure: {
    scope: 'local_only',
    contributor_basis: cell.basis,
    contributor_count: contributorCount,
    threshold: null,
  },
})

type AggregatorState = {
  counters: Map<string, CounterCell>
  histograms: Map<string, HistogramCell>
  lateCounts: Map<string, number>
  finalizedDays: Set<string>
}

const accumulate = (
  state: AggregatorState,
  tracker: ContributorTracker,
  day: string,
  dims: Dimensions,
  inc: AggregateIncrement,
  event: AnalyticsEventV1,
): void => {
  const cellKey = `${day}|${JSON.stringify(dims)}|${inc.metric}`
  const basis = basisOf(inc.metric)
  const contributor = contributorKeyForIncrement(inc, event)
  if (contributor !== null) tracker.record(day, cellKey, contributor)
  if (inc.kind === 'counter') {
    const cell = state.counters.get(cellKey) ?? { day, dimensions: dims, metric: inc.metric, value: 0, basis }
    cell.value += inc.delta
    state.counters.set(cellKey, cell)
    return
  }
  const cell = state.histograms.get(cellKey) ?? {
    day,
    dimensions: dims,
    metric: inc.metric,
    counts: FIXED_HISTOGRAM_BUCKETS_MS.map(() => 0),
    sum: 0,
    sampleCount: 0,
    basis,
  }
  const bucketIndex = histogramBucketIndex(inc.valueMs)
  cell.counts[bucketIndex] = (cell.counts[bucketIndex] ?? 0) + 1
  cell.sum += inc.valueMs
  cell.sampleCount += 1
  state.histograms.set(cellKey, cell)
}

const histogramMeasure = (cell: HistogramCell): AnalyticsAggregateV1['measure'] => ({
  kind: 'histogram',
  metric: cell.metric,
  fixed_buckets: [...FIXED_HISTOGRAM_BUCKETS_MS],
  counts: cell.counts,
  sum: cell.sum,
  sample_count: cell.sampleCount,
})

const finalizeDay = (
  state: AggregatorState,
  tracker: ContributorTracker,
  utcDay: string,
  opts: Readonly<{ restartGap: boolean }>,
): readonly AnalyticsAggregateV1[] => {
  const records: AnalyticsAggregateV1[] = []
  const late = state.lateCounts.get(utcDay) ?? 0
  for (const [key, cell] of state.counters) {
    if (cell.day !== utcDay) continue
    const count = opts.restartGap ? null : tracker.count(utcDay, key)
    records.push(
      buildRecord(cell, { kind: 'counter', metric: cell.metric, value: cell.value }, count, opts.restartGap, late),
    )
    state.counters.delete(key)
  }
  for (const [key, cell] of state.histograms) {
    if (cell.day !== utcDay) continue
    const count = opts.restartGap ? null : tracker.count(utcDay, key)
    records.push(buildRecord(cell, histogramMeasure(cell), count, opts.restartGap, late))
    state.histograms.delete(key)
  }
  tracker.clear(utcDay)
  state.finalizedDays.add(utcDay)
  return records
}

const applyEvent = (
  state: AggregatorState,
  tracker: ContributorTracker,
  event: AnalyticsEventV1,
): 'applied' | 'late' => {
  const day = utcDayOfMs(event.event.occurred_at_ms)
  if (state.finalizedDays.has(day)) {
    state.lateCounts.set(day, (state.lateCounts.get(day) ?? 0) + 1)
    return 'late'
  }
  incrementsForEvent(event).forEach((inc) => {
    accumulate(state, tracker, day, aggregateDimensionsOf(event), inc, event)
  })
  return 'applied'
}

export { createContributorTracker } from './aggregate-contributors.js'
export type { ContributorTracker } from './aggregate-contributors.js'

export const createDailyAggregator = (deps: Readonly<{ tracker: ContributorTracker }>): DailyAggregator => {
  const state: AggregatorState = {
    counters: new Map<string, CounterCell>(),
    histograms: new Map<string, HistogramCell>(),
    lateCounts: new Map<string, number>(),
    finalizedDays: new Set<string>(),
  }
  return {
    apply: (event) => applyEvent(state, deps.tracker, event),
    finalize: (utcDay, opts) => finalizeDay(state, deps.tracker, utcDay, opts),
    lateEventCount: (utcDay) => state.lateCounts.get(utcDay) ?? 0,
  }
}
