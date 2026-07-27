// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { PROP_EXTRACTIONS } from './snapshot-props.js'

export { CURATED_EVENT_PROP_COLUMNS, extractTypedProps, PROP_EXTRACTIONS } from './snapshot-props.js'
export type { PropExtraction, PropKind } from './snapshot-props.js'

export type SnapshotMode = 'pseudonymous' | 'aggregate_only'

export const SNAPSHOT_MODEL_VERSIONS: Readonly<Record<string, number>> = {
  '00-data-health': 1,
  '01-activation': 1,
  '02-retention-engagement': 1,
  '03-intents-features': 1,
  '04-reliability-friction-performance': 1,
}

const CURATED_EVENT_COLUMNS: readonly string[] = [
  'event_id TEXT PRIMARY KEY',
  'event_name TEXT NOT NULL',
  'occurred_at_ms INTEGER NOT NULL',
  'utc_day TEXT NOT NULL',
  'platform TEXT NOT NULL',
  'platform_instance_key TEXT NOT NULL',
  'context_type TEXT NOT NULL',
  'actor_role TEXT NOT NULL',
  'task_provider TEXT NOT NULL',
  'app_version TEXT NOT NULL',
  'invocation_mode TEXT NOT NULL',
  'eligibility TEXT NOT NULL',
  'actor_key TEXT',
  'context_key TEXT',
  'thread_key TEXT',
  'conversation_key TEXT',
  'task_instance_key TEXT',
  'turn_key TEXT',
  'session_key TEXT',
  ...PROP_EXTRACTIONS.map((entry) =>
    entry.kind === 'text' || entry.kind === 'json'
      ? `${entry.column} TEXT`
      : `${entry.column} ${entry.kind === 'integer' ? 'INTEGER' : 'REAL'}`,
  ),
]

const ACTOR_LEVEL_TABLE_DDLS: readonly string[] = [
  `CREATE TABLE curated_events (${CURATED_EVENT_COLUMNS.join(', ')})`,
  `CREATE TABLE curated_sessions (
     session_key TEXT PRIMARY KEY,
     actor_key TEXT NOT NULL,
     conversation_key TEXT NOT NULL,
     start_ms INTEGER NOT NULL,
     end_ms INTEGER NOT NULL,
     duration_ms INTEGER NOT NULL,
     activity_count INTEGER NOT NULL,
     turn_count INTEGER NOT NULL,
     sessionization_version INTEGER NOT NULL
   )`,
  `CREATE TABLE curated_session_events (
     session_key TEXT NOT NULL,
     event_id TEXT NOT NULL,
     occurred_at_ms INTEGER NOT NULL,
     extends_session INTEGER NOT NULL,
     sessionization_version INTEGER NOT NULL,
     PRIMARY KEY (session_key, event_id)
   )`,
  `CREATE TABLE curated_goal_attempts (
     attempt_key TEXT PRIMARY KEY,
     turn_key TEXT NOT NULL,
     goal TEXT NOT NULL,
     actor_key TEXT NOT NULL,
     conversation_key TEXT NOT NULL,
     start_ms INTEGER NOT NULL,
     mature_at_ms INTEGER NOT NULL,
     outcome TEXT NOT NULL,
     resolved_at_ms INTEGER,
     outcome_version INTEGER NOT NULL
   )`,
  `CREATE TABLE curated_feature_opportunity_days (
     actor_key TEXT NOT NULL,
     feature TEXT NOT NULL,
     utc_day TEXT NOT NULL,
     available INTEGER NOT NULL,
     reason TEXT NOT NULL,
     opportunity_event_id TEXT NOT NULL,
     definition_version INTEGER NOT NULL,
     PRIMARY KEY (actor_key, feature, utc_day)
   )`,
  `CREATE TABLE curated_feature_use_days (
     actor_key TEXT NOT NULL,
     feature TEXT NOT NULL,
     utc_day TEXT NOT NULL,
     success_count INTEGER NOT NULL,
     failure_count INTEGER NOT NULL,
     blocked_count INTEGER NOT NULL,
     joined_available INTEGER NOT NULL,
     adopted INTEGER NOT NULL,
     first_use_event_id TEXT NOT NULL,
     definition_version INTEGER NOT NULL,
     PRIMARY KEY (actor_key, feature, utc_day)
   )`,
  `CREATE TABLE curated_turn_friction (
     turn_key TEXT NOT NULL,
     actor_key TEXT NOT NULL,
     conversation_key TEXT NOT NULL,
     occurred_at_ms INTEGER NOT NULL,
     rephrase INTEGER NOT NULL,
     clarification_abandoned INTEGER NOT NULL,
     permission_issue INTEGER NOT NULL,
     stop INTEGER NOT NULL,
     long_turn INTEGER NOT NULL,
     disclosure_fallback INTEGER NOT NULL,
     failure_chain INTEGER NOT NULL,
     component_count INTEGER NOT NULL,
     display_score INTEGER NOT NULL,
     anchor_event_id TEXT NOT NULL,
     friction_version INTEGER NOT NULL,
     PRIMARY KEY (turn_key, friction_version)
   )`,
  `CREATE TABLE curated_censor_intervals (
     actor_key TEXT NOT NULL,
     kind TEXT NOT NULL,
     start_ms INTEGER NOT NULL,
     end_ms INTEGER,
     censor_version INTEGER NOT NULL,
     PRIMARY KEY (actor_key, kind, censor_version)
   )`,
]

const AGGREGATE_TABLE_DDLS: readonly string[] = [
  `CREATE TABLE analytics_daily_counters (
     utc_day TEXT NOT NULL,
     definition_version INTEGER NOT NULL,
     platform TEXT NOT NULL,
     context_type TEXT NOT NULL,
     actor_role TEXT NOT NULL,
     task_provider TEXT NOT NULL,
     app_version TEXT NOT NULL,
     metric TEXT NOT NULL,
     value INTEGER NOT NULL,
     finalized INTEGER NOT NULL,
     partial_day INTEGER NOT NULL,
     restart_gap_detected INTEGER NOT NULL,
     late_event_count INTEGER NOT NULL,
     reconciliation_status TEXT NOT NULL,
     disclosure_scope TEXT NOT NULL,
     contributor_basis TEXT NOT NULL,
     contributor_count INTEGER,
     threshold INTEGER,
     PRIMARY KEY (utc_day, definition_version, platform, context_type, actor_role, task_provider, app_version, metric)
   )`,
  `CREATE TABLE analytics_daily_histograms (
     utc_day TEXT NOT NULL,
     definition_version INTEGER NOT NULL,
     platform TEXT NOT NULL,
     context_type TEXT NOT NULL,
     actor_role TEXT NOT NULL,
     task_provider TEXT NOT NULL,
     app_version TEXT NOT NULL,
     metric TEXT NOT NULL,
     fixed_buckets_json TEXT NOT NULL,
     counts_json TEXT NOT NULL,
     sum REAL NOT NULL,
     sample_count INTEGER NOT NULL,
     finalized INTEGER NOT NULL,
     partial_day INTEGER NOT NULL,
     restart_gap_detected INTEGER NOT NULL,
     late_event_count INTEGER NOT NULL,
     reconciliation_status TEXT NOT NULL,
     disclosure_scope TEXT NOT NULL,
     contributor_basis TEXT NOT NULL,
     contributor_count INTEGER,
     threshold INTEGER,
     PRIMARY KEY (utc_day, definition_version, platform, context_type, actor_role, task_provider, app_version, metric)
   )`,
  `CREATE TABLE analytics_normalization_rejections (
     utc_day TEXT NOT NULL,
     source_event_type TEXT NOT NULL,
     reason TEXT NOT NULL,
     count INTEGER NOT NULL,
     PRIMARY KEY (utc_day, source_event_type, reason)
   )`,
]

const SNAPSHOT_META_DDL = `CREATE TABLE snapshot_meta (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  snapshot_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  storage_generation TEXT NOT NULL,
  source_high_water TEXT NOT NULL,
  source_row_count INTEGER NOT NULL,
  curated_row_counts_json TEXT NOT NULL,
  model_versions_json TEXT NOT NULL,
  reconciliation_status TEXT NOT NULL,
  snapshot_mode TEXT NOT NULL
)`

const ACTOR_LEVEL_TABLES = [
  'curated_events',
  'curated_sessions',
  'curated_session_events',
  'curated_goal_attempts',
  'curated_feature_opportunity_days',
  'curated_feature_use_days',
  'curated_turn_friction',
  'curated_censor_intervals',
] as const

const AGGREGATE_TABLES = [
  'analytics_daily_counters',
  'analytics_daily_histograms',
  'analytics_normalization_rejections',
] as const

export const CURATED_TABLES_PSEUDONYMOUS: readonly string[] = [
  'snapshot_meta',
  ...ACTOR_LEVEL_TABLES,
  ...AGGREGATE_TABLES,
]

/**
 * Aggregate-only snapshots carry the same table shells with zero actor-level
 * rows: the reviewed SQL models must still parse so they can label DAU,
 * sessions, retention, intent, cohorts, and actor adoption as UNAVAILABLE
 * instead of approximating them.
 */
export const CURATED_TABLES_AGGREGATE_ONLY: readonly string[] = CURATED_TABLES_PSEUDONYMOUS

/** Builds the fresh-empty allowlisted publish schema; never copies live DDL. */
export const createSnapshotSchema = (db: Database, mode: SnapshotMode): void => {
  void mode
  db.run(SNAPSHOT_META_DDL)
  for (const ddl of ACTOR_LEVEL_TABLE_DDLS) db.run(ddl)
  for (const ddl of AGGREGATE_TABLE_DDLS) db.run(ddl)
}
