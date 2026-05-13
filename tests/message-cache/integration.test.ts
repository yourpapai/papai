import { beforeEach, describe, expect, test } from 'bun:test'

import { cacheMessage } from '../../src/message-cache/cache.js'
import { buildReplyChain } from '../../src/message-cache/index.js'
import { clearMessageCache, mockLogger, mockMessageCache } from '../utils/test-helpers.js'

const replyToId = (i: number): string | undefined => (i > 0 ? String(i - 1) : undefined)

describe('Message Cache Integration', () => {
  beforeEach(() => {
    mockLogger()
    mockMessageCache()
    clearMessageCache()
  })

  test('should cache telegram-style messages and build chain', () => {
    cacheMessage({
      messageId: '100',
      contextId: 'chat-1',
      authorId: 'user-1',
      authorUsername: 'alice',
      text: 'Original message',
      timestamp: Date.now(),
    })

    cacheMessage({
      messageId: '101',
      contextId: 'chat-1',
      authorId: 'user-2',
      authorUsername: 'bob',
      text: 'Reply to alice',
      replyToMessageId: '100',
      timestamp: Date.now(),
    })

    cacheMessage({
      messageId: '102',
      contextId: 'chat-1',
      authorId: 'user-1',
      authorUsername: 'alice',
      text: 'Reply to bob',
      replyToMessageId: '101',
      timestamp: Date.now(),
    })

    const result = buildReplyChain('chat-1', '102')
    expect(result.chain).toEqual(['100', '101', '102'])
    expect(result.isComplete).toBe(true)
  })

  test('should handle deep chains', () => {
    for (let i = 0; i < 10; i++) {
      cacheMessage({
        messageId: String(i),
        contextId: 'chat-1',
        authorId: 'user-1',
        text: `Message ${i}`,
        replyToMessageId: replyToId(i),
        timestamp: Date.now(),
      })
    }

    const result = buildReplyChain('chat-1', '9')
    expect(result.chain).toHaveLength(10)
    expect(result.chain[0]).toBe('0')
    expect(result.chain[9]).toBe('9')
    expect(result.isComplete).toBe(true)
  })

  test('should handle partial chain with gap in middle', () => {
    // Cache messages 0, 1, 3, 4 but NOT 2
    cacheMessage({ messageId: '0', contextId: 'chat-1', timestamp: Date.now() })
    cacheMessage({ messageId: '1', contextId: 'chat-1', replyToMessageId: '0', timestamp: Date.now() })
    // Message 2 is missing
    cacheMessage({ messageId: '3', contextId: 'chat-1', replyToMessageId: '2', timestamp: Date.now() })
    cacheMessage({ messageId: '4', contextId: 'chat-1', replyToMessageId: '3', timestamp: Date.now() })

    const result = buildReplyChain('chat-1', '4')
    expect(result.chain).toEqual(['3', '4'])
    expect(result.isComplete).toBe(false)
    expect(result.brokenAt).toBe('2')
  })

  test('should isolate chains across different contexts', () => {
    // Same message IDs in different contexts should not collide
    cacheMessage({ messageId: '1', contextId: 'chat-A', text: 'Root in A', timestamp: Date.now() })
    cacheMessage({
      messageId: '2',
      contextId: 'chat-A',
      text: 'Reply in A',
      replyToMessageId: '1',
      timestamp: Date.now(),
    })

    cacheMessage({ messageId: '1', contextId: 'chat-B', text: 'Root in B', timestamp: Date.now() })
    cacheMessage({
      messageId: '2',
      contextId: 'chat-B',
      text: 'Reply in B',
      replyToMessageId: '1',
      timestamp: Date.now(),
    })

    const chainA = buildReplyChain('chat-A', '2')
    const chainB = buildReplyChain('chat-B', '2')

    expect(chainA.chain).toEqual(['1', '2'])
    expect(chainA.isComplete).toBe(true)
    expect(chainB.chain).toEqual(['1', '2'])
    expect(chainB.isComplete).toBe(true)
  })
})
