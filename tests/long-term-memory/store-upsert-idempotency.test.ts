// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The store has NO content-hash-keyed dedup at the write boundary. `saveMemoryRecord`
 * (`src/long-term-memory/store.ts:189-197`) upserts with
 * `onConflictDoUpdate({ target: memoryRecords.id, set: values })` — that is id-keyed collapse
 * only. Two writes of identical content under two different ids leave two active rows;
 * `contentHash` (`src/long-term-memory/tombstone.ts`) is consulted only by the erasure
 * tombstone path, never here. Content collapse exists solely in the LLM-gated
 * group-promotion path (`src/long-term-memory/promotion.ts:38-46,73`), which applies only to
 * provisional group records and is gated on `MEMORY_PROMOTION_MIN_THREADS` distinct threads
 * plus an LLM `confirmDurable` call.
 *
 * The guarantee this file actually proves is upsert-by-id: a duplicate, out-of-order
 * resubmission of the SAME capture (same id, reordered arrival, reworded whitespace/case)
 * collapses to exactly one stored row. That is a real store guarantee, but it is not content
 * dedup, and it does not satisfy the frozen `capture-idempotency` pass predicate. The Gate 0
 * `capture-idempotency` criterion is therefore `declared-unmet`
 * (`tests/long-term-memory/acceptance/registry.ts`) and this file claims no Gate 0 cell.
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import { listMemoryRecords, saveMemoryRecord } from '../../src/long-term-memory/store.js'
import { contentHash } from '../../src/long-term-memory/tombstone.js'
import type { MemoryRecord } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'
import { acceptanceRecord, PERSONAL, seedContradiction } from './acceptance/corpus.js'

/** Dense enough that a miss means the row is absent, not filtered out by an unrelated status. */
const activeRecords = (): readonly MemoryRecord[] => listMemoryRecords({ ...PERSONAL, status: 'active' })

/** Narrows outside the test body — oxlint forbids conditionals inside `test()`. */
const activeById = (id: string): MemoryRecord => {
  const record = activeRecords().find((r) => r.id === id)
  if (record === undefined) throw new Error(`no active record with id ${id}`)
  return record
}

describe('long-term-memory store: upsert-by-id idempotency', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('a duplicate, out-of-order, reworded resubmission under the same id collapses to one row', () => {
    const sameId = `${PERSONAL.scopeId}-store-dup-same-id`
    const lateArrival = saveMemoryRecord(
      acceptanceRecord({
        ...PERSONAL,
        id: sameId,
        content: '  user   DRINKS oat milk ',
        createdAt: '2026-07-05T00:00:00.000Z',
        updatedAt: '2026-07-05T00:00:00.000Z',
        lastSeenAt: '2026-07-05T00:00:00.000Z',
      }),
    )
    const earlyArrival = saveMemoryRecord(
      acceptanceRecord({
        ...PERSONAL,
        id: sameId,
        content: 'User drinks oat milk',
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-03T00:00:00.000Z',
        lastSeenAt: '2026-07-03T00:00:00.000Z',
      }),
    )
    // positive control: both resubmissions actually wrote (not suppressed), so the row count
    // below reflects deduplication rather than a second write that never happened
    expect(lateArrival).not.toBeNull()
    expect(earlyArrival).not.toBeNull()

    const collapsed = activeRecords().filter((r) => r.id === sameId)
    expect(collapsed).toHaveLength(1)
    // last-write-wins content: the later `saveMemoryRecord` call's payload is what survives
    expect(contentHash(activeById(sameId).content)).toBe(contentHash('User drinks oat milk'))
  })

  test('a superseded record is retained as contradicted while its replacement is active', () => {
    seedContradiction(PERSONAL)

    const contradicted = listMemoryRecords({ ...PERSONAL, status: 'contradicted' })
    const active = listMemoryRecords({ ...PERSONAL, status: 'active' })

    // positive control: the corpus actually seeded one row per status, so the content/id
    // assertions below distinguish real records rather than passing on empty sets
    expect(contradicted).toHaveLength(1)
    expect(active).toHaveLength(1)
    expect(contradicted[0]?.content).toBe('User lives in Berlin')
    expect(active[0]?.content).toBe('User lives in Hamburg')
    // history is preserved rather than destructively replaced: two distinct rows, not one edited row
    expect(contradicted[0]?.id).not.toBe(active[0]?.id)
    expect(contradicted[0]?.evidence.timestamps).toHaveLength(1)
    // and the superseded content is no longer active
    expect(active.map((r) => r.content)).not.toContain('User lives in Berlin')
  })
})
