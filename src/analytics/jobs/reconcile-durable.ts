// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, gte, lte } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import {
  analyticsBackfillAggregateContributions,
  analyticsBackfillEventMap,
  analyticsBackfillRuns,
  analyticsEvents,
  llmUsageEvents,
  toolCallEvents,
} from '../../db/schema.js'
import { utcDayOfMs } from '../aggregate.js'
import { classifyAnalyticsTool } from '../tool-classification.js'
import { controlledModelRoleOf, LLM_SOURCE_TABLE, TOOL_SOURCE_TABLE } from './backfill-decisions.js'
import { highWaterBoundMs } from './backfill-readers.js'

type Db = ReturnType<typeof defaultGetDrizzleDb>

export type DurableSourceDayRow = Readonly<{
  sourceTable: string
  utcDay: string
  usageRows: number
  canonical: number
  rejected: number
  ineligible: number
  aggregateOnly: number
  unexplainedDelta: number
}>

export type DurableUsageReport = Readonly<{
  perSourceDay: readonly DurableSourceDayRow[]
  unexplainedDeltaTotal: number
  breakdowns: Readonly<{
    perModelRole: Readonly<Record<string, number>>
    perToolDomain: Readonly<Record<string, number>>
  }>
  associationViolations: number
}>

const bump = (map: Record<string, number>, key: string): void => {
  map[key] = (map[key] ?? 0) + 1
}

type DayBucket = {
  usageRows: number
  canonical: Set<string>
  rejected: Set<string>
  ineligible: Set<string>
  aggregateOnly: Set<string>
}

const emptyBucket = (): DayBucket => ({
  usageRows: 0,
  canonical: new Set(),
  rejected: new Set(),
  ineligible: new Set(),
  aggregateOnly: new Set(),
})

const bucketFor = (buckets: Map<string, DayBucket>, sourceTable: string, utcDay: string): DayBucket => {
  const key = `${sourceTable}|${utcDay}`
  const existing = buckets.get(key)
  if (existing !== undefined) return existing
  const created = emptyBucket()
  buckets.set(key, created)
  return created
}

const coverageByTable = (db: Db): Map<string, { cutoffMs: number; boundMs: number }> => {
  const coverage = new Map<string, { cutoffMs: number; boundMs: number }>()
  const runs = db.select().from(analyticsBackfillRuns).where(eq(analyticsBackfillRuns.status, 'completed')).all()
  for (const run of runs) {
    const boundMs = highWaterBoundMs(run.highWaterRowKey)
    const existing = coverage.get(run.sourceTable)
    coverage.set(run.sourceTable, {
      cutoffMs: Math.min(existing?.cutoffMs ?? run.policyCutoffMs, run.policyCutoffMs),
      boundMs: Math.max(existing?.boundMs ?? boundMs, boundMs),
    })
  }
  return coverage
}

const countUsageRows = (
  db: Db,
  coverage: Map<string, { cutoffMs: number; boundMs: number }>,
  buckets: Map<string, DayBucket>,
  perModelRole: Record<string, number>,
  perToolDomain: Record<string, number>,
): void => {
  const llmCoverage = coverage.get(LLM_SOURCE_TABLE)
  if (llmCoverage !== undefined) {
    const rows = db
      .select({ occurredAt: llmUsageEvents.occurredAt, modelRole: llmUsageEvents.modelRole })
      .from(llmUsageEvents)
      .where(
        and(gte(llmUsageEvents.occurredAt, llmCoverage.cutoffMs), lte(llmUsageEvents.occurredAt, llmCoverage.boundMs)),
      )
      .all()
    for (const row of rows) {
      bucketFor(buckets, LLM_SOURCE_TABLE, utcDayOfMs(row.occurredAt)).usageRows += 1
      const role = controlledModelRoleOf(row.modelRole)
      if (role !== null) bump(perModelRole, role)
    }
  }
  const toolCoverage = coverage.get(TOOL_SOURCE_TABLE)
  if (toolCoverage !== undefined) {
    const rows = db
      .select({ occurredAt: toolCallEvents.occurredAt, toolName: toolCallEvents.toolName })
      .from(toolCallEvents)
      .where(
        and(
          gte(toolCallEvents.occurredAt, toolCoverage.cutoffMs),
          lte(toolCallEvents.occurredAt, toolCoverage.boundMs),
        ),
      )
      .all()
    for (const row of rows) {
      bucketFor(buckets, TOOL_SOURCE_TABLE, utcDayOfMs(row.occurredAt)).usageRows += 1
      bump(perToolDomain, classifyAnalyticsTool(row.toolName).toolDomain)
    }
  }
}

const applyContributionProvenance = (
  db: Db,
  runTables: ReadonlyMap<string, string>,
  buckets: Map<string, DayBucket>,
): void => {
  for (const contribution of db.select().from(analyticsBackfillAggregateContributions).all()) {
    const table = runTables.get(contribution.runId)
    if (table === undefined) continue
    const utcDay = contribution.aggregateCellKey.split('|')[0] ?? ''
    const bucket = bucketFor(buckets, table, utcDay)
    if (contribution.metric.startsWith('rejected:')) bucket.rejected.add(contribution.sourceRefKey)
    else if (contribution.metric.startsWith('ineligible:')) bucket.ineligible.add(contribution.sourceRefKey)
    else bucket.aggregateOnly.add(contribution.sourceRefKey)
  }
}

const applyCanonicalProvenance = (
  db: Db,
  runTables: ReadonlyMap<string, string>,
  buckets: Map<string, DayBucket>,
  activeGeneration: string,
): number => {
  const eventsById = new Map(
    db
      .select()
      .from(analyticsEvents)
      .all()
      .map((event) => [event.eventId, event]),
  )
  let associationViolations = 0
  for (const map of db.select().from(analyticsBackfillEventMap).all()) {
    const table = runTables.get(map.runId)
    const event = eventsById.get(map.eventId)
    if (event === undefined) {
      associationViolations += 1
      continue
    }
    if (table === undefined || event.storageGeneration !== activeGeneration) continue
    bucketFor(buckets, table, utcDayOfMs(event.occurredAtMs)).canonical.add(map.sourceRefKey)
  }
  return associationViolations
}

export const reconcileDurableUsage = (db: Db, activeGeneration: string): DurableUsageReport => {
  const buckets = new Map<string, DayBucket>()
  const perModelRole: Record<string, number> = {}
  const perToolDomain: Record<string, number> = {}
  countUsageRows(db, coverageByTable(db), buckets, perModelRole, perToolDomain)
  const runTables = new Map(
    db
      .select()
      .from(analyticsBackfillRuns)
      .all()
      .map((run) => [run.runId, run.sourceTable]),
  )
  applyContributionProvenance(db, runTables, buckets)
  const associationViolations = applyCanonicalProvenance(db, runTables, buckets, activeGeneration)
  const perSourceDay: DurableSourceDayRow[] = []
  let unexplainedDeltaTotal = 0
  for (const [key, bucket] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const separator = key.indexOf('|')
    const sourceTable = key.slice(0, separator)
    const utcDay = key.slice(separator + 1)
    const decisions = bucket.canonical.size + bucket.rejected.size + bucket.ineligible.size + bucket.aggregateOnly.size
    const unexplainedDelta = bucket.usageRows - decisions
    unexplainedDeltaTotal += Math.abs(unexplainedDelta)
    perSourceDay.push({
      sourceTable,
      utcDay,
      usageRows: bucket.usageRows,
      canonical: bucket.canonical.size,
      rejected: bucket.rejected.size,
      ineligible: bucket.ineligible.size,
      aggregateOnly: bucket.aggregateOnly.size,
      unexplainedDelta,
    })
  }
  return {
    perSourceDay,
    unexplainedDeltaTotal,
    breakdowns: { perModelRole, perToolDomain },
    associationViolations,
  }
}
