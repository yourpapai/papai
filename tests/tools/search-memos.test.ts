// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { userCachesForTesting } from '../../src/cache.js'
import type { Memo } from '../../src/memos.js'
import { saveMemo, updateMemoEmbedding } from '../../src/memos.js'
import { createTrackedLoggerMock, type LogCall, type TrackedLoggerMock } from '../utils/logger-mock.js'
import { getToolExecutor, setupTestDb } from '../utils/test-helpers.js'

type SearchMemosModule = typeof import('../../src/tools/search-memos.js')

const isSearchMemosModule = (value: unknown): value is SearchMemosModule =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'makeSearchMemosTool') === 'function'

// Legacy module-mock pattern (tests/AGENTS.md): getEmbeddingForContext has no
// per-call DI, so control it via mock.module. Re-applied in beforeEach after
// the preload reset restores src/embeddings.js originals (tests/mock-reset.ts).
let nextQueryVec: number[] | null = null
export let embeddingCall: { text: string; configContextId: string; context: unknown } | null = null

const setQueryVec = (v: number[] | null): void => {
  nextQueryVec = v
}

const mockEmbeddings = (): void => {
  void mock.module('../../src/embeddings.js', () => ({
    getEmbeddingForContext: (text: string, configContextId: string, context?: unknown): Promise<number[] | null> => {
      embeddingCall = { text, configContextId, context }
      return Promise.resolve(nextQueryVec)
    },
  }))
}

// src/tools/search-memos.ts binds `logger.child({ scope: 'tool:memo' })` at
// module-eval time. Install the tracked mock and force a fresh evaluation with
// a cache-busting query so the module binds the tracked child (mirrors
// tests/history.test.ts).
async function loadSearchMemosModule(tracked: TrackedLoggerMock): Promise<SearchMemosModule> {
  void mock.module('../../src/logger.js', () => ({
    getLogLevel: tracked.getLogLevel,
    logger: tracked.logger,
  }))
  const loaded: unknown = await import(`../../src/tools/search-memos.js?t=${crypto.randomUUID()}`)
  if (!isSearchMemosModule(loaded)) {
    throw new Error('search-memos module did not export expected shape')
  }
  return loaded
}

type SearchMemosResult = { results: (Memo & { score?: number })[]; mode: string }

function isSearchMemosResult(value: unknown): value is SearchMemosResult {
  return (
    typeof value === 'object' && value !== null && 'results' in value && 'mode' in value && Array.isArray(value.results)
  )
}

export function findCall(tracked: TrackedLoggerMock, level: LogCall['level'], message: string): LogCall | undefined {
  return tracked.getCallsByLevel(level).find((call) => call.args[1] === message)
}

const USER = 'user1'

export const QUERY_VEC = [1, 0]
export const VEC_HIGH = [0.9, 0.1]
export const VEC_MID = [0.85, 0.5]
export const VEC_PASS = [0.7, 0.7]
export const VEC_BELOW = [0.5, 0.87]
export const VEC_ORTHO = [0.0, 1.0]

export const seedMemoWithEmbedding = (content: string, vec: number[]): Memo => {
  const memo = saveMemo(USER, content, [])
  updateMemoEmbedding(USER, memo.id, new Float32Array(vec))
  return memo
}

describe('search_memos tool', () => {
  beforeEach(async () => {
    userCachesForTesting.clear()
    await setupTestDb()
    setQueryVec(null)
    embeddingCall = null
    mockEmbeddings()
  })

  test('keyword mode returns matching memos only', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    const lease = saveMemo(USER, 'lease renewal deadline', ['landlord'])
    saveMemo(USER, 'buy groceries', ['shopping'])

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'lease', mode: 'keyword' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('keyword')
    expect(result.results.map((r) => r.id)).toEqual([lease.id])
  })

  test('keyword mode returns empty results on no match', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    saveMemo(USER, 'some content', [])

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'nonexistent', mode: 'keyword' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('keyword')
    expect(result.results).toEqual([])
  })

  test('auto mode falls back to keyword when no embedding model resolves', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    const memo = saveMemo(USER, 'important project deadline', [])
    setQueryVec(null)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'deadline', mode: 'auto' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('keyword_fallback')
    expect(result.results.map((r) => r.id)).toEqual([memo.id])
  })
})
