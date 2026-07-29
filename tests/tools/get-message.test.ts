// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { toScopedThreadContextId, toScopedContextId } from '../../src/chat/scoped-context.js'
import { cacheMessage } from '../../src/message-cache/cache.js'
import { makeGetMessageTool } from '../../src/tools/get-message.js'
import { flushPendingWrites, getToolExecutor, mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'

const threadContextId = toScopedThreadContextId({
  platformInstanceId: 'inst1',
  nativeContextId: 'group1',
  threadId: 't1',
})
const otherThreadContextId = toScopedThreadContextId({
  platformInstanceId: 'inst1',
  nativeContextId: 'group2',
  threadId: 't1',
})
const groupContextId = toScopedContextId({ platformInstanceId: 'inst1', nativeContextId: 'group1' })

type GetMessageResult = { messageId: string; text: string; replyToMessageId?: string }
type NotFoundResult = { not_found: boolean }

function isGetMessageResult(value: unknown): value is GetMessageResult {
  return typeof value === 'object' && value !== null && 'messageId' in value && 'text' in value
}

function isNotFoundResult(value: unknown): value is NotFoundResult {
  return typeof value === 'object' && value !== null && 'not_found' in value
}

describe('get_message tool', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns a message by id within scope', async () => {
    cacheMessage({
      messageId: 'm1',
      contextId: threadContextId,
      groupContextId,
      text: 'hi',
      timestamp: 1,
    })
    await flushPendingWrites()
    const tool = makeGetMessageTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ messageId: 'm1' })
    assert(isGetMessageResult(result), 'Invalid result')
    expect(result.messageId).toBe('m1')
    expect(result.text).toBe('hi')
  })

  test('returns not_found for out-of-scope id (no existence leak)', async () => {
    cacheMessage({
      messageId: 'm1',
      contextId: threadContextId,
      groupContextId,
      text: 'hi',
      timestamp: 1,
    })
    await flushPendingWrites()
    const tool = makeGetMessageTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ messageId: 'm1' })
    assert(isGetMessageResult(result), 'Invalid result')
    expect(result.messageId).toBe('m1')
    const other = makeGetMessageTool('u1', otherThreadContextId, 'group')
    const otherResult: unknown = await getToolExecutor(other)({ messageId: 'm1' })
    assert(isNotFoundResult(otherResult), 'Invalid result')
    expect(otherResult.not_found).toBe(true)
  })

  test('schema requires messageId', () => {
    expect(schemaValidates(makeGetMessageTool('u', 'g', 'group'), { messageId: 'x' })).toBe(true)
    expect(schemaValidates(makeGetMessageTool('u', 'g', 'group'), {})).toBe(false)
  })

  test('schema accepts a multi-character messageId (guards min→max mutation)', () => {
    expect(schemaValidates(makeGetMessageTool('u', 'g', 'group'), { messageId: 'msg-12345' })).toBe(true)
  })

  test('returns a message including replyToMessageId when present', async () => {
    cacheMessage({
      messageId: 'parent',
      contextId: threadContextId,
      groupContextId,
      text: 'root',
      timestamp: 1,
    })
    cacheMessage({
      messageId: 'child',
      contextId: threadContextId,
      groupContextId,
      text: 'a reply',
      replyToMessageId: 'parent',
      timestamp: 2,
    })
    await flushPendingWrites()
    const tool = makeGetMessageTool('u1', threadContextId, 'group')
    const result: unknown = await getToolExecutor(tool)({ messageId: 'child' })
    assert(isGetMessageResult(result), 'Invalid result')
    expect(result.messageId).toBe('child')
    expect(result.replyToMessageId).toBe('parent')
  })

  test('DM scope fetches a DM-scoped message', async () => {
    cacheMessage({ messageId: 'dm1', contextId: 'dm-alice', text: 'secret', timestamp: 1 })
    await flushPendingWrites()
    const tool = makeGetMessageTool('alice', 'dm-alice', 'dm')
    const result: unknown = await getToolExecutor(tool)({ messageId: 'dm1' })
    assert(isGetMessageResult(result), 'Invalid result')
    expect(result.messageId).toBe('dm1')
    expect(result.text).toBe('secret')
  })
})
