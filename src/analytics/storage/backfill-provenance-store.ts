// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq, inArray } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import {
  analyticsBackfillAggregateContributions,
  analyticsBackfillEventMap,
  analyticsBackfillRuns,
} from '../../db/schema.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'analytics:storage:backfill-provenance-store' })

export type BackfillProvenanceStoreDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

export const createBackfillRun = (
  input: {
    runId: string
    sourceTable: string
    highWaterRowKey: string
    policyCutoffMs: number
    startedAtMs: number
  },
  deps: BackfillProvenanceStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  const db = deps.getDrizzleDb()
  db.insert(analyticsBackfillRuns)
    .values({
      runId: input.runId,
      sourceTable: input.sourceTable,
      highWaterRowKey: input.highWaterRowKey,
      policyCutoffMs: input.policyCutoffMs,
      status: 'running',
      startedAtMs: input.startedAtMs,
    })
    .run()
  log.debug({ runId: input.runId }, 'backfill run created')
}

export const completeBackfillRun = (
  input: { runId: string; completedAtMs: number; eventCount?: number; aggregateCount?: number },
  deps: BackfillProvenanceStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  const db = deps.getDrizzleDb()
  db.update(analyticsBackfillRuns)
    .set({
      status: 'completed',
      completedAtMs: input.completedAtMs,
      eventCount: input.eventCount ?? 0,
      aggregateCount: input.aggregateCount ?? 0,
    })
    .where(eq(analyticsBackfillRuns.runId, input.runId))
    .run()
  log.debug({ runId: input.runId }, 'backfill run completed')
}

export const failBackfillRun = (
  input: { runId: string; failedAtMs: number },
  deps: BackfillProvenanceStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  const db = deps.getDrizzleDb()
  db.update(analyticsBackfillRuns)
    .set({ status: 'failed', failedAtMs: input.failedAtMs })
    .where(eq(analyticsBackfillRuns.runId, input.runId))
    .run()
  log.debug({ runId: input.runId }, 'backfill run failed')
}

export const deleteBackfillEventMapsForEvents = (
  eventIds: readonly string[],
  deps: BackfillProvenanceStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): number => {
  if (eventIds.length === 0) return 0
  const db = deps.getDrizzleDb()
  const filter = inArray(analyticsBackfillEventMap.eventId, [...eventIds])
  const count = db
    .select({ eventId: analyticsBackfillEventMap.eventId })
    .from(analyticsBackfillEventMap)
    .where(filter)
    .all().length
  if (count === 0) return 0
  db.delete(analyticsBackfillEventMap).where(filter).run()
  log.info({ count }, 'backfill event maps removed for deleted events')
  return count
}

export const insertBackfillEventMap = (
  input: { runId: string; eventId: string; sourceRefKey: string },
  deps: BackfillProvenanceStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  const db = deps.getDrizzleDb()
  db.insert(analyticsBackfillEventMap)
    .values({
      runId: input.runId,
      eventId: input.eventId,
      sourceRefKey: input.sourceRefKey,
    })
    .run()
  log.debug(
    { runId: input.runId, eventId: input.eventId, sourceRefKey: input.sourceRefKey },
    'backfill event map recorded',
  )
}

export const insertBackfillAggregateContribution = (
  input: { runId: string; aggregateCellKey: string; metric: string; delta: number; sourceRefKey: string },
  deps: BackfillProvenanceStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  const db = deps.getDrizzleDb()
  db.insert(analyticsBackfillAggregateContributions)
    .values({
      runId: input.runId,
      aggregateCellKey: input.aggregateCellKey,
      metric: input.metric,
      delta: input.delta,
      sourceRefKey: input.sourceRefKey,
    })
    .run()
  log.debug(
    { runId: input.runId, aggregateCellKey: input.aggregateCellKey, metric: input.metric },
    'backfill aggregate contribution recorded',
  )
}
