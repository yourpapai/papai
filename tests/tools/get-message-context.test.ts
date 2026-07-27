// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { toScopedThreadContextId, toScopedContextId } from '../../src/chat/scoped-context.js'
import { cacheMessage } from '../../src/message-cache/cache.js'
import { makeGetMessageContextTool } from '../../src/tools/get-message-context.js'
import { flushPendingWrites, getToolExecutor, mockLogger, setupTestDb } from '../utils/test-helpers.js'

const threadContextId = toScopedThreadContextId({
  platformInstanceId: 'inst1',
  nativeContextId: 'group1',
  threadId: 't1',
})
const groupContextId = toScopedContextId({ platformInstanceId: 'inst1', nativeContextId: 'group1' })

type MessageContextToolResult = {
  target: { messageId: string }
  before: { messageId: string }[]
  after: { messageId: string }[]
  replyChain?: string[]
}

function isMessageContextResult(value: unknown): value is MessageContextToolResult {
  return typeof value === 'object' && value !== null && 'target' in value && 'before' in value && 'after' in value
}

function isNotFoundResult(value: unknown): value is { not_found: boolean } {
  return typeof value === 'object' && value !== null && 'not_found' in value
}

describe('get_message_context tool', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('temporal mode returns target + before/after', async () => {
    cacheMessage({ messageId: 'a', contextId: threadContextId, groupContextId, text: 'a', timestamp: 1 })
    cacheMessage({ messageId: 'b', contextId: threadContextId, groupContextId, text: 'b', timestamp: 2 })
    cacheMessage({ messageId: 'c', contextId: threadContextId, groupContextId, text: 'c', timestamp: 3 })
    await flushPendingWrites()
    const tool = makeGetMessageContextTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ messageId: 'b', before: 1, after: 1 })
    assert(isMessageContextResult(result), 'Invalid result')
    expect(result.target.messageId).toBe('b')
    expect(result.before.map((m) => m.messageId)).toEqual(['a'])
    expect(result.after.map((m) => m.messageId)).toEqual(['c'])
  })

  test('reply_chain mode returns replyChain', async () => {
    cacheMessage({ messageId: '1', contextId: threadContextId, groupContextId, text: 'root', timestamp: 1 })
    cacheMessage({
      messageId: '2',
      contextId: threadContextId,
      groupContextId,
      text: 'reply',
      replyToMessageId: '1',
      timestamp: 2,
    })
    await flushPendingWrites()
    const tool = makeGetMessageContextTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ messageId: '2', mode: 'reply_chain' })
    assert(isMessageContextResult(result), 'Invalid result')
    expect(result.replyChain).toEqual(['1', '2'])
  })

  test('not_found for missing target', async () => {
    const tool = makeGetMessageContextTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ messageId: 'zzz' })
    assert(isNotFoundResult(result), 'Invalid result')
    expect(result.not_found).toBe(true)
  })
})
