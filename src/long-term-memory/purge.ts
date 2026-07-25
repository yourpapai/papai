// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords, memoryTombstones } from '../db/schema.js'
import { recordScopeCondition } from './record-conditions.js'
import { tombstoneValues } from './tombstone.js'
import type { MemoryScope } from './types.js'

/**
 * Permanently destroys one memory record and tombstones its content so background
 * extraction cannot re-learn it. Returns false when no record matched.
 */
export function purgeMemoryRecord(scope: MemoryScope, recordId: string, now: string): boolean {
  const db = getDrizzleDb()
  return db.transaction((tx) => {
    const deleted = tx
      .delete(memoryRecords)
      .where(recordScopeCondition(scope, recordId))
      .returning({ content: memoryRecords.content })
      .all()
    const row = deleted[0]
    if (row === undefined) return false
    tx.insert(memoryTombstones)
      .values(tombstoneValues(scope, row.content, now))
      .onConflictDoNothing()
      .run()
    return true
  })
}
