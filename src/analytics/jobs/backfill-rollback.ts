// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import {
  analyticsBackfillAggregateContributions,
  analyticsBackfillEventMap,
  analyticsBackfillRuns,
  analyticsDailyCounters,
  analyticsEventCollectionRefs,
  analyticsEvents,
  analyticsNormalizationRejections,
} from '../../db/schema.js'
import { logger } from '../../logger.js'
import { sourceEventTypeForTable } from './backfill-decisions.js'

const log = logger.child({ scope: 'analytics:jobs:backfill-rollback' })

type Db = ReturnType<typeof defaultGetDrizzleDb>

type ContributionRow = typeof analyticsBackfillAggregateContributions.$inferSelect

const counterKeyMatches = (
  row: typeof analyticsDailyCounters.$inferSelect,
  key: {
    utcDay: string
    platform: unknown
    contextType: unknown
    actorRole: unknown
    taskProvider: unknown
    appVersion: unknown
    metric: string
  },
): boolean =>
  row.platform === key.platform &&
  row.contextType === key.contextType &&
  row.actorRole === key.actorRole &&
  row.taskProvider === key.taskProvider &&
  row.appVersion === key.appVersion &&
  row.metric === key.metric

const counterKeyWhere = (match: typeof analyticsDailyCounters.$inferSelect): ReturnType<typeof and> =>
  and(
    eq(analyticsDailyCounters.utcDay, match.utcDay),
    eq(analyticsDailyCounters.definitionVersion, match.definitionVersion),
    eq(analyticsDailyCounters.platform, match.platform),
    eq(analyticsDailyCounters.contextType, match.contextType),
    eq(analyticsDailyCounters.actorRole, match.actorRole),
    eq(analyticsDailyCounters.taskProvider, match.taskProvider),
    eq(analyticsDailyCounters.appVersion, match.appVersion),
    eq(analyticsDailyCounters.metric, match.metric),
  )

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const reverseCounterContribution = (db: Db, contribution: ContributionRow): void => {
  const firstBar = contribution.aggregateCellKey.indexOf('|')
  const lastBar = contribution.aggregateCellKey.lastIndexOf('|')
  if (firstBar <= 0 || lastBar <= firstBar) return
  const parsed: unknown = JSON.parse(contribution.aggregateCellKey.slice(firstBar + 1, lastBar))
  if (!isRecord(parsed)) return
  const key = {
    utcDay: contribution.aggregateCellKey.slice(0, firstBar),
    platform: parsed['platform'],
    contextType: parsed['context_type'],
    actorRole: parsed['actor_role'],
    taskProvider: parsed['task_provider'],
    appVersion: parsed['app_version'],
    metric: contribution.aggregateCellKey.slice(lastBar + 1),
  }
  const match = db
    .select()
    .from(analyticsDailyCounters)
    .where(eq(analyticsDailyCounters.utcDay, key.utcDay))
    .all()
    .find((row) => counterKeyMatches(row, key))
  if (match === undefined) return
  const remaining = match.value - contribution.delta
  if (remaining <= 0) {
    db.delete(analyticsDailyCounters).where(counterKeyWhere(match)).run()
    return
  }
  db.update(analyticsDailyCounters).set({ value: remaining }).where(counterKeyWhere(match)).run()
}

const rejectionWhere = (match: typeof analyticsNormalizationRejections.$inferSelect): ReturnType<typeof and> =>
  and(
    eq(analyticsNormalizationRejections.utcDay, match.utcDay),
    eq(analyticsNormalizationRejections.sourceEventType, match.sourceEventType),
    eq(analyticsNormalizationRejections.reason, match.reason),
  )

const reverseRejection = (db: Db, sourceTable: string, contribution: ContributionRow): void => {
  const reason = contribution.metric.slice('rejected:'.length)
  const utcDay = contribution.aggregateCellKey.slice(0, contribution.aggregateCellKey.indexOf('|'))
  const sourceEventType = sourceEventTypeForTable(sourceTable)
  const match = db
    .select()
    .from(analyticsNormalizationRejections)
    .where(eq(analyticsNormalizationRejections.utcDay, utcDay))
    .all()
    .find((row) => row.sourceEventType === sourceEventType && row.reason === reason)
  if (match === undefined) return
  if (match.count <= 1) {
    db.delete(analyticsNormalizationRejections).where(rejectionWhere(match)).run()
    return
  }
  db.update(analyticsNormalizationRejections)
    .set({ count: match.count - 1 })
    .where(rejectionWhere(match))
    .run()
}

export type RollbackResult = Readonly<{ removedContributions: number; removedEvents: number }>

export const rollbackBackfillRun = (
  input: Readonly<{ runId: string }>,
  deps: Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }> = { getDrizzleDb: defaultGetDrizzleDb },
): RollbackResult => {
  const db = deps.getDrizzleDb()
  return db.transaction((tx) => {
    const run = tx.select().from(analyticsBackfillRuns).where(eq(analyticsBackfillRuns.runId, input.runId)).get()
    if (run === undefined) return { removedContributions: 0, removedEvents: 0 }
    const contributions = tx
      .select()
      .from(analyticsBackfillAggregateContributions)
      .where(eq(analyticsBackfillAggregateContributions.runId, input.runId))
      .all()
    for (const contribution of contributions) {
      if (contribution.metric.startsWith('rejected:')) {
        reverseRejection(db, run.sourceTable, contribution)
      } else if (!contribution.metric.startsWith('ineligible:') && contribution.delta !== 0) {
        reverseCounterContribution(db, contribution)
      }
    }
    const maps = tx
      .select()
      .from(analyticsBackfillEventMap)
      .where(eq(analyticsBackfillEventMap.runId, input.runId))
      .all()
    for (const map of maps) {
      tx.delete(analyticsEventCollectionRefs).where(eq(analyticsEventCollectionRefs.eventId, map.eventId)).run()
    }
    tx.delete(analyticsBackfillEventMap).where(eq(analyticsBackfillEventMap.runId, input.runId)).run()
    for (const map of maps) {
      tx.delete(analyticsEvents).where(eq(analyticsEvents.eventId, map.eventId)).run()
    }
    tx.delete(analyticsBackfillRuns).where(eq(analyticsBackfillRuns.runId, input.runId)).run()
    log.info(
      { runId: input.runId, removedContributions: contributions.length, removedEvents: maps.length },
      'backfill run rolled back',
    )
    return { removedContributions: contributions.length, removedEvents: maps.length }
  })
}
