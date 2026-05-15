// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { extractReplyContext } from '../../../src/chat/telegram/index.js'
import { cacheMessage } from '../../../src/message-cache/index.js'
import { clearMessageCache, mockMessageCache } from '../../utils/test-helpers.js'

// Minimal interface for testing - matches the ExtractReplyContextInput interface
interface MockContext {
  message?: {
    message_id?: number
    text?: string
    message_thread_id?: number
    reply_to_message?: {
      message_id?: number
      from?: { id?: number; username?: string } | undefined
      text?: string
    }
    quote?: { text?: string }
  }
}

describe('extractReplyContext', () => {
  beforeEach(() => {
    mockMessageCache()
    clearMessageCache()
  })

  test('returns undefined when message is not a reply', () => {
    const ctx: MockContext = {
      message: {
        message_id: 100,
        text: 'Hello',
      },
    }

    const result = extractReplyContext(ctx, 'chat-1')

    expect(result).toBeUndefined()
  })

  test('extracts reply context from reply_to_message', () => {
    const ctx: MockContext = {
      message: {
        message_id: 100,
        text: 'Reply message',
        reply_to_message: {
          message_id: 50,
          from: { id: 123, username: 'originaluser' },
          text: 'Original message',
        },
      },
    }

    const result = extractReplyContext(ctx, 'chat-1')

    expect(result).toBeDefined()
    expect(result?.messageId).toBe('50')
    expect(result?.authorId).toBe('123')
    expect(result?.authorUsername).toBe('originaluser')
    expect(result?.text).toBe('Original message')
  })

  test('extracts quote text from reply', () => {
    const ctx: MockContext = {
      message: {
        message_id: 100,
        text: 'Reply with quote',
        reply_to_message: {
          message_id: 50,
          from: { id: 123, username: 'user' },
          text: 'Full original message',
        },
        quote: {
          text: 'Quoted portion',
        },
      },
    }

    const result = extractReplyContext(ctx, 'chat-1')

    expect(result?.quotedText).toBe('Quoted portion')
  })

  test('extracts message_thread_id for forum topics', () => {
    const ctx: MockContext = {
      message: {
        message_id: 100,
        text: 'Reply in thread',
        message_thread_id: 999,
        reply_to_message: {
          message_id: 50,
          from: { id: 123, username: 'user' },
          text: 'Original',
        },
      },
    }

    const result = extractReplyContext(ctx, 'chat-1')

    expect(result?.threadId).toBe('999')
  })

  test('handles missing from field on reply_to_message', () => {
    const ctx: MockContext = {
      message: {
        message_id: 100,
        text: 'Reply to system message',
        reply_to_message: {
          message_id: 50,
          from: undefined,
          text: 'System message',
        },
      },
    }

    const result = extractReplyContext(ctx, 'chat-1')

    expect(result?.messageId).toBe('50')
    expect(result?.authorId).toBeUndefined()
    expect(result?.authorUsername).toBeNull()
    expect(result?.text).toBe('System message')
  })

  test('returns chain and chainSummary when reply chain exists', () => {
    // Pre-populate the message cache to simulate existing chain
    cacheMessage({
      messageId: '40',
      contextId: 'chat-1',
      authorId: 'user1',
      authorUsername: 'user1',
      text: 'First message',
      timestamp: Date.now(),
    })
    cacheMessage({
      messageId: '50',
      contextId: 'chat-1',
      authorId: 'user2',
      authorUsername: 'user2',
      text: 'Second message',
      replyToMessageId: '40',
      timestamp: Date.now(),
    })

    const ctx: MockContext = {
      message: {
        message_id: 100,
        text: 'Third message',
        reply_to_message: {
          message_id: 50,
          from: { id: 123, username: 'user3' },
          text: 'Second message',
        },
      },
    }

    const result = extractReplyContext(ctx, 'chat-1')

    expect(result?.chain).toBeDefined()
    expect(result?.chainSummary).toBeDefined()
  })
})
