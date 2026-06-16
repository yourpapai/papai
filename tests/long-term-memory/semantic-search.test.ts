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

describe('rankRecordsBySimilarity', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns nearest record first, drops below threshold', () => {
    saveMemoryRecord(rec('near', new Float32Array([1, 0, 0])))
    saveMemoryRecord(rec('far', new Float32Array([0, 1, 0])))
    const out = rankRecordsBySimilarity({ scopeId: 'group-1', scopeType: 'group' }, [1, 0, 0], {
      threshold: 0.65,
      limit: 10,
    })
    expect(out.map((r) => r.id)).toEqual(['near'])
  })

  test('empty when no embeddings stored', () => {
    saveMemoryRecord({ ...rec('x', new Float32Array([1, 0, 0])), embedding: null })
    expect(rankRecordsBySimilarity({ scopeId: 'group-1', scopeType: 'group' }, [1, 0, 0], {})).toHaveLength(0)
  })
})
