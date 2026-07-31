// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const analyticsProcessEpochs = sqliteTable('analytics_process_epochs', {
  epochId: text('epoch_id').primaryKey(),
  state: text('state').notNull(),
  startedAtMs: integer('started_at_ms').notNull(),
  closeRequestedAtMs: integer('close_requested_at_ms'),
  closedAtMs: integer('closed_at_ms'),
  staleMarkedAtMs: integer('stale_marked_at_ms'),
})

export const analyticsEvents = sqliteTable(
  'analytics_events',
  {
    eventId: text('event_id').primaryKey(),
    storageGeneration: text('storage_generation').notNull(),
    processEpochId: text('process_epoch_id').notNull(),
    sourceRefKey: text('source_ref_key').notNull(),
    sourceKind: text('source_kind').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    eventName: text('event_name').notNull(),
    eventVersion: integer('event_version').notNull(),
    occurredAtMs: integer('occurred_at_ms').notNull(),
    ingestedAtMs: integer('ingested_at_ms').notNull(),
    source: text('source').notNull(),
    attributionQuality: text('attribution_quality').notNull(),
    appVersion: text('app_version').notNull(),
    deploymentKey: text('deployment_key').notNull(),
    keyVersion: text('key_version').notNull(),
    platform: text('platform').notNull(),
    platformInstanceKey: text('platform_instance_key').notNull(),
    actorKey: text('actor_key'),
    contextKey: text('context_key'),
    threadKey: text('thread_key'),
    conversationKey: text('conversation_key'),
    taskInstanceKey: text('task_instance_key'),
    contextType: text('context_type').notNull(),
    actorRole: text('actor_role').notNull(),
    taskProvider: text('task_provider').notNull(),
    invocationMode: text('invocation_mode').notNull(),
    turnKey: text('turn_key'),
    sessionKey: text('session_key'),
    policyVersion: integer('policy_version').notNull(),
    eligibility: text('eligibility').notNull(),
    maxClass: text('max_class').notNull(),
    propsJson: text('props_json').notNull(),
    expiresAtMs: integer('expires_at_ms').notNull(),
  },
  (table) => [
    uniqueIndex('idx_analytics_events_source_uniq').on(
      table.storageGeneration,
      table.sourceKind,
      table.sourceRefKey,
      table.eventName,
    ),
    index('idx_analytics_events_gen_occurred').on(table.storageGeneration, table.occurredAtMs),
    index('idx_analytics_events_gen_actor_occurred').on(table.storageGeneration, table.actorKey, table.occurredAtMs),
    index('idx_analytics_events_gen_conversation_occurred').on(
      table.storageGeneration,
      table.conversationKey,
      table.occurredAtMs,
    ),
    index('idx_analytics_events_gen_turn').on(table.storageGeneration, table.turnKey),
    index('idx_analytics_events_gen_name_occurred').on(table.storageGeneration, table.eventName, table.occurredAtMs),
  ],
)

export const analyticsDailyCounters = sqliteTable(
  'analytics_daily_counters',
  {
    utcDay: text('utc_day').notNull(),
    definitionVersion: integer('definition_version').notNull(),
    platform: text('platform').notNull(),
    contextType: text('context_type').notNull(),
    actorRole: text('actor_role').notNull(),
    taskProvider: text('task_provider').notNull(),
    appVersion: text('app_version').notNull(),
    metric: text('metric').notNull(),
    value: integer('value').notNull(),
    finalized: integer('finalized', { mode: 'boolean' }).notNull().default(false),
    partialDay: integer('partial_day', { mode: 'boolean' }).notNull().default(false),
    restartGapDetected: integer('restart_gap_detected', { mode: 'boolean' }).notNull().default(false),
    lateEventCount: integer('late_event_count').notNull().default(0),
    reconciliationStatus: text('reconciliation_status').notNull().default('complete_epoch'),
    disclosureScope: text('disclosure_scope').notNull(),
    contributorBasis: text('contributor_basis').notNull(),
    contributorCount: integer('contributor_count'),
    threshold: integer('threshold'),
  },
  (table) => [
    primaryKey({
      columns: [
        table.utcDay,
        table.definitionVersion,
        table.platform,
        table.contextType,
        table.actorRole,
        table.taskProvider,
        table.appVersion,
        table.metric,
      ],
    }),
  ],
)

export const analyticsDailyHistograms = sqliteTable(
  'analytics_daily_histograms',
  {
    utcDay: text('utc_day').notNull(),
    definitionVersion: integer('definition_version').notNull(),
    platform: text('platform').notNull(),
    contextType: text('context_type').notNull(),
    actorRole: text('actor_role').notNull(),
    taskProvider: text('task_provider').notNull(),
    appVersion: text('app_version').notNull(),
    metric: text('metric').notNull(),
    fixedBucketsJson: text('fixed_buckets_json').notNull(),
    countsJson: text('counts_json').notNull(),
    sum: real('sum').notNull(),
    sampleCount: integer('sample_count').notNull(),
    finalized: integer('finalized', { mode: 'boolean' }).notNull().default(false),
    partialDay: integer('partial_day', { mode: 'boolean' }).notNull().default(false),
    restartGapDetected: integer('restart_gap_detected', { mode: 'boolean' }).notNull().default(false),
    lateEventCount: integer('late_event_count').notNull().default(0),
    reconciliationStatus: text('reconciliation_status').notNull().default('complete_epoch'),
    disclosureScope: text('disclosure_scope').notNull(),
    contributorBasis: text('contributor_basis').notNull(),
    contributorCount: integer('contributor_count'),
    threshold: integer('threshold'),
  },
  (table) => [
    primaryKey({
      columns: [
        table.utcDay,
        table.definitionVersion,
        table.platform,
        table.contextType,
        table.actorRole,
        table.taskProvider,
        table.appVersion,
        table.metric,
      ],
    }),
  ],
)

export const analyticsEpochSourceCounters = sqliteTable(
  'analytics_epoch_source_counters',
  {
    epochId: text('epoch_id').notNull(),
    utcDay: text('utc_day').notNull(),
    sourceFamily: text('source_family').notNull(),
    disposition: text('disposition').notNull(),
    value: integer('value').notNull(),
  },
  (table) => [primaryKey({ columns: [table.epochId, table.utcDay, table.sourceFamily, table.disposition] })],
)

export const analyticsAggregateEpochContributions = sqliteTable(
  'analytics_aggregate_epoch_contributions',
  {
    epochId: text('epoch_id').notNull(),
    aggregateCellKey: text('aggregate_cell_key').notNull(),
    measureKind: text('measure_kind').notNull(),
    counterDelta: integer('counter_delta').notNull(),
    sampleCountDelta: integer('sample_count_delta').notNull(),
    sumDelta: real('sum_delta').notNull(),
    fixedBucketCountsDeltaJson: text('fixed_bucket_counts_delta_json').notNull(),
  },
  (table) => [primaryKey({ columns: [table.epochId, table.aggregateCellKey] })],
)

export const analyticsNormalizationRejections = sqliteTable(
  'analytics_normalization_rejections',
  {
    utcDay: text('utc_day').notNull(),
    sourceEventType: text('source_event_type').notNull(),
    reason: text('reason').notNull(),
    count: integer('count').notNull(),
  },
  (table) => [primaryKey({ columns: [table.utcDay, table.sourceEventType, table.reason] })],
)

export const analyticsBackfillRuns = sqliteTable('analytics_backfill_runs', {
  runId: text('run_id').primaryKey(),
  sourceTable: text('source_table').notNull(),
  highWaterRowKey: text('high_water_row_key').notNull(),
  policyCutoffMs: integer('policy_cutoff_ms').notNull(),
  status: text('status').notNull(),
  eventCount: integer('event_count').notNull().default(0),
  aggregateCount: integer('aggregate_count').notNull().default(0),
  startedAtMs: integer('started_at_ms').notNull(),
  completedAtMs: integer('completed_at_ms'),
  failedAtMs: integer('failed_at_ms'),
})

export const analyticsBackfillEventMap = sqliteTable(
  'analytics_backfill_event_map',
  {
    runId: text('run_id').notNull(),
    eventId: text('event_id').notNull(),
    sourceRefKey: text('source_ref_key').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.sourceRefKey] }),
    uniqueIndex('idx_analytics_backfill_event_map_run_event').on(table.runId, table.eventId),
  ],
)

export const analyticsBackfillAggregateContributions = sqliteTable(
  'analytics_backfill_aggregate_contributions',
  {
    runId: text('run_id').notNull(),
    aggregateCellKey: text('aggregate_cell_key').notNull(),
    metric: text('metric').notNull(),
    delta: integer('delta').notNull(),
    sourceRefKey: text('source_ref_key').notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.sourceRefKey, table.metric, table.aggregateCellKey] })],
)

export type AnalyticsEventRow = typeof analyticsEvents.$inferSelect
export type AnalyticsProcessEpochRow = typeof analyticsProcessEpochs.$inferSelect
export type AnalyticsDailyCounterRow = typeof analyticsDailyCounters.$inferSelect
export type AnalyticsDailyHistogramRow = typeof analyticsDailyHistograms.$inferSelect
export type AnalyticsEpochSourceCounterRow = typeof analyticsEpochSourceCounters.$inferSelect
export type AnalyticsAggregateEpochContributionRow = typeof analyticsAggregateEpochContributions.$inferSelect
export type AnalyticsNormalizationRejectionRow = typeof analyticsNormalizationRejections.$inferSelect
export type AnalyticsBackfillRunRow = typeof analyticsBackfillRuns.$inferSelect
export type AnalyticsBackfillEventMapRow = typeof analyticsBackfillEventMap.$inferSelect
export type AnalyticsBackfillAggregateContributionRow = typeof analyticsBackfillAggregateContributions.$inferSelect
