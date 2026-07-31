// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

const OUTCOME_CATEGORIES = [
  'immediate_success',
  'recovered_same_turn',
  'recovered_next_turn',
  'unresolved_engaged',
  'abandoned_after_failure',
  'abandoned_after_clarification',
  'abandoned_after_no_action',
  'censored',
] as const

const CENSOR_KINDS = ['withdrawal', 'deletion'] as const

const sqlList = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(',')

const createSessionsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_sessions (
      session_key TEXT PRIMARY KEY,
      storage_generation TEXT NOT NULL,
      actor_key TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      start_ms INTEGER NOT NULL CHECK(start_ms >= 0),
      end_ms INTEGER NOT NULL CHECK(end_ms >= start_ms),
      duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
      activity_count INTEGER NOT NULL CHECK(activity_count >= 0),
      turn_count INTEGER NOT NULL CHECK(turn_count >= 0),
      first_event_id TEXT NOT NULL
        REFERENCES analytics_events(event_id) ON DELETE CASCADE,
      last_event_id TEXT NOT NULL
        REFERENCES analytics_events(event_id) ON DELETE CASCADE,
      sessionization_version INTEGER NOT NULL CHECK(sessionization_version = 1)
    )
  `)
  db.run(`
    CREATE INDEX idx_analytics_sessions_actor_time
      ON analytics_sessions(actor_key, start_ms)
  `)
  db.run(`
    CREATE INDEX idx_analytics_sessions_conversation_time
      ON analytics_sessions(conversation_key, start_ms)
  `)
  db.run(`
    CREATE INDEX idx_analytics_sessions_version
      ON analytics_sessions(sessionization_version)
  `)
}

const createSessionEventsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_session_events (
      session_key TEXT NOT NULL
        REFERENCES analytics_sessions(session_key) ON DELETE CASCADE,
      event_id TEXT NOT NULL
        REFERENCES analytics_events(event_id) ON DELETE CASCADE,
      occurred_at_ms INTEGER NOT NULL CHECK(occurred_at_ms >= 0),
      extends_session INTEGER NOT NULL CHECK(extends_session IN (0, 1)),
      sessionization_version INTEGER NOT NULL CHECK(sessionization_version = 1),
      PRIMARY KEY(session_key, event_id)
    )
  `)
  db.run(`
    CREATE INDEX idx_analytics_session_events_event
      ON analytics_session_events(event_id)
  `)
}

const createGoalAttemptsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_goal_attempts (
      attempt_key TEXT PRIMARY KEY,
      storage_generation TEXT NOT NULL,
      turn_key TEXT NOT NULL,
      goal TEXT NOT NULL,
      actor_key TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      start_ms INTEGER NOT NULL CHECK(start_ms >= 0),
      mature_at_ms INTEGER NOT NULL CHECK(mature_at_ms >= start_ms),
      outcome TEXT NOT NULL CHECK(outcome IN (${sqlList(OUTCOME_CATEGORIES)})),
      resolved_at_ms INTEGER CHECK(resolved_at_ms IS NULL OR resolved_at_ms >= 0),
      anchor_event_id TEXT NOT NULL
        REFERENCES analytics_events(event_id) ON DELETE CASCADE,
      outcome_version INTEGER NOT NULL CHECK(outcome_version = 1),
      UNIQUE(turn_key, goal, outcome_version)
    )
  `)
  db.run(`
    CREATE INDEX idx_analytics_goal_attempts_actor_time
      ON analytics_goal_attempts(actor_key, start_ms)
  `)
  db.run(`
    CREATE INDEX idx_analytics_goal_attempts_maturity
      ON analytics_goal_attempts(mature_at_ms)
  `)
  db.run(`
    CREATE INDEX idx_analytics_goal_attempts_version
      ON analytics_goal_attempts(outcome_version)
  `)
}

const createFeatureOpportunityDaysTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_feature_opportunity_days (
      actor_key TEXT NOT NULL,
      feature TEXT NOT NULL,
      utc_day TEXT NOT NULL,
      storage_generation TEXT NOT NULL,
      available INTEGER NOT NULL CHECK(available IN (0, 1)),
      reason TEXT NOT NULL,
      opportunity_event_id TEXT NOT NULL
        REFERENCES analytics_events(event_id) ON DELETE CASCADE,
      definition_version INTEGER NOT NULL CHECK(definition_version = 1),
      PRIMARY KEY(actor_key, feature, utc_day)
    )
  `)
  db.run(`
    CREATE INDEX idx_analytics_feature_opportunity_days_feature_day
      ON analytics_feature_opportunity_days(feature, utc_day, available)
  `)
}

const createFeatureUseDaysTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_feature_use_days (
      actor_key TEXT NOT NULL,
      feature TEXT NOT NULL,
      utc_day TEXT NOT NULL,
      storage_generation TEXT NOT NULL,
      success_count INTEGER NOT NULL CHECK(success_count >= 0),
      failure_count INTEGER NOT NULL CHECK(failure_count >= 0),
      blocked_count INTEGER NOT NULL CHECK(blocked_count >= 0),
      joined_available INTEGER NOT NULL CHECK(joined_available IN (0, 1)),
      adopted INTEGER NOT NULL CHECK(adopted IN (0, 1)),
      first_use_event_id TEXT NOT NULL
        REFERENCES analytics_events(event_id) ON DELETE CASCADE,
      definition_version INTEGER NOT NULL CHECK(definition_version = 1),
      PRIMARY KEY(actor_key, feature, utc_day)
    )
  `)
}

const FRICTION_COMPONENT_COLUMNS = [
  'rephrase',
  'clarification_abandoned',
  'permission_issue',
  'stop',
  'long_turn',
  'disclosure_fallback',
  'failure_chain',
] as const

const createTurnFrictionTable = (db: Database): void => {
  const components = FRICTION_COMPONENT_COLUMNS.map(
    (column) => `      ${column} INTEGER NOT NULL CHECK(${column} IN (0, 1)),`,
  ).join('\n')
  db.run(`
    CREATE TABLE analytics_turn_friction (
      turn_key TEXT NOT NULL,
      storage_generation TEXT NOT NULL,
      actor_key TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      occurred_at_ms INTEGER NOT NULL CHECK(occurred_at_ms >= 0),
${components}
      component_count INTEGER NOT NULL CHECK(component_count BETWEEN 0 AND 7),
      display_score INTEGER NOT NULL CHECK(display_score BETWEEN 0 AND 100),
      anchor_event_id TEXT NOT NULL
        REFERENCES analytics_events(event_id) ON DELETE CASCADE,
      friction_version INTEGER NOT NULL CHECK(friction_version = 1),
      PRIMARY KEY(turn_key, friction_version)
    )
  `)
  db.run(`
    CREATE INDEX idx_analytics_turn_friction_actor_time
      ON analytics_turn_friction(actor_key, occurred_at_ms)
  `)
  db.run(`
    CREATE INDEX idx_analytics_turn_friction_version
      ON analytics_turn_friction(friction_version)
  `)
}

const createCensorIntervalsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_censor_intervals (
      actor_key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN (${sqlList(CENSOR_KINDS)})),
      start_ms INTEGER NOT NULL CHECK(start_ms >= 0),
      end_ms INTEGER CHECK(end_ms IS NULL OR end_ms >= start_ms),
      censor_version INTEGER NOT NULL CHECK(censor_version = 1),
      PRIMARY KEY(actor_key, kind, censor_version)
    )
  `)
  db.run(`
    CREATE INDEX idx_analytics_censor_intervals_start
      ON analytics_censor_intervals(start_ms)
  `)
}

const up = (db: Database): void => {
  createSessionsTable(db)
  createSessionEventsTable(db)
  createGoalAttemptsTable(db)
  createFeatureOpportunityDaysTable(db)
  createFeatureUseDaysTable(db)
  createTurnFrictionTable(db)
  createCensorIntervalsTable(db)
}

export const migration075AnalyticsMaterializations: Migration = {
  id: '075_analytics_materializations',
  up,
}

export default migration075AnalyticsMaterializations
