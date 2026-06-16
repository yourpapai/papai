// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { saveMemoryRecordWithEmbedding } from '../../src/long-term-memory/embedding-writer.js'
import { listMemoryRecords } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const input = (): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'group-1',
  scopeType: 'group',
  kind: 'fact',
  content: 'X',
  summary: null,
  tags: [],
  confidence: 1,
  status: 'provisional',
  source: 'background',
  evidence: {},
  threadContextId: 't',
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-11T00:00:00.000Z',
})

describe('saveMemoryRecordWithEmbedding', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('saves the row synchronously and applies the embedding when it resolves', async () => {
    const saved = await saveMemoryRecordWithEmbedding(input(), 'cfg-1', {
      getEmbedding: () => Promise.resolve([0.1, 0.2, 0.3]),
    })
    expect(saved.id).toBe('mem-1')
    const [row] = listMemoryRecords({ scopeId: 'group-1', scopeType: 'group', limit: 10 })
    assert(row !== undefined, 'expected a saved row')
    assert(row.embedding !== null, 'expected embedding to be set')
    assert(row.embedding !== undefined, 'expected embedding to be defined')
    expect(Array.from(row.embedding)).toHaveLength(3)
  })

  test('still saves the row when embedding is unavailable', async () => {
    const saved = await saveMemoryRecordWithEmbedding(input(), 'cfg-1', {
      getEmbedding: () => Promise.resolve(null),
    })
    expect(saved.id).toBe('mem-1')
    const [row] = listMemoryRecords({ scopeId: 'group-1', scopeType: 'group', limit: 10 })
    assert(row !== undefined, 'expected a saved row')
    expect(row.embedding).toBeNull()
  })
})
