// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { runRecallCascade, type RunRecallCascadeDeps } from '../../src/long-term-memory/recall-cascade.js'
import { listMemoryRecords, saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-07-15T12:00:00.000Z'
const MODEL = 'model-a'
const QUERY_VECTOR = [1, 0, 0]
const VERSION = `${MODEL}:${QUERY_VECTOR.length}`

const deps: RunRecallCascadeDeps = {
  getEmbedding: () => Promise.resolve(QUERY_VECTOR),
  resolveEmbeddingModel: () => MODEL,
  schedulePromotion: () => undefined,
}

const record = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'dm-ctx-1',
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

const recall = async (query: string): Promise<readonly string[]> => {
  const { records } = await runRecallCascade(
    { storageContextId: 'dm-ctx-1', configContextId: 'cfg-1', contextType: 'dm', query, limit: 8 },
    deps,
  )
  return records.map((r) => r.id)
}

describe('hybrid retrieval golden set', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  // Defect 1: the lexical tokenizer was [a-z0-9]+, so Cyrillic produced zero tokens.
  test('a Cyrillic query returns Cyrillic content', async () => {
    saveMemoryRecord(record({ id: 'ru', content: 'Маршруты доставки согласованы на вторник' }))
    saveMemoryRecord(record({ id: 'en', content: 'delivery routes agreed for Tuesday' }))

    expect(await recall('маршрут')).toContain('ru')
  })

  // Defect 2: expiresAt was never checked at query time.
  test('an expired but still-active record is neither recalled nor injected', async () => {
    saveMemoryRecord(record({ id: 'expired', content: 'маршрут отменён', expiresAt: '2026-07-01T00:00:00.000Z' }))

    expect(await recall('маршрут')).not.toContain('expired')
    expect(
      listMemoryRecords({ scopeId: 'dm-ctx-1', scopeType: 'personal', status: 'active', limit: 3, now: NOW }).map(
        (r) => r.id,
      ),
    ).not.toContain('expired')
  })

  // Defect 3: retrieval returned semantic hits OR lexical hits, never both, so an
  // unembedded record was invisible whenever any record cleared the 0.65 threshold.
  test('an unembedded record still surfaces when a semantic hit also exists', async () => {
    saveMemoryRecord(
      record({
        id: 'semantic',
        content: 'unrelated wording entirely',
        embedding: new Float32Array(QUERY_VECTOR),
        embeddingModel: MODEL,
        embeddingDimension: QUERY_VECTOR.length,
        embeddingVersion: VERSION,
      }),
    )
    saveMemoryRecord(record({ id: 'unembedded', content: 'маршрут доставки' }))

    const hits = await recall('маршрут')

    expect(hits).toContain('unembedded')
    expect(hits).toContain('semantic')
  })

  // Defect 4: no embedding version column, so an incompatible vector was
  // indistinguishable from a compatible one.
  test('an unknown-version record is excluded from dense but still found lexically', async () => {
    saveMemoryRecord(
      record({
        id: 'legacy',
        content: 'маршрут из старой базы',
        embedding: new Float32Array([1, 0, 0]),
        embeddingVersion: 'unknown',
      }),
    )

    // Reachable by its words...
    expect(await recall('маршрут')).toContain('legacy')
    // ...but not by vector alone: a query sharing no tokens finds nothing.
    expect(await recall('zzz')).not.toContain('legacy')
  })
})
