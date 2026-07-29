// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryTombstones } from '../db/schema.js'
import { tombstoneValues } from './tombstone.js'
import type { MemoryScope } from './types.js'

/** Test-only seam: production never inserts tombstones directly (forget/purge paths do). */
export function insertTombstone(scope: MemoryScope, content: string, now: string): void {
  getDrizzleDb()
    .insert(memoryTombstones)
    .values(tombstoneValues(scope, content, now))
    .onConflictDoNothing()
    .run()
}
