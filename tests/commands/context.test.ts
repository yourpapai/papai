import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { AuthorizationResult, ChatProvider, CommandHandler, ContextSnapshot } from '../../src/chat/types.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { createDmMessage, createMockChat, createMockReply, mockLogger, setupTestDb } from '../utils/test-helpers.js'

function captureCommand(commands: Map<string, CommandHandler>): CommandHandler {
  const handler = commands.get('context')
  if (handler === undefined) {
    throw new Error('context command not registered')
  }
  return handler
}

const snapshotDeps = (
  overrides?: Partial<import('../../src/commands/context.js').ContextCommandDeps>,
): import('../../src/commands/context.js').ContextCommandDeps => ({
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

describe('registerContextCommand', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('builds full direct tool definitions on cache miss', async () => {
    const provider = createMockProvider()
    void mock.module('../../src/providers/factory.js', () => ({
      buildProviderForUser: (): typeof provider => provider,
    }))
    const { registerContextCommand } = await import('../../src/commands/context.js')

    const commands = new Map<string, CommandHandler>()
    const chat = createMockChat({ commandHandlers: commands })
    let activeToolDefinitions: Record<string, unknown> | null = null

    registerContextCommand(
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

    const handler = captureCommand(commands)
    const { reply } = createMockReply()
    const auth: AuthorizationResult = {
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: 'user1',
    }

    await handler(createDmMessage('user1'), reply, auth)

    expect(activeToolDefinitions).not.toBeNull()
    expect(activeToolDefinitions).toHaveProperty('create_task')
    expect(activeToolDefinitions).not.toHaveProperty('papai_tool')
  })

  test('available to non-admin users', async () => {
    const { registerContextCommand } = await import('../../src/commands/context.js')
    const commands = new Map<string, CommandHandler>()
    const provider = createMockChat({ commandHandlers: commands })
    registerContextCommand(provider, snapshotDeps())

    const handler = captureCommand(commands)
    const { reply, textCalls } = createMockReply()
    const msg = createDmMessage('some-regular-user')
    const auth: AuthorizationResult = {
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: 'some-regular-user',
    }

    await handler(msg, reply, auth)

    expect(textCalls.length).toBeGreaterThan(0)
  })

  test('does not reject unauthorized users before the bot dispatcher (auth gate is upstream)', async () => {
    const { registerContextCommand } = await import('../../src/commands/context.js')
    const commands = new Map<string, CommandHandler>()
    const chat = createMockChat({ commandHandlers: commands })
    registerContextCommand(chat, snapshotDeps())

    const handler = captureCommand(commands)
    const { reply, textCalls } = createMockReply()
    const msg = createDmMessage('user1')
    const auth: AuthorizationResult = {
      allowed: false,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: 'user1',
    }

    await handler(msg, reply, auth)

    expect(textCalls.length).toBe(0)
  })

  test('dispatches text output via reply.text', async () => {
    const { registerContextCommand } = await import('../../src/commands/context.js')
    const commands = new Map<string, CommandHandler>()
    const chat: ChatProvider = {
      ...createMockChat({ commandHandlers: commands }),
      renderContext: () => ({ method: 'text', content: 'RAW TEXT PAYLOAD' }),
    }
    registerContextCommand(chat, snapshotDeps())
    const handler = captureCommand(commands)

    const { reply, textCalls } = createMockReply()
    const auth: AuthorizationResult = {
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: false,
      storageContextId: 'user1',
    }
    await handler(createDmMessage('user1'), reply, auth)

    expect(textCalls).toContain('RAW TEXT PAYLOAD')
  })

  test('dispatches formatted output via reply.formatted', async () => {
    const { registerContextCommand } = await import('../../src/commands/context.js')
    const commands = new Map<string, CommandHandler>()
    const chat: ChatProvider = {
      ...createMockChat({ commandHandlers: commands }),
      renderContext: () => ({ method: 'formatted', content: '**markdown**' }),
    }
    registerContextCommand(chat, snapshotDeps())
    const handler = captureCommand(commands)

    const { reply, textCalls } = createMockReply()
    const auth: AuthorizationResult = {
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: false,
      storageContextId: 'user1',
    }
    await handler(createDmMessage('user1'), reply, auth)

    expect(textCalls).toContain('**markdown**')
  })

  test('dispatches embed output via reply.embed when available', async () => {
    const { registerContextCommand } = await import('../../src/commands/context.js')
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
    registerContextCommand(chat, snapshotDeps())
    const handler = captureCommand(commands)

    const { reply, embedCalls } = createMockReply()
    const auth: AuthorizationResult = {
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: false,
      storageContextId: 'user1',
    }
    await handler(createDmMessage('user1'), reply, auth)

    expect(embedCalls).toHaveLength(1)
    expect(embedCalls[0]?.title).toBe('Context · gpt-4o')
  })

  test('falls back to reply.formatted when embed is requested but reply.embed is undefined', async () => {
    const { registerContextCommand } = await import('../../src/commands/context.js')
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
    registerContextCommand(chat, snapshotDeps())
    const handler = captureCommand(commands)

    const { reply, textCalls } = createMockReply()
    delete (reply as { embed?: unknown }).embed
    const auth: AuthorizationResult = {
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: false,
      storageContextId: 'user1',
    }
    await handler(createDmMessage('user1'), reply, auth)

    expect(textCalls.some((t) => t.includes('Context · gpt-4o'))).toBe(true)
    expect(textCalls.some((t) => t.includes('🟦🟦⬜'))).toBe(true)
  })

  test('falls back to formatted with fields in renderFallback', async () => {
    const { registerContextCommand } = await import('../../src/commands/context.js')
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
    registerContextCommand(chat, snapshotDeps())
    const handler = captureCommand(commands)

    const { reply, textCalls } = createMockReply()
    delete (reply as { embed?: unknown }).embed
    const auth: AuthorizationResult = {
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: false,
      storageContextId: 'user1',
    }
    await handler(createDmMessage('user1'), reply, auth)

    expect(textCalls.some((t) => t.includes('Context · gpt-4o'))).toBe(true)
    expect(textCalls.some((t) => t.includes('🟦🟦⬜'))).toBe(true)
    expect(textCalls.some((t) => t.includes('Field1: Value1'))).toBe(true)
    expect(textCalls.some((t) => t.includes('Field2: Value2'))).toBe(true)
  })

  test('reports collector errors with a friendly text message', async () => {
    const { registerContextCommand } = await import('../../src/commands/context.js')
    const commands = new Map<string, CommandHandler>()
    const chat = createMockChat({ commandHandlers: commands })
    registerContextCommand(
      chat,
      snapshotDeps({
        collectContext: (): ContextSnapshot => {
          throw new Error('boom')
        },
      }),
    )
    const handler = captureCommand(commands)

    const { reply, textCalls } = createMockReply()
    const auth: AuthorizationResult = {
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: false,
      storageContextId: 'user1',
    }
    await handler(createDmMessage('user1'), reply, auth)

    expect(textCalls.length).toBe(1)
    expect(textCalls[0]).toMatch(/could not build context view/i)
  })
})
