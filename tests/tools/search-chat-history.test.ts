// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { toScopedThreadContextId, toScopedContextId } from '../../src/chat/scoped-context.js'
import { cacheMessage } from '../../src/message-cache/cache.js'
import { storeEmbedding } from '../../src/message-cache/vector-store.js'
import { makeSearchChatHistoryTool } from '../../src/tools/search-chat-history.js'
import { flushPendingWrites, getToolExecutor, mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'

// Legacy module-mock pattern (tests/AGENTS.md): getEmbeddingForContext has no
// per-call DI, so control it via mock.module. Hoisted above the tool import so
// the tool binds the mock; re-applied in beforeEach after the preload reset.
let nextQueryVec: number[] | null = null
const setQueryVec = (v: number[] | null): void => {
  nextQueryVec = v
}
const mockEmbeddings = (): void => {
  void mock.module('../../src/embeddings.js', () => ({
    getEmbeddingForContext: (): Promise<number[] | null> => Promise.resolve(nextQueryVec),
  }))
}
mockEmbeddings()

const threadContextId = toScopedThreadContextId({
  platformInstanceId: 'inst1',
  nativeContextId: 'group1',
  threadId: 't1',
})
const groupContextId = toScopedContextId({ platformInstanceId: 'inst1', nativeContextId: 'group1' })

type SearchChatHistoryResult = { results: { messageId: string }[]; total: number; mode: string; hasMore: boolean }

function isSearchResult(value: unknown): value is SearchChatHistoryResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'results' in value &&
    'total' in value &&
    'mode' in value &&
    'hasMore' in value
  )
}

describe('search_chat_history tool', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    setQueryVec(null)
    mockEmbeddings()
  })

  test('input schema accepts query + optional filters', () => {
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    expect(schemaValidates(tool, { query: 'deploy' })).toBe(true)
    expect(schemaValidates(tool, { query: 'deploy', limit: 10, author: 'alice' })).toBe(true)
    expect(schemaValidates(tool, { limit: 5 })).toBe(false)
  })

  test('returns matching messages within the group scope', async () => {
    cacheMessage({
      messageId: '1',
      contextId: threadContextId,
      groupContextId,
      text: 'deploy the thing',
      authorUsername: 'alice',
      timestamp: 1,
    })
    cacheMessage({
      messageId: '2',
      contextId: threadContextId,
      groupContextId,
      text: 'lunch?',
      authorUsername: 'bob',
      timestamp: 2,
    })
    await flushPendingWrites()
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ query: 'deploy', mode: 'keyword' })
    assert(isSearchResult(result), 'Invalid result')
    expect(result.results.map((r) => r.messageId)).toEqual(['1'])
    expect(result.total).toBe(1)
    expect(result.mode).toBe('keyword')
    expect(result.hasMore).toBe(false)
  })

  test('hasMore is true when results hit the requested limit', async () => {
    for (let i = 1; i <= 3; i++) {
      cacheMessage({
        messageId: String(i),
        contextId: threadContextId,
        groupContextId,
        text: 'deploy',
        timestamp: i,
      })
    }
    await flushPendingWrites()
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    const capped: unknown = await getToolExecutor(tool)({ query: 'deploy', limit: 2, mode: 'keyword' })
    assert(isSearchResult(capped), 'Invalid result')
    expect(capped.total).toBe(2)
    expect(capped.hasMore).toBe(true)

    const uncapped: unknown = await getToolExecutor(tool)({ query: 'deploy', limit: 5, mode: 'keyword' })
    assert(isSearchResult(uncapped), 'Invalid result')
    expect(uncapped.total).toBe(3)
    expect(uncapped.hasMore).toBe(false)
  })

  test('returns empty result set on no match', async () => {
    cacheMessage({ messageId: '1', contextId: threadContextId, groupContextId, text: 'hello', timestamp: 1 })
    await flushPendingWrites()
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ query: 'zzz', mode: 'keyword' })
    assert(isSearchResult(result), 'Invalid result')
    expect(result.results).toEqual([])
    expect(result.total).toBe(0)
  })

  test('DM scope finds DM rows and group scope does not', async () => {
    cacheMessage({ messageId: 'dm1', contextId: 'dm-ctx-1', text: 'secret deploy notes', timestamp: 1 })
    await flushPendingWrites()
    const dmTool = makeSearchChatHistoryTool('u1', 'dm-ctx-1', 'dm')
    const dmResult: unknown = await getToolExecutor(dmTool)({ query: 'deploy', mode: 'keyword' })
    assert(isSearchResult(dmResult), 'Invalid result')
    expect(dmResult.results.map((r) => r.messageId)).toEqual(['dm1'])

    const groupTool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    const groupResult: unknown = await getToolExecutor(groupTool)({ query: 'deploy', mode: 'keyword' })
    assert(isSearchResult(groupResult), 'Invalid result')
    expect(groupResult.results).toEqual([])
    expect(groupResult.total).toBe(0)
  })

  test('auto mode returns a semantic hit by meaning when a query vector is available', async () => {
    cacheMessage({
      messageId: 's1',
      contextId: threadContextId,
      groupContextId,
      text: 'cycle the api keys',
      timestamp: 1,
    })
    cacheMessage({ messageId: 's2', contextId: threadContextId, groupContextId, text: 'lunch?', timestamp: 2 })
    await flushPendingWrites()
    storeEmbedding(threadContextId, 's1', new Float32Array([0.9, 0.1]), 'm', 2)
    storeEmbedding(threadContextId, 's2', new Float32Array([0.0, 1.0]), 'm', 2)
    setQueryVec([0.95, 0.05])
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ query: 'rotate credentials', mode: 'auto' })
    assert(isSearchResult(result), 'Invalid result')
    expect(result.results.map((r) => r.messageId)).toEqual(['s1'])
    expect(result.mode).toBe('semantic')
  })

  test('auto mode falls back to keyword when no embedding model resolves', async () => {
    cacheMessage({ messageId: 'k1', contextId: threadContextId, groupContextId, text: 'deploy', timestamp: 1 })
    await flushPendingWrites()
    setQueryVec(null)
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ query: 'deploy', mode: 'auto' })
    assert(isSearchResult(result), 'Invalid result')
    expect(result.mode).toBe('keyword_fallback')
    expect(result.results.map((r) => r.messageId)).toEqual(['k1'])
  })

  test('auto mode falls back to keyword when semantic returns zero hits', async () => {
    cacheMessage({ messageId: 'k1', contextId: threadContextId, groupContextId, text: 'deploy', timestamp: 1 })
    await flushPendingWrites()
    // vector present but matches nothing above threshold
    setQueryVec([0.0, 1.0])
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ query: 'deploy', mode: 'auto' })
    assert(isSearchResult(result), 'Invalid result')
    expect(result.mode).toBe('keyword_fallback')
  })

  test('semantic mode returns semantic_unavailable when no embedding model resolves', async () => {
    cacheMessage({ messageId: 'k1', contextId: threadContextId, groupContextId, text: 'deploy', timestamp: 1 })
    await flushPendingWrites()
    setQueryVec(null)
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ query: 'deploy', mode: 'semantic' })
    assert(isSearchResult(result), 'Invalid result')
    expect(result.mode).toBe('semantic_unavailable')
    expect(result.results).toEqual([])
  })

  test('keyword mode is unchanged (explicit)', async () => {
    cacheMessage({ messageId: 'k1', contextId: threadContextId, groupContextId, text: 'deploy', timestamp: 1 })
    await flushPendingWrites()
    // would produce a semantic hit if mode were auto
    setQueryVec([0.95, 0.05])
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ query: 'deploy', mode: 'keyword' })
    assert(isSearchResult(result), 'Invalid result')
    expect(result.mode).toBe('keyword')
  })

  test('schema accepts mode keyword|semantic|auto (default auto)', () => {
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    expect(schemaValidates(tool, { query: 'x', mode: 'semantic' })).toBe(true)
    expect(schemaValidates(tool, { query: 'x', mode: 'auto' })).toBe(true)
    expect(schemaValidates(tool, { query: 'x', mode: 'keyword' })).toBe(true)
    expect(schemaValidates(tool, { query: 'x', mode: 'bogus' })).toBe(false)
  })
})
