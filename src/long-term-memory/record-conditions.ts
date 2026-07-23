// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, isNull, ne, or, sql, type SQL } from 'drizzle-orm'

import { memoryRecords } from '../db/schema.js'
import type { MemoryScope } from './types.js'

/** Matches a single memory record by id within a given scope. Shared by the record store and provisional store. */
export const recordScopeCondition = (scope: MemoryScope, recordId: string): SQL | undefined =>
  and(
    eq(memoryRecords.scopeId, scope.scopeId),
    eq(memoryRecords.scopeType, scope.scopeType),
    eq(memoryRecords.id, recordId),
  )

/**
 * Half-open validity plus expiry, enforced at query time on every read path.
 * A NULL bound means "unbounded on that side".
 * @public -- consumed by the record store, provisional store, lexical search, and dense scan.
 */
export const recordValidityCondition = (now: string): SQL =>
  sql`(${memoryRecords.validFrom} IS NULL OR ${memoryRecords.validFrom} <= ${now})
   AND (${memoryRecords.validUntil} IS NULL OR ${memoryRecords.validUntil} > ${now})
   AND (${memoryRecords.expiresAt} IS NULL OR ${memoryRecords.expiresAt} > ${now})`

/** Include-one-thread / exclude-one-thread filtering, shared by the provisional store and the retrieval channels. */
export const threadScopeCondition = (
  filter: Readonly<{ threadContextId?: string; excludeThreadContextId?: string }>,
): SQL | undefined => {
  if (filter.threadContextId !== undefined) return eq(memoryRecords.threadContextId, filter.threadContextId)
  if (filter.excludeThreadContextId !== undefined) {
    return or(ne(memoryRecords.threadContextId, filter.excludeThreadContextId), isNull(memoryRecords.threadContextId))
  }
  return undefined
}
