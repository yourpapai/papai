// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MemoryRecallShadowLogRow } from '../db/long-term-memory-schema.js'
import { keyedHash } from '../stats/hashing.js'
import type { RecallProvenance } from './recall-cascade.js'

/**
 * A single shadow-retrieval hit, kept in memory only. Never persisted verbatim —
 * `buildShadowLogRow` is the only place `id` crosses into a hash.
 */
export type ShadowHit = Readonly<{
  id: string
  score: number
  provenance: RecallProvenance
}>

/** What the model's own `search_memory` tool calls did this turn, in memory only. */
export type ShadowPull = Readonly<{
  pulled: boolean
  queries: readonly string[]
  resultIds: readonly string[]
}>

/**
 * The rich, content-bearing in-memory outcome of a shadow recall. May reference raw
 * ids and query text — never persist this directly. Pass it only through
 * `buildShadowLogRow`, whose output type structurally cannot carry that content.
 */
export type ShadowOutcome = Readonly<{
  scope: string
  contextId: string
  turnRef: string
  readerModelId: string
  activeRecordCount: number
  shadowQuery: string
  shadowHits: ReadonlyArray<ShadowHit>
  pull: ShadowPull
  /** Threaded verbatim from `RunShadowRecallResult.skippedReason`; `undefined` on a normal turn. */
  skippedReason?: 'no-active-records'
}>

/**
 * The anonymized, content-free row persisted to `memory_recall_shadow_log`.
 * `id`/`createdAt` are assigned at insert time (Task 6), not by this pure builder.
 */
export type ShadowLogRow = Omit<MemoryRecallShadowLogRow, 'id' | 'createdAt'>

const SHORT_QUERY_MAX_LEN = 20
const MEDIUM_QUERY_MAX_LEN = 100

function bucketQueryLength(length: number): MemoryRecallShadowLogRow['shadowQueryLenBucket'] {
  if (length <= SHORT_QUERY_MAX_LEN) return 'short'
  if (length <= MEDIUM_QUERY_MAX_LEN) return 'medium'
  return 'long'
}

function pickTopHit(shadowHits: ReadonlyArray<ShadowHit>): ShadowHit | undefined {
  return shadowHits.reduce<ShadowHit | undefined>((top, hit) => {
    if (!top || hit.score > top.score) return hit
    return top
  }, undefined)
}

function countIdOverlap(shadowHits: ReadonlyArray<ShadowHit>, pullResultIds: readonly string[]): number {
  const pullIds = new Set(pullResultIds)
  let overlap = 0
  for (const hit of shadowHits) {
    if (pullIds.has(hit.id)) overlap += 1
  }
  return overlap
}

/**
 * The anonymity seam: the only place a raw string (scope, context id, query text,
 * record id) enters and a keyed hash leaves. Everything downstream (Task 6's insert
 * path) accepts only `ShadowLogRow`, so raw content is structurally unable to reach
 * the database.
 */
export function buildShadowLogRow(outcome: ShadowOutcome): ShadowLogRow {
  const topHit = pickTopHit(outcome.shadowHits)
  const firstPullQuery = outcome.pull.queries[0]

  return {
    scopeHash: keyedHash(outcome.scope),
    contextHash: keyedHash(outcome.contextId),
    turnRef: outcome.turnRef,
    readerModelId: outcome.readerModelId,
    activeRecordCount: outcome.activeRecordCount,
    shadowQueryHash: keyedHash(outcome.shadowQuery),
    shadowQueryLenBucket: bucketQueryLength(outcome.shadowQuery.length),
    shadowHitCount: outcome.shadowHits.length,
    shadowTopScore: topHit ? topHit.score : null,
    shadowTopProvenance: topHit ? topHit.provenance : null,
    shadowTopRecordHash: topHit ? keyedHash(topHit.id) : null,
    modelPulled: outcome.pull.pulled,
    pullCount: outcome.pull.queries.length,
    pullQueryHash: firstPullQuery === undefined ? null : keyedHash(firstPullQuery),
    pullResultCount: outcome.pull.resultIds.length,
    shadowPullOverlap: countIdOverlap(outcome.shadowHits, outcome.pull.resultIds),
    skippedReason: outcome.skippedReason ?? null,
  }
}
