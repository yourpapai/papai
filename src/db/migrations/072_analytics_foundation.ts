// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

const createProcessEpochsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_process_epochs (
      epoch_id TEXT PRIMARY KEY,
      state TEXT NOT NULL CHECK(state IN ('open','closed','stale_open')),
      started_at_ms INTEGER NOT NULL CHECK(started_at_ms >= 0),
      close_requested_at_ms INTEGER CHECK(close_requested_at_ms IS NULL OR close_requested_at_ms >= 0),
      closed_at_ms INTEGER CHECK(closed_at_ms IS NULL OR closed_at_ms >= 0),
      stale_marked_at_ms INTEGER CHECK(stale_marked_at_ms IS NULL OR stale_marked_at_ms >= 0)
    )
  `)
}

const createEventsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_events (
      event_id TEXT PRIMARY KEY,
      storage_generation TEXT NOT NULL,
      process_epoch_id TEXT NOT NULL
        REFERENCES analytics_process_epochs(epoch_id) ON DELETE RESTRICT,
      source_ref_key TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK(schema_version > 0),
      event_name TEXT NOT NULL,
      event_version INTEGER NOT NULL CHECK(event_version > 0),
      occurred_at_ms INTEGER NOT NULL CHECK(occurred_at_ms >= 0),
      ingested_at_ms INTEGER NOT NULL CHECK(ingested_at_ms >= 0),
      source TEXT NOT NULL CHECK(source IN ('live','backfill')),
      attribution_quality TEXT NOT NULL CHECK(attribution_quality IN ('native','backfill_snapshot','unknown')),
      app_version TEXT NOT NULL,
      deployment_key TEXT NOT NULL,
      key_version TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('telegram','mattermost','discord','kontur-talk')),
      platform_instance_key TEXT NOT NULL,
      actor_key TEXT,
      context_key TEXT,
      thread_key TEXT,
      conversation_key TEXT,
      task_instance_key TEXT,
      context_type TEXT NOT NULL CHECK(context_type IN ('dm','group','none')),
      actor_role TEXT NOT NULL CHECK(actor_role IN ('admin','member','guest','system')),
      task_provider TEXT NOT NULL CHECK(task_provider IN ('kaneo','youtrack','none','other')),
      invocation_mode TEXT NOT NULL CHECK(invocation_mode IN ('normal','command','settings','proactive','scheduler')),
      turn_key TEXT,
      session_key TEXT,
      policy_version INTEGER NOT NULL CHECK(policy_version >= 0),
      eligibility TEXT NOT NULL CHECK(eligibility IN ('allowed','operator_basis','not_applicable')),
      max_class TEXT NOT NULL CHECK(max_class IN ('C0','C1','C2')),
      props_json TEXT NOT NULL CHECK(json_valid(props_json)),
      expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms >= 0),
      UNIQUE(storage_generation, source_kind, source_ref_key, event_name)
    )
  `)
}

const createEventsIndexes = (db: Database): void => {
  db.run(`
    CREATE INDEX idx_analytics_events_gen_occurred
      ON analytics_events(storage_generation, occurred_at_ms)
  `)
  db.run(`
    CREATE INDEX idx_analytics_events_gen_actor_occurred
      ON analytics_events(storage_generation, actor_key, occurred_at_ms)
  `)
  db.run(`
    CREATE INDEX idx_analytics_events_gen_conversation_occurred
      ON analytics_events(storage_generation, conversation_key, occurred_at_ms)
  `)
  db.run(`
    CREATE INDEX idx_analytics_events_gen_turn
      ON analytics_events(storage_generation, turn_key)
  `)
  db.run(`
    CREATE INDEX idx_analytics_events_gen_name_occurred
      ON analytics_events(storage_generation, event_name, occurred_at_ms)
  `)
}

const createDailyCountersTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_daily_counters (
      utc_day TEXT NOT NULL,
      definition_version INTEGER NOT NULL,
      platform TEXT NOT NULL,
      context_type TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      task_provider TEXT NOT NULL,
      app_version TEXT NOT NULL,
      metric TEXT NOT NULL,
      value INTEGER NOT NULL CHECK(value >= 0),
      finalized INTEGER NOT NULL DEFAULT 0 CHECK(finalized IN (0,1)),
      partial_day INTEGER NOT NULL DEFAULT 0,
      restart_gap_detected INTEGER NOT NULL DEFAULT 0,
      late_event_count INTEGER NOT NULL DEFAULT 0 CHECK(late_event_count >= 0),
      reconciliation_status TEXT NOT NULL DEFAULT 'complete_epoch'
        CHECK(reconciliation_status IN ('complete_epoch','unreconciled_restart_gap')),
      disclosure_scope TEXT NOT NULL,
      contributor_basis TEXT NOT NULL,
      contributor_count INTEGER,
      threshold INTEGER,
      PRIMARY KEY(
        utc_day, definition_version, platform, context_type, actor_role,
        task_provider, app_version, metric
      )
    )
  `)
}

const createDailyHistogramsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_daily_histograms (
      utc_day TEXT NOT NULL,
      definition_version INTEGER NOT NULL,
      platform TEXT NOT NULL,
      context_type TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      task_provider TEXT NOT NULL,
      app_version TEXT NOT NULL,
      metric TEXT NOT NULL,
      fixed_buckets_json TEXT NOT NULL CHECK(json_valid(fixed_buckets_json)),
      counts_json TEXT NOT NULL CHECK(json_valid(counts_json)),
      sum REAL NOT NULL CHECK(sum >= 0),
      sample_count INTEGER NOT NULL CHECK(sample_count >= 0),
      finalized INTEGER NOT NULL DEFAULT 0 CHECK(finalized IN (0,1)),
      partial_day INTEGER NOT NULL DEFAULT 0,
      restart_gap_detected INTEGER NOT NULL DEFAULT 0,
      late_event_count INTEGER NOT NULL DEFAULT 0 CHECK(late_event_count >= 0),
      reconciliation_status TEXT NOT NULL DEFAULT 'complete_epoch'
        CHECK(reconciliation_status IN ('complete_epoch','unreconciled_restart_gap')),
      disclosure_scope TEXT NOT NULL,
      contributor_basis TEXT NOT NULL,
      contributor_count INTEGER,
      threshold INTEGER,
      PRIMARY KEY(
        utc_day, definition_version, platform, context_type, actor_role,
        task_provider, app_version, metric
      )
    )
  `)
}

const createEpochSourceCountersTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_epoch_source_counters (
      epoch_id TEXT NOT NULL
        REFERENCES analytics_process_epochs(epoch_id) ON DELETE RESTRICT,
      utc_day TEXT NOT NULL,
      source_family TEXT NOT NULL
        CHECK(source_family IN (
          'chat','auth','turn','reply','llm','agent_tool','confirmation',
          'steering','stop','clarification','rephrase','disclosure','settings',
          'task','intent','feature','live_status','provider','rate_limit',
          'unconfigured','mcp','guest'
        )),
      disposition TEXT NOT NULL CHECK(disposition IN (
        'opportunity','canonical','normalization_reject',
        'governance_ineligible','aggregate_only','controlled_overflow'
      )),
      value INTEGER NOT NULL CHECK(value >= 0),
      PRIMARY KEY(epoch_id, utc_day, source_family, disposition)
    )
  `)
}

const createAggregateEpochContributionsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_aggregate_epoch_contributions (
      epoch_id TEXT NOT NULL
        REFERENCES analytics_process_epochs(epoch_id) ON DELETE RESTRICT,
      aggregate_cell_key TEXT NOT NULL,
      measure_kind TEXT NOT NULL CHECK(measure_kind IN ('counter','histogram')),
      counter_delta INTEGER NOT NULL CHECK(counter_delta >= 0),
      sample_count_delta INTEGER NOT NULL CHECK(sample_count_delta >= 0),
      sum_delta REAL NOT NULL CHECK(sum_delta >= 0),
      fixed_bucket_counts_delta_json TEXT NOT NULL CHECK(json_valid(fixed_bucket_counts_delta_json)),
      PRIMARY KEY(epoch_id, aggregate_cell_key)
    )
  `)
}

const createNormalizationRejectionsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_normalization_rejections (
      utc_day TEXT NOT NULL,
      source_event_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      count INTEGER NOT NULL CHECK(count >= 0),
      PRIMARY KEY(utc_day, source_event_type, reason)
    )
  `)
}

const createBackfillRunsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_backfill_runs (
      run_id TEXT PRIMARY KEY,
      source_table TEXT NOT NULL,
      high_water_row_key TEXT NOT NULL,
      policy_cutoff_ms INTEGER NOT NULL CHECK(policy_cutoff_ms >= 0),
      status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
      event_count INTEGER NOT NULL DEFAULT 0 CHECK(event_count >= 0),
      aggregate_count INTEGER NOT NULL DEFAULT 0 CHECK(aggregate_count >= 0),
      started_at_ms INTEGER NOT NULL,
      completed_at_ms INTEGER,
      failed_at_ms INTEGER
    )
  `)
}

const createBackfillEventMapTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_backfill_event_map (
      run_id TEXT NOT NULL
        REFERENCES analytics_backfill_runs(run_id) ON DELETE CASCADE,
      event_id TEXT NOT NULL
        REFERENCES analytics_events(event_id) ON DELETE RESTRICT,
      source_ref_key TEXT NOT NULL,
      PRIMARY KEY(run_id, source_ref_key),
      UNIQUE(run_id, event_id)
    )
  `)
}

const createBackfillAggregateContributionsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_backfill_aggregate_contributions (
      run_id TEXT NOT NULL
        REFERENCES analytics_backfill_runs(run_id) ON DELETE CASCADE,
      aggregate_cell_key TEXT NOT NULL,
      metric TEXT NOT NULL,
      delta INTEGER NOT NULL CHECK(delta >= 0),
      source_ref_key TEXT NOT NULL,
      PRIMARY KEY(run_id, source_ref_key, metric, aggregate_cell_key)
    )
  `)
}

const up = (db: Database): void => {
  createProcessEpochsTable(db)
  createEventsTable(db)
  createEventsIndexes(db)
  createDailyCountersTable(db)
  createDailyHistogramsTable(db)
  createEpochSourceCountersTable(db)
  createAggregateEpochContributionsTable(db)
  createNormalizationRejectionsTable(db)
  createBackfillRunsTable(db)
  createBackfillEventMapTable(db)
  createBackfillAggregateContributionsTable(db)
}

export const migration072AnalyticsFoundation: Migration = {
  id: '072_analytics_foundation',
  up,
}

export default migration072AnalyticsFoundation
