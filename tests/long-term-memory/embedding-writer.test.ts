// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryRecords } from '../../src/db/schema.js'
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
      resolveEmbeddingModel: () => 'model-a',
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

  test('stamps model, dimension, version and timestamp alongside the vector', async () => {
    await setupTestDb()

    await saveMemoryRecordWithEmbedding({ ...input(), id: 'rec-1' }, 'cfg-1', {
      getEmbedding: () => Promise.resolve([0.1, 0.2, 0.3]),
      resolveEmbeddingModel: () => 'model-a',
      now: () => '2026-07-15T12:00:00.000Z',
    })

    const row = getDrizzleDb().select().from(memoryRecords).where(eq(memoryRecords.id, 'rec-1')).get()
    expect(row?.embeddingModel).toBe('model-a')
    expect(row?.embeddingDimension).toBe(3)
    expect(row?.embeddingVersion).toBe('model-a:3')
    expect(row?.embeddedAt).toBe('2026-07-15T12:00:00.000Z')
  })

  test('leaves identity null when the model cannot be resolved', async () => {
    await setupTestDb()

    await saveMemoryRecordWithEmbedding({ ...input(), id: 'rec-2' }, 'cfg-1', {
      getEmbedding: () => Promise.resolve([0.1, 0.2, 0.3]),
      resolveEmbeddingModel: () => null,
    })

    const row = getDrizzleDb().select().from(memoryRecords).where(eq(memoryRecords.id, 'rec-2')).get()
    expect(row?.embedding).toBeNull()
    expect(row?.embeddingVersion).toBeNull()
  })
})
