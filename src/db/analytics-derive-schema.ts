// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { analyticsEvents } from './analytics-schema.js'

export const analyticsSessions = sqliteTable(
  'analytics_sessions',
  {
    sessionKey: text('session_key').primaryKey(),
    storageGeneration: text('storage_generation').notNull(),
    actorKey: text('actor_key').notNull(),
    conversationKey: text('conversation_key').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    durationMs: integer('duration_ms').notNull(),
    activityCount: integer('activity_count').notNull(),
    turnCount: integer('turn_count').notNull(),
    firstEventId: text('first_event_id')
      .notNull()
      .references(() => analyticsEvents.eventId, { onDelete: 'cascade' }),
    lastEventId: text('last_event_id')
      .notNull()
      .references(() => analyticsEvents.eventId, { onDelete: 'cascade' }),
    sessionizationVersion: integer('sessionization_version').notNull(),
  },
  (table) => [
    index('idx_analytics_sessions_actor_time').on(table.actorKey, table.startMs),
    index('idx_analytics_sessions_conversation_time').on(table.conversationKey, table.startMs),
    index('idx_analytics_sessions_version').on(table.sessionizationVersion),
  ],
)

export const analyticsSessionEvents = sqliteTable(
  'analytics_session_events',
  {
    sessionKey: text('session_key')
      .notNull()
      .references(() => analyticsSessions.sessionKey, { onDelete: 'cascade' }),
    eventId: text('event_id')
      .notNull()
      .references(() => analyticsEvents.eventId, { onDelete: 'cascade' }),
    occurredAtMs: integer('occurred_at_ms').notNull(),
    extendsSession: integer('extends_session', { mode: 'boolean' }).notNull(),
    sessionizationVersion: integer('sessionization_version').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionKey, table.eventId] }),
    index('idx_analytics_session_events_event').on(table.eventId),
  ],
)

export const analyticsGoalAttempts = sqliteTable(
  'analytics_goal_attempts',
  {
    attemptKey: text('attempt_key').primaryKey(),
    storageGeneration: text('storage_generation').notNull(),
    turnKey: text('turn_key').notNull(),
    goal: text('goal').notNull(),
    actorKey: text('actor_key').notNull(),
    conversationKey: text('conversation_key').notNull(),
    startMs: integer('start_ms').notNull(),
    matureAtMs: integer('mature_at_ms').notNull(),
    outcome: text('outcome').notNull(),
    resolvedAtMs: integer('resolved_at_ms'),
    anchorEventId: text('anchor_event_id')
      .notNull()
      .references(() => analyticsEvents.eventId, { onDelete: 'cascade' }),
    outcomeVersion: integer('outcome_version').notNull(),
  },
  (table) => [
    uniqueIndex('idx_analytics_goal_attempts_turn_goal_version').on(table.turnKey, table.goal, table.outcomeVersion),
    index('idx_analytics_goal_attempts_actor_time').on(table.actorKey, table.startMs),
    index('idx_analytics_goal_attempts_maturity').on(table.matureAtMs),
    index('idx_analytics_goal_attempts_version').on(table.outcomeVersion),
  ],
)

export const analyticsFeatureOpportunityDays = sqliteTable(
  'analytics_feature_opportunity_days',
  {
    actorKey: text('actor_key').notNull(),
    feature: text('feature').notNull(),
    utcDay: text('utc_day').notNull(),
    storageGeneration: text('storage_generation').notNull(),
    available: integer('available', { mode: 'boolean' }).notNull(),
    reason: text('reason').notNull(),
    opportunityEventId: text('opportunity_event_id')
      .notNull()
      .references(() => analyticsEvents.eventId, { onDelete: 'cascade' }),
    definitionVersion: integer('definition_version').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.actorKey, table.feature, table.utcDay] }),
    index('idx_analytics_feature_opportunity_days_feature_day').on(table.feature, table.utcDay, table.available),
  ],
)

export const analyticsFeatureUseDays = sqliteTable(
  'analytics_feature_use_days',
  {
    actorKey: text('actor_key').notNull(),
    feature: text('feature').notNull(),
    utcDay: text('utc_day').notNull(),
    storageGeneration: text('storage_generation').notNull(),
    successCount: integer('success_count').notNull(),
    failureCount: integer('failure_count').notNull(),
    blockedCount: integer('blocked_count').notNull(),
    joinedAvailable: integer('joined_available', { mode: 'boolean' }).notNull(),
    adopted: integer('adopted', { mode: 'boolean' }).notNull(),
    firstUseEventId: text('first_use_event_id')
      .notNull()
      .references(() => analyticsEvents.eventId, { onDelete: 'cascade' }),
    definitionVersion: integer('definition_version').notNull(),
  },
  (table) => [primaryKey({ columns: [table.actorKey, table.feature, table.utcDay] })],
)

export const analyticsTurnFriction = sqliteTable(
  'analytics_turn_friction',
  {
    turnKey: text('turn_key').notNull(),
    storageGeneration: text('storage_generation').notNull(),
    actorKey: text('actor_key').notNull(),
    conversationKey: text('conversation_key').notNull(),
    occurredAtMs: integer('occurred_at_ms').notNull(),
    rephrase: integer('rephrase', { mode: 'boolean' }).notNull(),
    clarificationAbandoned: integer('clarification_abandoned', { mode: 'boolean' }).notNull(),
    permissionIssue: integer('permission_issue', { mode: 'boolean' }).notNull(),
    stop: integer('stop', { mode: 'boolean' }).notNull(),
    longTurn: integer('long_turn', { mode: 'boolean' }).notNull(),
    disclosureFallback: integer('disclosure_fallback', { mode: 'boolean' }).notNull(),
    failureChain: integer('failure_chain', { mode: 'boolean' }).notNull(),
    componentCount: integer('component_count').notNull(),
    displayScore: integer('display_score').notNull(),
    anchorEventId: text('anchor_event_id')
      .notNull()
      .references(() => analyticsEvents.eventId, { onDelete: 'cascade' }),
    frictionVersion: integer('friction_version').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.turnKey, table.frictionVersion] }),
    index('idx_analytics_turn_friction_actor_time').on(table.actorKey, table.occurredAtMs),
    index('idx_analytics_turn_friction_version').on(table.frictionVersion),
  ],
)

export const analyticsCensorIntervals = sqliteTable(
  'analytics_censor_intervals',
  {
    actorKey: text('actor_key').notNull(),
    kind: text('kind').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms'),
    censorVersion: integer('censor_version').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.actorKey, table.kind, table.censorVersion] }),
    index('idx_analytics_censor_intervals_start').on(table.startMs),
  ],
)

export type AnalyticsSessionRow = typeof analyticsSessions.$inferSelect
export type AnalyticsSessionEventRow = typeof analyticsSessionEvents.$inferSelect
export type AnalyticsGoalAttemptRow = typeof analyticsGoalAttempts.$inferSelect
export type AnalyticsFeatureOpportunityDayRow = typeof analyticsFeatureOpportunityDays.$inferSelect
export type AnalyticsFeatureUseDayRow = typeof analyticsFeatureUseDays.$inferSelect
export type AnalyticsTurnFrictionRow = typeof analyticsTurnFriction.$inferSelect
export type AnalyticsCensorIntervalRow = typeof analyticsCensorIntervals.$inferSelect
