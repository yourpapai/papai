// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { sql } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  memoryCanonicalCaptureAttempts,
  memoryCanonicalEvents,
  type MemoryCanonicalCaptureAttemptRow,
  type MemoryCanonicalEventRow,
} from '../../src/db/schema.js'
import { saveMemoryRecord, updateMemoryRecord } from '../../src/long-term-memory/store.js'
import { insertTombstone } from '../../src/long-term-memory/tombstone.testing.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-07-30T12:00:00.000Z'
const scope = { scopeId: 'user-1', scopeType: 'personal' } as const

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
  createdAt: NOW,
  updatedAt: NOW,
  lastSeenAt: NOW,
  ...overrides,
})

const events = (): MemoryCanonicalEventRow[] => getDrizzleDb().select().from(memoryCanonicalEvents).all()
const attempts = (): MemoryCanonicalCaptureAttemptRow[] =>
  getDrizzleDb().select().from(memoryCanonicalCaptureAttempts).all()

describe('canonical capture hook in the store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterEach(() => {
    delete process.env['MEMORY_CANONICAL_CAPTURE']
    getDrizzleDb().run(sql`DROP TRIGGER IF EXISTS fail_canonical_event_insert`)
  })

  test('a saved record captures a canonical event linked back to the record', () => {
    const saved = saveMemoryRecord(input())
    expect(saved?.id).toBe('rec-1')
    expect(events()).toHaveLength(1)
    expect(events()[0]?.recordId).toBe('rec-1')
  })

  test('a tombstone-suppressed save records an attempt and still returns null', () => {
    insertTombstone(scope, 'likes dark mode', NOW)

    expect(saveMemoryRecord(input())).toBeNull()
    expect(events()).toHaveLength(0)
    expect(attempts()).toHaveLength(1)
    expect(attempts()[0]?.outcome).toBe('suppressed-tombstoned')
  })

  test('a canonical write failure does not change what saveMemoryRecord returns', () => {
    getDrizzleDb().run(
      sql`CREATE TRIGGER fail_canonical_event_insert BEFORE INSERT ON memory_canonical_events
          BEGIN SELECT RAISE(ABORT, 'injected'); END`,
    )

    const saved = saveMemoryRecord(input())

    expect(saved?.id).toBe('rec-1')
    expect(saved?.content).toBe('likes dark mode')
    expect(events()).toHaveLength(0)
    expect(attempts()[0]?.outcome).toBe('failed')
  })

  test('a content-changing update captures a second canonical event', () => {
    saveMemoryRecord(input())
    updateMemoryRecord(scope, 'rec-1', { content: 'prefers light mode' }, '2026-07-30T13:00:00.000Z')

    expect(events()).toHaveLength(2)
    expect(events().map((row) => row.content)).toContain('prefers light mode')
  })

  test('a status-only update captures nothing', () => {
    saveMemoryRecord(input())
    const before = attempts().length

    updateMemoryRecord(scope, 'rec-1', { status: 'stale' }, '2026-07-30T13:00:00.000Z')

    expect(events()).toHaveLength(1)
    expect(attempts()).toHaveLength(before)
  })

  test('a confidence-only update captures nothing', () => {
    saveMemoryRecord(input())
    const before = attempts().length

    updateMemoryRecord(scope, 'rec-1', { confidence: 0.2 }, '2026-07-30T13:00:00.000Z')

    expect(attempts()).toHaveLength(before)
  })

  test('an update that matches no record captures nothing', () => {
    updateMemoryRecord(scope, 'missing', { content: 'never stored' }, NOW)
    expect(attempts()).toHaveLength(0)
  })

  test('a tombstone-suppressed update captures nothing', () => {
    saveMemoryRecord(input())
    insertTombstone(scope, 'forgotten thing', NOW)
    const before = attempts().length

    expect(updateMemoryRecord(scope, 'rec-1', { content: 'forgotten thing' }, NOW)).toBeNull()

    // Unlike saveMemoryRecord, this early-return has no full record to build a canonical
    // payload from — only a scope, an id, and a candidate string. 1c introduces canonical
    // tombstones and can record the suppression properly; 1a does not fabricate a payload.
    expect(attempts()).toHaveLength(before)
  })

  test('with the kill switch off the store behaves exactly as before', () => {
    process.env['MEMORY_CANONICAL_CAPTURE'] = 'off'

    const saved = saveMemoryRecord(input())

    expect(saved?.id).toBe('rec-1')
    expect(events()).toHaveLength(0)
    expect(attempts()).toHaveLength(0)
  })
})
