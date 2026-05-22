// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for Telegram message extraction helpers
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  cacheTelegramMessage,
  extractContextInfo,
  extractMessageIds,
  logMessageExtraction,
  type CacheContext,
  type MinimalContext,
} from '../../../src/chat/telegram/message-extraction.js'
import { mockLogger, mockMessageCache } from '../../utils/test-helpers.js'

describe('message-extraction', () => {
  beforeEach(() => {
    mockLogger()
    mockMessageCache()
  })

  describe('MinimalContext interface', () => {
    test('can be constructed with minimal properties', () => {
      const ctx: MinimalContext = {
        from: { id: 123, username: 'testuser' },
        chat: { id: 456, type: 'private' },
        message: { text: 'hello' },
      }
      expect(ctx.from?.id).toBe(123)
      expect(ctx.chat?.type).toBe('private')
      expect(ctx.message?.text).toBe('hello')
    })

    test('allows optional properties to be undefined', () => {
      const ctx: MinimalContext = {}
      expect(ctx.from).toBeUndefined()
      expect(ctx.chat).toBeUndefined()
      expect(ctx.message).toBeUndefined()
    })

    test('supports message with reply and quote data', () => {
      const ctx: MinimalContext = {
        from: { id: 123 },
        chat: { id: 456 },
        message: {
          message_id: 100,
          text: 'reply text',
          reply_to_message: { message_id: 50, text: 'original' },
          quote: { text: 'quoted' },
        },
      }
      expect(ctx.message?.message_id).toBe(100)
      expect(ctx.message?.reply_to_message?.text).toBe('original')
      expect(ctx.message?.quote?.text).toBe('quoted')
    })
  })

  describe('extractContextInfo', () => {
    const isBotMentioned = (text: string): boolean => text.includes('@bot')

    test('returns null when from.id is undefined', () => {
      const ctx: MinimalContext = { from: undefined, chat: { id: 123, type: 'private' }, message: { text: 'hi' } }
      const result = extractContextInfo(ctx, isBotMentioned)
      expect(result).toBeNull()
    })

    test('returns dm context info', () => {
      const ctx: MinimalContext = {
        from: { id: 123 },
        chat: { id: 123, type: 'private' },
        message: { text: 'hello' },
      }
      const result = extractContextInfo(ctx, isBotMentioned)
      expect(result).toEqual({
        id: 123,
        contextId: '123',
        contextType: 'dm',
        text: 'hello',
        entities: undefined,
        isMentioned: false,
      })
    })

    test('returns group context info', () => {
      const ctx: MinimalContext = {
        from: { id: 123 },
        chat: { id: 456, type: 'supergroup' },
        message: { text: 'hi @bot', entities: [{ type: 'mention', offset: 3, length: 4 }] },
      }
      const result = extractContextInfo(ctx, isBotMentioned)
      expect(result).toEqual({
        id: 123,
        contextId: '456',
        contextType: 'group',
        text: 'hi @bot',
        entities: [{ type: 'mention', offset: 3, length: 4 }],
        isMentioned: true,
      })
    })

    test('handles caption for media messages', () => {
      const ctx: MinimalContext = {
        from: { id: 123 },
        chat: { id: 456, type: 'group' },
        message: { caption: 'photo caption', caption_entities: [] },
      }
      const result = extractContextInfo(ctx, isBotMentioned)
      expect(result?.text).toBe('photo caption')
      expect(result?.entities).toEqual([])
    })
  })

  describe('extractMessageIds', () => {
    test('returns all message IDs from context', () => {
      const ctx: MinimalContext = {
        message: {
          message_id: 100,
          reply_to_message: { message_id: 50, text: 'original message' },
          quote: { text: 'quoted text' },
        },
      }
      const result = extractMessageIds(ctx)
      expect(result).toEqual({
        messageIdStr: '100',
        replyToMessageIdStr: '50',
        replyToMessageText: 'original message',
        quoteText: 'quoted text',
      })
    })

    test('handles undefined values gracefully', () => {
      const ctx: MinimalContext = { message: {} }
      const result = extractMessageIds(ctx)
      expect(result).toEqual({
        messageIdStr: undefined,
        replyToMessageIdStr: undefined,
        replyToMessageText: undefined,
        quoteText: undefined,
      })
    })
  })

  describe('logMessageExtraction', () => {
    test('does not throw when called', () => {
      expect(() => {
        logMessageExtraction(123, 'ctx456', 'msg789', 'reply321', 'original text', 'quoted text')
      }).not.toThrow()
    })
  })

  describe('CacheContext interface', () => {
    test('can have from with username', () => {
      const ctx: CacheContext = { from: { username: 'testuser' } }
      expect(ctx.from?.username).toBe('testuser')
    })

    test('allows from to be undefined', () => {
      const ctx: CacheContext = {}
      expect(ctx.from).toBeUndefined()
    })
  })

  describe('cacheTelegramMessage', () => {
    test('caches message when messageId is defined', () => {
      const ctx: CacheContext = { from: { username: 'testuser' } }
      expect(() => {
        cacheTelegramMessage(ctx, 123, 'ctx456', 'msg789', 'hello world', 'reply321')
      }).not.toThrow()
    })

    test('does nothing when messageId is undefined', () => {
      const ctx: CacheContext = { from: { username: 'testuser' } }
      expect(() => {
        cacheTelegramMessage(ctx, 123, 'ctx456', undefined, 'hello', 'reply')
      }).not.toThrow()
    })

    test('handles ctx without from property', () => {
      const ctx: CacheContext = {}
      expect(() => {
        cacheTelegramMessage(ctx, 123, 'ctx456', 'msg789', 'hello world', 'reply321')
      }).not.toThrow()
    })
  })
})
