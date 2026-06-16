// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { runRecallCascade } from '../../src/long-term-memory/recall-cascade.js'
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

describe('runRecallCascade (keyword mode, no embeddings)', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  // Query "friday deploy schedule" shares terms "friday" and "deploy" with content
  // "we deploy every friday" but is NOT a phrase match — this exercises term-overlap
  // recall (layer 2) rather than phrase-FTS, which would miss it.
  test('layer 2 active group record is found via term-overlap (not phrase match)', async () => {
    saveMemoryRecord(base({ id: 'a', status: 'active', threadContextId: null }))
    const out = await runRecallCascade(
      {
        storageContextId: 'g:thread:z',
        configContextId: 'g',
        contextType: 'group',
        query: 'friday deploy schedule',
        limit: 8,
      },
      { getEmbedding: () => Promise.resolve(null), schedulePromotion: () => undefined },
    )
    expect(out.records.map((r) => ({ id: r.id, p: r.provenance }))).toContainEqual({ id: 'a', p: 'group' })
  })

  // Query "friday deploy schedule" shares terms with "we deploy every friday";
  // sibling-thread provisional records use term-overlap (layer 3) already.
  test('reaches layer 3 for sibling-thread provisional and schedules promotion', async () => {
    saveMemoryRecord(base({ id: 'b', status: 'provisional', threadContextId: 'g:thread:a' }))
    const scheduled: string[] = []
    const out = await runRecallCascade(
      {
        storageContextId: 'g:thread:z',
        configContextId: 'g',
        contextType: 'group',
        query: 'friday deploy schedule',
        limit: 8,
      },
      {
        getEmbedding: () => Promise.resolve(null),
        schedulePromotion: (r) => {
          scheduled.push(r.id)
        },
      },
    )
    expect(out.records.map((r) => ({ id: r.id, p: r.provenance }))).toContainEqual({ id: 'b', p: 'other-thread' })
    expect(scheduled).toContain('b')
  })
})
