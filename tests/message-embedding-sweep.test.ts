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
import { createTrackedLoggerMock } from './utils/logger-mock.js'
import { flushPendingWrites, mockLogger, setupTestDb } from './utils/test-helpers.js'

const groupScope = (g: string): MessageScope => ({ kind: 'group', groupContextId: g })

let embedAttempts = 0

/** embedMany stub failing the first `rejectTimes` calls, then resolving one vector per value. */
function scriptFailureThenSuccess(
  rejectTimes: number,
  vectors: number[][],
): (values: readonly string[]) => Promise<{ embeddings: number[][] }> {
  embedAttempts = 0
  return (values) => {
    embedAttempts += 1
    if (embedAttempts <= rejectTimes) return Promise.reject(new Error('rate limited'))
    return Promise.resolve({
      embeddings: values.map((_, idx) => {
        const vec = vectors[idx % vectors.length]
        assert(vec !== undefined)
        return vec
      }),
    })
  }
}

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
    const deps = {
      resolve: (): LlmConfigResult => okConfig('m'),
      embedMany: (): Promise<{ embeddings: number[][] }> => Promise.reject(new Error('rate limited')),
      sleep: async (): Promise<void> => {},
    }

    await expect(runMessageEmbeddingSweep(deps)).resolves.toEqual({ embedded: 0, contexts: 0 })
    expect(countPending()).toBe(1)
  })

  test('a transient embed failure retries with backoff and then stores', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g-retry', text: 'one', timestamp: 1 })
    await flushPendingWrites()
    const sleeps: number[] = []
    const deps = {
      resolve: (): LlmConfigResult => okConfig('m'),
      embedMany: scriptFailureThenSuccess(2, [[0.5, 0.6]]),
      sleep: (ms: number): Promise<void> => {
        sleeps.push(ms)
        return Promise.resolve()
      },
    }

    const res = await runMessageEmbeddingSweep(deps)

    expect(res).toEqual({ embedded: 1, contexts: 1 })
    expect(embedAttempts).toBe(3)
    expect(sleeps).toEqual([500, 1000])
    expect(countPending()).toBe(0)
    expect(loadEmbeddingsForScope(groupScope('g-retry'))).toHaveLength(1)
  })

  test('a permanent failure exhausts the retries and leaves rows pending', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g-perm', text: 'one', timestamp: 1 })
    await flushPendingWrites()
    let attempts = 0
    const deps = {
      resolve: (): LlmConfigResult => okConfig('m'),
      embedMany: (): Promise<{ embeddings: number[][] }> => {
        attempts += 1
        return Promise.reject(new Error('hard down'))
      },
      sleep: async (): Promise<void> => {},
    }

    const res = await runMessageEmbeddingSweep(deps)

    expect(attempts).toBe(3)
    expect(res).toEqual({ embedded: 0, contexts: 0 })
    expect(countPending()).toBe(1)
  })
})

// message-embedding-sweep.ts binds its child logger at module-eval time, so force
// a fresh evaluation under the tracked mock with a cache-busting query (mirrors
// tests/llm-orchestrator-send.test.ts). The busted module instance also owns a
// fresh in-memory failure map, isolating the dead-letter policy tests.
const tracked = createTrackedLoggerMock()
void mock.module('../src/logger.js', () => ({ logger: tracked.logger, getLogLevel: tracked.getLogLevel }))

type SweepModule = typeof import('../src/message-embedding-sweep.js')
const isSweepModule = (value: unknown): value is SweepModule =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'runMessageEmbeddingSweep') === 'function'
const loadedSweep: unknown = await import(`../src/message-embedding-sweep.js?t=${crypto.randomUUID()}`)
if (!isSweepModule(loadedSweep)) {
  throw new Error('message-embedding-sweep module did not export expected shape')
}
const { runMessageEmbeddingSweep: bustedRunMessageEmbeddingSweep } = loadedSweep

type EmbedFailureWarnMeta = { configContextId: string; count: number; errorClass: string }
const isEmbedFailureWarnMeta = (value: unknown): value is EmbedFailureWarnMeta =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'configContextId') === 'string' &&
  typeof Reflect.get(value, 'errorClass') === 'string'

type SweepCompletionMeta = { embedded: number; contexts: number; remaining: number; deadLettered: number }
const isSweepCompletionMeta = (value: unknown): value is SweepCompletionMeta =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'deadLettered') === 'number' &&
  typeof Reflect.get(value, 'embedded') === 'number'

describe('message-embedding-sweep failure policy (tracked logger, busted module)', () => {
  beforeEach(async () => {
    await setupTestDb()
    tracked.clearCalls()
  })

  test('a full failing batch is dead-lettered out of the sweep after five exhausted sweeps', async () => {
    // A context batch holds up to 25 rows and the per-context failure map must
    // hold all of them, so every count climbs to the retire threshold. Five
    // failing sweeps (three embed attempts each) exhaust every row; the sixth
    // sweep has no live rows left, attempts nothing, and the rows stay pending.
    for (let i = 0; i < 25; i++) {
      cacheMessage({
        messageId: `m${i}`,
        contextId: 'g-full:t0',
        groupContextId: 'g-full',
        text: `t${i}`,
        timestamp: i + 1,
      })
    }
    await flushPendingWrites()
    const valuesPerCall: string[][] = []
    const deps = {
      resolve: (): LlmConfigResult => okConfig('m'),
      embedMany: (values: readonly string[]): Promise<{ embeddings: number[][] }> => {
        valuesPerCall.push([...values])
        return Promise.reject(new Error('hard down'))
      },
      sleep: async (): Promise<void> => {},
    }

    for (let sweep = 0; sweep < 5; sweep++) {
      await bustedRunMessageEmbeddingSweep(deps)
    }
    const res = await bustedRunMessageEmbeddingSweep(deps)

    expect(valuesPerCall).toHaveLength(15)
    expect(valuesPerCall[0]).toEqual(Array.from({ length: 25 }, (_, i) => `t${i}`))
    expect(res.embedded).toBe(0)
    expect(countPending()).toBe(25)

    const completionLogs = tracked
      .getCallsByLevel('info')
      .filter((entry) => entry.args[1] === 'message embedding sweep complete')
    const lastCompletion = completionLogs.at(-1)
    assert(lastCompletion !== undefined)
    assert(isSweepCompletionMeta(lastCompletion.args[0]))
    expect(lastCompletion.args[0].deadLettered).toBe(25)
  })

  test('rows behind dead-lettered rows are still attempted and evicted rows retry', async () => {
    // Thirty rows in one context: the first batch of 25 exhausts over five
    // sweeps; the sixth sweep skips past the dead-lettered rows and attempts
    // the five rows behind them, whose failures evict the five oldest dead
    // entries — so the seventh sweep retries the revived rows too.
    for (let i = 0; i < 30; i++) {
      cacheMessage({
        messageId: `m${i}`,
        contextId: 'g-adv:t0',
        groupContextId: 'g-adv',
        text: `t${i}`,
        timestamp: i + 1,
      })
    }
    await flushPendingWrites()
    const valuesPerCall: string[][] = []
    const deps = {
      resolve: (): LlmConfigResult => okConfig('m'),
      embedMany: (values: readonly string[]): Promise<{ embeddings: number[][] }> => {
        valuesPerCall.push([...values])
        return Promise.reject(new Error('hard down'))
      },
      sleep: async (): Promise<void> => {},
    }

    for (let sweep = 0; sweep < 7; sweep++) {
      await bustedRunMessageEmbeddingSweep(deps)
    }

    expect(valuesPerCall).toHaveLength(21)
    expect(valuesPerCall[15]).toEqual(['t25', 't26', 't27', 't28', 't29'])
    expect(valuesPerCall[18]).toEqual(['t0', 't1', 't2', 't3', 't4', 't25', 't26', 't27', 't28', 't29'])
    expect(countPending()).toBe(30)

    const completionLogs = tracked
      .getCallsByLevel('info')
      .filter((entry) => entry.args[1] === 'message embedding sweep complete')
    const lastCompletion = completionLogs.at(-1)
    assert(lastCompletion !== undefined)
    assert(isSweepCompletionMeta(lastCompletion.args[0]))
    expect(lastCompletion.args[0].deadLettered).toBe(20)
  })

  test('the embed-failure warn carries the provider error class', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'g:t1', groupContextId: 'g-errclass', text: 'one', timestamp: 1 })
    await flushPendingWrites()
    const deps = {
      resolve: (): LlmConfigResult => okConfig('m'),
      embedMany: (): Promise<{ embeddings: number[][] }> => {
        const err = Object.assign(new Error('rate limited'), { name: 'APICallError', statusCode: 429 })
        return Promise.reject(err)
      },
      sleep: async (): Promise<void> => {},
    }

    await bustedRunMessageEmbeddingSweep(deps)

    const warn = tracked
      .getCallsByLevel('warn')
      .find((entry) => entry.args[1] === 'batch embed failed; rows remain pending')
    assert(warn !== undefined)
    assert(isEmbedFailureWarnMeta(warn.args[0]))
    expect(warn.args[0].errorClass).toBe('APICallError:429')
    expect(warn.args[0].count).toBe(1)
  })
})
