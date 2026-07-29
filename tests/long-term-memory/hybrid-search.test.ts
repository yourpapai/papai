// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { searchHybrid } from '../../src/long-term-memory/hybrid-search.js'
import { saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-07-15T12:00:00.000Z'
const VERSION = 'model-a:3'
const SCOPE = { scopeId: 'user-1', scopeType: 'personal' } as const

const record = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'placeholder',
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

const ids = (records: readonly { id: string }[]): readonly string[] => records.map((r) => r.id)

describe('searchHybrid', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('surfaces an unembedded lexical match alongside a semantic match', () => {
    saveMemoryRecord(
      record({
        id: 'semantic',
        content: 'totally different words',
        embedding: new Float32Array([1, 0, 0]),
        embeddingVersion: VERSION,
      }),
    )
    saveMemoryRecord(record({ id: 'lexical-only', content: 'маршрут доставки' }))

    const hits = searchHybrid({
      ...SCOPE,
      query: 'маршрут',
      queryEmbedding: [1, 0, 0],
      embeddingVersion: VERSION,
      statuses: ['active'],
      limit: 8,
      now: NOW,
    })

    expect(ids(hits)).toContain('lexical-only')
    expect(ids(hits)).toContain('semantic')
    // Lexical weight is 2 against dense 1, so the exact-term match leads.
    expect(hits[0]?.id).toBe('lexical-only')
  })

  test('falls back to the lexical channel alone when there is no query embedding', () => {
    saveMemoryRecord(record({ id: 'lex', content: 'маршрут доставки' }))

    const hits = searchHybrid({
      ...SCOPE,
      query: 'маршрут',
      queryEmbedding: null,
      embeddingVersion: null,
      statuses: ['active'],
      limit: 8,
      now: NOW,
    })

    expect(ids(hits)).toEqual(['lex'])
  })

  test('returns dense hits when the query has no lexical tokens', () => {
    saveMemoryRecord(
      record({ id: 'dense', content: 'anything', embedding: new Float32Array([1, 0, 0]), embeddingVersion: VERSION }),
    )

    const hits = searchHybrid({
      ...SCOPE,
      query: '?!.,',
      queryEmbedding: [1, 0, 0],
      embeddingVersion: VERSION,
      statuses: ['active'],
      limit: 8,
      now: NOW,
    })

    expect(ids(hits)).toEqual(['dense'])
  })

  test('never returns an expired record from either channel', () => {
    saveMemoryRecord(
      record({
        id: 'expired',
        content: 'маршрут',
        embedding: new Float32Array([1, 0, 0]),
        embeddingVersion: VERSION,
        expiresAt: '2026-07-01T00:00:00.000Z',
      }),
    )

    const hits = searchHybrid({
      ...SCOPE,
      query: 'маршрут',
      queryEmbedding: [1, 0, 0],
      embeddingVersion: VERSION,
      statuses: ['active'],
      limit: 8,
      now: NOW,
    })

    expect(hits).toEqual([])
  })
})
