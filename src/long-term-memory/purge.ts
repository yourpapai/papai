// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, inArray } from 'drizzle-orm'

import { evictUser } from '../cache.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { memoryProfiles, memoryRecords, memorySummary, memoryTombstones } from '../db/schema.js'
import { logger } from '../logger.js'
import { profileScopeCondition, recordScopeCondition } from './record-conditions.js'
import { workingMemoryKeyMatch } from './scope-clear.js'
import { contentHash, tombstoneValues } from './tombstone.js'
import type { MemoryScope } from './types.js'

const log = logger.child({ scope: 'long-term-memory:purge' })

type PurgeOutcome = Readonly<{
  purged: boolean
  recordsDeleted: number
  contaminatedProfile: boolean
  clearedSummaryKeys: readonly string[]
}>

const NOT_PURGED: PurgeOutcome = {
  purged: false,
  recordsDeleted: 0,
  contaminatedProfile: false,
  clearedSummaryKeys: [],
}

/** Ids whose content hashes to `hash`. Pure so the sweep's matching rule stays testable apart from the transaction. */
const idsMatchingHash = (rows: readonly { id: string; content: string }[], hash: string): string[] =>
  rows.filter((row) => contentHash(row.content) === hash).map((row) => row.id)

/** The transaction handle passed to `db.transaction((tx) => ...)`, for helpers extracted outside that closure. */
type MemoryTx = Parameters<Parameters<ReturnType<typeof getDrizzleDb>['transaction']>[0]>[0]

type Sweep = Readonly<{ content: string; recordsDeleted: number }>

/**
 * Locates the target record, then deletes every row in its scope whose normalized
 * content hashes the same — the provisional/expired twins a plain by-id delete would
 * leave behind for the promotion sweep to resurrect. Returns `undefined` when the
 * target record itself does not exist.
 */
const sweepMatchingContent = (tx: MemoryTx, scope: MemoryScope, recordId: string): Sweep | undefined => {
  const target = tx
    .select({ content: memoryRecords.content })
    .from(memoryRecords)
    .where(recordScopeCondition(scope, recordId))
    .get()
  if (target === undefined) return undefined

  // Every row in the scope, all statuses and no validity filter: a purge must reach the
  // provisional and expired rows the read paths hide, or a twin survives to be promoted back.
  const scopeRows = tx
    .select({ id: memoryRecords.id, content: memoryRecords.content })
    .from(memoryRecords)
    .where(and(eq(memoryRecords.scopeId, scope.scopeId), eq(memoryRecords.scopeType, scope.scopeType)))
    .all()

  const doomed = idsMatchingHash(scopeRows, contentHash(target.content))
  const recordsDeleted = tx
    .delete(memoryRecords)
    .where(inArray(memoryRecords.id, doomed))
    .returning({ id: memoryRecords.id })
    .all().length

  return { content: target.content, recordsDeleted }
}

/**
 * Destroys one memory record outright, taking its FTS entry and embedding with it.
 *
 * Deliberately weaker than `purgeMemoryRecord`: it writes no tombstone and leaves the
 * profile and summary alone. This is the dedup path, where the deleted row is a
 * duplicate of a record the scope still keeps — the user never asked to forget the
 * fact, so suppressing its re-capture or invalidating the scope's derived prose would
 * be wrong.
 *
 * Returns false when no record matched.
 */
export function deleteMemoryRecord(scope: MemoryScope, recordId: string): boolean {
  const deleted = getDrizzleDb()
    .delete(memoryRecords)
    .where(recordScopeCondition(scope, recordId))
    .returning({ id: memoryRecords.id })
    .all()
  return deleted.length > 0
}

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
    const swept = sweepMatchingContent(tx, scope, recordId)
    if (swept === undefined) return NOT_PURGED
    const { content, recordsDeleted } = swept

    tx.insert(memoryTombstones)
      .values(tombstoneValues(scope, content, now))
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

    return { purged: true, recordsDeleted, contaminatedProfile: contaminated.length > 0, clearedSummaryKeys }
  })

  if (!outcome.purged) return false

  for (const key of outcome.clearedSummaryKeys) evictUser(key)

  log.info(
    {
      scopeId: scope.scopeId,
      scopeType: scope.scopeType,
      recordId,
      recordsDeleted: outcome.recordsDeleted,
      contaminatedProfile: outcome.contaminatedProfile,
      clearedSummaryKeys: outcome.clearedSummaryKeys.length,
    },
    'Memory record purged; derived memory invalidated',
  )
  return true
}
