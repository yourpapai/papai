import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { tool } from 'ai'
import { z } from 'zod'

import { _userCaches, setCachedTools } from '../../src/cache.js'
import type { ChatProvider, CommandHandler, ContextSnapshot } from '../../src/chat/types.js'
import type { ContextCommandDeps } from '../../src/commands/context.js'
import { createMockProvider } from '../tools/mock-provider.js'
import {
  createAuth,
  createDmMessage,
  createMockChat,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

function captureCommand(commands: Map<string, CommandHandler>): CommandHandler {
  const handler = commands.get('context')
  if (handler === undefined) {
    throw new Error('context command not registered')
  }
  return handler
}

const snapshotDeps = (overrides?: Partial<ContextCommandDeps>): ContextCommandDeps => ({
  collectContext: (): ContextSnapshot => ({
    modelName: 'gpt-4o',
    sections: [
      { label: 'System prompt', tokens: 1000 },
      { label: 'Memory context', tokens: 500 },
      { label: 'Conversation history', tokens: 2000 },
      { label: 'Tools', tokens: 3000 },
    ],
    totalTokens: 6500,
    maxTokens: 128_000,
    approximate: false,
  }),
  ...overrides,
})

async function registerContextHandler(
  commands: Map<string, CommandHandler>,
  chat: ChatProvider,
  deps: ContextCommandDeps = snapshotDeps(),
): Promise<CommandHandler> {
  const { registerContextCommand } = await import('../../src/commands/context.js')
  registerContextCommand(chat, deps)
  return captureCommand(commands)
}

function createFormattedContextChat(
  commands: Map<string, CommandHandler>,
  content = '**context summary**',
): ChatProvider {
  return {
    ...createMockChat({ commandHandlers: commands }),
    renderContext: () => ({ method: 'formatted', content }),
  }
}

function getCatalogReplies(textCalls: readonly string[]): readonly string[] {
  return textCalls.slice(1)
}

describe('registerContextCommand', () => {
  beforeEach(async () => {
    mockLogger()
    _userCaches.clear()
    await setupTestDb()
  })

  test('builds full direct tool definitions on cache miss', async () => {
    const provider = createMockProvider()
    void mock.module('../../src/providers/factory.js', () => ({
      buildProviderForUser: (): typeof provider => provider,
    }))

    const commands = new Map<string, CommandHandler>()
    const chat = createMockChat({ commandHandlers: commands })
    let activeToolDefinitions: Record<string, unknown> | null = null

    const handler = await registerContextHandler(
      commands,
      chat,
      snapshotDeps({
        collectContext: (_contextId, collectorDeps): ContextSnapshot => {
          activeToolDefinitions = collectorDeps.getActiveToolDefinitions()
          return {
            modelName: 'gpt-4o',
            sections: [],
            totalTokens: 0,
            maxTokens: 128_000,
            approximate: false,
          }
        },
      }),
    )

    const { reply } = createMockReply()
    const auth = createAuth('user1')

    await handler(createDmMessage('user1'), reply, auth)

    expect(activeToolDefinitions).not.toBeNull()
    expect(activeToolDefinitions).toHaveProperty('create_task')
    expect(activeToolDefinitions).not.toHaveProperty('papai_tool')
  })

  test('available to non-admin users', async () => {
    const commands = new Map<string, CommandHandler>()
    const provider = createMockChat({ commandHandlers: commands })

    const handler = await registerContextHandler(commands, provider)
    const { reply, textCalls } = createMockReply()
    const msg = createDmMessage('some-regular-user')
    const auth = createAuth('some-regular-user')

    await handler(msg, reply, auth)

    expect(textCalls.length).toBeGreaterThan(0)
  })

  test('does not reject unauthorized users before the bot dispatcher (auth gate is upstream)', async () => {
    const commands = new Map<string, CommandHandler>()
    const chat = createMockChat({ commandHandlers: commands })

    const handler = await registerContextHandler(commands, chat)
    const { reply, textCalls } = createMockReply()
    const msg = createDmMessage('user1')
    const auth = createAuth('user1', { allowed: false })

    await handler(msg, reply, auth)

    expect(textCalls.length).toBe(0)
  })

  describe('tool catalog follow-up', () => {
    test('emits live direct tool catalog pages after the summary response', async () => {
      const provider = createMockProvider()
      void mock.module('../../src/providers/factory.js', () => ({
        buildProviderForUser: (): typeof provider => provider,
      }))
      const commands = new Map<string, CommandHandler>()
      const chat = createFormattedContextChat(commands)
      const handler = await registerContextHandler(commands, chat)

      const { reply, textCalls } = createMockReply()

      await handler(createDmMessage('user1'), reply, createAuth('user1'))

      const catalogReplies = getCatalogReplies(textCalls)

      expect(textCalls[0]).toBe('**context summary**')
      expect(catalogReplies.some((content) => content.includes('`create_task`'))).toBe(true)
      expect(catalogReplies.some((content) => content.includes('Domain: `task`'))).toBe(true)
      expect(catalogReplies.some((content) => content.includes('Parameters'))).toBe(true)
    })

    test('uses cached tools for the follow-up catalog when provider construction is unavailable', async () => {
      setCachedTools('user1', {
        'add-task-relation': tool({
          description: 'Add a relation using cached tool metadata',
          inputSchema: z.object({
            taskId: z.string().describe('Primary task identifier'),
          }),
          execute: () => Promise.resolve({ ok: true }),
        }),
      })
      void mock.module('../../src/providers/factory.js', () => ({
        buildProviderForUser: (): never => {
          throw new Error('provider unavailable')
        },
      }))

      const commands = new Map<string, CommandHandler>()
      const chat = createFormattedContextChat(commands)
      let activeToolDefinitions: Record<string, unknown> | null = null
      const handler = await registerContextHandler(
        commands,
        chat,
        snapshotDeps({
          collectContext: (_contextId, collectorDeps): ContextSnapshot => {
            activeToolDefinitions = collectorDeps.getActiveToolDefinitions()
            return {
              modelName: 'gpt-4o',
              sections: [],
              totalTokens: 0,
              maxTokens: 128_000,
              approximate: false,
            }
          },
        }),
      )

      const { reply, textCalls } = createMockReply()

      await handler(createDmMessage('user1'), reply, createAuth('user1'))

      const catalogReplies = getCatalogReplies(textCalls)

      expect(activeToolDefinitions).not.toBeNull()
      expect(activeToolDefinitions).toHaveProperty('add-task-relation')
      expect(textCalls[0]).toBe('**context summary**')
      expect(catalogReplies.some((content) => content.includes('`add-task-relation`'))).toBe(true)
      expect(catalogReplies.some((content) => content.includes('Domain: `task`'))).toBe(true)
      expect(catalogReplies.some((content) => content.includes('_No active tools._'))).toBe(false)
    })
  })

  describe('response dispatch', () => {
    test('dispatches text output via reply.text', async () => {
      const commands = new Map<string, CommandHandler>()
      const chat: ChatProvider = {
        ...createMockChat({ commandHandlers: commands }),
        renderContext: () => ({ method: 'text', content: 'RAW TEXT PAYLOAD' }),
      }
      const handler = await registerContextHandler(commands, chat)

      const { reply, textCalls } = createMockReply()

      await handler(createDmMessage('user1'), reply, createAuth('user1', { isBotAdmin: true }))

      expect(textCalls).toContain('RAW TEXT PAYLOAD')
    })

    test('dispatches formatted output via reply.formatted', async () => {
      const commands = new Map<string, CommandHandler>()
      const chat = createFormattedContextChat(commands, '**markdown**')
      const handler = await registerContextHandler(commands, chat)

      const { reply, textCalls } = createMockReply()

      await handler(createDmMessage('user1'), reply, createAuth('user1', { isBotAdmin: true }))

      expect(textCalls).toContain('**markdown**')
    })

    test('dispatches embed output via reply.embed when available', async () => {
      const commands = new Map<string, CommandHandler>()
      const chat: ChatProvider = {
        ...createMockChat({ commandHandlers: commands }),
        renderContext: () => ({
          method: 'embed',
          embed: {
            title: 'Context · gpt-4o',
            description: '🟦🟦⬜',
            footer: '6,500 / 128,000 tokens',
            color: 0x2ecc71,
          },
        }),
      }
      const handler = await registerContextHandler(commands, chat)

      const { reply, embedCalls } = createMockReply()

      await handler(createDmMessage('user1'), reply, createAuth('user1', { isBotAdmin: true }))

      expect(embedCalls).toHaveLength(1)
      expect(embedCalls[0]?.title).toBe('Context · gpt-4o')
    })

    test('falls back to reply.formatted when embed is requested but reply.embed is undefined', async () => {
      const commands = new Map<string, CommandHandler>()
      const chat: ChatProvider = {
        ...createMockChat({ commandHandlers: commands }),
        renderContext: () => ({
          method: 'embed',
          embed: {
            title: 'Context · gpt-4o',
            description: '🟦🟦⬜',
            footer: '6,500 / 128,000 tokens',
          },
        }),
      }
      const handler = await registerContextHandler(commands, chat)

      const { reply, textCalls } = createMockReply()
      delete (reply as { embed?: unknown }).embed

      await handler(createDmMessage('user1'), reply, createAuth('user1', { isBotAdmin: true }))

      expect(textCalls.some((content) => content.includes('Context · gpt-4o'))).toBe(true)
      expect(textCalls.some((content) => content.includes('🟦🟦⬜'))).toBe(true)
    })

    test('falls back to formatted with fields in renderFallback', async () => {
      const commands = new Map<string, CommandHandler>()
      const chat: ChatProvider = {
        ...createMockChat({ commandHandlers: commands }),
        renderContext: () => ({
          method: 'embed',
          embed: {
            title: 'Context · gpt-4o',
            description: '🟦🟦⬜',
            fields: [
              { name: 'Field1', value: 'Value1' },
              { name: 'Field2', value: 'Value2' },
            ],
          },
        }),
      }
      const handler = await registerContextHandler(commands, chat)

      const { reply, textCalls } = createMockReply()
      delete (reply as { embed?: unknown }).embed

      await handler(createDmMessage('user1'), reply, createAuth('user1', { isBotAdmin: true }))

      expect(textCalls.some((content) => content.includes('Context · gpt-4o'))).toBe(true)
      expect(textCalls.some((content) => content.includes('🟦🟦⬜'))).toBe(true)
      expect(textCalls.some((content) => content.includes('Field1: Value1'))).toBe(true)
      expect(textCalls.some((content) => content.includes('Field2: Value2'))).toBe(true)
    })
  })

  test('reports collector errors with a friendly text message', async () => {
    const commands = new Map<string, CommandHandler>()
    const chat = createMockChat({ commandHandlers: commands })
    const handler = await registerContextHandler(
      commands,
      chat,
      snapshotDeps({
        collectContext: (): ContextSnapshot => {
          throw new Error('boom')
        },
      }),
    )

    const { reply, textCalls } = createMockReply()
    await handler(createDmMessage('user1'), reply, createAuth('user1', { isBotAdmin: true }))

    expect(textCalls.length).toBe(1)
    expect(textCalls[0]).toMatch(/could not build context view/i)
  })
})
