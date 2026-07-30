// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { sql } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryCanonicalCaptureAttempts, memoryCanonicalEvents, memoryProjectionOutbox } from '../../src/db/schema.js'
import { captureCanonicalEvent } from '../../src/long-term-memory/canonical-capture.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const INGEST = '2026-07-30T13:00:00.000Z'

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
  createdAt: '2026-07-30T12:00:00.000Z',
  updatedAt: '2026-07-30T12:00:00.000Z',
  lastSeenAt: '2026-07-30T12:00:00.000Z',
  ...overrides,
})

const events = (): (typeof memoryCanonicalEvents.$inferSelect)[] =>
  getDrizzleDb().select().from(memoryCanonicalEvents).all()
const outbox = (): (typeof memoryProjectionOutbox.$inferSelect)[] =>
  getDrizzleDb().select().from(memoryProjectionOutbox).all()
const attempts = (): (typeof memoryCanonicalCaptureAttempts.$inferSelect)[] =>
  getDrizzleDb().select().from(memoryCanonicalCaptureAttempts).all()

/** Injects a fault at exactly the B1 boundary: after the event insert, on the outbox insert. */
const failTheOutboxInsert = (): void => {
  getDrizzleDb().run(
    sql`CREATE TRIGGER fail_outbox_insert BEFORE INSERT ON memory_projection_outbox
        BEGIN SELECT RAISE(ABORT, 'injected outbox fault'); END`,
  )
}

const clearTheFault = (): void => {
  getDrizzleDb().run(sql`DROP TRIGGER IF EXISTS fail_outbox_insert`)
}

describe('canonical capture faults', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterEach(() => {
    delete process.env['MEMORY_CANONICAL_CAPTURE']
  })

  test('B1 is unreachable: a fault between the two inserts leaves neither row', () => {
    failTheOutboxInsert()
    const outcome = captureCanonicalEvent(input(), 'rec-1', INGEST)
    clearTheFault()

    expect(outcome).toBe('failed')
    expect(events()).toHaveLength(0)
    expect(outbox()).toHaveLength(0)
  })

  test('a failed capture is recorded durably outside the rolled-back transaction', () => {
    failTheOutboxInsert()
    captureCanonicalEvent(input(), 'rec-1', INGEST)
    clearTheFault()

    expect(attempts()).toHaveLength(1)
    expect(attempts()[0]?.outcome).toBe('failed')
    expect(attempts()[0]?.eventId).toBeNull()
  })

  test('a failure never propagates to the caller', () => {
    failTheOutboxInsert()
    expect(() => captureCanonicalEvent(input(), 'rec-1', INGEST)).not.toThrow()
    clearTheFault()
  })

  test('capture recovers once the fault clears', () => {
    failTheOutboxInsert()
    captureCanonicalEvent(input(), 'rec-1', INGEST)
    clearTheFault()

    expect(captureCanonicalEvent(input(), 'rec-1', INGEST)).toBe('captured')
    expect(events()).toHaveLength(1)
    expect(outbox()).toHaveLength(1)
  })

  test('enumeration holds forward: every event has at least one outbox item', () => {
    captureCanonicalEvent(input(), 'rec-1', INGEST)
    captureCanonicalEvent(input({ id: 'rec-2', content: 'prefers metric units' }), 'rec-2', INGEST)

    const enqueuedIds = new Set(outbox().map((row) => row.eventId))
    for (const event of events()) expect(enqueuedIds.has(event.eventId)).toBe(true)
  })

  test('enumeration holds backward: every outbox item resolves to an event', () => {
    captureCanonicalEvent(input(), 'rec-1', INGEST)
    captureCanonicalEvent(input({ evidence: { timestamps: ['2027-01-01T00:00:00.000Z'] } }), 'rec-1', INGEST)

    const eventIds = new Set(events().map((row) => row.eventId))
    expect(outbox().length).toBeGreaterThan(0)
    for (const item of outbox()) expect(eventIds.has(item.eventId)).toBe(true)
  })

  test('the kill switch off writes nothing and reports no outcome', () => {
    process.env['MEMORY_CANONICAL_CAPTURE'] = 'off'

    expect(captureCanonicalEvent(input(), 'rec-1', INGEST)).toBeNull()
    expect(events()).toHaveLength(0)
    expect(outbox()).toHaveLength(0)
    expect(attempts()).toHaveLength(0)
  })

  test('any value other than the exact string "off" leaves capture enabled', () => {
    process.env['MEMORY_CANONICAL_CAPTURE'] = 'OFF'
    expect(captureCanonicalEvent(input(), 'rec-1', INGEST)).toBe('captured')
  })
})
