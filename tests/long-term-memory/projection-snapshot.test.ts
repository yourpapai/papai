// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { captureCanonicalEvent } from '../../src/long-term-memory/canonical-capture.js'
import { drainProjectionOutbox } from '../../src/long-term-memory/projection-drain.js'
import { projectionSnapshot } from '../../src/long-term-memory/projection-snapshot.js'
import type { MemoryRecordInput, MemoryScope } from '../../src/long-term-memory/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-08-02T15:00:00.000Z'
const SCOPE: MemoryScope = { scopeId: 'user-1', scopeType: 'personal' }
const OTHER: MemoryScope = { scopeId: 'user-2', scopeType: 'personal' }

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

const captureAndDrain = (record: MemoryRecordInput, recordId: string | null, ingest: string): void => {
  captureCanonicalEvent(record, recordId, ingest)
  drainProjectionOutbox(ingest)
}

describe('projectionSnapshot', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('an empty scope has a stable empty snapshot', () => {
    expect(projectionSnapshot(SCOPE)).toBe(projectionSnapshot(SCOPE))
  })

  test('two scopes with no rows still produce different snapshots', () => {
    expect(projectionSnapshot(SCOPE)).not.toBe(projectionSnapshot(OTHER))
  })

  test('the snapshot changes when content changes', () => {
    captureAndDrain(input(), 'rec-1', NOW)
    const before = projectionSnapshot(SCOPE)
    captureAndDrain(
      input({ content: 'likes light mode', evidence: { timestamps: ['2026-08-05T00:00:00.000Z'] } }),
      'rec-1',
      NOW,
    )

    expect(projectionSnapshot(SCOPE)).not.toBe(before)
  })

  test('the snapshot excludes the event id, which is a fresh UUID on every run', () => {
    captureAndDrain(input(), 'rec-1', NOW)

    expect(projectionSnapshot(SCOPE)).not.toContain('eventId')
  })

  test('the snapshot excludes the projection timestamp', () => {
    captureAndDrain(input(), 'rec-1', NOW)

    expect(projectionSnapshot(SCOPE)).not.toContain('projectedAt')
  })

  test('a different ingest time yields the same snapshot', async () => {
    captureAndDrain(input(), 'rec-1', NOW)
    const first = projectionSnapshot(SCOPE)

    await setupTestDb()
    captureAndDrain(input(), 'rec-1', '2027-01-01T00:00:00.000Z')

    expect(projectionSnapshot(SCOPE)).toBe(first)
  })

  test('the snapshot carries the observed instant, which is replay-stable by construction', () => {
    captureAndDrain(input(), 'rec-1', NOW)

    expect(projectionSnapshot(SCOPE)).toContain('lastObservedAt')
  })

  test('the snapshot is scoped: another scope’s rows never appear', () => {
    captureAndDrain(input(), 'rec-1', NOW)
    captureAndDrain(input({ id: 'rec-2', scopeId: 'user-2', content: 'other scope fact' }), 'rec-2', NOW)

    expect(projectionSnapshot(SCOPE)).not.toContain('other scope fact')
  })

  test('rows are ordered by projection key, not by insertion order', () => {
    captureAndDrain(input({ id: 'rec-z', content: 'zebra fact' }), 'rec-z', NOW)
    captureAndDrain(input({ id: 'rec-a', content: 'alpha fact' }), 'rec-a', NOW)
    const snapshot = projectionSnapshot(SCOPE)

    expect(snapshot.indexOf('alpha fact')).toBeLessThan(snapshot.indexOf('zebra fact'))
  })
})
