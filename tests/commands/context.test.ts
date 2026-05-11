import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { _userCaches, setCachedTools } from '../../src/cache.js'
import type { ChatProvider, CommandHandler, ContextSnapshot } from '../../src/chat/types.js'
import type { ContextCommandDeps } from '../../src/commands/context.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { makeTools } from '../../src/tools/index.js'
import { createMockProvider } from '../tools/mock-provider.js'
import {
  createAuth,
  createDmMessage,
  createGroupMessage,
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

function snapshotDeps(overrides: Partial<ContextCommandDeps> | null): ContextCommandDeps {
  return {
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
    buildLiveToolSet: (storageContextId, actorUserId, contextType, provider): ToolSet | null => {
      if (provider === null) return null
      return makeTools(provider, {
        storageContextId,
        chatUserId: actorUserId,
        mode: 'normal',
        contextType,
      })
    },
    ...resolveOverrides(overrides),
  }
}

async function registerContextHandler(
  commands: Map<string, CommandHandler>,
  chat: ChatProvider,
  deps: ContextCommandDeps,
): Promise<CommandHandler> {
  const { registerContextCommand } = await import('../../src/commands/context.js')
  registerContextCommand(chat, deps)
  return captureCommand(commands)
}

async function registerDefaultContextHandler(
  commands: Map<string, CommandHandler>,
  chat: ChatProvider,
): Promise<CommandHandler> {
  const { registerContextCommand } = await import('../../src/commands/context.js')
  registerContextCommand(chat)
  return captureCommand(commands)
}

function createFormattedContextChat(commands: Map<string, CommandHandler>, content: string | null): ChatProvider {
  return {
    ...createMockChat({ commandHandlers: commands }),
    renderContext: () => ({ method: 'formatted', content: resolveFormattedContent(content) }),
  }
}

function resolveOverrides(overrides: Partial<ContextCommandDeps> | null): Partial<ContextCommandDeps> {
  if (overrides === null) return {}
  return overrides
}

function resolveFormattedContent(content: string | null): string {
  if (content === null) return '**context summary**'
  return content
}

function removeEmbedReply(reply: Record<string, unknown>): void {
  delete reply['embed']
}

function getCatalogReplies(textCalls: readonly string[]): readonly string[] {
  return textCalls.slice(1)
}

function createIdentityCapableProvider(): TaskProvider {
  return createMockProvider({
    identityResolver: {
      searchUsers: () => Promise.resolve([]),
    },
  })
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

  test('uses invocation-aware active tool definitions for group summaries on cache miss', async () => {
    const provider = createIdentityCapableProvider()
    void mock.module('../../src/providers/factory.js', () => ({
      buildProviderForUser: (): typeof provider => provider,
    }))

    const commands = new Map<string, CommandHandler>()
    const chat = createFormattedContextChat(commands, null)
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

    await handler(
      createGroupMessage('actor-user', '/context', false, 'group-1'),
      reply,
      createAuth('group-1', { isGroupAdmin: true }),
    )

    const catalogReplies = getCatalogReplies(textCalls)

    expect(activeToolDefinitions).not.toBeNull()
    expect(activeToolDefinitions).toHaveProperty('set_my_identity')
    expect(activeToolDefinitions).toHaveProperty('clear_my_identity')
    expect(catalogReplies.some((content) => content.includes('`set_my_identity`'))).toBe(true)
    expect(catalogReplies.some((content) => content.includes('`clear_my_identity`'))).toBe(true)
  })

  test('available to non-admin users', async () => {
    const commands = new Map<string, CommandHandler>()
    const provider = createMockChat({ commandHandlers: commands })

    const handler = await registerContextHandler(commands, provider, snapshotDeps(null))
    const { reply, textCalls } = createMockReply()
    const msg = createDmMessage('some-regular-user')
    const auth = createAuth('some-regular-user')

    await handler(msg, reply, auth)

    expect(textCalls.length).toBeGreaterThan(0)
  })

  test('does not reject unauthorized users before the bot dispatcher (auth gate is upstream)', async () => {
    const commands = new Map<string, CommandHandler>()
    const chat = createMockChat({ commandHandlers: commands })

    const handler = await registerContextHandler(commands, chat, snapshotDeps(null))
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
      const chat = createFormattedContextChat(commands, null)
      const handler = await registerContextHandler(commands, chat, snapshotDeps(null))

      const { reply, textCalls } = createMockReply()

      await handler(createDmMessage('user1'), reply, createAuth('user1'))

      const catalogReplies = getCatalogReplies(textCalls)

      expect(textCalls[0]).toBe('**context summary**')
      expect(catalogReplies.some((content) => content.includes('`create_task`'))).toBe(true)
      expect(catalogReplies.some((content) => content.includes('Domain: `task`'))).toBe(true)
      expect(catalogReplies.some((content) => content.includes('Parameters'))).toBe(true)
    })

    test('prefers live provider tools over warmed cached tools in normal operation', async () => {
      const provider = createMockProvider()
      setCachedTools('user1', {
        stale_cached_tool: tool({
          description: 'Stale cached tool that should not appear in live catalog output',
          inputSchema: z.object({
            query: z.string().describe('Cached-only query'),
          }),
          execute: () => Promise.resolve({ ok: true }),
        }),
      })
      void mock.module('../../src/providers/factory.js', () => ({
        buildProviderForUser: (): typeof provider => provider,
      }))

      const commands = new Map<string, CommandHandler>()
      const chat = createFormattedContextChat(commands, null)
      const handler = await registerContextHandler(commands, chat, snapshotDeps(null))
      const { reply, textCalls } = createMockReply()

      await handler(createDmMessage('user1'), reply, createAuth('user1'))

      const catalogReplies = getCatalogReplies(textCalls)

      expect(catalogReplies.some((content) => content.includes('`create_task`'))).toBe(true)
      expect(catalogReplies.some((content) => content.includes('`stale_cached_tool`'))).toBe(false)
    })

    test('keeps summary tool definitions aligned with live follow-up tools when cache is warmed', async () => {
      const provider = createIdentityCapableProvider()
      setCachedTools('group-1', {
        stale_cached_tool: tool({
          description: 'Stale cached tool that should not be used when live tools are available',
          inputSchema: z.object({
            query: z.string().describe('Cached-only query'),
          }),
          execute: () => Promise.resolve({ ok: true }),
        }),
      })
      void mock.module('../../src/providers/factory.js', () => ({
        buildProviderForUser: (): typeof provider => provider,
      }))

      const commands = new Map<string, CommandHandler>()
      const chat = createFormattedContextChat(commands, null)
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

      await handler(
        createGroupMessage('actor-user', '/context', false, 'group-1'),
        reply,
        createAuth('group-1', { isGroupAdmin: true }),
      )

      const catalogReplies = getCatalogReplies(textCalls)

      expect(activeToolDefinitions).not.toBeNull()
      expect(activeToolDefinitions).toHaveProperty('set_my_identity')
      expect(activeToolDefinitions).not.toHaveProperty('stale_cached_tool')
      expect(catalogReplies.some((content) => content.includes('`set_my_identity`'))).toBe(true)
      expect(catalogReplies.some((content) => content.includes('`stale_cached_tool`'))).toBe(false)
    })

    test('shows no active tools when live build succeeds but returns no tools', async () => {
      const provider = createMockProvider()
      setCachedTools('user1', {
        stale_cached_tool: tool({
          description: 'Stale cached tool that should not appear when live build succeeds',
          inputSchema: z.object({
            query: z.string().describe('Cached-only query'),
          }),
          execute: () => Promise.resolve({ ok: true }),
        }),
      })
      void mock.module('../../src/providers/factory.js', () => ({
        buildProviderForUser: (): typeof provider => provider,
      }))

      const commands = new Map<string, CommandHandler>()
      const chat = createFormattedContextChat(commands, null)
      const handler = await registerContextHandler(
        commands,
        chat,
        snapshotDeps({
          buildLiveToolSet: () => ({}),
        }),
      )
      const { reply, textCalls } = createMockReply()

      await handler(createDmMessage('user1'), reply, createAuth('user1'))

      const catalogReplies = getCatalogReplies(textCalls)

      expect(catalogReplies).toEqual(['_No active tools._'])
      expect(catalogReplies.some((content) => content.includes('`stale_cached_tool`'))).toBe(false)
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
      const chat = createFormattedContextChat(commands, null)
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

    test('falls back to cached tools when live tool construction throws', async () => {
      const provider = createMockProvider()
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
        buildProviderForUser: (): typeof provider => provider,
      }))

      const commands = new Map<string, CommandHandler>()
      const chat = createFormattedContextChat(commands, null)
      const handler = await registerContextHandler(
        commands,
        chat,
        snapshotDeps({
          buildLiveToolSet: (): never => {
            throw new Error('live tool build failed')
          },
        }),
      )
      const { reply, textCalls } = createMockReply()

      await handler(createDmMessage('user1'), reply, createAuth('user1'))

      const catalogReplies = getCatalogReplies(textCalls)

      expect(textCalls[0]).toBe('**context summary**')
      expect(catalogReplies.some((content) => content.includes('`add-task-relation`'))).toBe(true)
      expect(catalogReplies.some((content) => content.includes('_No active tools._'))).toBe(false)
    })

    test('shows no active tools when live tool construction throws without cached tools', async () => {
      const provider = createMockProvider()
      void mock.module('../../src/providers/factory.js', () => ({
        buildProviderForUser: (): typeof provider => provider,
      }))

      const commands = new Map<string, CommandHandler>()
      const chat = createFormattedContextChat(commands, null)
      const handler = await registerContextHandler(
        commands,
        chat,
        snapshotDeps({
          buildLiveToolSet: (): never => {
            throw new Error('live tool build failed')
          },
        }),
      )
      const { reply, textCalls } = createMockReply()

      await handler(createDmMessage('user1'), reply, createAuth('user1'))

      const catalogReplies = getCatalogReplies(textCalls)

      expect(textCalls[0]).toBe('**context summary**')
      expect(catalogReplies).toEqual(['_No active tools._'])
      expect(catalogReplies.some((content) => content.includes('`create_task`'))).toBe(false)
    })

    test('reflects group-context tool gating in the follow-up catalog', async () => {
      const provider = createIdentityCapableProvider()
      void mock.module('../../src/providers/factory.js', () => ({
        buildProviderForUser: (): typeof provider => provider,
      }))

      const commands = new Map<string, CommandHandler>()
      const chat = createFormattedContextChat(commands, null)
      const handler = await registerContextHandler(commands, chat, snapshotDeps(null))
      const { reply, textCalls } = createMockReply()

      await handler(
        createGroupMessage('actor-user', '/context', false, 'group-1'),
        reply,
        createAuth('group-1', { isGroupAdmin: true }),
      )

      const catalogReplies = getCatalogReplies(textCalls)

      expect(catalogReplies.some((content) => content.includes('`set_my_identity`'))).toBe(true)
      expect(catalogReplies.some((content) => content.includes('`clear_my_identity`'))).toBe(true)
      expect(catalogReplies.some((content) => content.includes('`create_deferred_prompt`'))).toBe(true)
    })

    test('uses invocation-aware tool construction in the default runtime wiring', async () => {
      const provider = createIdentityCapableProvider()
      void mock.module('../../src/providers/factory.js', () => ({
        buildProviderForUser: (): typeof provider => provider,
      }))

      const commands = new Map<string, CommandHandler>()
      const chat = createFormattedContextChat(commands, null)
      const handler = await registerDefaultContextHandler(commands, chat)
      const { reply, textCalls } = createMockReply()

      await handler(
        createGroupMessage('actor-user', '/context', false, 'group-1'),
        reply,
        createAuth('group-1', { isGroupAdmin: true }),
      )

      const catalogReplies = getCatalogReplies(textCalls)

      expect(catalogReplies.some((content) => content.includes('`set_my_identity`'))).toBe(true)
      expect(catalogReplies.some((content) => content.includes('`clear_my_identity`'))).toBe(true)
      expect(catalogReplies.some((content) => content.includes('`create_deferred_prompt`'))).toBe(true)
    })
  })

  describe('response dispatch', () => {
    test('dispatches text output via reply.text', async () => {
      const commands = new Map<string, CommandHandler>()
      const chat: ChatProvider = {
        ...createMockChat({ commandHandlers: commands }),
        renderContext: () => ({ method: 'text', content: 'RAW TEXT PAYLOAD' }),
      }
      const handler = await registerContextHandler(commands, chat, snapshotDeps(null))

      const { reply, textCalls } = createMockReply()

      await handler(createDmMessage('user1'), reply, createAuth('user1', { isBotAdmin: true }))

      expect(textCalls).toContain('RAW TEXT PAYLOAD')
    })

    test('dispatches formatted output via reply.formatted', async () => {
      const commands = new Map<string, CommandHandler>()
      const chat = createFormattedContextChat(commands, '**markdown**')
      const handler = await registerContextHandler(commands, chat, snapshotDeps(null))

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
      const handler = await registerContextHandler(commands, chat, snapshotDeps(null))

      const { reply, embedCalls } = createMockReply()

      await handler(createDmMessage('user1'), reply, createAuth('user1', { isBotAdmin: true }))

      expect(embedCalls).toHaveLength(1)
      const firstEmbed = embedCalls[0]!
      expect(firstEmbed.title).toBe('Context · gpt-4o')
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
      const handler = await registerContextHandler(commands, chat, snapshotDeps(null))

      const { reply, textCalls } = createMockReply()
      removeEmbedReply(reply as Record<string, unknown>)

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
      const handler = await registerContextHandler(commands, chat, snapshotDeps(null))

      const { reply, textCalls } = createMockReply()
      removeEmbedReply(reply as Record<string, unknown>)

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
