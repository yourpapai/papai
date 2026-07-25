// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { evictUser } from '../cache.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { memoryProfiles, memoryRecords, memorySummary, memoryTombstones } from '../db/schema.js'
import { logger } from '../logger.js'
import { profileScopeCondition, recordScopeCondition } from './record-conditions.js'
import { workingMemoryKeyMatch } from './scope-clear.js'
import { tombstoneValues } from './tombstone.js'
import type { MemoryScope } from './types.js'

const log = logger.child({ scope: 'long-term-memory:purge' })

type PurgeOutcome = Readonly<{ purged: boolean; contaminatedProfile: boolean; clearedSummaryKeys: readonly string[] }>

const NOT_PURGED: PurgeOutcome = { purged: false, contaminatedProfile: false, clearedSummaryKeys: [] }

/**
 * Permanently destroys one memory record, tombstones its content so background
 * extraction cannot re-learn it, and invalidates the derived prose that may have
 * absorbed the same fact.
 *
 * The profile is unstructured prose: the erased fact cannot be surgically removed
 * from it, so the whole profile is marked contaminated and withheld (see
 * `visibleProfileText`) until a background extraction rewrites it from the surviving
 * records. The rolling summary cannot be regenerated at all — its source messages
 * were consumed by the trim that produced it — so it is deleted outright.
 *
 * All three effects share one transaction, so nothing reaches the model between the
 * record's deletion and the suppression of its derivatives. Cache eviction runs after
 * the commit, mirroring `clearMemoryScope`.
 *
 * Returns false when no record matched, in which case nothing else is touched.
 */
export function purgeMemoryRecord(scope: MemoryScope, recordId: string, now: string): boolean {
  const db = getDrizzleDb()
  const outcome = db.transaction((tx): PurgeOutcome => {
    const deleted = tx
      .delete(memoryRecords)
      .where(recordScopeCondition(scope, recordId))
      .returning({ content: memoryRecords.content })
      .all()
    const row = deleted[0]
    if (row === undefined) return NOT_PURGED

    tx.insert(memoryTombstones)
      .values(tombstoneValues(scope, row.content, now))
      .onConflictDoNothing()
      .run()

    const contaminated = tx
      .update(memoryProfiles)
      .set({ contaminatedAt: now })
      .where(profileScopeCondition(scope))
      .returning({ scopeId: memoryProfiles.scopeId })
      .all()

    const clearedSummaryKeys = tx
      .delete(memorySummary)
      .where(workingMemoryKeyMatch(memorySummary.userId, scope))
      .returning({ key: memorySummary.userId })
      .all()
      .map((summaryRow) => summaryRow.key)

    return { purged: true, contaminatedProfile: contaminated.length > 0, clearedSummaryKeys }
  })

  if (!outcome.purged) return false

  for (const key of outcome.clearedSummaryKeys) evictUser(key)

  log.info(
    {
      scopeId: scope.scopeId,
      scopeType: scope.scopeType,
      recordId,
      contaminatedProfile: outcome.contaminatedProfile,
      clearedSummaryKeys: outcome.clearedSummaryKeys.length,
    },
    'Memory record purged; derived memory invalidated',
  )
  return true
}
