// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AnalyticsAggregateV1 } from './aggregate-contract.js'
import { aggregateDimensionsOf, contributorKeyForIncrement, incrementsForEvent, utcDayOfMs } from './aggregate.js'
import type { AggregateIncrement } from './aggregate.js'
import type { AnalyticsEventV1 } from './contracts.js'
import type { CollectionEligibilityRef, DeliveryGrantRef, EligibilityDecision } from './governance/eligibility.js'
import { normalize } from './normalizer.js'
import type { NormalizerEnv } from './normalizer.js'
import type { AnalyticsSourceFact } from './source-facts.js'

const DEFAULT_QUEUE_CAPACITY = 1024

export type AnalyticsObserver = Readonly<{
  observe: (fact: AnalyticsSourceFact) => void
  flush: () => Promise<void>
  stop: () => Promise<void>
}>

export type QueuedPseudonymousEvent = Readonly<{
  event: AnalyticsEventV1
  collectionRef: CollectionEligibilityRef
  deliveryGrant: DeliveryGrantRef | null
}>

export type QueuedAggregateIncrement = Readonly<{
  increment: AggregateIncrement
  utcDay: string
  contributorKey: string | null
  dimensions: AnalyticsAggregateV1['dimensions']
}>

export type RuntimeSinks = Readonly<{
  writeEvents: (items: readonly QueuedPseudonymousEvent[]) => void | Promise<void>
  writeAggregates: (items: readonly QueuedAggregateIncrement[]) => void | Promise<void>
}>

export type AnalyticsHealthCounter = 'queue_full' | 'observer_failure' | 'normalization_rejection'

export type AnalyticsRuntimeHealth = Readonly<{
  increment: (counter: AnalyticsHealthCounter) => void
}>

export type AnalyticsRuntimeLog = Readonly<{
  warn: (meta: Record<string, unknown>, message: string) => void
}>

export type NormalizationRejection = Readonly<{
  utcDay: string
  sourceEventType: string
  reason: string
}>

export type AnalyticsRuntimeDeps = Readonly<{
  decide: (fact: AnalyticsSourceFact) => EligibilityDecision
  normalizerEnv: () => NormalizerEnv | null
  health: AnalyticsRuntimeHealth
  log: AnalyticsRuntimeLog
  sinks: RuntimeSinks
  queueCapacity?: number
  /**
   * Durable controlled-overflow binding: invoked once per dropped item with
   * the dropped item's UTC day so the exact overflow count lands on the open
   * process epoch instead of a process-global implicit counter.
   */
  onControlledOverflow?: (utcDay: string) => void
  /**
   * Durable rejection accounting: invoked once per dropped fact with the
   * bounded (utc_day, source_event_type, reason) triple so live-lane
   * normalization rejections land in the same rejection store the backfill
   * lane uses. Must never throw; failures degrade to `observer_failure`.
   */
  onNormalizationRejection?: (rejection: NormalizationRejection) => void
}>

const isPseudonymousLane = (decision: EligibilityDecision): boolean =>
  decision.allowed && (decision.lane === 'local_pseudonymous' || decision.lane === 'external_pseudonymous')

const classifyError = (error: unknown): string => {
  if (error instanceof Error) return error.constructor.name
  return 'non_error'
}

const enqueue = <T>(queue: T[], item: T, capacity: number, health: AnalyticsRuntimeHealth): boolean => {
  if (queue.length >= capacity) {
    health.increment('queue_full')
    return false
  }
  queue.push(item)
  return true
}

const aggregateItemFor = (event: AnalyticsEventV1, increment: AggregateIncrement): QueuedAggregateIncrement => ({
  increment,
  utcDay: utcDayOfMs(event.event.occurred_at_ms),
  contributorKey: contributorKeyForIncrement(increment, event),
  dimensions: aggregateDimensionsOf(event),
})

const routePseudonymous = (
  fact: AnalyticsSourceFact,
  event: AnalyticsEventV1,
  decision: Extract<EligibilityDecision, { allowed: true }>,
  queue: QueuedPseudonymousEvent[],
  capacity: number,
  deps: AnalyticsRuntimeDeps,
): void => {
  if (decision.collectionEligibility === null) {
    deps.health.increment('observer_failure')
    deps.log.warn({ factType: fact.type, lane: decision.lane }, 'pseudonymous decision missing collection ref')
    return
  }
  const enqueued = enqueue(
    queue,
    { event, collectionRef: decision.collectionEligibility, deliveryGrant: decision.deliveryGrant },
    capacity,
    deps.health,
  )
  if (!enqueued) deps.onControlledOverflow?.(utcDayOfMs(event.event.occurred_at_ms))
}

export type SubjectWithdrawalHook = (identity: Readonly<{ platformInstanceId: string; platformUserId: string }>) => void

/**
 * Production caller for the rephrase handoff's `withdrawFor`: authenticated
 * preference withdrawal drives rephrase feature-set withdrawal through this
 * hook so the in-memory rephrase state is dropped together with the durable
 * analytics withdrawal.
 */
export const createSubjectWithdrawalHook = (
  rephrase: Readonly<{ withdrawFor: (platformInstanceId: string, platformUserId: string) => void }> | null,
): SubjectWithdrawalHook => {
  return (identity) => {
    rephrase?.withdrawFor(identity.platformInstanceId, identity.platformUserId)
  }
}

const recordRejection = (deps: AnalyticsRuntimeDeps, rejection: NormalizationRejection): void => {
  deps.health.increment('normalization_rejection')
  try {
    deps.onNormalizationRejection?.(rejection)
  } catch (error) {
    deps.health.increment('observer_failure')
    deps.log.warn({ errorClass: classifyError(error) }, 'normalization rejection accounting failed')
  }
}

const normalizeFact = (fact: AnalyticsSourceFact, deps: AnalyticsRuntimeDeps): AnalyticsEventV1 | null => {
  const rejectionBase = { utcDay: utcDayOfMs(fact.occurredAtMs) }
  const env = deps.normalizerEnv()
  if (env === null) {
    recordRejection(deps, { ...rejectionBase, sourceEventType: fact.type, reason: 'normalizer_unavailable' })
    return null
  }
  const result = normalize(fact, env)
  if (result.status !== 'ok') {
    recordRejection(deps, { ...rejectionBase, sourceEventType: result.sourceEventType, reason: result.reason })
    return null
  }
  return result.event
}

export const createAnalyticsObserver = (deps: AnalyticsRuntimeDeps): AnalyticsObserver => {
  const capacity = deps.queueCapacity ?? DEFAULT_QUEUE_CAPACITY
  const eventQueue: QueuedPseudonymousEvent[] = []
  const aggregateQueue: QueuedAggregateIncrement[] = []
  let stopped = false

  const route = (fact: AnalyticsSourceFact): void => {
    const decision = deps.decide(fact)
    if (!decision.allowed) return
    const event = normalizeFact(fact, deps)
    if (event === null) return
    incrementsForEvent(event).forEach((increment) => {
      const item = aggregateItemFor(event, increment)
      if (!enqueue(aggregateQueue, item, capacity, deps.health)) deps.onControlledOverflow?.(item.utcDay)
    })
    if (isPseudonymousLane(decision)) routePseudonymous(fact, event, decision, eventQueue, capacity, deps)
  }

  const drain = async (): Promise<void> => {
    const aggregates = aggregateQueue.splice(0, aggregateQueue.length)
    const events = eventQueue.splice(0, eventQueue.length)
    try {
      if (aggregates.length > 0) await deps.sinks.writeAggregates(aggregates)
      if (events.length > 0) await deps.sinks.writeEvents(events)
    } catch (error) {
      deps.health.increment('observer_failure')
      deps.log.warn({ errorClass: classifyError(error) }, 'analytics sink write failed')
    }
  }

  return {
    observe: (fact) => {
      if (stopped) return
      try {
        route(fact)
      } catch (error) {
        deps.health.increment('observer_failure')
        deps.log.warn({ factType: fact.type, errorClass: classifyError(error) }, 'analytics fact rejected')
      }
    },
    flush: drain,
    stop: async () => {
      stopped = true
      await drain()
    },
  }
}
