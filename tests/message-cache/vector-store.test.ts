// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { cacheMessage } from '../../src/message-cache/cache.js'
import type { MessageScope } from '../../src/message-cache/store.js'
import {
  countPending,
  embeddedConfigContexts,
  loadEmbeddingsForScope,
  nextPendingBatchForContext,
  pendingConfigContexts,
  searchKnn,
  storeEmbedding,
} from '../../src/message-cache/vector-store.js'
import { flushPendingWrites, mockLogger, setupTestDb } from '../utils/test-helpers.js'

const groupScope = (g: string): MessageScope => ({ kind: 'group', groupContextId: g })
const dmScope = (c: string): MessageScope => ({ kind: 'dm', contextId: c })

const vec = (...v: number[]): Float32Array => new Float32Array(v)

describe('message vector store: storeEmbedding + load round-trip', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('stores and loads a Float32 embedding, preserving values', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'hi', timestamp: 1 })
    await flushPendingWrites()
    storeEmbedding('g:t1', 'm1', vec(0.1, 0.2, 0.3), 'text-embedding-3-small', 3)
    const loaded = loadEmbeddingsForScope(groupScope('g'))
    expect(loaded).toHaveLength(1)
    const row = loaded[0]
    assert(row !== undefined)
    expect(row.messageId).toBe('m1')
    expect(Array.from(row.vec)).toEqual(Array.from(vec(0.1, 0.2, 0.3)))
    expect(row.contextId).toBe('g:t1')
  })

  test('upserts on repeat store (idempotent by PK)', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'hi', timestamp: 1 })
    await flushPendingWrites()
    storeEmbedding('g:t1', 'm1', vec(1, 0, 0), 'model-a', 3)
    storeEmbedding('g:t1', 'm1', vec(0, 1, 0), 'model-b', 3)
    const loaded = loadEmbeddingsForScope(groupScope('g'))
    expect(loaded).toHaveLength(1)
    const row = loaded[0]
    assert(row !== undefined)
    expect(Array.from(row.vec)).toEqual([0, 1, 0])
  })
})

describe('message vector store: scope bounding', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('group A cannot see group B embeddings', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'a:t1', groupContextId: 'a', text: 'x', timestamp: 1 })
    cacheMessage({ messageId: 'm2', contextId: 'b:t1', groupContextId: 'b', text: 'y', timestamp: 2 })
    await flushPendingWrites()
    storeEmbedding('a:t1', 'm1', vec(1, 0), 'm', 2)
    storeEmbedding('b:t1', 'm2', vec(1, 0), 'm', 2)
    expect(loadEmbeddingsForScope(groupScope('a')).map((r) => r.messageId)).toEqual(['m1'])
    expect(loadEmbeddingsForScope(groupScope('b')).map((r) => r.messageId)).toEqual(['m2'])
  })

  test('dm scope loads only that dm (group_context_id IS NULL)', async () => {
    cacheMessage({ messageId: 'dm1', contextId: 'dm-alice', text: 'secret', timestamp: 1 })
    cacheMessage({ messageId: 'g1', contextId: 'g:t1', groupContextId: 'g', text: 'group', timestamp: 2 })
    await flushPendingWrites()
    storeEmbedding('dm-alice', 'dm1', vec(1, 0), 'm', 2)
    storeEmbedding('g:t1', 'g1', vec(1, 0), 'm', 2)
    expect(loadEmbeddingsForScope(dmScope('dm-alice')).map((r) => r.messageId)).toEqual(['dm1'])
  })
})

describe('message vector store: searchKnn', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns scored results above threshold, sorted desc by similarity', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'rotate credentials', timestamp: 1 })
    cacheMessage({ messageId: 'm2', contextId: 'g:t1', groupContextId: 'g', text: 'cycle api keys', timestamp: 2 })
    cacheMessage({ messageId: 'm3', contextId: 'g:t1', groupContextId: 'g', text: 'lunch menu', timestamp: 3 })
    await flushPendingWrites()
    storeEmbedding('g:t1', 'm1', vec(0.9, 0.1), 'm', 2)
    storeEmbedding('g:t1', 'm2', vec(0.85, 0.15), 'm', 2)
    storeEmbedding('g:t1', 'm3', vec(0.0, 1.0), 'm', 2)
    const results = searchKnn([0.95, 0.05], groupScope('g'), {}, 5)
    expect(results.map((r) => r.messageId)).toEqual(['m1', 'm2'])
    const first = results[0]
    const second = results[1]
    assert(first !== undefined)
    assert(second !== undefined)
    expect(first.score).toBeGreaterThan(second.score)
  })

  test('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      cacheMessage({ messageId: `m${i}`, contextId: 'g:t1', groupContextId: 'g', text: 'x', timestamp: i })
    }
    await flushPendingWrites()
    for (let i = 0; i < 5; i++) storeEmbedding('g:t1', `m${i}`, vec(1, 0), 'm', 2)
    expect(searchKnn([1, 0], groupScope('g'), {}, 2)).toHaveLength(2)
  })

  test('author filter narrows the candidate set', async () => {
    cacheMessage({
      messageId: 'm1',
      contextId: 'g:t1',
      groupContextId: 'g',
      text: 'x',
      authorUsername: 'alice',
      timestamp: 1,
    })
    cacheMessage({
      messageId: 'm2',
      contextId: 'g:t1',
      groupContextId: 'g',
      text: 'y',
      authorUsername: 'bob',
      timestamp: 2,
    })
    await flushPendingWrites()
    storeEmbedding('g:t1', 'm1', vec(1, 0), 'm', 2)
    storeEmbedding('g:t1', 'm2', vec(1, 0), 'm', 2)
    expect(searchKnn([1, 0], groupScope('g'), { author: 'alice' }, 5).map((r) => r.messageId)).toEqual(['m1'])
  })

  test('returns [] for an out-of-scope query', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'a:t1', groupContextId: 'a', text: 'x', timestamp: 1 })
    await flushPendingWrites()
    storeEmbedding('a:t1', 'm1', vec(1, 0), 'm', 2)
    expect(searchKnn([1, 0], groupScope('other'), {}, 5)).toEqual([])
  })
})

describe('message vector store: pending queries', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('pendingConfigContexts lists config contexts with NULL embeddings', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'x', timestamp: 1 })
    cacheMessage({ messageId: 'm2', contextId: 'dm-alice', text: 'y', timestamp: 2 })
    await flushPendingWrites()
    // group config-context id is COALESCE(group_context_id, context_id) => 'g' and 'dm-alice'
    expect(pendingConfigContexts(10).sort()).toEqual(['dm-alice', 'g'])
  })

  test('countPending counts NULL-embedding rows', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'x', timestamp: 1 })
    cacheMessage({ messageId: 'm2', contextId: 'g:t2', groupContextId: 'g', text: 'y', timestamp: 2 })
    await flushPendingWrites()
    expect(countPending()).toBe(2)
    storeEmbedding('g:t1', 'm1', vec(1, 0), 'm', 2)
    expect(countPending()).toBe(1)
  })

  test('nextPendingBatchForContext returns NULLs and model-mismatched rows', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'one', timestamp: 1 })
    cacheMessage({ messageId: 'm2', contextId: 'g:t2', groupContextId: 'g', text: 'two', timestamp: 2 })
    await flushPendingWrites()
    // m1 is present but with a stale model; m2 has NULL embedding
    storeEmbedding('g:t1', 'm1', vec(1, 0), 'old-model', 2)
    const batch = nextPendingBatchForContext('g', 'new-model', 10)
    expect(batch.map((r) => r.messageId).sort()).toEqual(['m1', 'm2'])
  })

  test('nextPendingBatchForContext excludes rows matching current model', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'one', timestamp: 1 })
    await flushPendingWrites()
    storeEmbedding('g:t1', 'm1', vec(1, 0), 'current-model', 2)
    expect(nextPendingBatchForContext('g', 'current-model', 10)).toEqual([])
  })

  test('embeddedConfigContexts lists only contexts holding a stored embedding', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'one', timestamp: 1 })
    cacheMessage({ messageId: 'm2', contextId: 'h:t1', groupContextId: 'h', text: 'two', timestamp: 2 })
    await flushPendingWrites()
    expect(embeddedConfigContexts(10)).toEqual([])
    storeEmbedding('g:t1', 'm1', vec(1, 0), 'm', 2)
    expect(embeddedConfigContexts(10)).toEqual(['g'])
  })
})
