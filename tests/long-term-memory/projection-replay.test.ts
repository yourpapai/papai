// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  memoryCanonicalEvents,
  type MemoryCanonicalEventRow,
  memoryProjectionOutbox,
  type MemoryProjectionOutboxRow,
  memoryProjectionRecords,
  type MemoryProjectionRecordRow,
} from '../../src/db/schema.js'
import { captureCanonicalEvent } from '../../src/long-term-memory/canonical-capture.js'
import { drainProjectionOutbox, projectionCheckpoint } from '../../src/long-term-memory/projection-drain.js'
import { projectionSnapshot } from '../../src/long-term-memory/projection-snapshot.js'
import type { MemoryRecordInput, MemoryScope } from '../../src/long-term-memory/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const SCOPE: MemoryScope = { scopeId: 'user-1', scopeType: 'personal' }

const EARLY = '2026-08-01T00:00:00.000Z'
const LATE = '2026-08-09T00:00:00.000Z'

const input = (overrides: Partial<MemoryRecordInput> = {}): MemoryRecordInput => ({
  id: 'rec-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'likes dark mode',
  summary: null,
  tags: ['ui'],
  confidence: 0.9,
  status: 'active',
  source: 'background',
  evidence: {},
  createdAt: EARLY,
  updatedAt: EARLY,
  lastSeenAt: EARLY,
  ...overrides,
})

const events = (): MemoryCanonicalEventRow[] => getDrizzleDb().select().from(memoryCanonicalEvents).all()
const shadow = (): MemoryProjectionRecordRow[] => getDrizzleDb().select().from(memoryProjectionRecords).all()

/**
 * The outbox item that produced a shadow row, joined on `event_id` — the shadow row records the
 * winning event, and `applyOutboxItem` writes exactly one outbox item per canonical event, so
 * the join is 1:1. Throws rather than returning `undefined` so a missing item is a loud failure
 * (`no-conditional-in-test` bars an `if`/`??` inside the `test()` body that would otherwise
 * express this).
 */
const outboxItemFor = (eventId: string): MemoryProjectionOutboxRow => {
  const item = getDrizzleDb()
    .select()
    .from(memoryProjectionOutbox)
    .where(eq(memoryProjectionOutbox.eventId, eventId))
    .get()
  if (item === undefined) throw new Error(`no outbox item for event ${eventId}`)
  return item
}

/** Same throw-on-missing shape as `outboxItemFor`, for the checkpoint the B4 test compares against. */
const requireCheckpoint = (): number => {
  const checkpoint = projectionCheckpoint()
  if (checkpoint === null) throw new Error('no projection checkpoint')
  return checkpoint
}

const captureTimes = (times: number, ingest: string): void => {
  for (let attempt = 0; attempt < times; attempt += 1) captureCanonicalEvent(input(), 'rec-1', ingest)
}

const settle = (): string => {
  drainProjectionOutbox('2026-08-10T00:00:00.000Z')
  return projectionSnapshot(SCOPE)
}

describe('projection replay', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('one capture produces one event and one shadow row', () => {
    captureTimes(1, '2026-08-02T00:00:00.000Z')
    settle()

    expect(events()).toHaveLength(1)
    expect(shadow()).toHaveLength(1)
  })

  test('N identical replays yield exactly one canonical event', () => {
    captureTimes(5, '2026-08-02T00:00:00.000Z')

    expect(events()).toHaveLength(1)
  })

  test('the snapshot after N replays is byte-identical to the snapshot after one', async () => {
    captureTimes(1, '2026-08-02T00:00:00.000Z')
    const afterOne = settle()

    await setupTestDb()
    captureTimes(5, '2026-08-02T00:00:00.000Z')

    expect(settle()).toBe(afterOne)
  })

  test('draining between replays does not change the settled snapshot', async () => {
    captureTimes(1, '2026-08-02T00:00:00.000Z')
    const afterOne = settle()

    await setupTestDb()
    captureCanonicalEvent(input(), 'rec-1', '2026-08-02T00:00:00.000Z')
    drainProjectionOutbox('2026-08-03T00:00:00.000Z')
    captureCanonicalEvent(input(), 'rec-1', '2026-08-04T00:00:00.000Z')

    expect(settle()).toBe(afterOne)
  })

  test('reversing ingest order relative to event time yields the same settled snapshot', async () => {
    captureCanonicalEvent(input({ evidence: { timestamps: [EARLY] } }), 'rec-1', '2026-08-02T00:00:00.000Z')
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: [LATE] } }),
      'rec-1',
      '2026-08-03T00:00:00.000Z',
    )
    const forward = settle()

    // Load-bearing: the two orders must agree on the *correct* winner, not merely on each
    // other. A fold that resolves by ingest order rather than event time is still a
    // deterministic function of event time under both orderings, so it would converge on the
    // same wrong winner in both and the bare equality below would stay green.
    expect(shadow()[0]?.content).toBe('likes light mode')

    await setupTestDb()
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: [LATE] } }),
      'rec-1',
      '2026-08-02T00:00:00.000Z',
    )
    captureCanonicalEvent(input({ evidence: { timestamps: [EARLY] } }), 'rec-1', '2026-08-03T00:00:00.000Z')

    expect(settle()).toBe(forward)
    expect(shadow()[0]?.content).toBe('likes light mode')
  })

  test('draining after each capture yields the same snapshot as draining once at the end', async () => {
    captureCanonicalEvent(input({ evidence: { timestamps: [EARLY] } }), 'rec-1', '2026-08-02T00:00:00.000Z')
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: [LATE] } }),
      'rec-1',
      '2026-08-03T00:00:00.000Z',
    )
    const batched = settle()

    await setupTestDb()
    captureCanonicalEvent(input({ evidence: { timestamps: [EARLY] } }), 'rec-1', '2026-08-02T00:00:00.000Z')
    drainProjectionOutbox('2026-08-02T01:00:00.000Z')
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: [LATE] } }),
      'rec-1',
      '2026-08-03T00:00:00.000Z',
    )

    expect(settle()).toBe(batched)
  })

  test('the later event time wins regardless of which arrived first', () => {
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: [LATE] } }),
      'rec-1',
      '2026-08-02T00:00:00.000Z',
    )
    captureCanonicalEvent(input({ evidence: { timestamps: [EARLY] } }), 'rec-1', '2026-08-03T00:00:00.000Z')
    settle()

    expect(shadow()).toHaveLength(1)
    expect(shadow()[0]?.content).toBe('likes light mode')
  })

  test('B4 is unreachable: every shadow row has a completed item at or below the checkpoint', () => {
    captureCanonicalEvent(input(), 'rec-1', '2026-08-02T00:00:00.000Z')
    captureCanonicalEvent(input({ id: 'rec-2', content: 'prefers metric units' }), 'rec-2', '2026-08-02T00:00:00.000Z')
    settle()

    const rows = shadow()
    expect(rows).toHaveLength(2)
    const checkpoint = requireCheckpoint()
    for (const row of rows) {
      const item = outboxItemFor(row.eventId)
      expect(item.state).toBe('complete')
      expect(item.position).toBeLessThanOrEqual(checkpoint)
    }
  })

  test('B2 is holdable: capture without a drain leaves the snapshot empty', () => {
    const empty = projectionSnapshot(SCOPE)
    captureCanonicalEvent(input(), 'rec-1', '2026-08-02T00:00:00.000Z')

    expect(projectionSnapshot(SCOPE)).toBe(empty)
  })
})
