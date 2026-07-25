// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { asc, eq, sql, type SQL } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecallShadowLog } from '../db/schema.js'

export type ComputeShadowFunnelOptions = Readonly<{
  /** Restrict the aggregation to a single reader model instead of all of them. */
  readerModelId?: string
}>

/**
 * One reader model's slice of the under-trigger funnel. Never pool these across
 * `readerModelId` values — pull-propensity is model-dependent (see the shadow-logging
 * design doc), so a cross-model average would look authoritative while hiding the exact
 * per-model variance the pre-registered decision gate depends on.
 */
export type ShadowFunnelEntry = Readonly<{
  readerModelId: string
  /** Sampled turns where the scope had >=1 active record (there was something to find). */
  memoryBearingTurns: number
  /**
   * Turns where `shadow_hit_count >= 1` -- a rank cutoff (the shadow surfaced anything
   * within the cascade's own top-k window), not a relevance-score threshold. See the doc
   * comment on `ShadowRecallHit.score` in `shadow-recall.ts`: `shadow_top_score` is
   * rank-derived and not comparable across `shadow_top_provenance` values, so it must
   * never be used for thresholding here.
   */
  shadowHitTurns: number
  /** `shadow_hit_count >= 1 && model_pulled = false` -- the P1 headline bucket. */
  underTriggerTurns: number
  /** `underTriggerTurns / memoryBearingTurns`; 0 (never NaN) when the denominator is 0. */
  underTriggerRate: number
  /** `model_pulled = true && shadow_pull_overlap > 0` -- the model found what the shadow did. */
  overlapWhenPulled: number
  /**
   * `model_pulled = true && shadow_pull_overlap = 0` -- the model looked and found none of
   * what the shadow would have surfaced.
   *
   * NOT a pre-registered or spec-numeric threshold: the design doc only describes this
   * companion signal qualitatively ("`model_pulled` with low `pull_result_count` / low
   * overlap"), with no numeric cutoff. Zero-overlap is this repo's own operationalization
   * of that qualitative "low overlap" reading, chosen for definiteness, not derived from
   * the doc. It sits outside the frozen go/no-go gate, which depends only on
   * `underTriggerTurns` / `underTriggerRate` and the doc-verbatim `shadowHitTurns` overlap
   * signal -- do not fold this field into that gate.
   */
  overPullTurns: number
}>

type ShadowFunnelSqlRow = Readonly<{
  readerModelId: string
  memoryBearingTurns: number
  shadowHitTurns: number
  underTriggerTurns: number
  overlapWhenPulled: number
  overPullTurns: number
}>

function toEntry(row: ShadowFunnelSqlRow): ShadowFunnelEntry {
  const underTriggerRate = row.memoryBearingTurns === 0 ? 0 : row.underTriggerTurns / row.memoryBearingTurns
  return {
    readerModelId: row.readerModelId,
    memoryBearingTurns: row.memoryBearingTurns,
    shadowHitTurns: row.shadowHitTurns,
    underTriggerTurns: row.underTriggerTurns,
    underTriggerRate,
    overlapWhenPulled: row.overlapWhenPulled,
    overPullTurns: row.overPullTurns,
  }
}

/**
 * Aggregates `memory_recall_shadow_log` into the under-trigger funnel, one entry per
 * `reader_model_id` (SQL `GROUP BY reader_model_id`). Refuses to average across reader
 * models by construction -- there is no code path here that sums or divides across rows
 * from different `readerModelId` values.
 */
export function computeShadowFunnel(opts: ComputeShadowFunnelOptions = {}): ReadonlyArray<ShadowFunnelEntry> {
  const table = memoryRecallShadowLog
  const whereCondition: SQL | undefined =
    opts.readerModelId === undefined ? undefined : eq(table.readerModelId, opts.readerModelId)

  const baseQuery = getDrizzleDb()
    .select({
      readerModelId: table.readerModelId,
      memoryBearingTurns: sql<number>`sum(case when ${table.activeRecordCount} >= 1 then 1 else 0 end)`.as(
        'memory_bearing_turns',
      ),
      shadowHitTurns: sql<number>`sum(case when ${table.shadowHitCount} >= 1 then 1 else 0 end)`.as('shadow_hit_turns'),
      underTriggerTurns: sql<number>`sum(
        case when ${table.shadowHitCount} >= 1 and ${table.modelPulled} = 0 then 1 else 0 end
      )`.as('under_trigger_turns'),
      overlapWhenPulled: sql<number>`sum(
        case when ${table.modelPulled} = 1 and ${table.shadowPullOverlap} > 0 then 1 else 0 end
      )`.as('overlap_when_pulled'),
      overPullTurns: sql<number>`sum(
        case when ${table.modelPulled} = 1 and ${table.shadowPullOverlap} = 0 then 1 else 0 end
      )`.as('over_pull_turns'),
    })
    .from(table)

  const rows = (whereCondition === undefined ? baseQuery : baseQuery.where(whereCondition))
    .groupBy(table.readerModelId)
    .orderBy(asc(table.readerModelId))
    .all()

  return rows.map(toEntry)
}
