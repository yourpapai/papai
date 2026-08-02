// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { asc, eq } from 'drizzle-orm'

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
import { applyOutboxItem } from '../../src/long-term-memory/projection-apply.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-08-02T15:00:00.000Z'

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
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  lastSeenAt: '2026-08-01T12:00:00.000Z',
  ...overrides,
})

const shadow = (): MemoryProjectionRecordRow[] =>
  getDrizzleDb().select().from(memoryProjectionRecords).orderBy(asc(memoryProjectionRecords.projectionKey)).all()
const outbox = (): MemoryProjectionOutboxRow[] =>
  getDrizzleDb().select().from(memoryProjectionOutbox).orderBy(asc(memoryProjectionOutbox.position)).all()
const events = (): MemoryCanonicalEventRow[] => getDrizzleDb().select().from(memoryCanonicalEvents).all()

const firstPosition = (): number => {
  const rows = outbox()
  const head = rows[0]
  if (head === undefined) throw new Error('no outbox rows')
  return head.position
}

const positionAt = (index: number): number => {
  const row = outbox()[index]
  if (row === undefined) throw new Error(`no outbox row at index ${index}`)
  return row.position
}

const requireEvent = (row: MemoryCanonicalEventRow | undefined): MemoryCanonicalEventRow => {
  if (row === undefined) throw new Error('no canonical event')
  return row
}

const orphanOutboxRow = (): number => {
  getDrizzleDb()
    .insert(memoryProjectionOutbox)
    .values({ eventId: 'evt-does-not-exist', op: 'capture', state: 'pending', enqueuedAt: NOW })
    .run()
  const rows = outbox()
  const last = rows[rows.length - 1]
  if (last === undefined) throw new Error('no outbox rows')
  return last.position
}

describe('applyOutboxItem', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('applying a capture item writes one shadow row and completes the outbox row', () => {
    captureCanonicalEvent(input(), 'rec-1', NOW)

    expect(applyOutboxItem(firstPosition(), NOW)).toBe('applied')

    expect(shadow()).toHaveLength(1)
    expect(outbox()[0]?.state).toBe('complete')
    expect(outbox()[0]?.attemptCount).toBe(1)
    expect(outbox()[0]?.lastAttemptAt).toBe(NOW)
  })

  test('the shadow row carries every projected field from the winning event', () => {
    captureCanonicalEvent(
      input({
        summary: 'dark mode preference',
        validFrom: '2026-08-01T00:00:00.000Z',
        validUntil: '2027-01-01T00:00:00.000Z',
        expiresAt: '2028-01-01T00:00:00.000Z',
        threadContextId: 'thread-a',
        evidence: { actorIds: ['alice'], messageIds: ['m-1'], threads: ['thread-a'], contextId: 'ctx-1' },
      }),
      'rec-1',
      NOW,
    )
    applyOutboxItem(firstPosition(), NOW)

    const event = requireEvent(events()[0])
    expect(shadow()[0]).toEqual({
      projectionKey: 'rec-1',
      recordId: 'rec-1',
      eventId: event.eventId,
      idempotencyIdentity: event.idempotencyIdentity,
      contentIdentity: event.contentIdentity,
      scopeId: 'user-1',
      scopeType: 'personal',
      threadContextId: 'thread-a',
      kind: 'fact',
      content: 'likes dark mode',
      summary: 'dark mode preference',
      tags: '["ui"]',
      confidence: 0.9,
      source: 'background',
      actorIds: '["alice"]',
      provenance: JSON.stringify({ messageIds: ['m-1'], threads: ['thread-a'], contextId: 'ctx-1' }),
      eventTime: '2026-08-01T12:00:00.000Z',
      lastObservedAt: '2026-08-01T12:00:00.000Z',
      validFrom: '2026-08-01T00:00:00.000Z',
      validUntil: '2027-01-01T00:00:00.000Z',
      expiresAt: '2028-01-01T00:00:00.000Z',
      schemaVersion: 1,
      captureVersion: 'v1',
      projectedAt: NOW,
    })
  })

  test('a later-event-time update replaces the shadow row for the same record', () => {
    captureCanonicalEvent(input(), 'rec-1', NOW)
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: ['2026-08-05T00:00:00.000Z'] } }),
      'rec-1',
      NOW,
    )

    expect(applyOutboxItem(positionAt(0), NOW)).toBe('applied')
    expect(applyOutboxItem(positionAt(1), NOW)).toBe('applied')

    expect(shadow()).toHaveLength(1)
    expect(shadow()[0]?.content).toBe('likes light mode')
    expect(shadow()[0]?.eventTime).toBe('2026-08-05T00:00:00.000Z')
  })

  test('an earlier event applied after a later one loses and changes nothing', () => {
    captureCanonicalEvent(input(), 'rec-1', NOW)
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: ['2026-08-05T00:00:00.000Z'] } }),
      'rec-1',
      NOW,
    )

    expect(applyOutboxItem(positionAt(1), NOW)).toBe('applied')
    expect(applyOutboxItem(positionAt(0), NOW)).toBe('superseded')

    expect(shadow()).toHaveLength(1)
    expect(shadow()[0]?.content).toBe('likes light mode')
  })

  test('a superseded item still completes, so it is never retried forever', () => {
    captureCanonicalEvent(input(), 'rec-1', NOW)
    captureCanonicalEvent(
      input({ content: 'likes light mode', evidence: { timestamps: ['2026-08-05T00:00:00.000Z'] } }),
      'rec-1',
      NOW,
    )
    applyOutboxItem(positionAt(1), NOW)
    applyOutboxItem(positionAt(0), NOW)

    expect(outbox()[0]?.state).toBe('complete')
  })

  test('re-applying the same position is a no-op beyond the attempt count', () => {
    captureCanonicalEvent(input(), 'rec-1', NOW)
    const position = firstPosition()
    applyOutboxItem(position, NOW)
    const afterFirst = shadow()

    expect(applyOutboxItem(position, NOW)).toBe('applied')
    expect(shadow()).toEqual(afterFirst)
  })

  test('an event with no record id projects under its idempotency identity', () => {
    captureCanonicalEvent(input(), null, NOW)
    applyOutboxItem(firstPosition(), NOW)

    expect(shadow()).toHaveLength(1)
    expect(shadow()[0]?.recordId).toBeNull()
    expect(shadow()[0]?.projectionKey).toBe(events()[0]?.idempotencyIdentity)
  })

  test('an observe item refreshes last_observed_at on the winning row', () => {
    captureCanonicalEvent(input(), 'rec-1', NOW)
    applyOutboxItem(positionAt(0), NOW)
    captureCanonicalEvent(input({ evidence: { timestamps: ['2026-09-01T00:00:00.000Z'] } }), 'rec-1', NOW)

    expect(outbox()[1]?.op).toBe('observe')
    expect(applyOutboxItem(positionAt(1), NOW)).toBe('applied')
    expect(shadow()[0]?.lastObservedAt).toBe('2026-09-01T00:00:00.000Z')
  })

  test('an outbox row whose event is gone fails terminally rather than retrying', () => {
    const position = orphanOutboxRow()

    expect(applyOutboxItem(position, NOW)).toBe('missing-event')

    const row = getDrizzleDb()
      .select()
      .from(memoryProjectionOutbox)
      .where(eq(memoryProjectionOutbox.position, position))
      .get()
    expect(row?.state).toBe('failed')
    expect(row?.lastError).toContain('canonical event missing')
    expect(shadow()).toHaveLength(0)
  })

  test('an unknown position reports missing-event and writes nothing', () => {
    expect(applyOutboxItem(9999, NOW)).toBe('missing-event')
    expect(shadow()).toHaveLength(0)
  })
})
