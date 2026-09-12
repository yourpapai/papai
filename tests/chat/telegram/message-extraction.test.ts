// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for Telegram message extraction helpers
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  extractContextInfo,
  extractMessageIds,
  logMessageExtraction,
  type MinimalContext,
} from '../../../src/chat/telegram/message-extraction.js'
import { logger, logMultistream } from '../../../src/logger.js'
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
      const ctx: MinimalContext = {
        from: undefined,
        chat: { id: 123, type: 'private' },
        message: { text: 'hi' },
      }
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
          reply_to_message: { message_id: 50, from: { id: 77 }, text: 'original message' },
          quote: { text: 'quoted text' },
        },
      }
      const result = extractMessageIds(ctx)
      expect(result).toEqual({
        messageIdStr: '100',
        replyToMessageIdStr: '50',
        replyToAuthorIdStr: '77',
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
        replyToAuthorIdStr: undefined,
        replyToMessageText: undefined,
        quoteText: undefined,
      })
    })
  })

  describe('logMessageExtraction', () => {
    test('does not throw when called', () => {
      expect(() => {
        logMessageExtraction(123, 'ctx456', 'msg789', 'reply321', 'original text', 'quoted text', '777')
      }).not.toThrow()
    })
  })
})

describe('logMessageExtraction log attribution', () => {
  // No mockLogger here: the module-bound child logger is the real pino instance,
  // so attribution is asserted against actual egress (mirrors reply-context-helpers.test.ts).
  test('attributes reply/quote previews to the parent author, not the replying user', () => {
    const logLines: string[] = []
    logMultistream.add({ level: 'debug', stream: { write: (chunk: string): void => void logLines.push(chunk) } })
    logger.level = 'debug'
    try {
      logMessageExtraction(42, 'ctx-1', '100', '50', 'secret parent text', 'secret quote', '77')
    } finally {
      logger.level = 'silent'
    }
    const entry = logLines.find((line) => line.includes('"msg":"Extracting Telegram message with reply/quote data"'))
    expect(entry, 'expected an extraction debug log entry').toBeDefined()
    expect(entry).toContain('"chatUserId":"77"')
    expect(entry).not.toContain('"chatUserId":"42"')
  })

  test('keeps the sender attribution when no parent text is carried', () => {
    const logLines: string[] = []
    logMultistream.add({ level: 'debug', stream: { write: (chunk: string): void => void logLines.push(chunk) } })
    logger.level = 'debug'
    try {
      logMessageExtraction(42, 'ctx-1', '100', '50', undefined, undefined, '77')
    } finally {
      logger.level = 'silent'
    }
    const entry = logLines.find((line) => line.includes('"msg":"Extracting Telegram message with reply/quote data"'))
    expect(entry, 'expected an extraction debug log entry').toBeDefined()
    expect(entry).toContain('"chatUserId":"42"')
  })

  test('leaves chatUserId unset when parent text has no known author', () => {
    const logLines: string[] = []
    logMultistream.add({ level: 'debug', stream: { write: (chunk: string): void => void logLines.push(chunk) } })
    logger.level = 'debug'
    try {
      logMessageExtraction(42, 'ctx-1', '100', '50', 'secret parent text', undefined, undefined)
    } finally {
      logger.level = 'silent'
    }
    const entry = logLines.find((line) => line.includes('"msg":"Extracting Telegram message with reply/quote data"'))
    expect(entry, 'expected an extraction debug log entry').toBeDefined()
    expect(entry).not.toContain('"chatUserId"')
  })
})
