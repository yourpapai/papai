// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memos } from '../../src/db/schema.js'
import { memosForSubject } from '../../src/stats/per-table.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('memosForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns all-zero shape when subject has no memos', () => {
    const result = memosForSubject('nobody')

    expect(result).toEqual({
      total: 0,
      byStatus: {},
      tagCardinality: { distinct: 0, meanPerMemo: 0 },
      contentBytesTotal: 0,
      embeddingBytesTotal: 0,
      withEmbedding: 0,
      oldestCreatedAt: null,
      newestCreatedAt: null,
    })
  })

  test('aggregates counts, status mix, content bytes, tag cardinality and embedding presence', () => {
    const blob1 = new Uint8Array([1, 2, 3, 4])
    const blob2 = new Uint8Array([5, 6])

    getDrizzleDb()
      .insert(memos)
      .values([
        {
          id: 'm1',
          userId: 'u1',
          content: 'aaaa',
          tags: '["work","urgent"]',
          status: 'active',
          embedding: blob1,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'm2',
          userId: 'u1',
          content: 'bb',
          tags: '["work"]',
          status: 'active',
          embedding: blob2,
          createdAt: '2026-01-02T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
        },
        {
          id: 'm3',
          userId: 'u1',
          content: 'c',
          tags: '["personal"]',
          status: 'archived',
          createdAt: '2026-01-03T00:00:00Z',
          updatedAt: '2026-01-03T00:00:00Z',
        },
        {
          id: 'm4',
          userId: 'other',
          content: 'should not count',
          tags: '["leak"]',
          status: 'active',
          createdAt: '2026-01-04T00:00:00Z',
          updatedAt: '2026-01-04T00:00:00Z',
        },
      ])
      .run()

    const result = memosForSubject('u1')

    expect(result.total).toBe(3)
    expect(result.byStatus).toEqual({ active: 2, archived: 1 })
    expect(result.contentBytesTotal).toBe(4 + 2 + 1)
    expect(result.embeddingBytesTotal).toBe(4 + 2)
    expect(result.withEmbedding).toBe(2)
    expect(result.tagCardinality.distinct).toBe(3)
    expect(result.tagCardinality.meanPerMemo).toBeCloseTo(4 / 3, 5)
    const oldest = result.oldestCreatedAt
    const newest = result.newestCreatedAt
    expect(oldest).not.toBeNull()
    expect(newest).not.toBeNull()
    expect(Number(oldest)).toBeLessThan(Number(newest))
  })
})
