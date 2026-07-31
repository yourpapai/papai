// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration072AnalyticsFoundation } from '../../../src/db/migrations/072_analytics_foundation.js'
import { migration073AnalyticsGovernance } from '../../../src/db/migrations/073_analytics_governance.js'
import { migration074AnalyticsDelivery } from '../../../src/db/migrations/074_analytics_delivery.js'
import { migration075AnalyticsMaterializations } from '../../../src/db/migrations/075_analytics_materializations.js'

const getTableNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name)

const getIndexNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='index'")
    .all()
    .map((r) => r.name)

const DERIVED_TABLES = [
  'analytics_sessions',
  'analytics_session_events',
  'analytics_goal_attempts',
  'analytics_feature_opportunity_days',
  'analytics_feature_use_days',
  'analytics_turn_friction',
  'analytics_censor_intervals',
]

const insertMinimalEvent = (db: Database, eventId: string, occurredAtMs = 1700000000000): void => {
  db.run(
    `INSERT OR IGNORE INTO analytics_process_epochs (epoch_id, state, started_at_ms) VALUES ('epoch-1', 'open', 1700000000000)`,
  )
  db.run(
    `INSERT INTO analytics_events (
       event_id, storage_generation, process_epoch_id, source_ref_key, source_kind,
       schema_version, event_name, event_version, occurred_at_ms, ingested_at_ms,
       source, attribution_quality, app_version, deployment_key, key_version,
       platform, platform_instance_key, actor_key, context_type, actor_role, task_provider,
       invocation_mode, policy_version, eligibility, max_class, props_json, expires_at_ms
     ) VALUES (
       ?, 'gen-1', 'epoch-1', ?, 'live',
       1, 'turn_completed', 1, ?, 1700000000001,
       'live', 'native', '6.10.0', 'v1.p-deploy', 'v1',
       'telegram', 'v1.p-instance', 'v1.p-actor', 'dm', 'member', 'none',
       'normal', 1, 'allowed', 'C0', '{}', 1700000000002
     )`,
    [eventId, `ref-${eventId}`, occurredAtMs],
  )
}

const insertSession = (db: Database, sessionKey: string, firstEventId: string, lastEventId: string): void => {
  db.run(
    `INSERT INTO analytics_sessions (
       session_key, storage_generation, actor_key, conversation_key,
       start_ms, end_ms, duration_ms, activity_count, turn_count,
       first_event_id, last_event_id, sessionization_version
     ) VALUES (?, 'gen-1', 'v1.p-actor', 'v1.p-conversation', 1700000000000, 1700000001000, 1000, 1, 1, ?, ?, 1)`,
    [sessionKey, firstEventId, lastEventId],
  )
}

const insertSessionEvent = (db: Database, sessionKey: string, eventId: string): void => {
  db.run(
    `INSERT INTO analytics_session_events (session_key, event_id, occurred_at_ms, extends_session, sessionization_version)
     VALUES (?, ?, 1700000000000, 1, 1)`,
    [sessionKey, eventId],
  )
}

const insertGoalAttempt = (
  db: Database,
  attemptKey: string,
  turnKey: string,
  goal: string,
  anchorEventId: string,
  outcome = 'immediate_success',
): void => {
  db.run(
    `INSERT INTO analytics_goal_attempts (
       attempt_key, storage_generation, turn_key, goal, actor_key, conversation_key,
       start_ms, mature_at_ms, outcome, resolved_at_ms, anchor_event_id, outcome_version
     ) VALUES (?, 'gen-1', ?, ?, 'v1.p-actor', 'v1.p-conversation', 1700000000000, 1700086400000, ?, 1700000001000, ?, 1)`,
    [attemptKey, turnKey, goal, outcome, anchorEventId],
  )
}

const countRows = (db: Database, table: string): number => {
  const row = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()
  if (row === null) throw new Error('count query returned no row')
  return row.n
}

const insertFriction = (db: Database, turnKey: string, anchorEventId: string): void => {
  db.run(
    `INSERT INTO analytics_turn_friction (
       turn_key, storage_generation, actor_key, conversation_key, occurred_at_ms,
       rephrase, clarification_abandoned, permission_issue, stop, long_turn, disclosure_fallback, failure_chain,
       component_count, display_score, anchor_event_id, friction_version
     ) VALUES (?, 'gen-1', 'v1.p-actor', 'v1.p-conversation', 1700000000000, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, 1)`,
    [turnKey, anchorEventId],
  )
}

describe('migration 075_analytics_materializations', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys=ON')
    migration072AnalyticsFoundation.up(db)
    migration073AnalyticsGovernance.up(db)
    migration074AnalyticsDelivery.up(db)
    migration075AnalyticsMaterializations.up(db)
  })

  afterEach(() => {
    db.close()
  })

  test('exports a migration with the expected id', () => {
    expect(migration075AnalyticsMaterializations.id).toBe('075_analytics_materializations')
    expect(typeof migration075AnalyticsMaterializations.up).toBe('function')
  })

  test('creates every derived table', () => {
    const tables = getTableNames(db)
    for (const table of DERIVED_TABLES) {
      expect(tables).toContain(table)
    }
  })

  test('creates actor/time, conversation/time, maturity, and definition-version indexes', () => {
    const indexes = getIndexNames(db)
    for (const name of [
      'idx_analytics_sessions_actor_time',
      'idx_analytics_sessions_conversation_time',
      'idx_analytics_sessions_version',
      'idx_analytics_session_events_event',
      'idx_analytics_goal_attempts_actor_time',
      'idx_analytics_goal_attempts_maturity',
      'idx_analytics_goal_attempts_version',
      'idx_analytics_feature_opportunity_days_feature_day',
      'idx_analytics_turn_friction_actor_time',
      'idx_analytics_turn_friction_version',
      'idx_analytics_censor_intervals_start',
    ]) {
      expect(indexes).toContain(name)
    }
  })

  test('pins definition versions to 1', () => {
    insertMinimalEvent(db, 'ev-1')
    expect(() =>
      db.run(
        `INSERT INTO analytics_sessions (
           session_key, storage_generation, actor_key, conversation_key,
           start_ms, end_ms, duration_ms, activity_count, turn_count,
           first_event_id, last_event_id, sessionization_version
         ) VALUES ('v1.s-bad', 'gen-1', 'v1.p-actor', 'v1.p-conversation', 1, 1, 0, 1, 1, 'ev-1', 'ev-1', 2)`,
      ),
    ).toThrow()
    expect(() => insertGoalAttempt(db, 'v1.a-bad-version', 'v1.p-turn-bv', 'I01', 'ev-1')).not.toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_goal_attempts (
           attempt_key, storage_generation, turn_key, goal, actor_key, conversation_key,
           start_ms, mature_at_ms, outcome, resolved_at_ms, anchor_event_id, outcome_version
         ) VALUES ('v1.a-bad2', 'gen-1', 'v1.p-turn-bv2', 'I01', 'v1.p-actor', 'v1.p-conversation', 1, 1, 'censored', null, 'ev-1', 2)`,
      ),
    ).toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_turn_friction (
           turn_key, storage_generation, actor_key, conversation_key, occurred_at_ms,
           rephrase, clarification_abandoned, permission_issue, stop, long_turn, disclosure_fallback, failure_chain,
           component_count, display_score, anchor_event_id, friction_version
         ) VALUES ('v1.p-turn-fbad', 'gen-1', 'v1.p-actor', 'v1.p-conversation', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'ev-1', 2)`,
      ),
    ).toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_censor_intervals (actor_key, kind, start_ms, end_ms, censor_version)
         VALUES ('v1.p-actor', 'withdrawal', 1, null, 2)`,
      ),
    ).toThrow()
  })

  test('goal attempts use the eight closed terminal categories', () => {
    insertMinimalEvent(db, 'ev-2')
    const outcomes = [
      'immediate_success',
      'recovered_same_turn',
      'recovered_next_turn',
      'unresolved_engaged',
      'abandoned_after_failure',
      'abandoned_after_clarification',
      'abandoned_after_no_action',
      'censored',
    ]
    const insertOutcome =
      (index: number, outcome: string): (() => void) =>
      () => {
        insertGoalAttempt(db, `v1.a-${index}`, `v1.p-turn-o${index}`, 'I01', 'ev-2', outcome)
      }
    for (const [index, outcome] of outcomes.entries()) {
      expect(insertOutcome(index, outcome)).not.toThrow()
    }
    expect(() =>
      insertGoalAttempt(db, 'v1.a-bad-outcome', 'v1.p-turn-bad', 'I01', 'ev-2', 'worked_first_time'),
    ).toThrow()
  })

  test('goal attempts are unique per (turn_key, goal, outcome_version) and multi-goal turns allow three', () => {
    insertMinimalEvent(db, 'ev-3')
    insertGoalAttempt(db, 'v1.a-g1', 'v1.p-turn-multi', 'I01', 'ev-3')
    insertGoalAttempt(db, 'v1.a-g2', 'v1.p-turn-multi', 'I02', 'ev-3')
    insertGoalAttempt(db, 'v1.a-g3', 'v1.p-turn-multi', 'I03', 'ev-3')
    expect(() => insertGoalAttempt(db, 'v1.a-g4', 'v1.p-turn-multi', 'I01', 'ev-3')).toThrow()
  })

  test('friction is unique per (turn_key, friction_version) with a 0..7 component count and 0..100 score', () => {
    insertMinimalEvent(db, 'ev-4')
    insertFriction(db, 'v1.p-turn-f1', 'ev-4')
    expect(() => insertFriction(db, 'v1.p-turn-f1', 'ev-4')).toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_turn_friction (
           turn_key, storage_generation, actor_key, conversation_key, occurred_at_ms,
           rephrase, clarification_abandoned, permission_issue, stop, long_turn, disclosure_fallback, failure_chain,
           component_count, display_score, anchor_event_id, friction_version
         ) VALUES ('v1.p-turn-f8', 'gen-1', 'v1.p-actor', 'v1.p-conversation', 1, 1, 1, 1, 1, 1, 1, 1, 8, 100, 'ev-4', 1)`,
      ),
    ).toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_turn_friction (
           turn_key, storage_generation, actor_key, conversation_key, occurred_at_ms,
           rephrase, clarification_abandoned, permission_issue, stop, long_turn, disclosure_fallback, failure_chain,
           component_count, display_score, anchor_event_id, friction_version
         ) VALUES ('v1.p-turn-f101', 'gen-1', 'v1.p-actor', 'v1.p-conversation', 1, 1, 1, 1, 1, 1, 1, 1, 7, 101, 'ev-4', 1)`,
      ),
    ).toThrow()
    db.run(
      `INSERT INTO analytics_turn_friction (
         turn_key, storage_generation, actor_key, conversation_key, occurred_at_ms,
         rephrase, clarification_abandoned, permission_issue, stop, long_turn, disclosure_fallback, failure_chain,
         component_count, display_score, anchor_event_id, friction_version
       ) VALUES ('v1.p-turn-f7', 'gen-1', 'v1.p-actor', 'v1.p-conversation', 1, 1, 1, 1, 1, 1, 1, 1, 7, 100, 'ev-4', 1)`,
    )
  })

  test('feature days are unique per (actor_key, feature, utc_day)', () => {
    insertMinimalEvent(db, 'ev-5')
    const insertOpportunity = (day: string): void => {
      db.run(
        `INSERT INTO analytics_feature_opportunity_days (
           actor_key, feature, utc_day, storage_generation, available, reason, opportunity_event_id, definition_version
         ) VALUES ('v1.p-actor', 'coding', ?, 'gen-1', 1, 'available', 'ev-5', 1)`,
        [day],
      )
    }
    insertOpportunity('2023-11-14')
    expect(() => insertOpportunity('2023-11-14')).toThrow()
    expect(() => insertOpportunity('2023-11-15')).not.toThrow()
    const insertUse = (day: string): void => {
      db.run(
        `INSERT INTO analytics_feature_use_days (
           actor_key, feature, utc_day, storage_generation,
           success_count, failure_count, blocked_count, joined_available, adopted, first_use_event_id, definition_version
         ) VALUES ('v1.p-actor', 'coding', ?, 'gen-1', 1, 0, 0, 1, 1, 'ev-5', 1)`,
        [day],
      )
    }
    insertUse('2023-11-14')
    expect(() => insertUse('2023-11-14')).toThrow()
  })

  test('censor intervals use a closed kind and are unique per (actor_key, kind, censor_version)', () => {
    db.run(
      `INSERT INTO analytics_censor_intervals (actor_key, kind, start_ms, end_ms, censor_version)
       VALUES ('v1.p-actor', 'withdrawal', 1700000000000, null, 1)`,
    )
    expect(() =>
      db.run(
        `INSERT INTO analytics_censor_intervals (actor_key, kind, start_ms, end_ms, censor_version)
         VALUES ('v1.p-actor', 'withdrawal', 1700000001000, null, 1)`,
      ),
    ).toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_censor_intervals (actor_key, kind, start_ms, end_ms, censor_version)
         VALUES ('v1.p-actor', 'churn', 1700000001000, null, 1)`,
      ),
    ).toThrow()
  })

  test('derived rows cascade on anchor event deletion', () => {
    insertMinimalEvent(db, 'ev-6')
    insertMinimalEvent(db, 'ev-7', 1700000001000)
    insertSession(db, 'v1.s-1', 'ev-6', 'ev-7')
    insertSessionEvent(db, 'v1.s-1', 'ev-6')
    insertSessionEvent(db, 'v1.s-1', 'ev-7')
    insertGoalAttempt(db, 'v1.a-cascade', 'v1.p-turn-cascade', 'I01', 'ev-6')
    insertFriction(db, 'v1.p-turn-cascade', 'ev-6')
    db.run(
      `INSERT INTO analytics_feature_opportunity_days (
         actor_key, feature, utc_day, storage_generation, available, reason, opportunity_event_id, definition_version
       ) VALUES ('v1.p-actor', 'coding', '2023-11-14', 'gen-1', 1, 'available', 'ev-6', 1)`,
    )
    db.run(
      `INSERT INTO analytics_feature_use_days (
         actor_key, feature, utc_day, storage_generation,
         success_count, failure_count, blocked_count, joined_available, adopted, first_use_event_id, definition_version
       ) VALUES ('v1.p-actor', 'coding', '2023-11-14', 'gen-1', 1, 0, 0, 1, 1, 'ev-7', 1)`,
    )
    db.run('DELETE FROM analytics_events WHERE event_id = ?', ['ev-6'])
    const count = (table: string): number => countRows(db, table)
    expect(count('analytics_sessions')).toBe(0)
    expect(count('analytics_session_events')).toBe(0)
    expect(count('analytics_goal_attempts')).toBe(0)
    expect(count('analytics_turn_friction')).toBe(0)
    expect(count('analytics_feature_opportunity_days')).toBe(0)
    expect(count('analytics_feature_use_days')).toBe(1)
    db.run('DELETE FROM analytics_events WHERE event_id = ?', ['ev-7'])
    expect(count('analytics_feature_use_days')).toBe(0)
  })
})
