// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import type { AnalyticsEventV1 } from '../../src/analytics/contracts.js'
import { llmCompletedFixture } from '../../src/analytics/contracts.js'
import * as schema from '../../src/db/schema.js'
import type { getTestDb } from '../utils/test-helpers.js'

export type Db = ReturnType<typeof getTestDb>

export const TEST_EPOCH_ID = 'epoch-001'
export const TEST_RUN_ID = 'run-001'
export const TEST_STORAGE_GENERATION = 'gen-001'
export const ALT_STORAGE_GENERATION = 'gen-002'

export const createTestEpoch = (db: Db, epochId = TEST_EPOCH_ID): void => {
  db.insert(schema.analyticsProcessEpochs).values({ epochId, state: 'open', startedAtMs: 1700000000000 }).run()
}

export const createTestBackfillRun = (db: Db, runId = TEST_RUN_ID): void => {
  db.insert(schema.analyticsBackfillRuns)
    .values({
      runId,
      sourceTable: 'llm_usage_events',
      highWaterRowKey: 'row-0',
      policyCutoffMs: 1700000000000,
      status: 'running',
      startedAtMs: 1700000000000,
    })
    .run()
}

export const makeTestEvent = (overrides?: Partial<AnalyticsEventV1>): AnalyticsEventV1 => {
  const base = { ...llmCompletedFixture }
  if (overrides === undefined) return base
  return {
    ...base,
    ...overrides,
    event: { ...base.event, ...overrides.event },
    app: { ...base.app, ...overrides.app },
    identity: { ...base.identity, ...overrides.identity },
    context: { ...base.context, ...overrides.context },
    correlation: { ...base.correlation, ...overrides.correlation },
    governance: { ...base.governance, ...overrides.governance },
    privacy: { ...base.privacy, ...overrides.privacy },
  }
}

export const eventInsertInput = (
  event: AnalyticsEventV1,
  overrides?: { sourceRefKey?: string; processEpochId?: string },
): {
  storageGeneration: string
  processEpochId: string
  sourceRefKey: string
  sourceKind: string
  expiresAtMs: number
  event: AnalyticsEventV1
} => ({
  storageGeneration: TEST_STORAGE_GENERATION,
  processEpochId: overrides?.processEpochId ?? TEST_EPOCH_ID,
  sourceRefKey: overrides?.sourceRefKey ?? event.event.id,
  sourceKind: 'llm_usage_event',
  expiresAtMs: event.event.occurred_at_ms + 86400000,
  event,
})

export const commonQuality = {
  finalized: false,
  partialDay: false,
  restartGapDetected: false,
  lateEventCount: 0,
  reconciliationStatus: 'complete_epoch',
  disclosureScope: 'local_only',
  contributorBasis: 'not_required',
  contributorCount: null,
  threshold: null,
} satisfies import('../../src/analytics/storage/aggregate-store-helpers.js').QualityDisclosure

export const getEventRow = (db: Db, eventId: string): typeof schema.analyticsEvents.$inferSelect | undefined =>
  db.select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.eventId, eventId)).get()

export const countEvents = (db: Db): number =>
  db.select({ count: schema.analyticsEvents.eventId }).from(schema.analyticsEvents).all().length

export const getCounterRow = (
  db: Db,
  utcDay: string,
  metric: string,
): typeof schema.analyticsDailyCounters.$inferSelect | undefined =>
  db
    .select()
    .from(schema.analyticsDailyCounters)
    .where(and(eq(schema.analyticsDailyCounters.utcDay, utcDay), eq(schema.analyticsDailyCounters.metric, metric)))
    .get()

export const getHistogramRow = (
  db: Db,
  utcDay: string,
  metric: string,
): typeof schema.analyticsDailyHistograms.$inferSelect | undefined =>
  db
    .select()
    .from(schema.analyticsDailyHistograms)
    .where(and(eq(schema.analyticsDailyHistograms.utcDay, utcDay), eq(schema.analyticsDailyHistograms.metric, metric)))
    .get()

export const getBackfillMapRow = (
  db: Db,
  sourceRefKey: string,
): typeof schema.analyticsBackfillEventMap.$inferSelect | undefined =>
  db
    .select()
    .from(schema.analyticsBackfillEventMap)
    .where(eq(schema.analyticsBackfillEventMap.sourceRefKey, sourceRefKey))
    .get()

export const getEpochContributionRow = (
  db: Db,
  aggregateCellKey: string,
): typeof schema.analyticsAggregateEpochContributions.$inferSelect | undefined =>
  db
    .select()
    .from(schema.analyticsAggregateEpochContributions)
    .where(eq(schema.analyticsAggregateEpochContributions.aggregateCellKey, aggregateCellKey))
    .get()
