// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, gte, lt } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsDailyCounters, analyticsDailyHistograms, analyticsEvents } from '../../db/schema.js'
import type { AnalyticsEventRow } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { FIXED_HISTOGRAM_BUCKETS_MS } from '../aggregate-contract.js'
import {
  aggregateDimensionsOf,
  contributorBasisForMetric,
  contributorKeyForIncrement,
  histogramBucketIndex,
  incrementsForEvent,
} from '../aggregate.js'
import { AnalyticsEventV1Schema } from '../contracts.js'
import type { AnalyticsEventV1 } from '../contracts.js'
import { DAY_MS, utcDayStartMs } from '../retention/expiry-guard.js'
import { unexpiredEventFilter } from '../retention/expiry-guard.js'

const log = logger.child({ scope: 'analytics:storage:aggregate-rebuild' })

export type AggregateRebuildDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

type CounterCell = {
  key: Readonly<{
    utcDay: string
    platform: string
    contextType: string
    actorRole: string
    taskProvider: string
    appVersion: string
    metric: string
  }>
  value: number
  contributors: Set<string>
  contributorRequired: boolean
}

type HistogramCell = {
  key: CounterCell['key']
  counts: number[]
  sum: number
  sampleCount: number
  contributors: Set<string>
  contributorRequired: boolean
}

const rowToEvent = (row: AnalyticsEventRow): AnalyticsEventV1 | null => {
  const props: unknown = JSON.parse(row.propsJson)
  const parsed = AnalyticsEventV1Schema.safeParse({
    schema: { name: 'papai.analytics.event', version: row.schemaVersion },
    event: {
      id: row.sourceRefKey,
      name: row.eventName,
      version: row.eventVersion,
      occurred_at_ms: row.occurredAtMs,
      ingested_at_ms: row.ingestedAtMs,
      source: row.source,
      attribution_quality: row.attributionQuality,
    },
    app: { version: row.appVersion, deployment_key: row.deploymentKey },
    identity: {
      key_version: row.keyVersion,
      platform: row.platform,
      platform_instance_key: row.platformInstanceKey,
      actor_key: row.actorKey,
      context_key: row.contextKey,
      thread_key: row.threadKey,
      task_instance_key: row.taskInstanceKey,
    },
    context: {
      context_type: row.contextType,
      actor_role: row.actorRole,
      task_provider: row.taskProvider,
      invocation_mode: row.invocationMode,
    },
    correlation: { conversation_key: row.conversationKey, turn_key: row.turnKey, session_key: row.sessionKey },
    governance: {
      purpose: 'product_analytics',
      collection_tier: 'pseudonymous',
      policy_version: row.policyVersion,
      eligibility: row.eligibility,
    },
    privacy: { max_class: row.maxClass },
    props,
  })
  if (!parsed.success) {
    log.warn({ eventName: row.eventName }, 'aggregate rebuild skipped an unparseable event row')
    return null
  }
  return parsed.data
}

const cellIdOf = (key: CounterCell['key']): string =>
  [key.platform, key.contextType, key.actorRole, key.taskProvider, key.appVersion, key.metric].join('|')

const accumulate = (
  cells: { counters: Map<string, CounterCell>; histograms: Map<string, HistogramCell> },
  utcDay: string,
  event: AnalyticsEventV1,
): void => {
  const dimensions = aggregateDimensionsOf(event)
  for (const increment of incrementsForEvent(event)) {
    const key = {
      utcDay,
      platform: dimensions.platform,
      contextType: dimensions.context_type,
      actorRole: dimensions.actor_role,
      taskProvider: dimensions.task_provider,
      appVersion: dimensions.app_version,
      metric: increment.metric,
    }
    const id = cellIdOf(key)
    const contributor = contributorKeyForIncrement(increment, event)
    if (increment.kind === 'counter') {
      const cell = cells.counters.get(id) ?? {
        key,
        value: 0,
        contributors: new Set<string>(),
        contributorRequired: contributor !== null,
      }
      cell.value += increment.delta
      if (contributor !== null) cell.contributors.add(contributor)
      cells.counters.set(id, cell)
      continue
    }
    const cell = cells.histograms.get(id) ?? {
      key,
      counts: FIXED_HISTOGRAM_BUCKETS_MS.map(() => 0),
      sum: 0,
      sampleCount: 0,
      contributors: new Set<string>(),
      contributorRequired: contributor !== null,
    }
    const bucketIndex = histogramBucketIndex(increment.valueMs)
    cell.counts[bucketIndex] = (cell.counts[bucketIndex] ?? 0) + 1
    cell.sum += increment.valueMs
    cell.sampleCount += 1
    if (contributor !== null) cell.contributors.add(contributor)
    cells.histograms.set(id, cell)
  }
}

type QualityColumns = Readonly<{
  finalized: boolean
  partialDay: boolean
  restartGapDetected: boolean
  lateEventCount: number
  reconciliationStatus: string
  disclosureScope: string
  contributorBasis: string
  contributorCount: number | null
  threshold: null
}>

const qualityColumns = (metric: string, contributors: Set<string>, contributorRequired: boolean): QualityColumns => ({
  finalized: false,
  partialDay: false,
  restartGapDetected: false,
  lateEventCount: 0,
  reconciliationStatus: 'complete_epoch',
  disclosureScope: 'local_only',
  contributorBasis: contributorBasisForMetric(metric),
  contributorCount: contributorRequired ? contributors.size : null,
  threshold: null,
})

const rewriteDay = (db: Db | Tx, utcDay: string, nowMs: number): void => {
  const dayStart = utcDayStartMs(utcDay)
  const rows = db
    .select()
    .from(analyticsEvents)
    .where(
      and(
        gte(analyticsEvents.occurredAtMs, dayStart),
        lt(analyticsEvents.occurredAtMs, dayStart + DAY_MS),
        unexpiredEventFilter(nowMs),
      ),
    )
    .all()
  db.delete(analyticsDailyCounters).where(eq(analyticsDailyCounters.utcDay, utcDay)).run()
  db.delete(analyticsDailyHistograms).where(eq(analyticsDailyHistograms.utcDay, utcDay)).run()
  const cells = { counters: new Map<string, CounterCell>(), histograms: new Map<string, HistogramCell>() }
  for (const row of rows) {
    const event = rowToEvent(row)
    if (event !== null) accumulate(cells, utcDay, event)
  }
  for (const cell of cells.counters.values()) {
    db.insert(analyticsDailyCounters)
      .values({
        ...cell.key,
        definitionVersion: 1,
        value: cell.value,
        ...qualityColumns(cell.key.metric, cell.contributors, cell.contributorRequired),
      })
      .run()
  }
  for (const cell of cells.histograms.values()) {
    db.insert(analyticsDailyHistograms)
      .values({
        ...cell.key,
        definitionVersion: 1,
        fixedBucketsJson: JSON.stringify(FIXED_HISTOGRAM_BUCKETS_MS),
        countsJson: JSON.stringify(cell.counts),
        sum: cell.sum,
        sampleCount: cell.sampleCount,
        ...qualityColumns(cell.key.metric, cell.contributors, cell.contributorRequired),
      })
      .run()
  }
}

export const rebuildDailyAggregatesForDays = (
  input: Readonly<{ utcDays: readonly string[]; nowMs: number }>,
  deps: AggregateRebuildDeps = { getDrizzleDb: defaultGetDrizzleDb },
): Readonly<{ days: number }> => {
  const db = deps.getDrizzleDb()
  db.transaction((tx) => {
    for (const utcDay of input.utcDays) rewriteDay(tx, utcDay, input.nowMs)
  })
  log.info({ days: input.utcDays.length }, 'daily aggregates rebuilt')
  return { days: input.utcDays.length }
}
