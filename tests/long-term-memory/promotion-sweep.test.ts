// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { sweepPromotions } from '../../src/long-term-memory/promotion-sweep.js'
import { saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const prov = (id: string, thread: string): MemoryRecordInput => ({
  id,
  scopeId: 'g',
  scopeType: 'group',
  kind: 'fact',
  content: 'deploys on fridays',
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

describe('sweepPromotions', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('evaluates every provisional record in each scope', async () => {
    saveMemoryRecord(prov('m1', 't-a'))
    saveMemoryRecord(prov('m2', 't-b'))
    saveMemoryRecord(prov('m3', 't-c'))
    const seen: string[] = []
    await sweepPromotions({
      evaluate: (_scope, candidate) => {
        seen.push(candidate.id)
        return Promise.resolve(true)
      },
      listScopes: () => [{ scopeId: 'g', scopeType: 'group' }],
    })
    expect(seen).toEqual(['m1', 'm2', 'm3'])
  })
})
