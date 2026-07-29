// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { rankRecordsBySimilarity } from '../../src/long-term-memory/semantic-search.js'
import { saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const rec = (id: string, embedding: Float32Array): MemoryRecordInput => ({
  id,
  scopeId: 'group-1',
  scopeType: 'group',
  kind: 'fact',
  content: id,
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'background',
  evidence: {},
  embedding,
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
})

const memoryRecordInput = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'placeholder',
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

describe('rankRecordsBySimilarity', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns nearest record first, drops below threshold', () => {
    saveMemoryRecord({ ...rec('near', new Float32Array([1, 0, 0])), embeddingVersion: 'model-a:3' })
    saveMemoryRecord({ ...rec('far', new Float32Array([0, 1, 0])), embeddingVersion: 'model-a:3' })
    const out = rankRecordsBySimilarity({ scopeId: 'group-1', scopeType: 'group' }, [1, 0, 0], {
      threshold: 0.65,
      limit: 10,
      embeddingVersion: 'model-a:3',
    })
    expect(out.map((r) => r.id)).toEqual(['near'])
  })

  test('empty when no embeddings stored', () => {
    saveMemoryRecord({ ...rec('x', new Float32Array([1, 0, 0])), embedding: null, embeddingVersion: 'model-a:3' })
    expect(
      rankRecordsBySimilarity({ scopeId: 'group-1', scopeType: 'group' }, [1, 0, 0], {
        embeddingVersion: 'model-a:3',
      }),
    ).toHaveLength(0)
  })

  test('finds matching record even when scope has >1000 records (no hydration cap)', () => {
    const TOTAL = 1100
    const matchingId = 'match-old'
    saveMemoryRecord({
      ...rec(matchingId, new Float32Array([1, 0, 0])),
      lastSeenAt: '2020-01-01T00:00:00.000Z',
      embeddingVersion: 'model-a:3',
    })
    for (let i = 0; i < TOTAL - 1; i += 1) {
      saveMemoryRecord({
        ...rec(`filler-${i}`, new Float32Array([0, 1, 0])),
        lastSeenAt: '2026-06-01T00:00:00.000Z',
        embeddingVersion: 'model-a:3',
      })
    }
    const out = rankRecordsBySimilarity({ scopeId: 'group-1', scopeType: 'group' }, [1, 0, 0], {
      threshold: 0.65,
      limit: 5,
      embeddingVersion: 'model-a:3',
    })
    expect(out.map((r) => r.id)).toContain(matchingId)
  })

  test('excludes a record whose embedding version does not match the query identity', async () => {
    await setupTestDb()
    const vector = new Float32Array([1, 0, 0])

    saveMemoryRecord({
      ...memoryRecordInput({ id: 'compatible' }),
      embedding: vector,
      embeddingModel: 'model-a',
      embeddingDimension: 3,
      embeddingVersion: 'model-a:3',
    })
    saveMemoryRecord({
      ...memoryRecordInput({ id: 'other-model' }),
      embedding: vector,
      embeddingModel: 'model-b',
      embeddingDimension: 3,
      embeddingVersion: 'model-b:3',
    })
    saveMemoryRecord({
      ...memoryRecordInput({ id: 'legacy' }),
      embedding: vector,
      embeddingVersion: 'unknown',
    })

    const hits = rankRecordsBySimilarity({ scopeId: 'user-1', scopeType: 'personal' }, [1, 0, 0], {
      embeddingVersion: 'model-a:3',
      now: '2026-07-15T12:00:00.000Z',
    })

    expect(hits.map((h) => h.id)).toEqual(['compatible'])
  })

  test('returns nothing when the caller has no embedding version', async () => {
    await setupTestDb()

    saveMemoryRecord({
      ...memoryRecordInput({ id: 'compatible' }),
      embedding: new Float32Array([1, 0, 0]),
      embeddingVersion: 'model-a:3',
    })

    expect(
      rankRecordsBySimilarity({ scopeId: 'user-1', scopeType: 'personal' }, [1, 0, 0], { embeddingVersion: null }),
    ).toEqual([])
  })

  test('excludes an expired record from the dense channel', async () => {
    await setupTestDb()

    saveMemoryRecord({
      ...memoryRecordInput({ id: 'expired', expiresAt: '2026-07-01T00:00:00.000Z' }),
      embedding: new Float32Array([1, 0, 0]),
      embeddingVersion: 'model-a:3',
    })

    expect(
      rankRecordsBySimilarity({ scopeId: 'user-1', scopeType: 'personal' }, [1, 0, 0], {
        embeddingVersion: 'model-a:3',
        now: '2026-07-15T12:00:00.000Z',
      }),
    ).toEqual([])
  })
})
