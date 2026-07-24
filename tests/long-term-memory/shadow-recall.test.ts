// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { runShadowRecall } from '../../src/long-term-memory/shadow-recall.js'
import { saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const base = (over: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'x',
  scopeId: 'g',
  scopeType: 'group',
  kind: 'fact',
  content: 'we deploy every friday',
  summary: null,
  tags: [],
  confidence: 0.5,
  status: 'provisional',
  source: 'background',
  evidence: {},
  threadContextId: 'g:thread:a',
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
  ...over,
})

describe('runShadowRecall', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('zero active records: skips embedding, returns skippedReason without hits', async () => {
    const getEmbedding = mock(() => Promise.resolve(null))
    const schedulePromotion = mock(() => undefined)

    const out = await runShadowRecall(
      {
        storageContextId: 'g:thread:z',
        configContextId: 'g',
        contextType: 'group',
        query: 'friday deploy schedule',
      },
      { getEmbedding, resolveEmbeddingModel: () => 'model-a', schedulePromotion },
    )

    expect(out).toEqual({ hits: [], activeRecordCount: 0, skippedReason: 'no-active-records' })
    expect(getEmbedding).not.toHaveBeenCalled()
  })

  test('with active records: runs the cascade and returns id/score/provenance only', async () => {
    saveMemoryRecord(base({ id: 'a', status: 'active', threadContextId: null }))
    const getEmbedding = mock(() => Promise.resolve(null))
    const schedulePromotion = mock(() => undefined)

    const out = await runShadowRecall(
      {
        storageContextId: 'g:thread:z',
        configContextId: 'g',
        contextType: 'group',
        query: 'friday deploy schedule',
      },
      { getEmbedding, resolveEmbeddingModel: () => 'model-a', schedulePromotion },
    )

    expect(out.activeRecordCount).toBe(1)
    expect(out.skippedReason).toBeUndefined()
    expect(out.hits.map((hit) => ({ id: hit.id, provenance: hit.provenance }))).toContainEqual({
      id: 'a',
      provenance: 'group',
    })
    for (const hit of out.hits) {
      expect(typeof hit.score).toBe('number')
      expect(Object.keys(hit).sort()).toEqual(['id', 'provenance', 'score'])
    }
    expect(getEmbedding).toHaveBeenCalled()
  })

  test('side-effect-free: never schedules promotion even when sibling-thread layer is reached', async () => {
    saveMemoryRecord(base({ id: 'active-seed', status: 'active', threadContextId: null }))
    saveMemoryRecord(base({ id: 'sibling-prov', status: 'provisional', threadContextId: 'g:thread:a' }))
    const schedulePromotion = mock(() => undefined)

    await runShadowRecall(
      {
        storageContextId: 'g:thread:z',
        configContextId: 'g',
        contextType: 'group',
        query: 'friday deploy schedule',
      },
      { getEmbedding: () => Promise.resolve(null), resolveEmbeddingModel: () => 'model-a', schedulePromotion },
    )

    expect(schedulePromotion).not.toHaveBeenCalled()
  })
})
