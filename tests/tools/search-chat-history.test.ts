// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { toScopedThreadContextId, toScopedContextId } from '../../src/chat/scoped-context.js'
import { cacheMessage } from '../../src/message-cache/cache.js'
import { makeSearchChatHistoryTool } from '../../src/tools/search-chat-history.js'
import { flushPendingWrites, getToolExecutor, mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'

const threadContextId = toScopedThreadContextId({
  platformInstanceId: 'inst1',
  nativeContextId: 'group1',
  threadId: 't1',
})
const groupContextId = toScopedContextId({ platformInstanceId: 'inst1', nativeContextId: 'group1' })

type SearchChatHistoryResult = { results: { messageId: string }[]; total: number; mode: string }

function isSearchResult(value: unknown): value is SearchChatHistoryResult {
  return typeof value === 'object' && value !== null && 'results' in value && 'total' in value && 'mode' in value
}

describe('search_chat_history tool', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
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
    const result: unknown = await getToolExecutor(tool)({ query: 'deploy' })
    assert(isSearchResult(result), 'Invalid result')
    expect(result.results.map((r) => r.messageId)).toEqual(['1'])
    expect(result.total).toBe(1)
    expect(result.mode).toBe('keyword')
  })

  test('returns empty result set on no match', async () => {
    cacheMessage({ messageId: '1', contextId: threadContextId, groupContextId, text: 'hello', timestamp: 1 })
    await flushPendingWrites()
    const tool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ query: 'zzz' })
    assert(isSearchResult(result), 'Invalid result')
    expect(result.results).toEqual([])
    expect(result.total).toBe(0)
  })

  test('DM scope finds DM rows and group scope does not', async () => {
    cacheMessage({ messageId: 'dm1', contextId: 'dm-ctx-1', text: 'secret deploy notes', timestamp: 1 })
    await flushPendingWrites()
    const dmTool = makeSearchChatHistoryTool('u1', 'dm-ctx-1', 'dm')
    const dmResult: unknown = await getToolExecutor(dmTool)({ query: 'deploy' })
    assert(isSearchResult(dmResult), 'Invalid result')
    expect(dmResult.results.map((r) => r.messageId)).toEqual(['dm1'])

    const groupTool = makeSearchChatHistoryTool('u1', threadContextId, 'group')
    const groupResult: unknown = await getToolExecutor(groupTool)({ query: 'deploy' })
    assert(isSearchResult(groupResult), 'Invalid result')
    expect(groupResult.results).toEqual([])
    expect(groupResult.total).toBe(0)
  })
})
