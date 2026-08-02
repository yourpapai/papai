// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import {
  memoryCanonicalCaptureAttempts,
  type MemoryCanonicalCaptureAttemptRow,
  memoryCanonicalEvents,
  type MemoryCanonicalEventRow,
  memoryProjectionRecords,
  type MemoryProjectionRecordRow,
} from '../../../src/db/schema.js'
import { drainProjectionOutbox } from '../../../src/long-term-memory/projection-drain.js'
import { projectionSnapshot } from '../../../src/long-term-memory/projection-snapshot.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'
import { PERSONAL, seedDuplicateOutOfOrder, seedLongHorizon } from './corpus.js'

const DRAIN_AT = '2026-08-02T18:00:00.000Z'

const events = (): MemoryCanonicalEventRow[] => getDrizzleDb().select().from(memoryCanonicalEvents).all()
const attempts = (): MemoryCanonicalCaptureAttemptRow[] =>
  getDrizzleDb().select().from(memoryCanonicalCaptureAttempts).all()

/**
 * The shadow-projection view, queried directly rather than inferred from `settle()`'s return
 * value. Every byte-identity assertion in this suite compares two snapshots for equality, which
 * a no-op projection pipeline satisfies vacuously (both sides settle to the same empty
 * snapshot). Anchoring at least one assertion per byte-identity claim to a concrete row count
 * and concrete content here is what makes that claim load-bearing rather than a comparison of
 * two empty strings.
 */
const shadow = (): MemoryProjectionRecordRow[] => getDrizzleDb().select().from(memoryProjectionRecords).all()

const settle = (): string => {
  drainProjectionOutbox(DRAIN_AT)
  return projectionSnapshot(PERSONAL)
}

const duplicateSuppressions = (): number => attempts().filter((row) => row.outcome === 'suppressed-duplicate').length

describe('acceptance: capture-idempotency / duplicate-out-of-order', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('identical content captured twice yields exactly one canonical event', () => {
    seedDuplicateOutOfOrder(PERSONAL)

    expect(events()).toHaveLength(1)
  })

  test('the suppressed replay is observable as a duplicate suppression', () => {
    seedDuplicateOutOfOrder(PERSONAL)

    expect(duplicateSuppressions()).toBe(1)
  })

  test('the settled snapshot after the duplicate equals the snapshot after the first write alone', async () => {
    seedDuplicateOutOfOrder(PERSONAL)
    const withDuplicate = settle()

    // Load-bearing: prove the compared snapshot actually carries the surviving record. Without
    // this, a projection pipeline that no-ops entirely would settle both sides to the same
    // empty snapshot and the bare equality below would stay green.
    expect(shadow()).toHaveLength(1)
    expect(shadow()[0]?.content).toBe('User drinks oat milk')

    await setupTestDb()
    seedDuplicateOutOfOrder(PERSONAL)

    expect(settle()).toBe(withDuplicate)
  })
})

describe('acceptance: capture-idempotency / long-horizon', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('a twelve-month horizon projects one shadow row per distinct fact', () => {
    seedLongHorizon(PERSONAL)
    settle()

    expect(shadow()).toHaveLength(12)
    expect(events()).toHaveLength(12)
  })

  test('draining once at the end equals draining after every write', async () => {
    seedLongHorizon(PERSONAL)
    const batched = settle()

    // Load-bearing: same anchor as above, applied to the batched-drain snapshot this test
    // compares against.
    expect(shadow()).toHaveLength(12)
    expect(shadow()[0]?.content).toBe('Month 01 status was recorded')

    await setupTestDb()
    seedLongHorizon(PERSONAL)
    drainProjectionOutbox('2026-08-02T17:00:00.000Z')

    expect(settle()).toBe(batched)
  })

  test('replaying the whole horizon a second time leaves the snapshot byte-identical', async () => {
    seedLongHorizon(PERSONAL)
    const once = settle()

    // Load-bearing: same anchor, applied to the single-pass snapshot this test compares
    // against after a second, redundant seeding of the whole horizon.
    expect(shadow()).toHaveLength(12)
    expect(shadow()[0]?.content).toBe('Month 01 status was recorded')

    await setupTestDb()
    seedLongHorizon(PERSONAL)
    seedLongHorizon(PERSONAL)

    expect(settle()).toBe(once)
  })
})
