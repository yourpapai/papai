// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for Telegram forum topic helpers
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  createForumTopicIfNeeded,
  _clearForumStatusCache,
  type ForumTopicContext,
} from '../../../src/chat/telegram/forum-topic-helpers.js'
import { mockLogger } from '../../utils/test-helpers.js'

/** Mock API interface */
interface MockApi {
  getChat: (_chatId: number) => Promise<{ is_forum: boolean }>
  createForumTopic: (_chatId: number, _name: string) => Promise<{ message_thread_id: number }>
}

/** Create mock Context for testing */
function createMockContext(
  overrides: { chatType?: string; threadId?: number; username?: string } = {},
): ForumTopicContext {
  const { chatType = 'supergroup', threadId, username = 'testuser' } = overrides
  return {
    chat: { type: chatType, id: 123456 },
    message: { message_thread_id: threadId },
    from: { username },
  }
}

describe('createForumTopicIfNeeded', () => {
  beforeEach(() => {
    mockLogger()
    _clearForumStatusCache()
  })

  test('returns existing threadId if already in thread', async () => {
    const ctx = createMockContext({ threadId: 999 })

    const mockApi: MockApi = {
      getChat: () => Promise.resolve({ is_forum: true }),
      createForumTopic: () => Promise.resolve({ message_thread_id: 111 }),
    }

    const result = await createForumTopicIfNeeded(ctx, mockApi)

    expect(result).toBe('999')
  })

  test('returns undefined for non-supergroup chat', async () => {
    const ctx = createMockContext({ chatType: 'group' })

    const mockApi: MockApi = {
      getChat: () => Promise.resolve({ is_forum: true }),
      createForumTopic: () => Promise.resolve({ message_thread_id: 111 }),
    }

    const result = await createForumTopicIfNeeded(ctx, mockApi)

    expect(result).toBeUndefined()
  })

  test('returns undefined for non-forum supergroup', async () => {
    const ctx = createMockContext()

    const mockApi: MockApi = {
      getChat: () => Promise.resolve({ is_forum: false }),
      createForumTopic: () => Promise.resolve({ message_thread_id: 111 }),
    }

    const result = await createForumTopicIfNeeded(ctx, mockApi)

    expect(result).toBeUndefined()
  })

  test('creates forum topic when conditions met', async () => {
    const ctx = createMockContext()

    const mockApi: MockApi = {
      getChat: () => Promise.resolve({ is_forum: true }),
      createForumTopic: () => Promise.resolve({ message_thread_id: 111 }),
    }

    const result = await createForumTopicIfNeeded(ctx, mockApi)

    expect(result).toBe('111')
  })

  test('handles missing username gracefully', async () => {
    const ctx = createMockContext({ username: undefined })

    const mockApi: MockApi = {
      getChat: () => Promise.resolve({ is_forum: true }),
      createForumTopic: () => Promise.resolve({ message_thread_id: 111 }),
    }

    const result = await createForumTopicIfNeeded(ctx, mockApi)

    expect(result).toBe('111')
  })

  test('returns undefined on API error', async () => {
    const ctx = createMockContext()

    const mockApi: MockApi = {
      getChat: () => Promise.resolve({ is_forum: true }),
      createForumTopic: () => Promise.reject(new Error('API Error')),
    }

    const result = await createForumTopicIfNeeded(ctx, mockApi)

    expect(result).toBeUndefined()
  })

  test('caches getChat result to avoid repeated API calls', async () => {
    const ctx = createMockContext()
    let getChatCallCount = 0

    const mockApi: MockApi = {
      getChat: () => {
        getChatCallCount++
        return Promise.resolve({ is_forum: true })
      },
      createForumTopic: () => Promise.resolve({ message_thread_id: 111 }),
    }

    // First call should trigger getChat
    await createForumTopicIfNeeded(ctx, mockApi)
    expect(getChatCallCount).toBe(1)

    // Second call to same chat should use cache, not call getChat again
    await createForumTopicIfNeeded(ctx, mockApi)
    expect(getChatCallCount).toBe(1)
  })

  test('caches getChat result per chatId', async () => {
    const ctx1 = createMockContext()
    const ctx2: ForumTopicContext = {
      chat: { type: 'supergroup', id: 999999 },
      message: {},
      from: { username: 'testuser' },
    }
    let getChatCallCount = 0

    const mockApi: MockApi = {
      getChat: () => {
        getChatCallCount++
        return Promise.resolve({ is_forum: true })
      },
      createForumTopic: () => Promise.resolve({ message_thread_id: 111 }),
    }

    // Call for different chats should each trigger getChat
    await createForumTopicIfNeeded(ctx1, mockApi)
    await createForumTopicIfNeeded(ctx2, mockApi)
    expect(getChatCallCount).toBe(2)
  })
})
