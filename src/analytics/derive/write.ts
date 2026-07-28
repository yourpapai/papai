// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import {
  analyticsCensorIntervals,
  analyticsEventCollectionRefs,
  analyticsEvents,
  analyticsFeatureOpportunityDays,
  analyticsFeatureUseDays,
  analyticsGoalAttempts,
  analyticsSessionEvents,
  analyticsSessions,
  analyticsTurnFriction,
} from '../../db/schema.js'
import { FEATURE_MATERIALIZATION_VERSION } from './features.js'
import type { FeatureDayMaterialization } from './features.js'
import { FRICTION_VERSION } from './friction.js'
import type { TurnFrictionResult } from './friction.js'
import { OUTCOME_VERSION } from './outcomes.js'
import type { GoalAttemptOutcome } from './outcomes.js'
import { SESSIONIZATION_VERSION } from './sessionizer.js'
import type { SessionizedSession } from './sessionizer.js'
import type { AffectedPartition, Db } from './store.js'

export const replaceSessions = (
  db: Db,
  generation: string,
  partition: AffectedPartition,
  sessions: readonly SessionizedSession[],
): Readonly<{ sessions: number; events: number }> =>
  db.transaction((tx) => {
    tx.delete(analyticsSessions)
      .where(
        and(
          eq(analyticsSessions.actorKey, partition.actorKey),
          eq(analyticsSessions.conversationKey, partition.conversationKey),
        ),
      )
      .run()
    let eventCount = 0
    for (const session of sessions) {
      tx.insert(analyticsSessions)
        .values({
          sessionKey: session.sessionKey,
          storageGeneration: generation,
          actorKey: session.actorKey,
          conversationKey: session.conversationKey,
          startMs: session.startMs,
          endMs: session.endMs,
          durationMs: session.durationMs,
          activityCount: session.activityCount,
          turnCount: session.turnCount,
          firstEventId: session.firstEventId,
          lastEventId: session.lastEventId,
          sessionizationVersion: SESSIONIZATION_VERSION,
        })
        .run()
      for (const event of session.events) {
        tx.insert(analyticsSessionEvents)
          .values({
            sessionKey: session.sessionKey,
            eventId: event.eventId,
            occurredAtMs: event.occurredAtMs,
            extendsSession: event.extendsSession,
            sessionizationVersion: SESSIONIZATION_VERSION,
          })
          .run()
        eventCount += 1
      }
    }
    return { sessions: sessions.length, events: eventCount }
  })

export const replaceGoalAttempts = (
  db: Db,
  partition: AffectedPartition,
  attempts: readonly GoalAttemptOutcome[],
  generation: string,
): number =>
  db.transaction((tx) => {
    tx.delete(analyticsGoalAttempts)
      .where(
        and(
          eq(analyticsGoalAttempts.actorKey, partition.actorKey),
          eq(analyticsGoalAttempts.conversationKey, partition.conversationKey),
        ),
      )
      .run()
    for (const attempt of attempts) {
      tx.insert(analyticsGoalAttempts)
        .values({
          attemptKey: attempt.attemptKey,
          storageGeneration: generation,
          turnKey: attempt.turnKey,
          goal: attempt.goal,
          actorKey: attempt.actorKey,
          conversationKey: attempt.conversationKey,
          startMs: attempt.startMs,
          matureAtMs: attempt.matureAtMs,
          outcome: attempt.outcome,
          resolvedAtMs: attempt.resolvedAtMs,
          anchorEventId: attempt.anchorEventId,
          outcomeVersion: OUTCOME_VERSION,
        })
        .run()
    }
    return attempts.length
  })

export const replaceTurnFriction = (
  db: Db,
  partition: AffectedPartition,
  rows: readonly TurnFrictionResult[],
  generation: string,
): number =>
  db.transaction((tx) => {
    tx.delete(analyticsTurnFriction)
      .where(
        and(
          eq(analyticsTurnFriction.actorKey, partition.actorKey),
          eq(analyticsTurnFriction.conversationKey, partition.conversationKey),
        ),
      )
      .run()
    for (const row of rows) {
      tx.insert(analyticsTurnFriction)
        .values({
          turnKey: row.turnKey,
          storageGeneration: generation,
          actorKey: row.actorKey,
          conversationKey: row.conversationKey,
          occurredAtMs: row.occurredAtMs,
          rephrase: row.components.rephrase,
          clarificationAbandoned: row.components.clarificationAbandoned,
          permissionIssue: row.components.permissionIssue,
          stop: row.components.stop,
          longTurn: row.components.longTurn,
          disclosureFallback: row.components.disclosureFallback,
          failureChain: row.components.failureChain,
          componentCount: row.componentCount,
          displayScore: row.displayScore,
          anchorEventId: row.anchorEventId,
          frictionVersion: FRICTION_VERSION,
        })
        .run()
    }
    return rows.length
  })

export const replaceFeatureDays = (
  db: Db,
  actorKey: string,
  materialization: FeatureDayMaterialization,
  generation: string,
): Readonly<{ opportunities: number; uses: number }> =>
  db.transaction((tx) => {
    tx.delete(analyticsFeatureOpportunityDays).where(eq(analyticsFeatureOpportunityDays.actorKey, actorKey)).run()
    tx.delete(analyticsFeatureUseDays).where(eq(analyticsFeatureUseDays.actorKey, actorKey)).run()
    for (const day of materialization.opportunities) {
      tx.insert(analyticsFeatureOpportunityDays)
        .values({
          actorKey: day.actorKey,
          feature: day.feature,
          utcDay: day.utcDay,
          storageGeneration: generation,
          available: day.available,
          reason: day.reason,
          opportunityEventId: day.opportunityEventId,
          definitionVersion: FEATURE_MATERIALIZATION_VERSION,
        })
        .run()
    }
    for (const day of materialization.uses) {
      tx.insert(analyticsFeatureUseDays)
        .values({
          actorKey: day.actorKey,
          feature: day.feature,
          utcDay: day.utcDay,
          storageGeneration: generation,
          successCount: day.successCount,
          failureCount: day.failureCount,
          blockedCount: day.blockedCount,
          joinedAvailable: day.joinedAvailable,
          adopted: day.adopted,
          firstUseEventId: day.firstUseEventId,
          definitionVersion: FEATURE_MATERIALIZATION_VERSION,
        })
        .run()
    }
    return { opportunities: materialization.opportunities.length, uses: materialization.uses.length }
  })

export const upsertCensorIntervals = (
  db: Db,
  rows: readonly Readonly<{ actorKey: string; startMs: number }>[],
): number => {
  let written = 0
  for (const row of rows) {
    const existing = db
      .select({ actorKey: analyticsCensorIntervals.actorKey })
      .from(analyticsCensorIntervals)
      .where(and(eq(analyticsCensorIntervals.actorKey, row.actorKey), eq(analyticsCensorIntervals.kind, 'withdrawal')))
      .get()
    if (existing !== undefined) continue
    db.insert(analyticsCensorIntervals)
      .values({ actorKey: row.actorKey, kind: 'withdrawal', startMs: row.startMs, endMs: null, censorVersion: 1 })
      .run()
    written += 1
  }
  return written
}

export const deleteDerivedClarificationEvent = (db: Db, eventId: string): void => {
  db.delete(analyticsEventCollectionRefs).where(eq(analyticsEventCollectionRefs.eventId, eventId)).run()
  db.delete(analyticsEvents).where(eq(analyticsEvents.eventId, eventId)).run()
}
