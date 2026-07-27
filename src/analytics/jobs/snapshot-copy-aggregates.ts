// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { analyticsDailyCounters, analyticsDailyHistograms, analyticsNormalizationRejections } from '../../db/schema.js'
import { insertCuratedRow } from './snapshot-copy.js'
import type { SnapshotSourceDb } from './snapshot-copy.js'

const copyDailyCounters = (source: SnapshotSourceDb, publishDb: Database): Record<string, number> => {
  const counters = source.select().from(analyticsDailyCounters).all()
  for (const row of counters) {
    insertCuratedRow(publishDb, 'analytics_daily_counters', {
      utc_day: row.utcDay,
      definition_version: row.definitionVersion,
      platform: row.platform,
      context_type: row.contextType,
      actor_role: row.actorRole,
      task_provider: row.taskProvider,
      app_version: row.appVersion,
      metric: row.metric,
      value: row.value,
      finalized: row.finalized ? 1 : 0,
      partial_day: row.partialDay ? 1 : 0,
      restart_gap_detected: row.restartGapDetected ? 1 : 0,
      late_event_count: row.lateEventCount,
      reconciliation_status: row.reconciliationStatus,
      disclosure_scope: row.disclosureScope,
      contributor_basis: row.contributorBasis,
      contributor_count: row.contributorCount,
      threshold: row.threshold,
    })
  }
  return { analytics_daily_counters: counters.length }
}

const copyDailyHistograms = (source: SnapshotSourceDb, publishDb: Database): Record<string, number> => {
  const histograms = source.select().from(analyticsDailyHistograms).all()
  for (const row of histograms) {
    insertCuratedRow(publishDb, 'analytics_daily_histograms', {
      utc_day: row.utcDay,
      definition_version: row.definitionVersion,
      platform: row.platform,
      context_type: row.contextType,
      actor_role: row.actorRole,
      task_provider: row.taskProvider,
      app_version: row.appVersion,
      metric: row.metric,
      fixed_buckets_json: row.fixedBucketsJson,
      counts_json: row.countsJson,
      sum: row.sum,
      sample_count: row.sampleCount,
      finalized: row.finalized ? 1 : 0,
      partial_day: row.partialDay ? 1 : 0,
      restart_gap_detected: row.restartGapDetected ? 1 : 0,
      late_event_count: row.lateEventCount,
      reconciliation_status: row.reconciliationStatus,
      disclosure_scope: row.disclosureScope,
      contributor_basis: row.contributorBasis,
      contributor_count: row.contributorCount,
      threshold: row.threshold,
    })
  }
  return { analytics_daily_histograms: histograms.length }
}

const copyRejections = (source: SnapshotSourceDb, publishDb: Database): Record<string, number> => {
  const rejections = source.select().from(analyticsNormalizationRejections).all()
  for (const row of rejections) {
    insertCuratedRow(publishDb, 'analytics_normalization_rejections', {
      utc_day: row.utcDay,
      source_event_type: row.sourceEventType,
      reason: row.reason,
      count: row.count,
    })
  }
  return { analytics_normalization_rejections: rejections.length }
}

/** Copies the aggregate tables verbatim; they are already actor-free. */
export const copyAggregateTables = (source: SnapshotSourceDb, publishDb: Database): Record<string, number> =>
  [copyDailyCounters, copyDailyHistograms, copyRejections]
    .map((copyFn) => copyFn(source, publishDb))
    .reduce<Record<string, number>>((merged, counts) => ({ ...merged, ...counts }), {})
