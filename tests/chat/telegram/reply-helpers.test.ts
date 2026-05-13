/**
 * Tests for Telegram reply helpers
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { InlineKeyboard } from 'grammy'

import { formatLlmOutput } from '../../../src/chat/telegram/format.js'
import {
  createReplyParamsBuilder,
  type ReplacementReplyContext,
  type ReplyContext,
  type ReplyParamsBuilder,
  sendReplacementButtonReply,
  sendReplacementTextReply,
} from '../../../src/chat/telegram/reply-helpers.js'
import { mockLogger } from '../../utils/test-helpers.js'

/** Create mock Context with message for tests */
function createMockContext(message: {
  message_id: number | undefined
  message_thread_id: number | undefined
}): ReplyContext {
  return { message }
}

type ReplacementCallOptions = Partial<{
  entities: ReturnType<typeof formatLlmOutput>['entities']
  reply_markup: InlineKeyboard
}>

describe('createReplyParamsBuilder', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('should handle explicit threadId parameter', () => {
    const ctx = createMockContext({
      message_id: 123,
      message_thread_id: undefined,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx, '456')
    const params = builder()

    expect(params).toEqual({
      message_id: 123,
      message_thread_id: 456,
    })
  })

  test('should use context threadId when no explicit threadId provided', () => {
    const ctx = createMockContext({
      message_id: 123,
      message_thread_id: 789,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx)
    const params = builder()

    expect(params).toEqual({
      message_id: 123,
      message_thread_id: 789,
    })
  })

  test('should prioritize explicit threadId over context threadId', () => {
    const ctx = createMockContext({
      message_id: 123,
      message_thread_id: 789,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx, '456')
    const params = builder()

    expect(params).toEqual({
      message_id: 123,
      message_thread_id: 456,
    })
  })

  test('should handle options.threadId as fallback', () => {
    const ctx = createMockContext({
      message_id: 123,
      message_thread_id: undefined,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx)
    const params = builder({ threadId: '999' })

    expect(params).toEqual({
      message_id: 123,
      message_thread_id: 999,
    })
  })

  test('should handle options.replyToMessageId', () => {
    const ctx = createMockContext({
      message_id: 123,
      message_thread_id: 789,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx, '456')
    const params = builder({ replyToMessageId: '999' })

    expect(params).toEqual({
      message_id: 999,
      message_thread_id: 456,
    })
  })

  test('should return undefined when no message_id exists', () => {
    const ctx = createMockContext({
      message_id: undefined,
      message_thread_id: 789,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx)
    const params = builder()

    expect(params).toBeUndefined()
  })
})

describe('sendButtonReply content formatting', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('markdown content is converted: no raw asterisks, entities produced', () => {
    const result = formatLlmOutput('**Bold title**\n*(not set)*')
    expect(result.text.includes('**')).toBe(false)
    expect(result.entities.length).toBeGreaterThan(0)
  })

  test('plain text passes through unchanged with no entities', () => {
    const result = formatLlmOutput('Plain text message')
    expect(result.text).toBe('Plain text message')
    expect(result.entities).toHaveLength(0)
  })
})

describe('replacement reply helpers', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('sendReplacementButtonReply edits the callback message with a new keyboard', async () => {
    let capturedText: string | undefined
    let capturedOptions: ReplacementCallOptions | undefined
    const editMessageText = mock((text: string, ...rest: [] | [ReplacementCallOptions]) => {
      const options = rest[0]
      capturedText = text
      capturedOptions = options
      return Promise.resolve(true)
    })
    const ctx: ReplacementReplyContext = { editMessageText }

    await sendReplacementButtonReply(ctx, '**Updated**', {
      buttons: [
        { text: 'First', callbackData: 'first' },
        { text: 'Second', callbackData: 'second' },
        { text: 'Third', callbackData: 'third' },
      ],
    })

    const formatted = formatLlmOutput('**Updated**')

    expect(editMessageText).toHaveBeenCalledTimes(1)

    expect(capturedText).toBe(formatted.text)
    expect(capturedOptions).toBeDefined()
    assert(capturedOptions !== undefined)
    expect(capturedOptions.entities).toEqual(formatted.entities)
    expect(capturedOptions.reply_markup).toBeInstanceOf(InlineKeyboard)

    const replyMarkup = capturedOptions.reply_markup
    expect(replyMarkup).toBeDefined()
    assert(replyMarkup !== undefined)
    const inlineKeyboard = replyMarkup.inline_keyboard

    expect(inlineKeyboard.flat()).toEqual([
      { text: 'First', callback_data: 'first' },
      { text: 'Second', callback_data: 'second' },
      { text: 'Third', callback_data: 'third' },
    ])
  })

  test('sendReplacementTextReply edits the callback message and clears any existing keyboard', async () => {
    let capturedText: string | undefined
    let capturedOptions: ReplacementCallOptions | undefined
    const editMessageText = mock((text: string, ...rest: [] | [ReplacementCallOptions]) => {
      const options = rest[0]
      capturedText = text
      capturedOptions = options
      return Promise.resolve(true)
    })
    const ctx: ReplacementReplyContext = { editMessageText }

    await sendReplacementTextReply(ctx, '**Updated**')

    const formatted = formatLlmOutput('**Updated**')

    expect(editMessageText).toHaveBeenCalledTimes(1)

    expect(capturedText).toBe(formatted.text)
    expect(capturedOptions).toBeDefined()
    assert(capturedOptions !== undefined)
    expect(capturedOptions.entities).toEqual(formatted.entities)
    expect(capturedOptions.reply_markup).toBeInstanceOf(InlineKeyboard)
    const replyMarkup = capturedOptions.reply_markup
    expect(replyMarkup).toBeDefined()
    assert(replyMarkup !== undefined)
    expect(replyMarkup.inline_keyboard).toEqual([])
  })
})
