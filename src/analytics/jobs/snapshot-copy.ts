// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { and, eq } from 'drizzle-orm'

import type { getDrizzleDb } from '../../db/drizzle.js'
import {
  analyticsCensorIntervals,
  analyticsEvents,
  analyticsFeatureOpportunityDays,
  analyticsFeatureUseDays,
  analyticsGoalAttempts,
  analyticsSessionEvents,
  analyticsSessions,
  analyticsTurnFriction,
} from '../../db/schema.js'
import { utcDayOfMs } from '../aggregate.js'
import { isUnexpired } from '../retention/expiry-guard.js'
import { copyAggregateTables } from './snapshot-copy-aggregates.js'
import { extractTypedProps } from './snapshot-schema.js'
import type { SnapshotMode } from './snapshot-schema.js'

export type SnapshotSourceDb = Pick<ReturnType<typeof getDrizzleDb>, 'select'>

export type SnapshotCopyResult = Readonly<{
  rowCounts: Readonly<Record<string, number>>
  sourceRowCount: number
  sourceHighWater: string
}>

export const insertCuratedRow = (
  db: Database,
  table: string,
  row: Readonly<Record<string, string | number | null>>,
): void => {
  const columns = Object.keys(row)
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  db.prepare(sql).run(...columns.map((column) => row[column] ?? null))
}

const readProps = (propsJson: string): Readonly<Record<string, unknown>> => {
  const parsed: unknown = JSON.parse(propsJson)
  if (typeof parsed !== 'object' || parsed === null) return {}
  return Object.fromEntries(Object.entries(parsed))
}

const copyEvents = (source: SnapshotSourceDb, publishDb: Database, generation: string, nowMs: number): number => {
  const rows = source
    .select()
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.storageGeneration, generation)))
    .all()
  let copied = 0
  for (const row of rows) {
    if (!isUnexpired(nowMs, row.expiresAtMs)) continue
    const typed = extractTypedProps(readProps(row.propsJson))
    insertCuratedRow(publishDb, 'curated_events', {
      event_id: row.eventId,
      event_name: row.eventName,
      occurred_at_ms: row.occurredAtMs,
      utc_day: utcDayOfMs(row.occurredAtMs),
      platform: row.platform,
      platform_instance_key: row.platformInstanceKey,
      context_type: row.contextType,
      actor_role: row.actorRole,
      task_provider: row.taskProvider,
      app_version: row.appVersion,
      invocation_mode: row.invocationMode,
      eligibility: row.eligibility,
      actor_key: row.actorKey,
      context_key: row.contextKey,
      thread_key: row.threadKey,
      conversation_key: row.conversationKey,
      task_instance_key: row.taskInstanceKey,
      turn_key: row.turnKey,
      session_key: row.sessionKey,
      ...typed,
    })
    copied += 1
  }
  return copied
}

const highWaterFor = (source: SnapshotSourceDb, generation: string): { count: number; maxOccurredAtMs: number } => {
  const rows = source
    .select({ occurredAtMs: analyticsEvents.occurredAtMs })
    .from(analyticsEvents)
    .where(eq(analyticsEvents.storageGeneration, generation))
    .all()
  const maxOccurredAtMs = rows.reduce((bound, row) => Math.max(bound, row.occurredAtMs), 0)
  return { count: rows.length, maxOccurredAtMs }
}

const copySessions = (source: SnapshotSourceDb, publishDb: Database, generation: string): Record<string, number> => {
  const sessions = source
    .select()
    .from(analyticsSessions)
    .where(eq(analyticsSessions.storageGeneration, generation))
    .all()
  const keptSessions = new Set(sessions.map((row) => row.sessionKey))
  for (const row of sessions) {
    insertCuratedRow(publishDb, 'curated_sessions', {
      session_key: row.sessionKey,
      actor_key: row.actorKey,
      conversation_key: row.conversationKey,
      start_ms: row.startMs,
      end_ms: row.endMs,
      duration_ms: row.durationMs,
      activity_count: row.activityCount,
      turn_count: row.turnCount,
      sessionization_version: row.sessionizationVersion,
    })
  }
  let sessionEventCount = 0
  for (const row of source.select().from(analyticsSessionEvents).all()) {
    if (!keptSessions.has(row.sessionKey)) continue
    insertCuratedRow(publishDb, 'curated_session_events', {
      session_key: row.sessionKey,
      event_id: row.eventId,
      occurred_at_ms: row.occurredAtMs,
      extends_session: row.extendsSession ? 1 : 0,
      sessionization_version: row.sessionizationVersion,
    })
    sessionEventCount += 1
  }
  return { curated_sessions: sessions.length, curated_session_events: sessionEventCount }
}

const copyGoalAttempts = (
  source: SnapshotSourceDb,
  publishDb: Database,
  generation: string,
): Record<string, number> => {
  const attempts = source
    .select()
    .from(analyticsGoalAttempts)
    .where(eq(analyticsGoalAttempts.storageGeneration, generation))
    .all()
  for (const row of attempts) {
    insertCuratedRow(publishDb, 'curated_goal_attempts', {
      attempt_key: row.attemptKey,
      turn_key: row.turnKey,
      goal: row.goal,
      actor_key: row.actorKey,
      conversation_key: row.conversationKey,
      start_ms: row.startMs,
      mature_at_ms: row.matureAtMs,
      outcome: row.outcome,
      resolved_at_ms: row.resolvedAtMs,
      outcome_version: row.outcomeVersion,
    })
  }
  return { curated_goal_attempts: attempts.length }
}

const copyFeatureDays = (source: SnapshotSourceDb, publishDb: Database, generation: string): Record<string, number> => {
  const opportunities = source
    .select()
    .from(analyticsFeatureOpportunityDays)
    .where(eq(analyticsFeatureOpportunityDays.storageGeneration, generation))
    .all()
  for (const row of opportunities) {
    insertCuratedRow(publishDb, 'curated_feature_opportunity_days', {
      actor_key: row.actorKey,
      feature: row.feature,
      utc_day: row.utcDay,
      available: row.available ? 1 : 0,
      reason: row.reason,
      opportunity_event_id: row.opportunityEventId,
      definition_version: row.definitionVersion,
    })
  }
  const useDays = source
    .select()
    .from(analyticsFeatureUseDays)
    .where(eq(analyticsFeatureUseDays.storageGeneration, generation))
    .all()
  for (const row of useDays) {
    insertCuratedRow(publishDb, 'curated_feature_use_days', {
      actor_key: row.actorKey,
      feature: row.feature,
      utc_day: row.utcDay,
      success_count: row.successCount,
      failure_count: row.failureCount,
      blocked_count: row.blockedCount,
      joined_available: row.joinedAvailable ? 1 : 0,
      adopted: row.adopted ? 1 : 0,
      first_use_event_id: row.firstUseEventId,
      definition_version: row.definitionVersion,
    })
  }
  return {
    curated_feature_opportunity_days: opportunities.length,
    curated_feature_use_days: useDays.length,
  }
}

const copyFriction = (source: SnapshotSourceDb, publishDb: Database, generation: string): Record<string, number> => {
  const friction = source
    .select()
    .from(analyticsTurnFriction)
    .where(eq(analyticsTurnFriction.storageGeneration, generation))
    .all()
  for (const row of friction) {
    insertCuratedRow(publishDb, 'curated_turn_friction', {
      turn_key: row.turnKey,
      actor_key: row.actorKey,
      conversation_key: row.conversationKey,
      occurred_at_ms: row.occurredAtMs,
      rephrase: row.rephrase ? 1 : 0,
      clarification_abandoned: row.clarificationAbandoned ? 1 : 0,
      permission_issue: row.permissionIssue ? 1 : 0,
      stop: row.stop ? 1 : 0,
      long_turn: row.longTurn ? 1 : 0,
      disclosure_fallback: row.disclosureFallback ? 1 : 0,
      failure_chain: row.failureChain ? 1 : 0,
      component_count: row.componentCount,
      display_score: row.displayScore,
      anchor_event_id: row.anchorEventId,
      friction_version: row.frictionVersion,
    })
  }
  return { curated_turn_friction: friction.length }
}

const copyCensorIntervals = (source: SnapshotSourceDb, publishDb: Database): Record<string, number> => {
  const censorRows = source.select().from(analyticsCensorIntervals).all()
  for (const row of censorRows) {
    insertCuratedRow(publishDb, 'curated_censor_intervals', {
      actor_key: row.actorKey,
      kind: row.kind,
      start_ms: row.startMs,
      end_ms: row.endMs,
      censor_version: row.censorVersion,
    })
  }
  return { curated_censor_intervals: censorRows.length }
}

const copyDeriveTables = (source: SnapshotSourceDb, publishDb: Database, generation: string): Record<string, number> =>
  [copySessions, copyGoalAttempts, copyFeatureDays, copyFriction]
    .map((copyFn) => copyFn(source, publishDb, generation))
    .reduce<Record<string, number>>(
      (merged, counts) => ({ ...merged, ...counts }),
      copyCensorIntervals(source, publishDb),
    )

/**
 * Copies only unexpired, allowlisted, active-generation rows into the fresh
 * publish database. Callers run this inside one consistent source read
 * transaction; target-shadow and retired rows are never selected.
 */
export const copyCuratedRows = (
  source: SnapshotSourceDb,
  publishDb: Database,
  input: Readonly<{
    generation: string
    nowMs: number
    mode: SnapshotMode
    hooks?: Readonly<{ afterEventsInsert?: () => void }>
  }>,
): SnapshotCopyResult => {
  const rowCounts: Record<string, number> = {}
  if (input.mode === 'pseudonymous') {
    rowCounts['curated_events'] = copyEvents(source, publishDb, input.generation, input.nowMs)
    input.hooks?.afterEventsInsert?.()
    Object.assign(rowCounts, copyDeriveTables(source, publishDb, input.generation))
  }
  Object.assign(rowCounts, copyAggregateTables(source, publishDb))
  const highWater = highWaterFor(source, input.generation)
  return {
    rowCounts,
    sourceRowCount: highWater.count,
    sourceHighWater: `${highWater.count}:${highWater.maxOccurredAtMs}`,
  }
}
