// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { z } from 'zod'

import { FIXED_HISTOGRAM_BUCKETS_MS } from './aggregate-contract.js'
import type { AnalyticsAggregateV1 } from './aggregate-contract.js'
import type { ContributorTracker } from './aggregate-contributors.js'
import type { AnalyticsEventV1 } from './contracts.js'
import type { AggregateCounterV1, AggregateHistogramV1 } from './controlled-types.js'
import { propsByEventName } from './event-props.js'

export type AggregateIncrement =
  | Readonly<{ kind: 'counter'; metric: AggregateCounterV1; delta: number }>
  | Readonly<{ kind: 'histogram'; metric: AggregateHistogramV1; valueMs: number }>

const counter = (metric: AggregateCounterV1, delta = 1): AggregateIncrement => ({ kind: 'counter', metric, delta })
const histogram = (metric: AggregateHistogramV1, valueMs: number): AggregateIncrement => ({
  kind: 'histogram',
  metric,
  valueMs,
})

const parseWith = <S extends z.ZodType>(schema: S, props: unknown): z.infer<S> | null => {
  const parsed = schema.safeParse(props)
  return parsed.success ? parsed.data : null
}

const messageIncrements = (event: AnalyticsEventV1): readonly AggregateIncrement[] | null => {
  const name = event.event.name
  if (name === 'chat_message_accepted') return [counter('message_accepted')]
  if (name === 'auth_checked') {
    const p = parseWith(propsByEventName.auth_checked, event.props)
    return p === null ? [] : [counter(p.outcome === 'granted' ? 'auth_granted' : 'auth_denied')]
  }
  if (name === 'turn_started') {
    const p = parseWith(propsByEventName.turn_started, event.props)
    return p === null ? [] : [counter('turn_started'), histogram('queue_delay_ms', p.queue_wait_ms)]
  }
  if (name === 'turn_completed') {
    const p = parseWith(propsByEventName.turn_completed, event.props)
    if (p === null) return []
    return [
      counter(p.outcome === 'ok' ? 'turn_completed' : 'turn_failed'),
      histogram('turn_duration_ms', p.duration_ms),
    ]
  }
  if (name === 'reply_sent') {
    const p = parseWith(propsByEventName.reply_sent, event.props)
    return p === null ? [] : [histogram('time_to_first_reply_ms', p.latency_ms)]
  }
  return null
}

const executionIncrements = (event: AnalyticsEventV1): readonly AggregateIncrement[] | null => {
  const name = event.event.name
  if (name === 'llm_started') return [counter('llm_started')]
  if (name === 'llm_failed') return [counter('llm_failed')]
  if (name === 'tool_started') return [counter('tool_started')]
  if (name === 'llm_completed') {
    const p = parseWith(propsByEventName.llm_completed, event.props)
    if (p === null) return []
    return p.time_to_first_token_ms === null
      ? [counter('llm_completed')]
      : [counter('llm_completed'), histogram('time_to_first_token_ms', p.time_to_first_token_ms)]
  }
  if (name === 'tool_completed') {
    const p = parseWith(propsByEventName.tool_completed, event.props)
    if (p === null) return []
    return [
      counter(p.execution_outcome === 'semantic_success' ? 'tool_semantic_success' : 'tool_failed'),
      histogram('tool_duration_ms', p.duration_ms),
    ]
  }
  if (name === 'confirmation_resolved') {
    const p = parseWith(propsByEventName.confirmation_resolved, event.props)
    return p === null ? [] : [histogram('confirmation_latency_ms', p.decision_latency_ms)]
  }
  if (name === 'first_visible_feedback') {
    const p = parseWith(propsByEventName.first_visible_feedback, event.props)
    if (p === null || p.latency_ms === null) return []
    return [histogram('first_feedback_ms', p.latency_ms)]
  }
  return null
}

const boundaryIncrements = (event: AnalyticsEventV1): readonly AggregateIncrement[] | null => {
  const name = event.event.name
  if (name === 'rate_limit_blocked') return [counter('rate_limit_blocked')]
  if (name === 'unconfigured_reply') return [counter('unconfigured_reply')]
  if (name === 'provider_request_completed') {
    const p = parseWith(propsByEventName.provider_request_completed, event.props)
    if (p === null || p.outcome !== 'failure') return []
    return [counter('provider_failed')]
  }
  if (name === 'mcp_availability') {
    const p = parseWith(propsByEventName.mcp_availability, event.props)
    if (p === null || p.outcome === 'available') return []
    return [counter('mcp_unavailable')]
  }
  return null
}

const derivedIncrements = (event: AnalyticsEventV1): readonly AggregateIncrement[] | null => {
  if (event.event.name !== 'guest_turn_aggregate') return null
  const p = parseWith(propsByEventName.guest_turn_aggregate, event.props)
  return p === null ? [] : [counter('guest_turn', p.turns)]
}

export const incrementsForEvent = (event: AnalyticsEventV1): readonly AggregateIncrement[] =>
  messageIncrements(event) ?? executionIncrements(event) ?? boundaryIncrements(event) ?? derivedIncrements(event) ?? []

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
