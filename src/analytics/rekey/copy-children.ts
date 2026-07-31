// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import {
  analyticsBackfillEventMap,
  analyticsCensorIntervals,
  analyticsFeatureOpportunityDays,
  analyticsFeatureUseDays,
  analyticsGoalAttempts,
  analyticsSessionEvents,
  analyticsSessions,
  analyticsTurnFriction,
} from '../../db/schema.js'
import type { AnalyticsEventRow, AnalyticsRekeyRunRow } from '../../db/schema.js'
import { analyticsRemap, requireShadowParentIn, sourceEventMapIn } from './copy.js'
import type { RekeyFullKeyMaterial } from './dual-write.js'
import type { RekeyTx } from './run-store.js'

type ChildCopyContext = Readonly<{
  tx: RekeyTx
  run: AnalyticsRekeyRunRow
  material: RekeyFullKeyMaterial
  sourceEvents: ReadonlyMap<string, AnalyticsEventRow>
  shadowOf: (eventId: string) => string
  remap: (domain: string, value: string | null) => string | null
}>

const copySessionsIn = (ctx: ChildCopyContext): ReadonlyMap<string, string> => {
  const sessionKeyMap = new Map<string, string>()
  const sessions = ctx.tx
    .select()
    .from(analyticsSessions)
    .where(eq(analyticsSessions.storageGeneration, ctx.run.sourceGeneration))
    .all()
  for (const session of sessions) {
    const newKey = ctx.remap('session:v1', session.sessionKey)
    if (newKey === null) throw new Error('session key remap failed')
    sessionKeyMap.set(session.sessionKey, newKey)
    const exists = ctx.tx.select().from(analyticsSessions).where(eq(analyticsSessions.sessionKey, newKey)).get()
    if (exists !== undefined) continue
    ctx.tx
      .insert(analyticsSessions)
      .values({
        ...session,
        sessionKey: newKey,
        storageGeneration: ctx.run.targetGeneration,
        actorKey: ctx.remap('actor:v1', session.actorKey) ?? session.actorKey,
        conversationKey: ctx.remap('conversation:v1', session.conversationKey) ?? session.conversationKey,
        firstEventId: ctx.shadowOf(session.firstEventId),
        lastEventId: ctx.shadowOf(session.lastEventId),
      })
      .run()
  }
  return sessionKeyMap
}

const copySessionEventsIn = (ctx: ChildCopyContext, sessionKeyMap: ReadonlyMap<string, string>): void => {
  for (const row of ctx.tx.select().from(analyticsSessionEvents).all()) {
    const newSessionKey = sessionKeyMap.get(row.sessionKey)
    if (newSessionKey === undefined) continue
    const newEventId = ctx.shadowOf(row.eventId)
    const exists = ctx.tx
      .select()
      .from(analyticsSessionEvents)
      .where(and(eq(analyticsSessionEvents.sessionKey, newSessionKey), eq(analyticsSessionEvents.eventId, newEventId)))
      .get()
    if (exists !== undefined) continue
    ctx.tx
      .insert(analyticsSessionEvents)
      .values({ ...row, sessionKey: newSessionKey, eventId: newEventId })
      .run()
  }
}

const copyGoalAttemptsIn = (ctx: ChildCopyContext): void => {
  const attempts = ctx.tx
    .select()
    .from(analyticsGoalAttempts)
    .where(eq(analyticsGoalAttempts.storageGeneration, ctx.run.sourceGeneration))
    .all()
  for (const attempt of attempts) {
    const newAttemptKey = ctx.remap('materialization:v1', attempt.attemptKey) ?? attempt.attemptKey
    const newTurnKey = ctx.remap('turn:v1', attempt.turnKey) ?? attempt.turnKey
    const exists = ctx.tx
      .select()
      .from(analyticsGoalAttempts)
      .where(
        and(
          eq(analyticsGoalAttempts.turnKey, newTurnKey),
          eq(analyticsGoalAttempts.goal, attempt.goal),
          eq(analyticsGoalAttempts.outcomeVersion, attempt.outcomeVersion),
        ),
      )
      .get()
    if (exists !== undefined) continue
    ctx.tx
      .insert(analyticsGoalAttempts)
      .values({
        ...attempt,
        attemptKey: newAttemptKey,
        storageGeneration: ctx.run.targetGeneration,
        turnKey: newTurnKey,
        actorKey: ctx.remap('actor:v1', attempt.actorKey) ?? attempt.actorKey,
        conversationKey: ctx.remap('conversation:v1', attempt.conversationKey) ?? attempt.conversationKey,
        anchorEventId: ctx.shadowOf(attempt.anchorEventId),
      })
      .run()
  }
}

const copyOpportunityDaysIn = (ctx: ChildCopyContext): void => {
  const opportunityDays = ctx.tx
    .select()
    .from(analyticsFeatureOpportunityDays)
    .where(eq(analyticsFeatureOpportunityDays.storageGeneration, ctx.run.sourceGeneration))
    .all()
  for (const day of opportunityDays) {
    const newActor = ctx.remap('actor:v1', day.actorKey) ?? day.actorKey
    const exists = ctx.tx
      .select()
      .from(analyticsFeatureOpportunityDays)
      .where(
        and(
          eq(analyticsFeatureOpportunityDays.actorKey, newActor),
          eq(analyticsFeatureOpportunityDays.feature, day.feature),
          eq(analyticsFeatureOpportunityDays.utcDay, day.utcDay),
        ),
      )
      .get()
    if (exists !== undefined) continue
    ctx.tx
      .insert(analyticsFeatureOpportunityDays)
      .values({
        ...day,
        actorKey: newActor,
        storageGeneration: ctx.run.targetGeneration,
        opportunityEventId: ctx.shadowOf(day.opportunityEventId),
      })
      .run()
  }
}

const copyUseDaysIn = (ctx: ChildCopyContext): void => {
  const useDays = ctx.tx
    .select()
    .from(analyticsFeatureUseDays)
    .where(eq(analyticsFeatureUseDays.storageGeneration, ctx.run.sourceGeneration))
    .all()
  for (const day of useDays) {
    const newActor = ctx.remap('actor:v1', day.actorKey) ?? day.actorKey
    const exists = ctx.tx
      .select()
      .from(analyticsFeatureUseDays)
      .where(
        and(
          eq(analyticsFeatureUseDays.actorKey, newActor),
          eq(analyticsFeatureUseDays.feature, day.feature),
          eq(analyticsFeatureUseDays.utcDay, day.utcDay),
        ),
      )
      .get()
    if (exists !== undefined) continue
    ctx.tx
      .insert(analyticsFeatureUseDays)
      .values({
        ...day,
        actorKey: newActor,
        storageGeneration: ctx.run.targetGeneration,
        firstUseEventId: ctx.shadowOf(day.firstUseEventId),
      })
      .run()
  }
}

const copyTurnFrictionIn = (ctx: ChildCopyContext): void => {
  const frictions = ctx.tx
    .select()
    .from(analyticsTurnFriction)
    .where(eq(analyticsTurnFriction.storageGeneration, ctx.run.sourceGeneration))
    .all()
  for (const friction of frictions) {
    const newTurnKey = ctx.remap('turn:v1', friction.turnKey) ?? friction.turnKey
    const exists = ctx.tx
      .select()
      .from(analyticsTurnFriction)
      .where(
        and(
          eq(analyticsTurnFriction.turnKey, newTurnKey),
          eq(analyticsTurnFriction.frictionVersion, friction.frictionVersion),
        ),
      )
      .get()
    if (exists !== undefined) continue
    ctx.tx
      .insert(analyticsTurnFriction)
      .values({
        ...friction,
        turnKey: newTurnKey,
        storageGeneration: ctx.run.targetGeneration,
        actorKey: ctx.remap('actor:v1', friction.actorKey) ?? friction.actorKey,
        conversationKey: ctx.remap('conversation:v1', friction.conversationKey) ?? friction.conversationKey,
        anchorEventId: ctx.shadowOf(friction.anchorEventId),
      })
      .run()
  }
}

const copyCensorIntervalsIn = (ctx: ChildCopyContext): void => {
  for (const interval of ctx.tx.select().from(analyticsCensorIntervals).all()) {
    const inSource = [...ctx.sourceEvents.values()].some((row) => row.actorKey === interval.actorKey)
    if (!inSource) continue
    const newActor = ctx.remap('actor:v1', interval.actorKey) ?? interval.actorKey
    const exists = ctx.tx
      .select()
      .from(analyticsCensorIntervals)
      .where(
        and(
          eq(analyticsCensorIntervals.actorKey, newActor),
          eq(analyticsCensorIntervals.kind, interval.kind),
          eq(analyticsCensorIntervals.censorVersion, interval.censorVersion),
        ),
      )
      .get()
    if (exists !== undefined) continue
    ctx.tx
      .insert(analyticsCensorIntervals)
      .values({ ...interval, actorKey: newActor })
      .run()
  }
}

/** copy_children.materializations_backfill: sessions, attempts, friction, feature days, censor, backfill maps. */
export const copyChildrenMaterializationsBackfillIn = (
  tx: RekeyTx,
  run: AnalyticsRekeyRunRow,
  material: RekeyFullKeyMaterial,
): void => {
  const sourceEvents = sourceEventMapIn(tx, run.sourceGeneration)
  const ctx: ChildCopyContext = {
    tx,
    run,
    material,
    sourceEvents,
    shadowOf: (eventId) => requireShadowParentIn(tx, sourceEvents, eventId, run.targetGeneration),
    remap: (domain, value) => analyticsRemap(material, domain, value),
  }
  copySessionEventsIn(ctx, copySessionsIn(ctx))
  copyGoalAttemptsIn(ctx)
  copyOpportunityDaysIn(ctx)
  copyUseDaysIn(ctx)
  copyTurnFrictionIn(ctx)
  copyCensorIntervalsIn(ctx)
  for (const mapRow of tx.select().from(analyticsBackfillEventMap).all()) {
    if (!sourceEvents.has(mapRow.eventId)) continue
    ctx.shadowOf(mapRow.eventId)
  }
}
