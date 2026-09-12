// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for Telegram reply helpers
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { InlineKeyboard } from 'grammy'

import { formatLlmOutput } from '../../../src/chat/telegram/format.js'
import {
  type ButtonReplyCapableContext,
  createReplyParamsBuilder,
  type ReplacementReplyContext,
  type ReplyContext,
  type ReplyParamsBuilder,
  type SentButtonMessage,
  sendButtonReply,
  sendFormattedReply,
  sendReplacementButtonReply,
  sendReplacementTextReply,
} from '../../../src/chat/telegram/reply-helpers.js'
import { createTrackedLoggerMock } from '../../utils/logger-mock.js'
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

describe('sendFormattedReply link preview', () => {
  beforeEach(() => {
    mockLogger()
  })

  const makeReplyCtx = (): { ctx: ButtonReplyCapableContext; calls: Array<Record<string, unknown> | undefined> } => {
    const calls: Array<Record<string, unknown> | undefined> = []
    const ctx: ButtonReplyCapableContext = {
      reply: (_text: string, opts?: Record<string, unknown>): Promise<SentButtonMessage> => {
        calls.push(opts)
        return Promise.resolve({ message_id: 1, chat: { id: 1 } })
      },
    }
    return { ctx, calls }
  }

  test('omits link_preview_options by default', async () => {
    const { ctx, calls } = makeReplyCtx()
    await sendFormattedReply(ctx, 'hello https://example.com', () => undefined, undefined)
    expect(calls[0]?.['link_preview_options']).toBeUndefined()
  })

  test('disables link preview when disableLinkPreview is set', async () => {
    const { ctx, calls } = makeReplyCtx()
    await sendFormattedReply(ctx, 'hello https://example.com', () => undefined, { disableLinkPreview: true })
    expect(calls[0]?.['link_preview_options']).toEqual({ is_disabled: true })
  })
})

describe('sendFormattedReply returns sent message id', () => {
  beforeEach(() => {
    mockLogger()
  })
  test('returns the sent message id and chat id', async () => {
    const ctx: ButtonReplyCapableContext = {
      reply: (): Promise<SentButtonMessage> => Promise.resolve({ message_id: 42, chat: { id: 7 } }),
    }

    const sent = await sendFormattedReply(ctx, 'hello', () => undefined, undefined)

    expect(sent.messageId).toBe(42)
    expect(sent.chatId).toBe(7)
  })
})

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

describe('sendButtonReply returns sent message', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('returns the message object resolved by ctx.reply', async () => {
    const sentMessage: SentButtonMessage = { message_id: 42, chat: { id: 7 } }
    const fakeCtx: ButtonReplyCapableContext = {
      reply: (_text: string, _opts?: Record<string, unknown>): Promise<SentButtonMessage> =>
        Promise.resolve(sentMessage),
    }

    const result = await sendButtonReply(fakeCtx, 'hi', () => undefined, { buttons: [] })

    expect(result.message_id).toBe(42)
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

/** Reply context whose sends resolve per-call outcomes (Error entries reject) — module scope for no-conditional-in-test. */
function makeChunkReplyCtx(outcomes: ReadonlyArray<SentButtonMessage | Error>): {
  ctx: ButtonReplyCapableContext
  texts: string[]
  optionCalls: Array<Record<string, unknown> | undefined>
} {
  const texts: string[] = []
  const optionCalls: Array<Record<string, unknown> | undefined> = []
  let callIndex = 0
  const ctx: ButtonReplyCapableContext = {
    reply: (text: string, opts?: Record<string, unknown>): Promise<SentButtonMessage> => {
      const current = callIndex
      callIndex += 1
      texts.push(text)
      optionCalls.push(opts)
      const outcome = outcomes[current]
      if (outcome === undefined) throw new Error(`No scripted reply outcome for call ${current}`)
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome)
    },
  }
  return { ctx, texts, optionCalls }
}

describe('sendFormattedReply chunked delivery', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('sends ordered in-bounds chunks with the same reply parameters and returns the last send', async () => {
    const { ctx, texts, optionCalls } = makeChunkReplyCtx([
      { message_id: 11, chat: { id: 5 } },
      { message_id: 22, chat: { id: 5 } },
    ])
    const buildReplyParams: ReplyParamsBuilder = () => ({ message_id: 77, message_thread_id: 44 })

    const sent = await sendFormattedReply(ctx, 'x'.repeat(5000), buildReplyParams, undefined)

    expect(texts.length).toBe(2)
    for (const text of texts) {
      expect(text.length).toBeLessThanOrEqual(4096)
    }
    expect(texts.join('')).toBe('x'.repeat(5000))
    for (const opts of optionCalls) {
      expect(opts?.['reply_parameters']).toEqual({ message_id: 77, message_thread_id: 44 })
    }
    expect(sent).toEqual({ messageId: 22, chatId: 5 })
  })

  test('carries the link-preview option on every chunk', async () => {
    const { ctx, optionCalls } = makeChunkReplyCtx([
      { message_id: 1, chat: { id: 1 } },
      { message_id: 2, chat: { id: 1 } },
    ])
    await sendFormattedReply(ctx, 'x'.repeat(5000), () => undefined, { disableLinkPreview: true })
    expect(optionCalls.length).toBe(2)
    for (const opts of optionCalls) {
      expect(opts?.['link_preview_options']).toEqual({ is_disabled: true })
    }
  })

  test('sends a single message with entities when within the limit', async () => {
    const { ctx, texts, optionCalls } = makeChunkReplyCtx([{ message_id: 42, chat: { id: 7 } }])
    const sent = await sendFormattedReply(ctx, '**hello**', () => undefined, undefined)
    expect(texts).toEqual(['hello'])
    expect(optionCalls[0]?.['entities']).toEqual([{ offset: 0, length: 5, type: 'bold' }])
    expect(sent).toEqual({ messageId: 42, chatId: 7 })
  })

  test('shifts entities fully inside a later chunk into its window', async () => {
    const { ctx, texts, optionCalls } = makeChunkReplyCtx([
      { message_id: 1, chat: { id: 1 } },
      { message_id: 2, chat: { id: 1 } },
    ])
    const markdown = 'x'.repeat(4100) + '**bold**' + 'y'.repeat(200)

    await sendFormattedReply(ctx, markdown, () => undefined, undefined)

    expect(texts.length).toBe(2)
    expect(optionCalls[0]?.['entities']).toEqual([])
    expect(optionCalls[1]?.['entities']).toEqual([{ offset: 4, length: 4, type: 'bold' }])
    expect(texts.join('')).toBe('x'.repeat(4100) + 'bold' + 'y'.repeat(200))
  })

  test('drops entities spanning a chunk cut', async () => {
    const { ctx, texts, optionCalls } = makeChunkReplyCtx([
      { message_id: 1, chat: { id: 1 } },
      { message_id: 2, chat: { id: 1 } },
    ])
    const markdown = 'x'.repeat(4094) + '**abcdef**' + 'y'.repeat(200)

    await sendFormattedReply(ctx, markdown, () => undefined, undefined)

    expect(texts.length).toBe(2)
    expect(texts[0]!.length).toBe(4096)
    expect(optionCalls[0]?.['entities']).toEqual([])
    expect(optionCalls[1]?.['entities']).toEqual([])
    expect(texts.join('')).toBe('x'.repeat(4094) + 'abcdef' + 'y'.repeat(200))
  })
})

// reply-helpers.ts binds its child logger at module-eval time, so force a fresh
// evaluation under the tracked mock with a cache-busting query (mirrors
// tests/llm-orchestrator-send.test.ts).
const tracked = createTrackedLoggerMock()
void mock.module('../../../src/logger.js', () => ({ logger: tracked.logger, getLogLevel: tracked.getLogLevel }))

type HelpersModule = typeof import('../../../src/chat/telegram/reply-helpers.js')
const isHelpersModule = (value: unknown): value is HelpersModule =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'sendFormattedReply') === 'function'
const loadedHelpers: unknown = await import(`../../../src/chat/telegram/reply-helpers.js?t=${crypto.randomUUID()}`)
if (!isHelpersModule(loadedHelpers)) {
  throw new Error('reply-helpers module did not export expected shape')
}
const { sendFormattedReply: bustedSendFormattedReply } = loadedHelpers

describe('sendFormattedReply chunk failure (tracked logger, busted module)', () => {
  test('a failing chunk logs a warn and later chunks still send', async () => {
    const { ctx, texts } = makeChunkReplyCtx([
      { message_id: 11, chat: { id: 5 } },
      new Error('telegram down'),
      { message_id: 33, chat: { id: 5 } },
    ])

    const sent = await bustedSendFormattedReply(ctx, 'x'.repeat(9000), () => undefined, undefined)

    expect(texts.length).toBe(3)
    expect(sent).toEqual({ messageId: 33, chatId: 5 })
    const warn = tracked.getCallsByLevel('warn').find((entry) => entry.args[1] === 'Telegram chunk send failed')
    expect(warn).toBeDefined()
  })
})
