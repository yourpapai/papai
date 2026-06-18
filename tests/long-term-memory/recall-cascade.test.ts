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

  // DM contexts have no current-thread or sibling-thread layers: the cascade returns
  // only active records from the personal scope (tagged 'group'), never reads
  // provisional records, and never schedules promotion. `recall` is now always
  // registered in normal mode, so this DM path is reachable through the tool.
  test('dm context returns active personal records, ignores provisional, schedules no promotion', async () => {
    saveMemoryRecord(
      base({ id: 'dm-active', scopeId: 'dm-user-1', scopeType: 'personal', status: 'active', threadContextId: null }),
    )
    saveMemoryRecord(
      base({
        id: 'dm-prov',
        scopeId: 'dm-user-1',
        scopeType: 'personal',
        status: 'provisional',
        threadContextId: null,
      }),
    )
    const scheduled: string[] = []
    const out = await runRecallCascade(
      {
        storageContextId: 'dm-user-1',
        configContextId: 'dm-user-1',
        contextType: 'dm',
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
    expect(out.records.map((r) => ({ id: r.id, p: r.provenance }))).toContainEqual({ id: 'dm-active', p: 'group' })
    expect(out.records.map((r) => r.id)).not.toContain('dm-prov')
    expect(scheduled).toEqual([])
  })

  test('kind filter restricts results across layers', async () => {
    saveMemoryRecord(base({ id: 'k-fact', status: 'active', threadContextId: null, kind: 'fact' }))
    saveMemoryRecord(base({ id: 'k-pref', status: 'active', threadContextId: null, kind: 'preference' }))
    const out = await runRecallCascade(
      {
        storageContextId: 'g:thread:z',
        configContextId: 'g',
        contextType: 'group',
        query: 'friday deploy schedule',
        limit: 8,
        kind: 'preference',
      },
      { getEmbedding: () => Promise.resolve(null), schedulePromotion: () => undefined },
    )
    const ids = out.records.map((r) => r.id)
    expect(ids).toContain('k-pref')
    expect(ids).not.toContain('k-fact')
  })

  test('include_stale extends the active layer to stale records', async () => {
    saveMemoryRecord(base({ id: 's-stale', status: 'stale', threadContextId: null }))
    const without = await runRecallCascade(
      {
        storageContextId: 'g:thread:z',
        configContextId: 'g',
        contextType: 'group',
        query: 'friday deploy schedule',
        limit: 8,
      },
      { getEmbedding: () => Promise.resolve(null), schedulePromotion: () => undefined },
    )
    expect(without.records.map((r) => r.id)).not.toContain('s-stale')
    const withStale = await runRecallCascade(
      {
        storageContextId: 'g:thread:z',
        configContextId: 'g',
        contextType: 'group',
        query: 'friday deploy schedule',
        limit: 8,
        includeStale: true,
      },
      { getEmbedding: () => Promise.resolve(null), schedulePromotion: () => undefined },
    )
    expect(withStale.records.map((r) => r.id)).toContain('s-stale')
  })
})
