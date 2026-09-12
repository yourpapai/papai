// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { logger, logMultistream } from '../../src/logger.js'
import { cacheMessage } from '../../src/message-cache/cache.js'
import { getMessage, getMessageByContext, getMessageContext, searchMessages } from '../../src/message-cache/store.js'
import type { MessageScope } from '../../src/message-cache/store.js'
import { flushPendingWrites, mockLogger, setupTestDb } from '../utils/test-helpers.js'

const groupScope = (g: string): MessageScope => ({ kind: 'group', groupContextId: g })
const dmScope = (c: string): MessageScope => ({ kind: 'dm', contextId: c })

describe('message-cache store: getMessageByContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns a previously cached message by (contextId, messageId)', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'c1', text: 'hello', timestamp: 1000 })
    await flushPendingWrites()
    const got = getMessageByContext('c1', 'm1')
    expect(got?.text).toBe('hello')
    expect(got?.timestamp).toBe(1000)
  })

  test('returns undefined for a missing message', () => {
    expect(getMessageByContext('c1', 'nope')).toBeUndefined()
  })

  test('isolates by contextId (same messageId, different context)', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'A', text: 'in A', timestamp: 1 })
    cacheMessage({ messageId: 'm1', contextId: 'B', text: 'in B', timestamp: 2 })
    await flushPendingWrites()
    expect(getMessageByContext('A', 'm1')?.text).toBe('in A')
    expect(getMessageByContext('B', 'm1')?.text).toBe('in B')
  })
})

describe('message-cache store: rowToCachedMessage mapping', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('maps a fully populated row', async () => {
    cacheMessage({
      messageId: 'full',
      contextId: 'g:t1',
      authorId: 'u1',
      authorUsername: 'alice',
      text: 'hello',
      replyToMessageId: 'parent',
      groupContextId: 'g',
      timestamp: 42,
    })
    await flushPendingWrites()
    const got = getMessageByContext('g:t1', 'full')
    expect(got).toEqual({
      messageId: 'full',
      contextId: 'g:t1',
      authorId: 'u1',
      authorUsername: 'alice',
      text: 'hello',
      replyToMessageId: 'parent',
      groupContextId: 'g',
      timestamp: 42,
    })
  })

  test('coerces null columns to undefined', async () => {
    cacheMessage({ messageId: 'sparse', contextId: 'g:t1', timestamp: 7 })
    await flushPendingWrites()
    const got = getMessageByContext('g:t1', 'sparse')
    expect(got).toEqual({
      messageId: 'sparse',
      contextId: 'g:t1',
      authorId: undefined,
      authorUsername: undefined,
      text: undefined,
      replyToMessageId: undefined,
      groupContextId: undefined,
      timestamp: 7,
    })
  })
})

describe('message-cache store: searchMessages (FTS5)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('matches by keyword within group scope, ranked by bm25', async () => {
    cacheMessage({ messageId: '1', contextId: 'g:t1', groupContextId: 'g', text: 'deploy the thing', timestamp: 1 })
    cacheMessage({ messageId: '2', contextId: 'g:t1', groupContextId: 'g', text: 'deploy went fine', timestamp: 2 })
    cacheMessage({ messageId: '3', contextId: 'g:t1', groupContextId: 'g', text: 'unrelated chatter', timestamp: 3 })
    await flushPendingWrites()
    const results = searchMessages(groupScope('g'), 'deploy', {}, 10)
    expect(results.map((r) => r.messageId).sort()).toEqual(['1', '2'])
  })

  test('does not leak across groups', async () => {
    cacheMessage({ messageId: '1', contextId: 'a:t1', groupContextId: 'a', text: 'deploy', timestamp: 1 })
    cacheMessage({ messageId: '2', contextId: 'b:t1', groupContextId: 'b', text: 'deploy', timestamp: 2 })
    await flushPendingWrites()
    expect(searchMessages(groupScope('a'), 'deploy', {}, 10).map((r) => r.messageId)).toEqual(['1'])
  })

  test('dm scope isolates to that dm (group_context_id IS NULL)', async () => {
    cacheMessage({ messageId: '1', contextId: 'dm-alice', text: 'deploy note', timestamp: 1 })
    cacheMessage({ messageId: '2', contextId: 'g:t1', groupContextId: 'g', text: 'deploy note', timestamp: 2 })
    await flushPendingWrites()
    expect(searchMessages(dmScope('dm-alice'), 'deploy', {}, 10).map((r) => r.messageId)).toEqual(['1'])
  })

  test('author filter narrows results', async () => {
    cacheMessage({
      messageId: '1',
      contextId: 'g:t1',
      groupContextId: 'g',
      authorUsername: 'alice',
      text: 'deploy',
      timestamp: 1,
    })
    cacheMessage({
      messageId: '2',
      contextId: 'g:t1',
      groupContextId: 'g',
      authorUsername: 'bob',
      text: 'deploy',
      timestamp: 2,
    })
    await flushPendingWrites()
    expect(searchMessages(groupScope('g'), 'deploy', { author: 'alice' }, 10).map((r) => r.messageId)).toEqual(['1'])
  })

  test('empty/no-match query returns []', async () => {
    cacheMessage({ messageId: '1', contextId: 'g:t1', groupContextId: 'g', text: 'deploy', timestamp: 1 })
    await flushPendingWrites()
    expect(searchMessages(groupScope('g'), 'nonexistentterm', {}, 10)).toEqual([])
  })

  test('bm25 ranks the higher-relevance message first', async () => {
    cacheMessage({
      messageId: '1',
      contextId: 'g:t1',
      groupContextId: 'g',
      text: 'deploy alpha beta gamma',
      timestamp: 1,
    })
    cacheMessage({
      messageId: '2',
      contextId: 'g:t1',
      groupContextId: 'g',
      text: 'deploy deploy alpha beta',
      timestamp: 2,
    })
    cacheMessage({ messageId: '3', contextId: 'g:t1', groupContextId: 'g', text: 'unrelated chatter', timestamp: 3 })
    await flushPendingWrites()
    const results = searchMessages(groupScope('g'), 'deploy', {}, 10)
    expect(results[0]?.messageId).toBe('2')
  })
})

describe('message-cache store: searchMessages log attribution', () => {
  // No mockLogger here: the module-bound child logger is the real pino instance,
  // so attribution is asserted against actual egress (see tests/tools/logging-privacy.test.ts).
  beforeEach(async () => {
    await setupTestDb()
  })

  test('debug entry carries chatUserId so the querying admin keeps their own query text', () => {
    const logLines: string[] = []
    logMultistream.add({ level: 'debug', stream: { write: (chunk: string): void => void logLines.push(chunk) } })
    logger.level = 'debug'
    try {
      searchMessages(groupScope('g'), 'deploy', {}, 10, 'user-9')
    } finally {
      logger.level = 'silent'
    }
    const entry = logLines.find((line) => line.includes('"msg":"searchMessages called"'))
    expect(entry, 'expected a searchMessages debug log entry').toBeDefined()
    expect(entry).toContain('"chatUserId":"user-9"')
    expect(entry).toContain('"query":"deploy"')
  })
})

describe('message-cache store: getMessage (scope-checked)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns message within group scope', async () => {
    cacheMessage({ messageId: 'm', contextId: 'g:t1', groupContextId: 'g', text: 'x', timestamp: 1 })
    await flushPendingWrites()
    expect(getMessage(groupScope('g'), 'm')?.text).toBe('x')
  })

  test('returns undefined out of scope (no existence leak)', async () => {
    cacheMessage({ messageId: 'm', contextId: 'g:t1', groupContextId: 'g', text: 'x', timestamp: 1 })
    await flushPendingWrites()
    expect(getMessage(groupScope('other'), 'm')).toBeUndefined()
  })
})

describe('message-cache store: getMessageContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('temporal mode returns N before/after within scope', async () => {
    cacheMessage({ messageId: 'a', contextId: 'g:t1', groupContextId: 'g', text: 'a', timestamp: 1 })
    cacheMessage({ messageId: 'b', contextId: 'g:t1', groupContextId: 'g', text: 'b', timestamp: 2 })
    cacheMessage({ messageId: 'c', contextId: 'g:t1', groupContextId: 'g', text: 'c', timestamp: 3 })
    cacheMessage({ messageId: 'd', contextId: 'g:t1', groupContextId: 'g', text: 'd', timestamp: 4 })
    await flushPendingWrites()
    const res = getMessageContext(groupScope('g'), 'c', 1, 1, 'temporal')
    expect(res.target?.messageId).toBe('c')
    expect(res.before.map((m) => m.messageId)).toEqual(['b'])
    expect(res.after.map((m) => m.messageId)).toEqual(['d'])
  })

  test('thread mode isolates to the anchor contextId within the group scope', async () => {
    cacheMessage({ messageId: 'a1', contextId: 'g:t1', groupContextId: 'g', text: 'a1', timestamp: 1 })
    cacheMessage({ messageId: 'b1', contextId: 'g:t2', groupContextId: 'g', text: 'b1', timestamp: 2 })
    cacheMessage({ messageId: 'a2', contextId: 'g:t1', groupContextId: 'g', text: 'a2', timestamp: 3 })
    cacheMessage({ messageId: 'b2', contextId: 'g:t2', groupContextId: 'g', text: 'b2', timestamp: 4 })
    cacheMessage({ messageId: 'a3', contextId: 'g:t1', groupContextId: 'g', text: 'a3', timestamp: 5 })
    await flushPendingWrites()
    const res = getMessageContext(groupScope('g'), 'a2', 5, 5, 'thread')
    expect(res.target?.messageId).toBe('a2')
    expect(res.before.map((m) => m.messageId)).toEqual(['a1'])
    expect(res.after.map((m) => m.messageId)).toEqual(['a3'])
  })

  test('returns empty target when message missing in scope', async () => {
    cacheMessage({ messageId: 'a', contextId: 'g:t1', groupContextId: 'g', text: 'a', timestamp: 1 })
    await flushPendingWrites()
    const res = getMessageContext(groupScope('g'), 'zzz', 1, 1, 'temporal')
    expect(res.target).toBeUndefined()
    expect(res.before).toEqual([])
    expect(res.after).toEqual([])
  })

  test('reply_chain mode walks parents via buildReplyChain', async () => {
    cacheMessage({ messageId: '1', contextId: 'g:t1', groupContextId: 'g', text: 'root', timestamp: 1 })
    cacheMessage({
      messageId: '2',
      contextId: 'g:t1',
      groupContextId: 'g',
      text: 'reply',
      replyToMessageId: '1',
      timestamp: 2,
    })
    await flushPendingWrites()
    const res = getMessageContext(groupScope('g'), '2', 0, 0, 'reply_chain')
    expect(res.replyChain).toEqual(['1', '2'])
  })
})
