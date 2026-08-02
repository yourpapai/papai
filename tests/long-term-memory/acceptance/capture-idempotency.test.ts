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
} from '../../../src/db/schema.js'
import { drainProjectionOutbox } from '../../../src/long-term-memory/projection-drain.js'
import { projectionSnapshot } from '../../../src/long-term-memory/projection-snapshot.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'
import { PERSONAL, seedDuplicateOutOfOrder, seedLongHorizon } from './corpus.js'

const DRAIN_AT = '2026-08-02T18:00:00.000Z'

const events = (): MemoryCanonicalEventRow[] => getDrizzleDb().select().from(memoryCanonicalEvents).all()
const attempts = (): MemoryCanonicalCaptureAttemptRow[] =>
  getDrizzleDb().select().from(memoryCanonicalCaptureAttempts).all()

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

    expect(events()).toHaveLength(12)
  })

  test('draining once at the end equals draining after every write', async () => {
    seedLongHorizon(PERSONAL)
    const batched = settle()

    await setupTestDb()
    seedLongHorizon(PERSONAL)
    drainProjectionOutbox('2026-08-02T17:00:00.000Z')

    expect(settle()).toBe(batched)
  })

  test('replaying the whole horizon a second time leaves the snapshot byte-identical', async () => {
    seedLongHorizon(PERSONAL)
    const once = settle()

    await setupTestDb()
    seedLongHorizon(PERSONAL)
    seedLongHorizon(PERSONAL)

    expect(settle()).toBe(once)
  })
})
