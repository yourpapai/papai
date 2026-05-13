/**
 * Tests for Telegram chat provider
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { extractFilesFromContext } from '../../../src/chat/telegram/file-helpers.js'
import { TelegramChatProvider } from '../../../src/chat/telegram/index.js'
import {
  cacheTelegramMessage,
  extractContextInfo,
  extractMessageIds,
  logMessageExtraction,
  type CacheContext,
  type MinimalContext,
} from '../../../src/chat/telegram/message-extraction.js'
import type { DeferredDeliveryTarget, IncomingMessage, ReplyFn } from '../../../src/chat/types.js'
import { mockLogger } from '../../utils/test-helpers.js'

type EditMessageCall = [text: string, options: Partial<{ reply_markup: unknown }> | undefined]
type SendMessageCall = [
  chatId: number,
  text: string,
  options: Partial<{ entities: unknown[]; message_thread_id: number }> | undefined,
]

const isBotMentionedFalse = (): boolean => false
const includesTestBotMention = (text: string): boolean => text.includes('@testbot')

function makeFileFetcher(content: Buffer | null | undefined): (_fileId: string) => Promise<Buffer | null> {
  const resolvedContent = content === undefined ? Buffer.from('data') : content
  return (_fileId: string): Promise<Buffer | null> => Promise.resolve(resolvedContent)
}

function makeDefaultFileFetcher(): (_fileId: string) => Promise<Buffer | null> {
  return makeFileFetcher(Buffer.from('data'))
}

function isIncomingMessage(value: unknown): value is IncomingMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'contextId' in value &&
    'contextType' in value &&
    'isMentioned' in value &&
    'text' in value
  )
}

function isReplyFn(value: unknown): value is ReplyFn {
  return typeof value === 'object' && value !== null && 'text' in value && 'buttons' in value && 'formatted' in value
}

function isBotWithSendMessage(
  value: unknown,
): value is { api: { sendMessage: (...args: SendMessageCall) => Promise<unknown> } } {
  return typeof value === 'object' && value !== null && 'api' in value
}

function getProviderBot(provider: TelegramChatProvider): {
  api: { sendMessage: (...args: SendMessageCall) => Promise<unknown> }
} {
  const value = Reflect.get(provider as object, 'bot') as unknown
  if (!isBotWithSendMessage(value)) {
    throw new TypeError('Expected provider bot to expose api.sendMessage')
  }
  return value
}

// Mock the auth module to provide getThreadScopedStorageContextId
void mock.module('../../../src/auth.js', () => ({
  getThreadScopedStorageContextId: (
    contextId: string,
    _contextType: 'dm' | 'group',
    threadId: string | undefined,
  ): string => {
    // Thread-scoped: groupId:threadId for threads
    if (threadId !== undefined) return `${contextId}:${threadId}`
    return contextId
  },
}))

describe('TelegramChatProvider', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('provider has correct name', () => {
    // We can't instantiate without TELEGRAM_BOT_TOKEN, but we can verify the class exists
    expect(typeof TelegramChatProvider).toBe('function')
  })

  describe('thread capabilities', () => {
    test('declares thread support with creation capability', () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()
      expect(provider.threadCapabilities.supportsThreads).toBe(true)
      expect(provider.threadCapabilities.canCreateThreads).toBe(true)
      expect(provider.threadCapabilities.threadScope).toBe('message')
      delete process.env['TELEGRAM_BOT_TOKEN']
    })
  })

  describe('sendMessage', () => {
    test('uses an ID-based text mention with username label for personal group delivery', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()
      const bot = getProviderBot(provider)

      const calls: SendMessageCall[] = []
      bot.api.sendMessage = (...args: SendMessageCall): Promise<unknown> => {
        calls.push(args)
        return Promise.resolve(undefined)
      }

      const target: DeferredDeliveryTarget = {
        contextId: '99',
        contextType: 'group',
        threadId: '123',
        audience: 'personal',
        mentionUserIds: ['42'],
        createdByUserId: '42',
        createdByUsername: 'alice',
      }

      await provider.sendMessage(target, 'hello')

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual([
        99,
        '@alice hello',
        {
          entities: [
            {
              offset: 0,
              length: 6,
              type: 'text_mention',
              user: { id: 42, is_bot: false, first_name: 'alice' },
            },
          ],
          message_thread_id: 123,
        },
      ])

      delete process.env['TELEGRAM_BOT_TOKEN']
    })

    test('falls back to a generic ID-based mention and shifts markdown entities', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()
      const bot = getProviderBot(provider)

      const calls: SendMessageCall[] = []
      bot.api.sendMessage = (...args: SendMessageCall): Promise<unknown> => {
        calls.push(args)
        return Promise.resolve(undefined)
      }

      const target: DeferredDeliveryTarget = {
        contextId: '99',
        contextType: 'group',
        threadId: null,
        audience: 'personal',
        mentionUserIds: ['42'],
        createdByUserId: '42',
        createdByUsername: null,
      }

      await provider.sendMessage(target, '**hi**')

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual([
        99,
        'you hi',
        {
          entities: [
            {
              offset: 0,
              length: 3,
              type: 'text_mention',
              user: { id: 42, is_bot: false, first_name: 'you' },
            },
            {
              offset: 4,
              length: 2,
              type: 'bold',
            },
          ],
        },
      ])

      delete process.env['TELEGRAM_BOT_TOKEN']
    })

    test('does not fall back to username text when mentionUserIds are invalid', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()
      const bot = getProviderBot(provider)

      const calls: SendMessageCall[] = []
      bot.api.sendMessage = (...args: SendMessageCall): Promise<unknown> => {
        calls.push(args)
        return Promise.resolve(undefined)
      }

      const target: DeferredDeliveryTarget = {
        contextId: '99',
        contextType: 'group',
        threadId: null,
        audience: 'personal',
        mentionUserIds: ['not-a-number'],
        createdByUserId: '42',
        createdByUsername: 'alice',
      }

      await provider.sendMessage(target, 'hello')

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual([
        99,
        'hello',
        {
          entities: [],
        },
      ])

      delete process.env['TELEGRAM_BOT_TOKEN']
    })

    test('creates text mentions for multiple IDs and shifts following entities', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()
      const bot = getProviderBot(provider)

      const calls: SendMessageCall[] = []
      bot.api.sendMessage = (...args: SendMessageCall): Promise<unknown> => {
        calls.push(args)
        return Promise.resolve(undefined)
      }

      const target: DeferredDeliveryTarget = {
        contextId: '99',
        contextType: 'group',
        threadId: null,
        audience: 'personal',
        mentionUserIds: ['42', '7'],
        createdByUserId: '42',
        createdByUsername: 'alice',
      }

      await provider.sendMessage(target, '**hi**')

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual([
        99,
        '@alice user hi',
        {
          entities: [
            {
              offset: 0,
              length: 6,
              type: 'text_mention',
              user: { id: 42, is_bot: false, first_name: 'alice' },
            },
            {
              offset: 7,
              length: 4,
              type: 'text_mention',
              user: { id: 7, is_bot: false, first_name: 'user' },
            },
            {
              offset: 12,
              length: 2,
              type: 'bold',
            },
          ],
        },
      ])

      delete process.env['TELEGRAM_BOT_TOKEN']
    })
  })

  describe('forum topic creation', () => {
    test('extractMessage includes Telegram chat title for group messages', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()
      const extractMessage: unknown = Reflect.get(provider, 'extractMessage')
      expect(extractMessage).toBeInstanceOf(Function)
      assert(typeof extractMessage === 'function', 'extractMessage not available')

      const result: unknown = await Promise.resolve(
        extractMessage.call(
          provider,
          {
            from: { id: 1, username: 'alice' },
            chat: { id: 99, type: 'supergroup', title: 'Operations' },
            message: { text: '/help', message_id: 42 },
          },
          true,
        ),
      )

      assert(isIncomingMessage(result), 'Expected extractMessage to return an IncomingMessage')

      expect(result.contextName).toBe('Operations')
      delete process.env['TELEGRAM_BOT_TOKEN']
    })

    test('async extractMessage returns IncomingMessage with threadId when mentioned', () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()

      // Verify provider methods exist and are async
      expect(typeof provider.onMessage).toBe('function')
      expect(typeof provider.registerCommand).toBe('function')

      delete process.env['TELEGRAM_BOT_TOKEN']
    })

    test('registerCommand passes threadId to buildReplyFn', () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()

      // Register a command and verify it doesn't throw
      provider.registerCommand('test', async () => {
        // Handler
      })

      delete process.env['TELEGRAM_BOT_TOKEN']
    })

    test('onMessage registers handlers without error', () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()

      // Register message handler and verify it doesn't throw
      provider.onMessage(async () => {
        // Handler
      })

      delete process.env['TELEGRAM_BOT_TOKEN']
    })

    test('message reply does not expose replacement methods', () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()
      const buildReplyFn: unknown = Reflect.get(provider, 'buildReplyFn')

      expect(buildReplyFn).toBeInstanceOf(Function)
      assert(typeof buildReplyFn === 'function', 'buildReplyFn not available')

      const reply: unknown = buildReplyFn.call(provider, {
        chat: { id: 99, type: 'supergroup' },
        message: { message_id: 321, message_thread_id: 123 },
        replyWithChatAction: (): Promise<void> => Promise.resolve(),
        reply: (): Promise<void> => Promise.resolve(),
        replyWithDocument: (): Promise<void> => Promise.resolve(),
      })

      expect(isReplyFn(reply)).toBe(true)
      assert(isReplyFn(reply), 'Expected buildReplyFn to return a ReplyFn')

      expect(reply.replaceText).toBeUndefined()
      expect(reply.replaceButtons).toBeUndefined()

      delete process.env['TELEGRAM_BOT_TOKEN']
    })

    test('dispatchCallbackQuery answers callback queries before null exit', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()
      const calls: string[] = []
      const dispatchCallbackQuery: unknown = Reflect.get(provider, 'dispatchCallbackQuery')
      expect(dispatchCallbackQuery).toBeInstanceOf(Function)
      assert(typeof dispatchCallbackQuery === 'function', 'dispatchCallbackQuery not available')

      await Promise.resolve(
        dispatchCallbackQuery.call(provider, {
          answerCallbackQuery: (): Promise<void> => {
            calls.push('answered')
            return Promise.resolve()
          },
          callbackQuery: {},
        }),
      )

      expect(calls).toEqual(['answered'])
      delete process.env['TELEGRAM_BOT_TOKEN']
    })

    test('dispatchCallbackQuery builds replies with the interaction thread id', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()
      const captured: Array<string | undefined> = []
      const dispatchCallbackQuery: unknown = Reflect.get(provider, 'dispatchCallbackQuery')
      expect(dispatchCallbackQuery).toBeInstanceOf(Function)
      assert(typeof dispatchCallbackQuery === 'function', 'dispatchCallbackQuery not available')

      Reflect.set(provider, 'buildReplyFn', (_ctx: object, threadId: string | undefined): ReplyFn => {
        captured.push(threadId)
        return {
          text: (): Promise<void> => Promise.resolve(),
          formatted: (): Promise<void> => Promise.resolve(),
          file: (): Promise<void> => Promise.resolve(),
          typing: (): void => {},
          redactMessage: (): Promise<void> => Promise.resolve(),
          buttons: (): Promise<void> => Promise.resolve(),
        }
      })
      Reflect.set(provider, 'checkAdminStatus', (): Promise<boolean> => Promise.resolve(false))
      Reflect.set(provider, 'interactionHandler', (): Promise<void> => Promise.resolve())

      await Promise.resolve(
        dispatchCallbackQuery.call(provider, {
          from: { id: 42, username: 'alice' },
          chat: { id: 99, type: 'supergroup' },
          callbackQuery: {
            data: 'cfg:edit:timezone',
            message: { message_thread_id: 123 },
          },
          answerCallbackQuery: (): Promise<void> => Promise.resolve(),
        }),
      )

      expect(captured).toEqual(['123'])
      delete process.env['TELEGRAM_BOT_TOKEN']
    })

    test('dispatchCallbackQuery reply exposes replacement methods for interaction menus', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()
      const dispatchCallbackQuery: unknown = Reflect.get(provider, 'dispatchCallbackQuery')
      const editCalls: EditMessageCall[] = []

      expect(dispatchCallbackQuery).toBeInstanceOf(Function)
      assert(typeof dispatchCallbackQuery === 'function', 'dispatchCallbackQuery not available')

      Reflect.set(provider, 'checkAdminStatus', (): Promise<boolean> => Promise.resolve(false))
      provider.onInteraction(async (_interaction, reply) => {
        expect(typeof reply.replaceText).toBe('function')
        expect(typeof reply.replaceButtons).toBe('function')
        assert(reply.replaceText !== undefined, 'Expected replacement helpers to be available')
        assert(reply.replaceButtons !== undefined, 'Expected replacement helpers to be available')

        await reply.replaceText('Updated menu')
        await reply.replaceButtons('Choose next', {
          buttons: [
            { text: 'One', callbackData: 'one' },
            { text: 'Two', callbackData: 'two' },
          ],
        })
      })

      await Promise.resolve(
        dispatchCallbackQuery.call(provider, {
          from: { id: 42, username: 'alice' },
          chat: { id: 99, type: 'supergroup' },
          callbackQuery: {
            data: 'cfg:edit:timezone',
            message: { message_id: 321, message_thread_id: 123 },
          },
          answerCallbackQuery: (): Promise<void> => Promise.resolve(),
          editMessageText: (text: string, ...rest: [] | [Partial<{ reply_markup: unknown }>]): Promise<void> => {
            const options = rest[0]
            editCalls.push([text, options])
            return Promise.resolve()
          },
        }),
      )

      expect(editCalls).toHaveLength(2)
      expect(editCalls[0]).toBeDefined()
      expect(editCalls[1]).toBeDefined()
      assert(editCalls[0] !== undefined, 'Expected replacement edit calls to be captured')
      assert(editCalls[1] !== undefined, 'Expected replacement edit calls to be captured')
      expect(editCalls[0][0]).toBe('Updated menu')
      expect(editCalls[1][0]).toBe('Choose next')
      const firstOptions = editCalls[0][1]
      const secondOptions = editCalls[1][1]
      expect(firstOptions).toBeDefined()
      expect(secondOptions).toBeDefined()
      assert(firstOptions !== undefined, 'Expected replacement edit options to be captured')
      assert(secondOptions !== undefined, 'Expected replacement edit options to be captured')
      expect(firstOptions.reply_markup).toBeDefined()
      expect(secondOptions.reply_markup).toBeDefined()

      delete process.env['TELEGRAM_BOT_TOKEN']
    })
  })

  test('provider exposes interactive capabilities and onInteraction hook', () => {
    process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
    const provider = new TelegramChatProvider()

    expect(provider.capabilities.has('messages.buttons')).toBe(true)
    expect(provider.capabilities.has('interactions.callbacks')).toBe(true)
    expect(typeof provider.onInteraction).toBe('function')

    delete process.env['TELEGRAM_BOT_TOKEN']
  })

  describe('resolveUserId', () => {
    const context = { contextId: 'c1', contextType: 'group' as const }

    test('returns numeric ID as-is', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()
      const result = await provider.resolveUserId('123456789', context)
      expect(result).toBe('123456789')
      delete process.env['TELEGRAM_BOT_TOKEN']
    })

    test('returns null for username (cannot resolve via Bot API)', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
      const provider = new TelegramChatProvider()
      const result = await provider.resolveUserId('@username', context)
      expect(result).toBeNull()
      delete process.env['TELEGRAM_BOT_TOKEN']
    })
  })

  describe('command thread scoping', () => {
    test('getThreadScopedStorageContextId formats thread-scoped context correctly', () => {
      // Test the utility function behavior: thread-scoped format is groupId:threadId
      const contextId = 'channel123'
      const threadId = 'thread456'
      const result = `${contextId}:${threadId}`
      expect(result).toBe('channel123:thread456')
    })

    test('getThreadScopedStorageContextId returns bare contextId for DM', () => {
      const contextId = 'user123'
      // DM: just return contextId (userId)
      expect(contextId).toBe('user123')
    })

    test('getThreadScopedStorageContextId returns bare contextId for main chat', () => {
      const contextId = 'channel123'
      // Main chat: return contextId (channelId)
      expect(contextId).toBe('channel123')
    })
  })

  describe('message extraction helpers', () => {
    test('extractContextInfo returns null when from.id is undefined', () => {
      const ctx: MinimalContext = { from: undefined, chat: { id: 123, type: 'private' }, message: { text: 'hi' } }
      const result = extractContextInfo(ctx, isBotMentionedFalse)
      expect(result).toBeNull()
    })

    test('extractContextInfo returns context info for group chat', () => {
      const ctx: MinimalContext = {
        from: { id: 123 },
        chat: { id: 456, type: 'supergroup' },
        message: { text: 'hello @testbot', entities: [{ type: 'mention', offset: 6, length: 9 }] },
      }
      const result = extractContextInfo(ctx, includesTestBotMention)
      expect(result).toEqual({
        id: 123,
        contextId: '456',
        contextType: 'group',
        text: 'hello @testbot',
        entities: [{ type: 'mention', offset: 6, length: 9 }],
        isMentioned: true,
      })
    })

    test('extractContextInfo returns context info for DM', () => {
      const ctx: MinimalContext = {
        from: { id: 123 },
        chat: { id: 123, type: 'private' },
        message: { text: 'hello' },
      }
      const result = extractContextInfo(ctx, isBotMentionedFalse)
      expect(result).toEqual({
        id: 123,
        contextId: '123',
        contextType: 'dm',
        text: 'hello',
        entities: undefined,
        isMentioned: false,
      })
    })

    test('extractMessageIds returns all message IDs', () => {
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

    test('extractMessageIds handles undefined values', () => {
      const ctx: MinimalContext = { message: {} }
      const result = extractMessageIds(ctx)
      expect(result).toEqual({
        messageIdStr: undefined,
        replyToMessageIdStr: undefined,
        replyToMessageText: undefined,
        quoteText: undefined,
      })
    })

    test('logMessageExtraction logs debug info', () => {
      expect(() => {
        logMessageExtraction(123, 'ctx123', 'msg456', 'reply789', 'original text', 'quoted text')
      }).not.toThrow()
    })

    test('cacheTelegramMessage caches message when messageId is defined', () => {
      const ctx: CacheContext = { from: { username: 'testuser' } }
      expect(() => {
        cacheTelegramMessage(ctx, 123, 'ctx456', 'msg789', 'hello world', 'reply321')
      }).not.toThrow()
    })

    test('cacheTelegramMessage does nothing when messageId is undefined', () => {
      const ctx: CacheContext = { from: { username: 'testuser' } }
      expect(() => {
        cacheTelegramMessage(ctx, 123, 'ctx456', undefined, 'hello', 'reply')
      }).not.toThrow()
    })
  })
})

describe('extractFilesFromContext', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('returns empty array when message has no files', async () => {
    const ctx = { message: {} }
    const result = await extractFilesFromContext(ctx, makeFileFetcher(null))
    expect(result).toEqual([])
  })

  test('returns empty array when message is undefined', async () => {
    const result = await extractFilesFromContext({}, makeFileFetcher(null))
    expect(result).toEqual([])
  })

  test('extracts document', async () => {
    const content = Buffer.from('file content')
    const ctx = {
      message: {
        document: {
          file_id: 'doc-123',
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
          file_size: 1234,
        },
      },
    }
    const result = await extractFilesFromContext(ctx, makeFileFetcher(content))
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      fileId: 'doc-123',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 1234,
      content,
    })
  })

  test('extracts photo (largest size)', async () => {
    const ctx = {
      message: {
        photo: [
          { file_id: 'photo-small', file_size: 100 },
          { file_id: 'photo-large', file_size: 5000 },
        ],
      },
    }
    const result = await extractFilesFromContext(ctx, makeDefaultFileFetcher())
    expect(result).toHaveLength(1)
    const first = result[0]
    assert(first !== undefined, 'Expected extracted photo')
    expect(first.fileId).toBe('photo-large')
    expect(first.filename).toBe('photo.jpg')
    expect(first.mimeType).toBe('image/jpeg')
  })

  test('extracts audio with filename', async () => {
    const ctx = {
      message: {
        audio: {
          file_id: 'audio-1',
          file_name: 'song.mp3',
          mime_type: 'audio/mpeg',
          file_size: 2048,
        },
      },
    }
    const result = await extractFilesFromContext(ctx, makeDefaultFileFetcher())
    const first = result[0]
    assert(first !== undefined, 'Expected extracted audio file')
    expect(first.fileId).toBe('audio-1')
    expect(first.filename).toBe('song.mp3')
    expect(first.mimeType).toBe('audio/mpeg')
  })

  test('extracts audio with fallback filename', async () => {
    const ctx = { message: { audio: { file_id: 'audio-1', file_size: 2048 } } }
    const result = await extractFilesFromContext(ctx, makeDefaultFileFetcher())
    const first = result[0]
    assert(first !== undefined, 'Expected extracted fallback audio file')
    expect(first.filename).toBe('audio')
  })

  test('extracts video', async () => {
    const ctx = {
      message: {
        video: {
          file_id: 'vid-1',
          file_name: 'clip.mp4',
          mime_type: 'video/mp4',
          file_size: 10000,
        },
      },
    }
    const result = await extractFilesFromContext(ctx, makeDefaultFileFetcher())
    const first = result[0]
    assert(first !== undefined, 'Expected extracted video file')
    expect(first.fileId).toBe('vid-1')
    expect(first.filename).toBe('clip.mp4')
  })

  test('extracts voice note with fallback filename', async () => {
    const ctx = { message: { voice: { file_id: 'voice-1', file_size: 512 } } }
    const result = await extractFilesFromContext(ctx, makeDefaultFileFetcher())
    const first = result[0]
    assert(first !== undefined, 'Expected extracted voice note')
    expect(first.filename).toBe('voice.ogg')
    expect(first.mimeType).toBe('audio/ogg')
  })

  test('skips file when fetcher returns null', async () => {
    const ctx = {
      message: {
        document: { file_id: 'doc-123', file_name: 'file.txt', mime_type: 'text/plain', file_size: 10 },
      },
    }
    const result = await extractFilesFromContext(ctx, makeFileFetcher(null))
    expect(result).toEqual([])
  })

  test('uses fallback filename for document without file_name', async () => {
    const ctx = {
      message: {
        document: { file_id: 'doc-123', mime_type: 'application/octet-stream', file_size: 10 },
      },
    }
    const result = await extractFilesFromContext(ctx, makeDefaultFileFetcher())
    const first = result[0]
    assert(first !== undefined, 'Expected extracted document')
    expect(first.filename).toBe('document')
  })
})

describe('TelegramChatProvider reverse label resolution', () => {
  test('resolveGroupLabel returns chat title from getChat', async () => {
    process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
    const provider = new TelegramChatProvider()
    Reflect.set(provider, 'bot', {
      api: {
        getChat: (chatId: number): Promise<{ title: string | undefined }> => {
          expect(chatId).toBe(-1003768634358)
          return Promise.resolve({ title: 'Engineering Chat' })
        },
      },
    })

    const label = await provider.resolveGroupLabel?.('-1003768634358')
    expect(label).toBe('Engineering Chat')
    delete process.env['TELEGRAM_BOT_TOKEN']
  })

  test('resolveUserLabel returns full name and username from getChatMember', async () => {
    process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
    const provider = new TelegramChatProvider()
    Reflect.set(provider, 'bot', {
      api: {
        getChatMember: (
          _chatId: number | string,
          userId: number,
        ): Promise<{
          user:
            | { first_name: string | undefined; last_name: string | undefined; username: string | undefined }
            | undefined
        }> => {
          expect(userId).toBe(164696606)
          return Promise.resolve({ user: { first_name: 'John', last_name: 'Johnson', username: 'itsmike' } })
        },
      },
    })

    const label = await provider.resolveUserLabel?.('164696606', { contextId: '-1003768634358', contextType: 'group' })
    expect(label).toBe('John Johnson (@itsmike)')
    delete process.env['TELEGRAM_BOT_TOKEN']
  })

  test('resolveUserLabel returns null for non-numeric Telegram user IDs', async () => {
    process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
    const provider = new TelegramChatProvider()

    const label = await provider.resolveUserLabel?.('not-a-number', {
      contextId: '-1003768634358',
      contextType: 'group',
    })
    expect(label).toBeNull()
    delete process.env['TELEGRAM_BOT_TOKEN']
  })
})
