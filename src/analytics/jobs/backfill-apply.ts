// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import type { LlmUsageEventRow } from '../../db/llm-usage-events-schema.js'
import { analyticsBackfillAggregateContributions, analyticsBackfillEventMap } from '../../db/schema.js'
import type { ToolCallEventRow } from '../../db/tool-call-events-schema.js'
import { utcDayOfMs } from '../aggregate.js'
import { incrementCounter } from '../storage/aggregate-store.js'
import { incrementNormalizationRejection } from '../storage/rejection-store.js'
import {
  backfillAggregateCellKey,
  backfillAggregateDimensions,
  decisionNameOf,
  deriveBackfillSourceRef,
  sourceEventTypeForTable,
} from './backfill-decisions.js'
import type { BackfillDecision, BackfillSourceTable } from './backfill-decisions.js'

type Db = ReturnType<typeof defaultGetDrizzleDb>

export type BackfillApplyContext = Readonly<{
  runId: string
  sourceTable: BackfillSourceTable
  key: Buffer
  keyVersion: string
}>

const QUALITY = {
  finalized: false,
  partialDay: false,
  restartGapDetected: false,
  lateEventCount: 0,
  reconciliationStatus: 'complete_epoch' as const,
  disclosureScope: 'local_only',
  contributorBasis: 'not_required',
  contributorCount: null,
  threshold: null,
}

const provenanceExists = (db: Db, sourceRefKey: string): boolean => {
  const contribution = db
    .select({ runId: analyticsBackfillAggregateContributions.runId })
    .from(analyticsBackfillAggregateContributions)
    .where(eq(analyticsBackfillAggregateContributions.sourceRefKey, sourceRefKey))
    .limit(1)
    .get()
  if (contribution !== undefined) return true
  const mapped = db
    .select({ runId: analyticsBackfillEventMap.runId })
    .from(analyticsBackfillEventMap)
    .where(eq(analyticsBackfillEventMap.sourceRefKey, sourceRefKey))
    .limit(1)
    .get()
  return mapped !== undefined
}

const applyAggregateOnly = (
  db: Db,
  ctx: BackfillApplyContext,
  row: LlmUsageEventRow | ToolCallEventRow,
  decision: Extract<BackfillDecision, { kind: 'aggregate_only' }>,
  sourceRefKey: string,
): void => {
  const utcDay = utcDayOfMs(row.occurredAt)
  const dims = backfillAggregateDimensions(row.contextType)
  for (const increment of decision.increments) {
    if (increment.kind !== 'counter') continue
    incrementCounter(
      {
        utcDay,
        definitionVersion: 1,
        platform: dims.platform,
        contextType: dims.context_type,
        actorRole: dims.actor_role,
        taskProvider: dims.task_provider,
        appVersion: dims.app_version,
        metric: increment.metric,
        delta: increment.delta,
        aggregateCellKey: backfillAggregateCellKey(utcDay, dims, increment.metric),
        runId: ctx.runId,
        sourceRefKey,
        ...QUALITY,
      },
      { getDrizzleDb: () => db },
    )
  }
}

type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

const applyRejected = (
  db: Db,
  tx: Tx,
  ctx: BackfillApplyContext,
  utcDay: string,
  reason: string,
  sourceRefKey: string,
): void => {
  tx.insert(analyticsBackfillAggregateContributions)
    .values({
      runId: ctx.runId,
      aggregateCellKey: `${utcDay}|${ctx.sourceTable}|rejected`,
      metric: `rejected:${reason}`,
      delta: 0,
      sourceRefKey,
    })
    .run()
  incrementNormalizationRejection(
    { utcDay, sourceEventType: sourceEventTypeForTable(ctx.sourceTable), reason },
    { getDrizzleDb: () => db },
  )
}

export const applyBackfillDecision = (
  db: Db,
  ctx: BackfillApplyContext,
  row: LlmUsageEventRow | ToolCallEventRow,
  decision: BackfillDecision,
): 'applied' | 'skipped' => {
  const sourceRefKey = deriveBackfillSourceRef({
    key: ctx.key,
    keyVersion: ctx.keyVersion,
    sourceTable: ctx.sourceTable,
    sourceEventId: row.eventId,
    decisionName: decisionNameOf(decision),
  })
  return db.transaction((tx) => {
    if (provenanceExists(db, sourceRefKey)) return 'skipped'
    if (decision.kind === 'aggregate_only') {
      applyAggregateOnly(db, ctx, row, decision, sourceRefKey)
      return 'applied'
    }
    if (decision.kind === 'rejected') {
      applyRejected(db, tx, ctx, utcDayOfMs(row.occurredAt), decision.reason, sourceRefKey)
      return 'applied'
    }
    return 'skipped'
  })
}
