// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, sql } from 'drizzle-orm'

import type { ContextType } from '../chat/types.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import {
  defaultDeps,
  RECALL_DEFAULT_LIMIT,
  runRecallCascade,
  type RecallProvenance,
  type RunRecallCascadeDeps,
} from './recall-cascade.js'
import { recordValidityCondition } from './record-conditions.js'
import { resolveMemoryScope } from './scope.js'
import type { MemoryScope } from './types.js'

export type RunShadowRecallInput = Readonly<{
  storageContextId: string
  configContextId: string
  contextType: ContextType
  query: string
  limit?: number
}>

export type ShadowRecallHit = Readonly<{
  id: string
  score: number
  provenance: RecallProvenance
}>

export type RunShadowRecallResult = Readonly<{
  hits: ReadonlyArray<ShadowRecallHit>
  activeRecordCount: number
  skippedReason?: 'no-active-records'
}>

/**
 * Counts active (non-expired, currently-valid) records in a scope, using the same
 * scope/status/validity conditions as `listMemoryRecords`, so the shadow's zero-record
 * precondition matches production recall's notion of "active".
 */
function countActiveMemoryRecords(scope: MemoryScope, now: string): number {
  const row = getDrizzleDb()
    .select({ count: sql<number>`count(*)` })
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.scopeId, scope.scopeId),
        eq(memoryRecords.scopeType, scope.scopeType),
        eq(memoryRecords.status, 'active'),
        recordValidityCondition(now),
      ),
    )
    .get()
  return row?.count ?? 0
}

/**
 * Runs the counterfactual recall a future auto-injection tier would run, without any
 * production side effects: no promotion scheduling, no `lastSeenAt` mutation, nothing
 * injected into the prompt. Returns only `{ id, score, provenance }` per hit — never
 * record content — so callers cannot accidentally carry raw memory bodies forward.
 */
export async function runShadowRecall(
  input: RunShadowRecallInput,
  deps: RunRecallCascadeDeps = defaultDeps,
): Promise<RunShadowRecallResult> {
  const scope = resolveMemoryScope({ storageContextId: input.storageContextId, contextType: input.contextType })
  const activeRecordCount = countActiveMemoryRecords(scope, new Date().toISOString())

  if (activeRecordCount === 0) {
    return { hits: [], activeRecordCount: 0, skippedReason: 'no-active-records' }
  }

  // Shadow is side-effect-free by construction: `schedulePromotion` is always
  // overridden to a no-op here, regardless of what the caller (or the default) passes.
  const cascadeDeps: RunRecallCascadeDeps = { ...deps, schedulePromotion: () => undefined }
  const { records } = await runRecallCascade(
    {
      storageContextId: input.storageContextId,
      configContextId: input.configContextId,
      contextType: input.contextType,
      query: input.query,
      limit: input.limit ?? RECALL_DEFAULT_LIMIT,
    },
    cascadeDeps,
  )

  return {
    hits: records.map((record) => ({ id: record.id, score: record.confidence, provenance: record.provenance })),
    activeRecordCount,
  }
}
