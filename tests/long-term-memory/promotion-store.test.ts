// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  listMemoryRecords,
  promoteProvisionalToActive,
  markPromotionRejected,
  saveMemoryRecord,
} from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

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
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
})

describe('promotion store mutations', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('promoteProvisionalToActive flips status, clears thread, merges threads', () => {
    saveMemoryRecord(prov('m1', 't-a'))
    const out = promoteProvisionalToActive(
      { scopeId: 'g', scopeType: 'group' },
      'm1',
      ['t-a', 't-b', 't-c'],
      '2026-06-16T00:00:00.000Z',
    )
    expect(out?.status).toBe('active')
    expect(out?.threadContextId).toBeNull()
    expect(out?.evidence.threads).toEqual(['t-a', 't-b', 't-c'])
    expect(listMemoryRecords({ scopeId: 'g', scopeType: 'group', status: 'active' })).toHaveLength(1)
  })

  test('markPromotionRejected records a cooldown timestamp in evidence', () => {
    saveMemoryRecord(prov('m1', 't-a'))
    markPromotionRejected({ scopeId: 'g', scopeType: 'group' }, 'm1', '2026-06-16T00:00:00.000Z')
    const [row] = listMemoryRecords({ scopeId: 'g', scopeType: 'group', status: 'provisional' })
    expect(row?.evidence.promotionRejectedAt).toBe('2026-06-16T00:00:00.000Z')
  })
})
