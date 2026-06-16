// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { rankCandidatesByQuery } from '../../src/long-term-memory/recall-ranking.js'
import type { MemoryRecord } from '../../src/long-term-memory/types.js'

const rec = (id: string, content: string, embedding: Float32Array | null): MemoryRecord => ({
  id,
  scopeId: 'g',
  scopeType: 'group',
  kind: 'fact',
  content,
  summary: null,
  tags: [],
  confidence: 0.5,
  status: 'provisional',
  source: 'background',
  evidence: {},
  threadContextId: 't',
  embedding,
  createdAt: '',
  updatedAt: '',
  lastSeenAt: '',
})

describe('rankCandidatesByQuery', () => {
  test('semantic mode ranks by cosine and drops below threshold', () => {
    const out = rankCandidatesByQuery(
      [rec('near', 'x', new Float32Array([1, 0, 0])), rec('far', 'y', new Float32Array([0, 1, 0]))],
      'anything',
      [1, 0, 0],
      { threshold: 0.65, limit: 5 },
    )
    expect(out.map((r) => r.id)).toEqual(['near'])
  })

  test('keyword fallback when no query embedding', () => {
    const out = rankCandidatesByQuery(
      [rec('a', 'deploys happen on fridays', null), rec('b', 'lunch is at noon', null)],
      'Friday deploys',
      null,
      { limit: 5 },
    )
    expect(out[0]?.id).toBe('a')
  })
})
