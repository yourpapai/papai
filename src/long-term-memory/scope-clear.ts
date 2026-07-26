// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, or, sql, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'

import { evictUser } from '../cache.js'
import { getDrizzleDb } from '../db/drizzle.js'
import {
  conversationHistory,
  memoryExtractionState,
  memoryFacts,
  memoryProfiles,
  memoryRecords,
  memorySummary,
  memoryTombstones,
} from '../db/schema.js'
import { profileScopeCondition } from './record-conditions.js'
import type { MemoryScope } from './types.js'

/** The transaction handle passed to `db.transaction((tx) => ...)`, for helpers extracted outside that closure. */
type MemoryTx = Parameters<Parameters<ReturnType<typeof getDrizzleDb>['transaction']>[0]>[0]

const LIKE_ESCAPE = '\\'

const escapeLike = (value: string): string =>
  value
    .replaceAll(LIKE_ESCAPE, `${LIKE_ESCAPE}${LIKE_ESCAPE}`)
    .replaceAll('%', `${LIKE_ESCAPE}%`)
    .replaceAll('_', `${LIKE_ESCAPE}_`)

/** Matches a working-memory key belonging to `scope`: the scope id itself, or one of its `:thread:*` sub-keys. */
export const workingMemoryKeyMatch = (column: SQLiteColumn, scope: MemoryScope): SQL => {
  const pattern = `${escapeLike(scope.scopeId)}:thread:%`
  const condition = or(eq(column, scope.scopeId), sql`${column} LIKE ${pattern} ESCAPE ${LIKE_ESCAPE}`)
  if (condition === undefined) throw new Error('workingMemoryKeyMatch: or() produced no condition')
  return condition
}

type LongTermClearCounts = Readonly<{ profileDeleted: number; recordsDeleted: number; tombstonesDeleted: number }>

const deleteLongTermMemory = (tx: MemoryTx, scope: MemoryScope): LongTermClearCounts => {
  const recordsDeleted = tx
    .delete(memoryRecords)
    .where(and(eq(memoryRecords.scopeId, scope.scopeId), eq(memoryRecords.scopeType, scope.scopeType)))
    .returning({ id: memoryRecords.id })
    .all().length
  const profileDeleted = tx
    .delete(memoryProfiles)
    .where(profileScopeCondition(scope))
    .returning({ scopeId: memoryProfiles.scopeId })
    .all().length
  const tombstonesDeleted = tx
    .delete(memoryTombstones)
    .where(and(eq(memoryTombstones.scopeId, scope.scopeId), eq(memoryTombstones.scopeType, scope.scopeType)))
    .returning({ scopeId: memoryTombstones.scopeId })
    .all().length
  return { profileDeleted, recordsDeleted, tombstonesDeleted }
}

type WorkingMemoryClearResult = Readonly<{ clearedKeys: readonly string[]; extractionStateDeleted: number }>

const deleteWorkingMemory = (tx: MemoryTx, scope: MemoryScope): WorkingMemoryClearResult => {
  const clearedKeys = new Set<string>()
  for (const row of tx
    .delete(conversationHistory)
    .where(workingMemoryKeyMatch(conversationHistory.userId, scope))
    .returning({ key: conversationHistory.userId })
    .all())
    clearedKeys.add(row.key)
  for (const row of tx
    .delete(memorySummary)
    .where(workingMemoryKeyMatch(memorySummary.userId, scope))
    .returning({ key: memorySummary.userId })
    .all())
    clearedKeys.add(row.key)
  // `memory_facts` is the web-fetch title/URL cache keyed by storage user id, not a projection of
  // memory records. A scope clear removes it because it is keyed to the scope; a single-record purge
  // deliberately does not, because no row here derives from the purged record.
  for (const row of tx
    .delete(memoryFacts)
    .where(workingMemoryKeyMatch(memoryFacts.userId, scope))
    .returning({ key: memoryFacts.userId })
    .all())
    clearedKeys.add(row.key)
  const extractionStateDeleted = tx
    .delete(memoryExtractionState)
    .where(workingMemoryKeyMatch(memoryExtractionState.contextId, scope))
    .returning({ key: memoryExtractionState.contextId })
    .all().length
  return { clearedKeys: [...clearedKeys], extractionStateDeleted }
}

/**
 * Completely erases a memory scope: long-term records + profile, working memory (conversation history,
 * summaries, facts) including thread-scoped keys, the extraction watermark, and forgotten-content tombstones.
 * Cache eviction for cleared working-memory keys happens after the transaction commits.
 */
export function clearMemoryScope(scope: MemoryScope): {
  profileDeleted: number
  recordsDeleted: number
  workingMemoryKeysCleared: number
  extractionStateDeleted: number
  tombstonesDeleted: number
} {
  const db = getDrizzleDb()
  const result = db.transaction((tx) => ({
    ...deleteLongTermMemory(tx, scope),
    ...deleteWorkingMemory(tx, scope),
  }))

  for (const key of result.clearedKeys) evictUser(key)

  return {
    profileDeleted: result.profileDeleted,
    recordsDeleted: result.recordsDeleted,
    workingMemoryKeysCleared: result.clearedKeys.length,
    extractionStateDeleted: result.extractionStateDeleted,
    tombstonesDeleted: result.tombstonesDeleted,
  }
}
