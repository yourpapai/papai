// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsAggregateEpochContributions, analyticsDeliveries, analyticsEvents } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { utcDayOfMs } from '../aggregate.js'
import { resolveActive } from '../governance/generation-store.js'
import type { RekeyCutoverFence } from '../rekey/cutover-fence.js'
import { listEpochSourceCounters, listProcessEpochs, markRestartGapBuckets } from '../storage/epoch-store.js'
import { reconcileDurableUsage } from './reconcile-durable.js'
import type { DurableSourceDayRow, DurableUsageReport } from './reconcile-durable.js'

export type { DurableSourceDayRow, DurableUsageReport }

const log = logger.child({ scope: 'analytics:jobs:reconcile' })

type Db = ReturnType<typeof defaultGetDrizzleDb>

const DAY_MS = 86_400_000

export type LiveEpochReport = Readonly<{
  epochId: string
  state: string
  status: 'publishable' | 'delta' | 'unreconciled_restart_gap'
  unexplainedDelta: number
  gapDays: readonly string[]
  publishableTotal: number | null
}>

export type DeliveryReport = Readonly<{
  total: number
  uniquePairs: number
  byState: Readonly<Record<string, number>>
  excludedNonActiveGeneration: number
  conserved: boolean
}>

export type ReconciliationReport = Readonly<{
  status: 'reconciled' | 'gap' | 'delta'
  durableUsage: DurableUsageReport
  liveEpochs: readonly LiveEpochReport[]
  delivery: DeliveryReport
  associationViolations: number
  eventsByName: Readonly<Record<string, number>>
  eventsByAttributionQuality: Readonly<Record<string, number>>
}>

export type ReconcileDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  fence?: RekeyCutoverFence
}>

const TERMINAL_DISPOSITIONS = new Set([
  'canonical',
  'normalization_reject',
  'governance_ineligible',
  'aggregate_only',
  'controlled_overflow',
])

const daysBetween = (startMs: number, endMs: number): string[] => {
  const days: string[] = []
  let cursor = Math.floor(startMs / DAY_MS) * DAY_MS
  const end = Math.floor(endMs / DAY_MS) * DAY_MS
  while (cursor <= end) {
    days.push(utcDayOfMs(cursor))
    cursor += DAY_MS
  }
  return days
}

const bump = (map: Record<string, number>, key: string): void => {
  map[key] = (map[key] ?? 0) + 1
}

type EpochSummary = ReturnType<typeof listProcessEpochs>[number]

const reconcileClosedEpoch = (db: Db, epoch: EpochSummary, activeGeneration: string): LiveEpochReport => {
  const counters = listEpochSourceCounters({ epochId: epoch.epochId }, { getDrizzleDb: () => db })
  const groups = new Map<string, { opportunity: number; terminal: number }>()
  let canonicalDispositions = 0
  let aggregateDispositions = 0
  let opportunityTotal = 0
  for (const counter of counters) {
    const key = `${counter.utcDay}|${counter.sourceFamily}`
    const group = groups.get(key) ?? { opportunity: 0, terminal: 0 }
    if (counter.disposition === 'opportunity') {
      group.opportunity += counter.value
      opportunityTotal += counter.value
    } else if (TERMINAL_DISPOSITIONS.has(counter.disposition)) {
      group.terminal += counter.value
    }
    if (counter.disposition === 'canonical') canonicalDispositions += counter.value
    if (counter.disposition === 'aggregate_only') aggregateDispositions += counter.value
    groups.set(key, group)
  }
  let delta = 0
  for (const group of groups.values()) delta += Math.abs(group.opportunity - group.terminal)
  const canonicalEvents = db
    .select({ eventId: analyticsEvents.eventId })
    .from(analyticsEvents)
    .where(
      and(eq(analyticsEvents.processEpochId, epoch.epochId), eq(analyticsEvents.storageGeneration, activeGeneration)),
    )
    .all().length
  delta += Math.abs(canonicalDispositions - canonicalEvents)
  const contributions = db
    .select()
    .from(analyticsAggregateEpochContributions)
    .where(eq(analyticsAggregateEpochContributions.epochId, epoch.epochId))
    .all()
  const contributionIncrements = contributions.reduce((sum, row) => sum + row.counterDelta + row.sampleCountDelta, 0)
  delta += Math.abs(aggregateDispositions - contributionIncrements)
  return {
    epochId: epoch.epochId,
    state: epoch.state,
    status: delta === 0 ? 'publishable' : 'delta',
    unexplainedDelta: delta,
    gapDays: [],
    publishableTotal: delta === 0 ? opportunityTotal : null,
  }
}

const reconcileEpoch = (
  db: Db,
  epoch: EpochSummary,
  activeGeneration: string,
  input: { nowMs: number; apply: boolean },
): LiveEpochReport => {
  if (epoch.state === 'closed') return reconcileClosedEpoch(db, epoch, activeGeneration)
  const endMs = epoch.state === 'stale_open' ? (epoch.staleMarkedAtMs ?? input.nowMs) : input.nowMs
  const gapDays = daysBetween(epoch.startedAtMs, endMs)
  if (input.apply) markRestartGapBuckets({ utcDays: gapDays }, { getDrizzleDb: () => db })
  return {
    epochId: epoch.epochId,
    state: epoch.state,
    status: 'unreconciled_restart_gap',
    unexplainedDelta: 0,
    gapDays,
    publishableTotal: null,
  }
}

const reconcileDeliveries = (db: Db, activeGeneration: string): DeliveryReport => {
  const eventsById = new Map(
    db
      .select({ eventId: analyticsEvents.eventId, storageGeneration: analyticsEvents.storageGeneration })
      .from(analyticsEvents)
      .all()
      .map((event) => [event.eventId, event.storageGeneration]),
  )
  const byState: Record<string, number> = {}
  const pairs = new Set<string>()
  let total = 0
  let excludedNonActiveGeneration = 0
  for (const delivery of db.select().from(analyticsDeliveries).all()) {
    if (eventsById.get(delivery.eventId) !== activeGeneration) {
      excludedNonActiveGeneration += 1
      continue
    }
    total += 1
    bump(byState, delivery.state)
    pairs.add(`${delivery.eventId}|${delivery.sinkVersionId}`)
  }
  const stateSum = Object.values(byState).reduce((sum, value) => sum + value, 0)
  return {
    total,
    uniquePairs: pairs.size,
    byState,
    excludedNonActiveGeneration,
    conserved: pairs.size === total && stateSum === total,
  }
}

/**
 * Hourly reconciliation. The apply phase (restart-gap status writes) is a
 * mutable phase, so it holds a cutover-fence admission under the backfill
 * writer class (the class that owns aggregate-bucket writes) for the whole
 * run: a mid-run cutover acquisition cannot drain past reconcile, and a
 * fence already held at entry skips the apply phase cleanly (read-only
 * report, no throw, no admission).
 */
export const runReconciliation = (
  input: Readonly<{ nowMs: number; apply: boolean }>,
  deps: ReconcileDeps = { getDrizzleDb: defaultGetDrizzleDb },
): ReconciliationReport => {
  const admission = input.apply && deps.fence !== undefined ? deps.fence.admit('backfill') : null
  const fenceBlocked = input.apply && deps.fence !== undefined && admission === null
  if (fenceBlocked) {
    log.warn('reconciliation apply phase skipped: the cutover fence is held')
  }
  const effectiveInput = { nowMs: input.nowMs, apply: input.apply && !fenceBlocked }
  try {
    const db = deps.getDrizzleDb()
    const activeGeneration = resolveActive({ getDrizzleDb: deps.getDrizzleDb }).generation
    const durable = reconcileDurableUsage(db, activeGeneration)
    const liveEpochs = listProcessEpochs({ getDrizzleDb: deps.getDrizzleDb }).map((epoch) =>
      reconcileEpoch(db, epoch, activeGeneration, effectiveInput),
    )
    const delivery = reconcileDeliveries(db, activeGeneration)
    const eventsByName: Record<string, number> = {}
    const eventsByAttributionQuality: Record<string, number> = {}
    for (const event of db.select().from(analyticsEvents).all()) {
      if (event.storageGeneration !== activeGeneration) continue
      bump(eventsByName, event.eventName)
      bump(eventsByAttributionQuality, event.attributionQuality)
    }
    const hasDelta =
      durable.unexplainedDeltaTotal > 0 ||
      durable.associationViolations > 0 ||
      liveEpochs.some((epoch) => epoch.status === 'delta') ||
      !delivery.conserved
    const hasGap = liveEpochs.some((epoch) => epoch.status === 'unreconciled_restart_gap')
    const status = hasDelta ? 'delta' : hasGap ? 'gap' : 'reconciled'
    log.info({ status, unexplainedDelta: durable.unexplainedDeltaTotal }, 'reconciliation completed')
    return {
      status,
      durableUsage: durable,
      liveEpochs,
      delivery,
      associationViolations: durable.associationViolations,
      eventsByName,
      eventsByAttributionQuality,
    }
  } finally {
    admission?.release()
  }
}
