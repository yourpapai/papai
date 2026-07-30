// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  memoryCanonicalCaptureAttempts,
  type MemoryCanonicalCaptureAttemptRow,
  memoryCanonicalEvents,
  type MemoryCanonicalEventRow,
  memoryProjectionOutbox,
  type MemoryProjectionOutboxRow,
  memoryTombstones,
} from '../../src/db/schema.js'
import { captureCanonicalEvent } from '../../src/long-term-memory/canonical-capture.js'
import { contentHash } from '../../src/long-term-memory/tombstone.js'
import { insertTombstone } from '../../src/long-term-memory/tombstone.testing.js'
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

const events = (): MemoryCanonicalEventRow[] => getDrizzleDb().select().from(memoryCanonicalEvents).all()
const outbox = (): MemoryProjectionOutboxRow[] => getDrizzleDb().select().from(memoryProjectionOutbox).all()
const attempts = (): MemoryCanonicalCaptureAttemptRow[] =>
  getDrizzleDb().select().from(memoryCanonicalCaptureAttempts).all()

describe('captureCanonicalEvent', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('a first capture writes one event, one capture outbox item, and one attempt', () => {
    expect(captureCanonicalEvent(input(), 'rec-1', INGEST)).toBe('captured')

    expect(events()).toHaveLength(1)
    expect(events()[0]?.recordId).toBe('rec-1')
    expect(events()[0]?.lastObservedAt).toBe('2026-07-30T12:00:00.000Z')
    expect(outbox()).toHaveLength(1)
    expect(outbox()[0]?.op).toBe('capture')
    expect(outbox()[0]?.state).toBe('pending')
    expect(attempts()).toHaveLength(1)
    expect(attempts()[0]?.outcome).toBe('captured')
    expect(attempts()[0]?.eventId).toBe(events()[0]?.eventId)
  })

  test('a pure replay adds no event, no outbox item, and no timestamp change — only an attempt', () => {
    captureCanonicalEvent(input(), 'rec-1', INGEST)
    const before = events()[0]

    expect(captureCanonicalEvent(input(), 'rec-1', '2026-07-30T14:00:00.000Z')).toBe('suppressed-duplicate')

    expect(events()).toHaveLength(1)
    expect(events()[0]?.lastObservedAt).toBe(before?.lastObservedAt)
    expect(outbox()).toHaveLength(1)
    expect(attempts()).toHaveLength(2)
    expect(attempts()[1]?.outcome).toBe('suppressed-duplicate')
  })

  test('ten replays leave exactly one event and one outbox item', () => {
    for (let i = 0; i < 10; i += 1) captureCanonicalEvent(input(), 'rec-1', INGEST)
    expect(events()).toHaveLength(1)
    expect(outbox()).toHaveLength(1)
    expect(attempts()).toHaveLength(10)
  })

  test('a later observation advances lastObservedAt and enqueues an observe item', () => {
    captureCanonicalEvent(input({ evidence: { timestamps: ['2026-07-01T00:00:00.000Z'] } }), 'rec-1', INGEST)
    expect(
      captureCanonicalEvent(input({ evidence: { timestamps: ['2026-07-05T00:00:00.000Z'] } }), 'rec-1', INGEST),
    ).toBe('suppressed-duplicate')

    expect(events()[0]?.lastObservedAt).toBe('2026-07-05T00:00:00.000Z')
    expect(outbox()).toHaveLength(2)
    expect(outbox()[1]?.op).toBe('observe')
  })

  test('reversed ingest order still leaves lastObservedAt at the maximum event time', () => {
    captureCanonicalEvent(input({ evidence: { timestamps: ['2026-07-05T00:00:00.000Z'] } }), 'rec-1', INGEST)
    captureCanonicalEvent(input({ evidence: { timestamps: ['2026-07-01T00:00:00.000Z'] } }), 'rec-1', INGEST)

    expect(events()[0]?.lastObservedAt).toBe('2026-07-05T00:00:00.000Z')
    // The earlier observation advanced nothing, so it enqueued nothing.
    expect(outbox()).toHaveLength(1)
  })

  test('case and whitespace variants of the same content are one event', () => {
    captureCanonicalEvent(input(), 'rec-1', INGEST)
    captureCanonicalEvent(input({ id: 'rec-2', content: '  LIKES   dark MODE ' }), 'rec-2', INGEST)
    expect(events()).toHaveLength(1)
  })

  test('the same content in a different scope is a different event', () => {
    captureCanonicalEvent(input(), 'rec-1', INGEST)
    captureCanonicalEvent(input({ id: 'rec-2', scopeId: 'user-2' }), 'rec-2', INGEST)
    expect(events()).toHaveLength(2)
  })

  test('tombstoned content is suppressed: no event, no outbox item, but an attempt is recorded', () => {
    insertTombstone({ scopeId: 'user-1', scopeType: 'personal' }, 'likes dark mode', INGEST)

    expect(captureCanonicalEvent(input(), null, INGEST)).toBe('suppressed-tombstoned')

    expect(events()).toHaveLength(0)
    expect(outbox()).toHaveLength(0)
    expect(attempts()).toHaveLength(1)
    expect(attempts()[0]?.outcome).toBe('suppressed-tombstoned')
    expect(attempts()[0]?.eventId).toBeNull()
  })

  test('an explicit save is never gated by a tombstone', () => {
    insertTombstone({ scopeId: 'user-1', scopeType: 'personal' }, 'likes dark mode', INGEST)
    expect(captureCanonicalEvent(input({ source: 'explicit' }), 'rec-1', INGEST)).toBe('captured')
    expect(events()).toHaveLength(1)
  })

  test('the hash a tombstone stores is the hash the identity is built from', () => {
    // Read from storage rather than recomputed: this is the only assertion that catches a
    // future divergence between what erasure records and what dedup keys on.
    insertTombstone({ scopeId: 'user-1', scopeType: 'personal' }, 'likes dark mode', INGEST)
    const stored = getDrizzleDb().select().from(memoryTombstones).all()[0]

    expect(stored?.contentHash).toBe(contentHash('likes dark mode'))
    // And that hash is what suppresses the capture, from the same scope tuple.
    expect(captureCanonicalEvent(input(), null, INGEST)).toBe('suppressed-tombstoned')
  })

  test('every attempt row carries the capture version and both identities', () => {
    captureCanonicalEvent(input(), 'rec-1', INGEST)
    const attempt = attempts()[0]
    expect(attempt?.captureVersion).toBe('v1')
    expect(attempt?.idempotencyIdentity).toBe(events()[0]?.idempotencyIdentity)
    expect(attempt?.contentIdentity).toBe(events()[0]?.contentIdentity)
  })
})
