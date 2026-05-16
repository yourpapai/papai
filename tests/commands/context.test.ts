// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ToolSet } from 'ai'

import { _userCaches } from '../../src/cache.js'
import type { ChatProvider, CommandHandler, ContextSnapshot } from '../../src/chat/types.js'
import {
  resolveActiveToolDefinitions,
  resolveContextToolSurface,
  safeBuildProvider,
} from '../../src/commands/context-tool-resolution.js'
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
    buildProvider: safeBuildProvider,
    buildLiveToolSet: (storageContextId, actorUserId, contextType, provider): ToolSet | null => {
      if (provider === null) return null
      return makeTools(provider, {
        storageContextId,
        chatUserId: actorUserId,
        mode: 'normal',
        contextType,
      })
    },
    resolveActiveToolDefinitions,
    resolveToolSurface: resolveContextToolSurface,
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

function createIdentityCapableProvider(): TaskProvider {
  return createMockProvider({
    identityResolver: {
      searchUsers: () => Promise.resolve([]),
    },
  })
}

function createSequentialLiveToolSet(results: readonly (ToolSet | null)[]): () => ToolSet | null {
  let nextIndex = 0

  return (): ToolSet | null => {
    const nextResult = results[nextIndex]
    nextIndex += 1

    if (nextResult === undefined) return null
    return nextResult
  }
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

    const { reply } = createMockReply()

    await handler(
      createGroupMessage('actor-user', '/context', false, 'group-1'),
      reply,
      createAuth('group-1', { isGroupAdmin: true }),
    )

    expect(activeToolDefinitions).not.toBeNull()
    expect(activeToolDefinitions).toHaveProperty('set_my_identity')
    expect(activeToolDefinitions).toHaveProperty('clear_my_identity')
  })

  test('uses injected provider construction instead of the hardwired provider factory', async () => {
    const provider = createIdentityCapableProvider()
    void mock.module('../../src/providers/factory.js', () => ({
      buildProviderForUser: (): never => {
        throw new Error('factory should not be used')
      },
    }))

    const commands = new Map<string, CommandHandler>()
    const chat = createFormattedContextChat(commands, null)
    const handler = await registerContextHandler(
      commands,
      chat,
      snapshotDeps({
        buildProvider: (): typeof provider => provider,
      }),
    )
    const { reply } = createMockReply()

    await handler(
      createGroupMessage('actor-user', '/context', false, 'group-1'),
      reply,
      createAuth('group-1', { isGroupAdmin: true }),
    )

    // No assertion needed — if the factory is used it throws.
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

  test('keeps summary tool definitions aligned with live follow-up tools when cache is warmed', async () => {
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
    const { reply } = createMockReply()

    await handler(
      createGroupMessage('actor-user', '/context', false, 'group-1'),
      reply,
      createAuth('group-1', { isGroupAdmin: true }),
    )

    expect(activeToolDefinitions).not.toBeNull()
    expect(activeToolDefinitions).toHaveProperty('set_my_identity')
  })

  test('keeps summary and follow-up aligned when live tool resolution is transient across calls', async () => {
    const provider = createIdentityCapableProvider()
    const firstLiveTools = makeTools(provider, {
      storageContextId: 'group-1',
      chatUserId: 'actor-user',
      mode: 'normal',
      contextType: 'group',
    })
    const liveResults: readonly [ToolSet, null] = [firstLiveTools, null]
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
        buildLiveToolSet: createSequentialLiveToolSet(liveResults),
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

    await handler(
      createGroupMessage('actor-user', '/context', false, 'group-1'),
      reply,
      createAuth('group-1', { isGroupAdmin: true }),
    )

    expect(activeToolDefinitions).not.toBeNull()
    expect(activeToolDefinitions).toHaveProperty('set_my_identity')
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
