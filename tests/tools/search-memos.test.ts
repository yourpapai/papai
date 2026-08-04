// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { userCachesForTesting } from '../../src/cache.js'
import type { Memo } from '../../src/memos.js'
import { saveMemo, updateMemoEmbedding } from '../../src/memos.js'
import { createTrackedLoggerMock, type LogCall, type TrackedLoggerMock } from '../utils/logger-mock.js'
import { getToolExecutor, schemaValidates, setupTestDb } from '../utils/test-helpers.js'

type SearchMemosModule = typeof import('../../src/tools/search-memos.js')

const isSearchMemosModule = (value: unknown): value is SearchMemosModule =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'makeSearchMemosTool') === 'function'

// Legacy module-mock pattern (tests/AGENTS.md): getEmbeddingForContext has no
// per-call DI, so control it via mock.module. Re-applied in beforeEach after
// the preload reset restores src/embeddings.js originals (tests/mock-reset.ts).
let nextQueryVec: number[] | null = null
export let embeddingCall: {
  text: string
  configContextId: string
  context: unknown
} | null = null

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

type SearchMemosResult = {
  results: (Memo & { score?: number })[]
  mode: string
}

function isSearchMemosResult(value: unknown): value is SearchMemosResult {
  return (
    typeof value === 'object' && value !== null && 'results' in value && 'mode' in value && Array.isArray(value.results)
  )
}

export function findCall(tracked: TrackedLoggerMock, level: LogCall['level'], message: string): LogCall | undefined {
  return tracked.getCallsByLevel(level).find((call) => call.args[1] === message)
}

function getInputFieldJsonSchema(tool: { inputSchema: unknown }, fieldName: string): z.core.JSONSchema.JSONSchema {
  const schema = tool.inputSchema
  if (!(schema instanceof z.ZodType)) throw new Error('Tool inputSchema is not a zod schema')
  const jsonSchema = z.toJSONSchema(schema)
  if (!('properties' in jsonSchema) || jsonSchema.properties === undefined) {
    throw new Error('Tool inputSchema has no properties')
  }
  const property = jsonSchema.properties[fieldName]
  if (typeof property !== 'object' || property === null) {
    throw new Error(`No JSON schema for field '${fieldName}'`)
  }
  return property
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

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({
      query: 'lease',
      mode: 'keyword',
    })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('keyword')
    expect(result.results.map((r) => r.id)).toEqual([lease.id])
  })

  test('keyword mode returns empty results on no match', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    saveMemo(USER, 'some content', [])

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({
      query: 'nonexistent',
      mode: 'keyword',
    })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('keyword')
    expect(result.results).toEqual([])
  })

  test('auto mode falls back to keyword when no embedding model resolves', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    const memo = saveMemo(USER, 'important project deadline', [])
    setQueryVec(null)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({
      query: 'deadline',
      mode: 'auto',
    })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('keyword_fallback')
    expect(result.results.map((r) => r.id)).toEqual([memo.id])
  })

  test('input schema validates query/mode/limit constraints', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    const tool = makeSearchMemosTool(USER)

    expect(schemaValidates(tool, { query: 'x' })).toBe(true)
    expect(schemaValidates(tool, { query: 'x', mode: 'keyword' })).toBe(true)
    expect(schemaValidates(tool, { query: 'x', mode: 'semantic' })).toBe(true)
    expect(schemaValidates(tool, { query: 'x', mode: 'auto' })).toBe(true)
    expect(schemaValidates(tool, { query: 'x', mode: 'bogus' })).toBe(false)
    expect(schemaValidates(tool, { query: '' })).toBe(false)
    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { query: 'x', limit: 0 })).toBe(false)
    expect(schemaValidates(tool, { query: 'x', limit: 21 })).toBe(false)
    expect(schemaValidates(tool, { query: 'x', limit: 2.5 })).toBe(false)
    expect(schemaValidates(tool, { query: 'x', limit: 1 })).toBe(true)
    expect(schemaValidates(tool, { query: 'x', limit: 20 })).toBe(true)
  })

  test('exposes non-empty LLM-facing descriptions, enum, and defaults', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    const tool = makeSearchMemosTool(USER)

    expect(tool.description).toContain('Search personal notes')

    const queryMeta = getInputFieldJsonSchema(tool, 'query')
    const modeMeta = getInputFieldJsonSchema(tool, 'mode')
    const limitMeta = getInputFieldJsonSchema(tool, 'limit')

    expect(typeof queryMeta.description).toBe('string')
    expect(queryMeta.description?.length).toBeGreaterThan(0)
    expect(typeof modeMeta.description).toBe('string')
    expect(modeMeta.description?.length).toBeGreaterThan(0)
    expect(typeof limitMeta.description).toBe('string')
    expect(limitMeta.description?.length).toBeGreaterThan(0)

    expect(modeMeta.enum).toEqual(['keyword', 'semantic', 'auto'])
    expect(modeMeta.default).toBe('auto')
    expect(limitMeta.default).toBe(5)
    expect(limitMeta.minimum).toBe(1)
    expect(limitMeta.maximum).toBe(20)
  })

  test('auto mode still falls back to keyword when embeddings exist but no query vector resolves', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    const memo = seedMemoWithEmbedding('deadline notes', VEC_HIGH)
    setQueryVec(null)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'deadline', mode: 'auto' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('keyword_fallback')
    expect(result.results.map((r) => r.id)).toEqual([memo.id])
  })

  test('auto mode returns semantic hits sorted by descending score', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    const mid = seedMemoWithEmbedding('rotate the credentials', VEC_MID)
    const high = seedMemoWithEmbedding('cycle api keys soon', VEC_HIGH)
    seedMemoWithEmbedding('unrelated lunch note', VEC_ORTHO)
    setQueryVec(QUERY_VEC)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({
      query: 'security rotation',
      mode: 'auto',
    })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('semantic')
    expect(result.results.map((r) => r.id)).toEqual([high.id, mid.id])
    expect(typeof result.results[0]?.score).toBe('number')

    const done = findCall(tracked, 'info', 'Semantic search completed')
    expect(done?.args[0]).toEqual({ mode: 'semantic', resultCount: 2 })
  })

  test('auto mode falls back to keyword when semantic yields zero hits', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    const memo = seedMemoWithEmbedding('deploy runbook', VEC_ORTHO)
    setQueryVec(QUERY_VEC)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'deploy', mode: 'auto' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('keyword_fallback')
    expect(result.results.map((r) => r.id)).toEqual([memo.id])
  })

  test('semantic mode returns an empty semantic result when nothing passes the threshold', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    seedMemoWithEmbedding('deploy runbook', VEC_ORTHO)
    setQueryVec(QUERY_VEC)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'deploy', mode: 'semantic' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('semantic')
    expect(result.results).toEqual([])
  })

  test('semantic mode returns an empty result and warns when no embedding model resolves', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    saveMemo(USER, 'deploy runbook', [])
    setQueryVec(null)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'deploy', mode: 'semantic' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('semantic')
    expect(result.results).toEqual([])
    const warn = tracked.getCallsByLevel('warn').find((call) => call.args[0] === 'Semantic search unavailable')
    expect(warn).toBeDefined()
  })

  test('semantic search excludes memos below the similarity threshold', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    seedMemoWithEmbedding('vaguely related', VEC_BELOW)
    const high = seedMemoWithEmbedding('directly related', VEC_HIGH)
    setQueryVec(QUERY_VEC)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({ query: 'topic', mode: 'semantic' })

    assert(isSearchMemosResult(result))
    expect(result.mode).toBe('semantic')
    expect(result.results.map((r) => r.id)).toEqual([high.id])
  })

  test('semantic search keeps only the top limit results', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    seedMemoWithEmbedding('third best', VEC_PASS)
    const mid = seedMemoWithEmbedding('second best', VEC_MID)
    const high = seedMemoWithEmbedding('best match', VEC_HIGH)
    setQueryVec(QUERY_VEC)

    const result: unknown = await getToolExecutor(makeSearchMemosTool(USER))({
      query: 'topic',
      mode: 'semantic',
      limit: 2,
    })

    assert(isSearchMemosResult(result))
    expect(result.results.map((r) => r.id)).toEqual([high.id, mid.id])
  })

  test('resolves the query embedding against the user scope', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeSearchMemosTool } = await loadSearchMemosModule(tracked)
    seedMemoWithEmbedding('anything', VEC_HIGH)
    setQueryVec(QUERY_VEC)

    await getToolExecutor(makeSearchMemosTool(USER))({ query: 'find this', mode: 'auto' })

    expect(embeddingCall).toEqual({
      text: 'find this',
      configContextId: USER,
      context: { storageContextId: USER, contextType: 'dm', chatUserId: USER },
    })
  })
})
