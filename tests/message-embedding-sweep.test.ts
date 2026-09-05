// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { LlmConfigResult, ResolvedRole } from '../src/llm-providers/types.js'
import { cacheMessage } from '../src/message-cache/cache.js'
import type { MessageScope } from '../src/message-cache/store.js'
import { countPending, loadEmbeddingsForScope, storeEmbedding } from '../src/message-cache/vector-store.js'
import { runMessageEmbeddingSweep } from '../src/message-embedding-sweep.js'
import type { SweepDeps } from '../src/message-embedding-sweep.js'
import { flushPendingWrites, mockLogger, setupTestDb } from './utils/test-helpers.js'

const groupScope = (g: string): MessageScope => ({ kind: 'group', groupContextId: g })

const role = (model: string): ResolvedRole => ({
  apiKey: 'k',
  baseUrl: 'u',
  model,
  source: 'global',
  metadata: {
    providerId: null,
    modelId: null,
    contextWindow: null,
    maxOutputTokens: null,
    source: 'none',
    via: null,
  },
})

const okConfig = (model: string): LlmConfigResult => ({
  ok: true,
  source: 'global',
  main: role(model),
  small: role(model),
  embedding: role(model),
})

const missingConfig = (): LlmConfigResult => ({
  ok: false,
  type: 'missing',
  source: 'global',
  missing: ['embedding'],
})

const okDeps = (vectors: number[][], model = 'sweep-model'): SweepDeps => ({
  resolve: (): LlmConfigResult => okConfig(model),
  embedMany: (values): Promise<{ embeddings: number[][] }> =>
    Promise.resolve({
      embeddings: values.map((_, idx) => {
        const vec = vectors[idx % vectors.length]
        assert(vec !== undefined)
        return vec
      }),
    }),
})

describe('message-embedding-sweep', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('backfills NULL-embedding rows in a context', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'one', timestamp: 1 })
    cacheMessage({ messageId: 'm2', contextId: 'g:t2', groupContextId: 'g', text: 'two', timestamp: 2 })
    await flushPendingWrites()
    expect(countPending()).toBe(2)

    const res = await runMessageEmbeddingSweep(okDeps([[0.1, 0.2]]))

    expect(res).toEqual({ embedded: 2, contexts: 1 })
    expect(countPending()).toBe(0)
    expect(loadEmbeddingsForScope(groupScope('g'))).toHaveLength(2)
  })

  test('re-embeds rows whose model differs from the current model', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'one', timestamp: 1 })
    await flushPendingWrites()
    storeEmbedding('g:t1', 'm1', new Float32Array([9, 9]), 'old-model', 2)
    expect(countPending()).toBe(0)

    const res = await runMessageEmbeddingSweep(okDeps([[0.3, 0.4]]))

    expect(res.embedded).toBe(1)
    const loaded = loadEmbeddingsForScope(groupScope('g'))
    expect(loaded).toHaveLength(1)
    const row = loaded[0]
    assert(row !== undefined)
    expect(Array.from(row.vec)).toEqual(Array.from(new Float32Array([0.3, 0.4])))
  })

  test('skips a context whose config does not resolve', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'one', timestamp: 1 })
    await flushPendingWrites()
    const embedMany = mock(() => Promise.resolve({ embeddings: [[0, 0]] }))
    const deps: SweepDeps = { resolve: () => missingConfig(), embedMany }

    const res = await runMessageEmbeddingSweep(deps)

    expect(embedMany).toHaveBeenCalledTimes(0)
    expect(res).toEqual({ embedded: 0, contexts: 0 })
    expect(countPending()).toBe(1)
  })

  test('a transient embed failure leaves rows pending without crashing the sweep', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g', text: 'one', timestamp: 1 })
    await flushPendingWrites()
    const deps: SweepDeps = {
      resolve: () => okConfig('m'),
      embedMany: () => Promise.reject(new Error('rate limited')),
    }

    await expect(runMessageEmbeddingSweep(deps)).resolves.toEqual({ embedded: 0, contexts: 0 })
    expect(countPending()).toBe(1)
  })
})
