// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { listMemoryRecords, saveMemoryRecord } from '../../../src/long-term-memory/store.js'
import { contentHash, normalizeForHash } from '../../../src/long-term-memory/tombstone.js'
import type { MemoryRecord } from '../../../src/long-term-memory/types.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { CASES } from './capture-idempotency.cases.js'
import { acceptanceRecord, PERSONAL, seedContradiction, seedDuplicateOutOfOrder } from './corpus.js'

/** Dense enough that a miss means the row is absent, not filtered out by an unrelated status. */
const activeRecords = (): readonly MemoryRecord[] => listMemoryRecords({ ...PERSONAL, status: 'active' })

/** Narrows outside the test body — oxlint forbids conditionals inside `test()`. */
const activeById = (id: string): MemoryRecord => {
  const record = activeRecords().find((r) => r.id === id)
  if (record === undefined) throw new Error(`no active record with id ${id}`)
  return record
}

describe('acceptance: capture-idempotency', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test(`duplicate-out-of-order — ${CASES['duplicate-out-of-order']}`, () => {
    const seeded = seedDuplicateOutOfOrder(PERSONAL)

    // positive control: both independently captured writes actually landed, so the hash
    // agreement below proves the two rows carry identical content rather than one write
    // having silently failed and leaving a trivially-matching set of size one
    const seededActive = activeRecords().filter((r) => seeded.includes(r.id))
    expect(seededActive).toHaveLength(seeded.length)

    const hashes = new Set(seededActive.map((r) => contentHash(r.content)))
    expect(hashes.size).toBe(1)

    // the hash function itself is order-independent and whitespace/case-normalized — the
    // property that would let a consumer collapse independently captured rows into one
    // logical identity
    expect(contentHash('User drinks oat milk')).toBe(contentHash('  user   DRINKS oat milk '))
    expect(normalizeForHash('  User   Drinks Oat Milk ')).toBe('user drinks oat milk')

    // seedDuplicateOutOfOrder models "duplicate capture" as two independent writes under two
    // different ids: the store has no content-hash-keyed dedup, so both rows above remain
    // active (see task report). The guarantee the write path actually provides is
    // upsert-by-id: a duplicate, out-of-order resubmission of the SAME capture (same id,
    // reordered arrival, reworded whitespace/case) collapses to exactly one stored row.
    const sameId = `${PERSONAL.scopeId}-acc-dup-same-id`
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
    expect(contentHash(activeById(sameId).content)).toBe(contentHash('User drinks oat milk'))
  })

  test(`contradiction — ${CASES.contradiction}`, () => {
    seedContradiction(PERSONAL)

    const contradicted = listMemoryRecords({ ...PERSONAL, status: 'contradicted' })
    const active = listMemoryRecords({ ...PERSONAL, status: 'active' })

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
