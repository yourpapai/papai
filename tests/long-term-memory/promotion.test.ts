// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { evaluatePromotion } from '../../src/long-term-memory/promotion.js'
import { saveMemoryRecord, listMemoryRecords } from '../../src/long-term-memory/store.js'
import type { MemoryRecord, MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const emb = new Float32Array([1, 0, 0])
const prov = (id: string, thread: string): MemoryRecordInput => ({
  id,
  scopeId: 'g',
  scopeType: 'group',
  kind: 'fact',
  content: 'Deploys on Fridays.',
  summary: null,
  tags: [],
  confidence: 0.5,
  status: 'provisional',
  source: 'background',
  evidence: { threads: [thread] },
  threadContextId: thread,
  embedding: emb,
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
})

const load = (id: string): MemoryRecord => {
  const found = listMemoryRecords({ scopeId: 'g', scopeType: 'group', status: 'provisional', limit: 50 }).find(
    (r) => r.id === id,
  )
  if (found === undefined) throw new Error('missing')
  return found
}

describe('evaluatePromotion', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('promotes when 3 distinct threads agree and confirm passes', async () => {
    saveMemoryRecord(prov('m1', 't-a'))
    saveMemoryRecord(prov('m2', 't-b'))
    saveMemoryRecord(prov('m3', 't-c'))
    const promoted = await evaluatePromotion({ scopeId: 'g', scopeType: 'group' }, load('m1'), {
      confirmDurable: () => Promise.resolve(true),
      now: () => '2026-06-16T00:00:00.000Z',
    })
    expect(promoted).toBe(true)
    expect(listMemoryRecords({ scopeId: 'g', scopeType: 'group', status: 'active' })).toHaveLength(1)
    expect(listMemoryRecords({ scopeId: 'g', scopeType: 'group', status: 'provisional' })).toHaveLength(0)
  })

  test('does not promote below the thread threshold', async () => {
    saveMemoryRecord(prov('m1', 't-a'))
    saveMemoryRecord(prov('m2', 't-b'))
    const promoted = await evaluatePromotion({ scopeId: 'g', scopeType: 'group' }, load('m1'), {
      confirmDurable: () => Promise.resolve(true),
      now: () => '2026-06-16T00:00:00.000Z',
    })
    expect(promoted).toBe(false)
    expect(listMemoryRecords({ scopeId: 'g', scopeType: 'group', status: 'active' })).toHaveLength(0)
  })

  test('records a cooldown when confirm rejects', async () => {
    saveMemoryRecord(prov('m1', 't-a'))
    saveMemoryRecord(prov('m2', 't-b'))
    saveMemoryRecord(prov('m3', 't-c'))
    const promoted = await evaluatePromotion({ scopeId: 'g', scopeType: 'group' }, load('m1'), {
      confirmDurable: () => Promise.resolve(false),
      now: () => '2026-06-16T00:00:00.000Z',
    })
    expect(promoted).toBe(false)
    expect(load('m1').evidence.promotionRejectedAt).toBe('2026-06-16T00:00:00.000Z')
  })
})
