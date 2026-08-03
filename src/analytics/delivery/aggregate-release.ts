// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import {
  analyticsAggregateDeliveries,
  analyticsAggregateReleases,
  analyticsDailyCounters,
  analyticsDailyHistograms,
} from '../../db/schema.js'
import { logger } from '../../logger.js'
import { AnalyticsAggregateV1Schema } from '../aggregate-contract.js'
import { aggregateReleaseCellKey, applyReleaseSuppression, thresholdFor } from './release-suppression.js'
import type { CellDimensions, ReleaseCellInput, SuppressionDecision } from './release-suppression.js'
import { DELIVERY_PAYLOAD_SCHEMA_VERSION } from './sink.js'

const log = logger.child({ scope: 'analytics:delivery:aggregate-release' })

export const AGGREGATE_RELEASE_SCHEMA_VERSION = DELIVERY_PAYLOAD_SCHEMA_VERSION

export const AnalyticsAggregateReleaseV1Schema = z
  .object({
    schema: z
      .object({
        name: z.literal('papai.analytics.aggregate-release'),
        version: z.literal(AGGREGATE_RELEASE_SCHEMA_VERSION),
      })
      .strict(),
    utc_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'utc_day must be YYYY-MM-DD'),
    definition_version: z.literal(1),
    cells: z.array(AnalyticsAggregateV1Schema),
  })
  .strict()

export type AnalyticsAggregateReleaseV1 = z.infer<typeof AnalyticsAggregateReleaseV1Schema>

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

export type AggregateReleaseDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

const dimensionsOfRow = (row: {
  platform: string
  contextType: string
  actorRole: string
  taskProvider: string
  appVersion: string
}): CellDimensions => ({
  platform: row.platform,
  contextType: row.contextType,
  actorRole: row.actorRole,
  taskProvider: row.taskProvider,
  appVersion: row.appVersion,
})

const NumberArraySchema = z.array(z.number())

const parseNumberArray = (json: string, field: string): readonly number[] => {
  const raw: unknown = JSON.parse(json)
  const parsed = NumberArraySchema.safeParse(raw)
  if (!parsed.success) throw new Error(`invalid histogram payload: ${field} must be a number array`)
  return parsed.data
}

const loadCells = (db: Db | Tx, utcDay: string): ReleaseCellInput[] => {
  const counters = db.select().from(analyticsDailyCounters).where(eq(analyticsDailyCounters.utcDay, utcDay)).all()
  const histograms = db.select().from(analyticsDailyHistograms).where(eq(analyticsDailyHistograms.utcDay, utcDay)).all()
  const cells: ReleaseCellInput[] = []
  for (const row of counters) {
    cells.push({
      utcDay: row.utcDay,
      metric: row.metric,
      measureKind: 'counter',
      dimensions: dimensionsOfRow(row),
      counterValue: row.value,
      finalized: row.finalized,
      partialDay: row.partialDay,
      reconciliationStatus: row.reconciliationStatus,
      contributorBasis: row.contributorBasis,
      contributorCount: row.contributorCount,
    })
  }
  for (const row of histograms) {
    cells.push({
      utcDay: row.utcDay,
      metric: row.metric,
      measureKind: 'histogram',
      dimensions: dimensionsOfRow(row),
      histogram: {
        fixedBuckets: parseNumberArray(row.fixedBucketsJson, 'fixed_buckets'),
        counts: parseNumberArray(row.countsJson, 'counts'),
        sum: row.sum,
        sampleCount: row.sampleCount,
      },
      finalized: row.finalized,
      partialDay: row.partialDay,
      reconciliationStatus: row.reconciliationStatus,
      contributorBasis: row.contributorBasis,
      contributorCount: row.contributorCount,
    })
  }
  return cells
}

// The record is validated by AnalyticsAggregateReleaseV1Schema at payload build
// time, so dimension/metric strings flow through uncast: a value outside the
// controlled vocabulary fails the build instead of being asserted.
const toAggregateRecord = (cell: ReleaseCellInput): unknown => ({
  schema: { name: 'papai.analytics.aggregate', version: 1 },
  bucket: { utc_day: cell.utcDay, definition_version: 1, finalized: true },
  dimensions: {
    platform: cell.dimensions.platform,
    context_type: cell.dimensions.contextType,
    actor_role: cell.dimensions.actorRole,
    task_provider: cell.dimensions.taskProvider,
    app_version: 'all',
  },
  measure:
    cell.measureKind === 'counter'
      ? { kind: 'counter', metric: cell.metric, value: cell.counterValue ?? 0 }
      : {
          kind: 'histogram',
          metric: cell.metric,
          fixed_buckets: [...(cell.histogram?.fixedBuckets ?? [])],
          counts: [...(cell.histogram?.counts ?? [])],
          sum: cell.histogram?.sum ?? 0,
          sample_count: cell.histogram?.sampleCount ?? 0,
        },
  quality: {
    source: 'live',
    partial_day: false,
    restart_gap_detected: false,
    reconciliation: 'complete_epoch',
    late_event_count: 0,
  },
  disclosure: {
    scope: 'external_eligible',
    contributor_basis: cell.contributorBasis,
    contributor_count: cell.contributorCount,
    threshold: thresholdFor(cell),
  },
})

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const persistAssessment = (
  db: Db | Tx,
  cells: readonly ReleaseCellInput[],
  decisions: ReadonlyMap<string, SuppressionDecision>,
): void => {
  for (const cell of cells) {
    const decision = decisions.get(aggregateReleaseCellKey(cell)) ?? 'suppressed'
    const patch = { disclosureScope: decision, threshold: thresholdFor(cell) }
    const table = cell.measureKind === 'counter' ? analyticsDailyCounters : analyticsDailyHistograms
    db.update(table)
      .set(patch)
      .where(
        and(
          eq(table.utcDay, cell.utcDay),
          eq(table.definitionVersion, 1),
          eq(table.platform, cell.dimensions.platform),
          eq(table.contextType, cell.dimensions.contextType),
          eq(table.actorRole, cell.dimensions.actorRole),
          eq(table.taskProvider, cell.dimensions.taskProvider),
          eq(table.appVersion, cell.dimensions.appVersion),
          eq(table.metric, cell.metric),
        ),
      )
      .run()
  }
}

export type BuildReleaseInput = Readonly<{ utcDay: string; sinkVersionId: string; nowMs: number }>

export type BuildReleaseResult =
  | Readonly<{ status: 'released'; releaseId: string; releaseHash: string; cellCount: number }>
  | Readonly<{ status: 'already_released'; releaseId: string; releaseHash: string }>
  | Readonly<{ status: 'empty' }>
  | Readonly<{ status: 'day_not_complete' }>

const releasedRecords = (
  cells: readonly ReleaseCellInput[],
  decisions: ReadonlyMap<string, SuppressionDecision>,
): readonly unknown[] =>
  cells
    .filter((cell) => decisions.get(aggregateReleaseCellKey(cell)) === 'external_eligible')
    .sort((a, b) => aggregateReleaseCellKey(a).localeCompare(aggregateReleaseCellKey(b)))
    .map(toAggregateRecord)

const buildPayload = (
  utcDay: string,
  cells: readonly ReleaseCellInput[],
  decisions: ReadonlyMap<string, SuppressionDecision>,
): { payloadJson: string; cellCount: number } => {
  const released = releasedRecords(cells, decisions)
  const payload: AnalyticsAggregateReleaseV1 = AnalyticsAggregateReleaseV1Schema.parse({
    schema: { name: 'papai.analytics.aggregate-release', version: AGGREGATE_RELEASE_SCHEMA_VERSION },
    utc_day: utcDay,
    definition_version: 1,
    cells: released,
  })
  return { payloadJson: stableStringify(payload), cellCount: released.length }
}

const stageReleaseDelivery = (
  tx: Tx,
  input: BuildReleaseInput,
  releaseId: string,
  releaseHash: string,
  payloadJson: string,
): void => {
  tx.insert(analyticsAggregateReleases)
    .values({
      releaseId,
      releaseHash,
      payloadJson,
      payloadSchemaVersion: AGGREGATE_RELEASE_SCHEMA_VERSION,
      createdAtMs: input.nowMs,
    })
    .run()
  tx.insert(analyticsAggregateDeliveries)
    .values({
      releaseId,
      sinkVersionId: input.sinkVersionId,
      state: 'pending',
      attempts: 0,
      nextAttemptAtMs: input.nowMs,
      payloadSchemaVersion: AGGREGATE_RELEASE_SCHEMA_VERSION,
    })
    .run()
}

export const buildDailyAggregateRelease = (
  input: BuildReleaseInput,
  deps: AggregateReleaseDeps = { getDrizzleDb: defaultGetDrizzleDb },
): BuildReleaseResult => {
  const db = deps.getDrizzleDb()
  return db.transaction((tx) => {
    const cells = loadCells(tx, input.utcDay)
    if (cells.length === 0) return { status: 'empty' }
    if (cells.some((cell) => !cell.finalized || cell.partialDay)) {
      log.warn({ utcDay: input.utcDay }, 'aggregate release refused: day is not complete')
      return { status: 'day_not_complete' }
    }
    const decisions = applyReleaseSuppression(cells)
    persistAssessment(tx, cells, decisions)
    const { payloadJson, cellCount } = buildPayload(input.utcDay, cells, decisions)
    const releaseHash = createHash('sha256').update(payloadJson).digest('hex')
    const releaseId = `agg-release:${releaseHash.slice(0, 40)}`
    const existing = tx
      .select({ releaseId: analyticsAggregateReleases.releaseId })
      .from(analyticsAggregateReleases)
      .where(eq(analyticsAggregateReleases.releaseId, releaseId))
      .get()
    if (existing !== undefined) return { status: 'already_released', releaseId, releaseHash }
    stageReleaseDelivery(tx, input, releaseId, releaseHash, payloadJson)
    log.info({ utcDay: input.utcDay, cellCount }, 'aggregate release staged for delivery')
    return { status: 'released', releaseId, releaseHash, cellCount }
  })
}
