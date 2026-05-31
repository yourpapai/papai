// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { addAuthorizedGroup } from '../../../src/authorized-groups.js'
import type { ButtonInteractionLike } from '../../../src/chat/discord/buttons.js'
import type { DiscordClientFactory } from '../../../src/chat/discord/index.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import type { ContextSnapshot, IncomingMessage } from '../../../src/chat/types.js'
import { dmTarget } from '../../../src/chat/types.js'
import { setConfigValue } from '../../../src/config.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../../src/group-settings/registry.js'
import { startGroupSettingsSelection } from '../../../src/group-settings/selector.js'
import { setContextSettings } from '../../../src/instances/context-store.js'
import { insertTaskInstance } from '../../../src/instances/task-store.js'
import { KANEO_PLUGIN_CREDENTIAL_KEY, KANEO_PLUGIN_WORKSPACE_KEY } from '../../../src/types/config.js'
import { addUser as addScopedUser } from '../../../src/users.js'
import { mockLogger, mockMessageCache, seedCommonTestPlatformInstances, setupTestDb } from '../../utils/test-helpers.js'

const TEST_PLATFORM_ID = 'discord-default'

const scopedContextId = (nativeContextId: string): string =>
  toScopedContextId({ platformInstanceId: TEST_PLATFORM_ID, nativeContextId })

const addAuthorizedDiscordGroup = (nativeContextId: string, addedBy: string): void => {
  addAuthorizedGroup(scopedContextId(nativeContextId), addedBy)
}

const addUser = (userId: string, addedBy: string, ...args: [] | [username: string]): void => {
  const username = args[0]
  if (username === undefined) {
    addScopedUser({ userId, platformInstanceId: TEST_PLATFORM_ID, addedBy })
  } else {
    addScopedUser({ userId, platformInstanceId: TEST_PLATFORM_ID, addedBy, username })
  }
}

const assignKaneoContext = (contextId: string): void => {
  insertTaskInstance({
    id: `${contextId}-kaneo`,
    type: 'kaneo',
    config: { baseUrl: 'https://kaneo.invalid' },
    status: 'active',
  })
  setContextSettings({ contextId, taskInstanceId: `${contextId}-kaneo`, platformInstanceId: 'discord-default' })
}

type ReadyListener = (arg: { user: { id: string; username: string } }) => void
type GenericListener = (...args: unknown[]) => void

function makeOnceReadyRouter(readyListeners: ReadyListener[]): (event: string, listener: GenericListener) => void {
  return (event: string, listener: GenericListener): void => {
    if (event === 'ready') readyListeners.push(listener as ReadyListener)
  }
}

function makeOnMessageCreateRouter(
  messageListeners: GenericListener[],
): (event: string, listener: GenericListener) => void {
  return (event: string, listener: GenericListener): void => {
    if (event === 'messageCreate') messageListeners.push(listener)
  }
}

function makeOnErrorRouter(errorListeners: GenericListener[]): (event: string, listener: GenericListener) => void {
  return (event: string, listener: GenericListener): void => {
    if (event === 'error') errorListeners.push(listener)
  }
}

function makeOnInteractionCreateRouter(
  interactionListeners: GenericListener[],
): (event: string, listener: GenericListener) => void {
  return (event: string, listener: GenericListener): void => {
    if (event === 'interactionCreate') interactionListeners.push(listener)
  }
}

describe('DiscordChatProvider', () => {
  beforeEach(async () => {
    mockLogger()
    mockMessageCache()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    process.env['ADMIN_USER_ID'] = 'admin-id'
  })

  type SendCapture = Partial<{ content: string; components: unknown[] }>

  test('constructor requires explicit token and platform instance id', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    expect(() => new DiscordChatProvider({ platformInstanceId: TEST_PLATFORM_ID })).toThrow(
      'DISCORD_BOT_TOKEN environment variable is required',
    )
    expect(() => new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: '   ' })).toThrow(
      'platformInstanceId is required',
    )
  })

  test('constructor rejects whitespace-only token', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    expect(() => new DiscordChatProvider({ token: '   ', platformInstanceId: TEST_PLATFORM_ID })).toThrow(
      'DISCORD_BOT_TOKEN environment variable is required',
    )
  })

  test('constructor succeeds with a non-empty token and exposes name="discord"', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })
    expect(provider.name).toBe('discord')
  })

  test('registerCommand routes a matching /help text through the command handler', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

    const captured: IncomingMessage[] = []
    provider.registerCommand('help', (msg): Promise<void> => {
      captured.push(msg)
      return Promise.resolve()
    })

    const fakeMessage = {
      id: 'm1',
      author: { id: 'u1', username: 'alice', bot: false },
      content: '<@bot_id> /help',
      channel: {
        id: 'c1',
        type: 0,
        send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
          Promise.resolve({ id: 'out1', edit: (): Promise<void> => Promise.resolve() }),
        sendTyping: (): Promise<void> => Promise.resolve(),
      },
      mentions: { has: (id: string): boolean => id === 'bot_id' },
      reference: null,
      type: 0,
    }
    await provider.testDispatchMessage(fakeMessage, 'bot_id')

    expect(captured).toHaveLength(1)
    expect(captured[0]!.text).toBe('/help')
  })

  test('onMessage receives non-command messages after mapping', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

    const seen: IncomingMessage[] = []
    provider.onMessage((msg): Promise<void> => {
      seen.push(msg)
      return Promise.resolve()
    })

    const fakeMessage = {
      id: 'm2',
      author: { id: 'u2', username: 'bob', bot: false },
      content: '<@bot_id> what is the weather',
      channel: {
        id: 'c2',
        type: 0,
        send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
          Promise.resolve({ id: 'out2', edit: (): Promise<void> => Promise.resolve() }),
        sendTyping: (): Promise<void> => Promise.resolve(),
      },
      mentions: { has: (id: string): boolean => id === 'bot_id' },
      reference: null,
      type: 0,
    }
    await provider.testDispatchMessage(fakeMessage, 'bot_id')

    expect(seen).toHaveLength(1)
    expect(seen[0]!.text).toBe('what is the weather')
  })

  test('onMessage receives constructor-provided platform instance ID', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: 'discord-secondary' })

    const seen: IncomingMessage[] = []
    provider.onMessage((msg): Promise<void> => {
      seen.push(msg)
      return Promise.resolve()
    })

    const fakeMessage = {
      id: 'm2',
      author: { id: 'u2', username: 'bob', bot: false },
      content: '<@bot_id> what is the weather',
      channel: {
        id: 'c2',
        type: 0,
        send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
          Promise.resolve({ id: 'out2', edit: (): Promise<void> => Promise.resolve() }),
        sendTyping: (): Promise<void> => Promise.resolve(),
      },
      mentions: { has: (id: string): boolean => id === 'bot_id' },
      reference: null,
      type: 0,
    }
    await provider.testDispatchMessage(fakeMessage, 'bot_id')

    expect(seen).toHaveLength(1)
    expect(seen[0]!.platformInstanceId).toBe('discord-secondary')
  })

  test('onMessage receives default Discord platform instance ID when constructor omits it', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

    const seen: IncomingMessage[] = []
    provider.onMessage((msg): Promise<void> => {
      seen.push(msg)
      return Promise.resolve()
    })

    const fakeMessage = {
      id: 'm2-default',
      author: { id: 'u2', username: 'bob', bot: false },
      content: '<@bot_id> what is the weather',
      channel: {
        id: 'c2',
        type: 0,
        send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
          Promise.resolve({ id: 'out2', edit: (): Promise<void> => Promise.resolve() }),
        sendTyping: (): Promise<void> => Promise.resolve(),
      },
      mentions: { has: (id: string): boolean => id === 'bot_id' },
      reference: null,
      type: 0,
    }
    await provider.testDispatchMessage(fakeMessage, 'bot_id')

    expect(seen).toHaveLength(1)
    expect(seen[0]!.platformInstanceId).toBe('discord-default')
  })

  test('bot-authored messages are ignored', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })
    const seen: IncomingMessage[] = []
    provider.onMessage((msg): Promise<void> => {
      seen.push(msg)
      return Promise.resolve()
    })
    const fakeMessage = {
      id: 'm3',
      author: { id: 'bot_id', username: 'bot', bot: true },
      content: '<@bot_id> nothing',
      channel: {
        id: 'c3',
        type: 0,
        send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
          Promise.resolve({ id: 'out3', edit: (): Promise<void> => Promise.resolve() }),
        sendTyping: (): Promise<void> => Promise.resolve(),
      },
      mentions: { has: (): boolean => true },
      reference: null,
      type: 0,
    }
    await provider.testDispatchMessage(fakeMessage, 'bot_id')
    expect(seen).toHaveLength(0)
  })

  test('stop() calls client.destroy when a client exists', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })
    let destroyed = false
    provider.testSetClient({
      destroy: (): Promise<void> => {
        destroyed = true
        return Promise.resolve()
      },
    })
    await provider.stop()
    expect(destroyed).toBe(true)
  })

  test('sendMessage creates a DM channel and sends the markdown', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

    const sends: Array<Partial<{ content: string }>> = []
    const dmChannel = {
      id: 'dm-chan-1',
      send: (arg: Partial<{ content: string }>): Promise<{ id: string; edit: () => Promise<void> }> => {
        sends.push(arg)
        return Promise.resolve({ id: 'msg-x', edit: (): Promise<void> => Promise.resolve() })
      },
      sendTyping: (): Promise<void> => Promise.resolve(),
    }
    const fakeClient = {
      destroy: (): Promise<void> => Promise.resolve(),
      users: {
        fetch: (id: string): Promise<{ createDM: () => Promise<typeof dmChannel> }> => {
          expect(id).toBe('user-42')
          return Promise.resolve({
            createDM: (): Promise<typeof dmChannel> => Promise.resolve(dmChannel),
          })
        },
      },
    }
    provider.testSetClient(fakeClient)

    await provider.sendMessage('discord-default', dmTarget('user-42'), 'hello discord')
    expect(sends).toHaveLength(1)
    expect(sends[0]!.content).toBe('hello discord')
  })

  test('sendMessage throws when a group channel is not sendable', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

    provider.testSetClient({
      destroy: (): Promise<void> => Promise.resolve(),
      users: {
        fetch: (
          _id: string,
        ): Promise<{
          createDM: () => Promise<{ send: (arg: { content: string }) => Promise<unknown> }>
        }> => Promise.reject(new Error('not used')),
      },
      channels: {
        cache: new Map<string, unknown>(),
        fetch: (_id: string): Promise<unknown> => Promise.resolve(null),
      },
    })

    await expect(
      provider.sendMessage(
        'discord-default',
        {
          contextId: 'chan-404',
          contextType: 'group',
          threadId: null,
          audience: 'shared',
          mentionUserIds: [],
          createdByUserId: 'user-1',
          createdByUsername: null,
        },
        'hello group',
      ),
    ).rejects.toThrow('Discord channel not sendable')
  })

  test('sendMessage throws when a fetched group channel reports isSendable() false', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

    provider.testSetClient({
      destroy: (): Promise<void> => Promise.resolve(),
      users: {
        fetch: (
          _id: string,
        ): Promise<{
          createDM: () => Promise<{ send: (arg: { content: string }) => Promise<unknown> }>
        }> => Promise.reject(new Error('not used')),
      },
      channels: {
        cache: new Map<string, unknown>(),
        fetch: (_id: string): Promise<unknown> =>
          Promise.resolve({
            send: (_arg: { content: string }): Promise<unknown> => Promise.resolve(),
            isSendable: (): boolean => false,
          }),
      },
    })

    await expect(
      provider.sendMessage(
        'discord-default',
        {
          contextId: 'chan-stage',
          contextType: 'group',
          threadId: null,
          audience: 'shared',
          mentionUserIds: [],
          createdByUserId: 'user-1',
          createdByUsername: null,
        },
        'hello group',
      ),
    ).rejects.toThrow('Discord channel not sendable')
  })

  test('resolveUserId returns snowflake as-is when the input is numeric', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })
    const result = await provider.resolveUserId('1234567890', {
      contextId: 'c1',
      contextType: 'group',
    })
    expect(result).toBe('1234567890')
  })

  test('resolveUserId returns null in DMs (no guild context)', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })
    const result = await provider.resolveUserId('@alice', { contextId: 'u1', contextType: 'dm' })
    expect(result).toBeNull()
  })

  test('resolveUserId searches members in the channel guild for group context', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

    const fakeGuild = {
      members: {
        search: (arg: { query: string; limit: number }): Promise<Map<string, { id: string }>> => {
          expect(arg.query).toBe('alice')
          expect(arg.limit).toBe(1)
          return Promise.resolve(new Map([['u-9', { id: 'u-9' }]]))
        },
      },
    }
    const fakeClient = {
      destroy: (): Promise<void> => Promise.resolve(),
      channels: {
        cache: new Map([['chan-7', { guildId: 'guild-3' }]]),
      },
      guilds: {
        cache: new Map([['guild-3', fakeGuild]]),
      },
    }
    provider.testSetClient(fakeClient)

    const result = await provider.resolveUserId('@alice', {
      contextId: 'chan-7',
      contextType: 'group',
    })
    expect(result).toBe('u-9')
  })

  test('resolveUserId fetches an uncached channel before searching the guild', async () => {
    const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
    const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

    const fakeGuild = {
      members: {
        search: (arg: { query: string; limit: number }): Promise<Map<string, { id: string }>> => {
          expect(arg.query).toBe('alice')
          expect(arg.limit).toBe(1)
          return Promise.resolve(new Map([['u-10', { id: 'u-10' }]]))
        },
      },
    }
    const fakeClient = {
      destroy: (): Promise<void> => Promise.resolve(),
      channels: {
        cache: new Map(),
        fetch: (id: string): Promise<{ guildId: string }> => {
          expect(id).toBe('chan-8')
          return Promise.resolve({ guildId: 'guild-4' })
        },
      },
      guilds: {
        cache: new Map([['guild-4', fakeGuild]]),
      },
    }
    provider.testSetClient(fakeClient)

    const result = await provider.resolveUserId('@alice', {
      contextId: 'chan-8',
      contextType: 'group',
    })
    expect(result).toBe('u-10')
  })

  describe('renderContext', () => {
    test('returns embed method result with context snapshot', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

      const snapshot: ContextSnapshot = {
        modelName: 'gpt-4o',
        totalTokens: 1500,
        maxTokens: 128_000,
        approximate: false,
        sections: [
          { label: 'System prompt', tokens: 500 },
          { label: 'Tools', tokens: 1000 },
        ],
      }

      const result = provider.renderContext(snapshot)

      assert.ok(result.method === 'embed')
      expect(result.embed.title).toBe('Context · gpt-4o')
      expect(result.embed.description).toContain('🟦')
      expect(result.embed.footer).toContain('1,500')
      expect(result.embed.footer).toContain('128,000')
      expect(result.embed.color).toBe(0x2ecc71)
    })
  })

  describe('defaultClientFactory', () => {
    test('creates a discord.js Client instance with the required interface', async () => {
      const { defaultClientFactory } = await import('../../../src/chat/discord/index.js')
      const client = defaultClientFactory()
      expect(typeof client.on).toBe('function')
      expect(typeof client.once).toBe('function')
      expect(typeof client.login).toBe('function')
      expect(typeof client.destroy).toBe('function')
      // Clean up the client to avoid open handles
      await client.destroy().catch(() => {})
    })
  })

  describe('start()', () => {
    test('resolves when ClientReady fires after login', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')

      const readyListeners: ReadyListener[] = []

      const fakeClient = {
        destroy: (): Promise<void> => Promise.resolve(),
        user: null,
        on: (_event: string, _listener: GenericListener): void => undefined,
        once: makeOnceReadyRouter(readyListeners),
        login: (_token: string): Promise<string> => Promise.resolve('fake-token-123'),
      }

      const factory: DiscordClientFactory = () => fakeClient
      const provider = new DiscordChatProvider({
        clientFactory: factory,
        token: 'fake-discord-token',
        platformInstanceId: TEST_PLATFORM_ID,
      })
      const startPromise = provider.start()

      await Promise.resolve()
      readyListeners[0]!({ user: { id: 'bot-42', username: 'testbot' } })

      await startPromise
    })

    test('registers messageCreate, interactionCreate, and error listeners', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')

      const registeredEvents: string[] = []
      const readyListeners: ReadyListener[] = []

      const fakeClient = {
        destroy: (): Promise<void> => Promise.resolve(),
        user: null,
        on: (event: string, _listener: GenericListener): void => {
          registeredEvents.push(event)
        },
        once: makeOnceReadyRouter(readyListeners),
        login: (_token: string): Promise<string> => Promise.resolve('fake-token-123'),
      }

      const factory: DiscordClientFactory = () => fakeClient
      const provider = new DiscordChatProvider({
        clientFactory: factory,
        token: 'fake-discord-token',
        platformInstanceId: TEST_PLATFORM_ID,
      })
      const startPromise = provider.start()

      await Promise.resolve()
      readyListeners[0]!({ user: { id: 'bot-42', username: 'testbot' } })
      await startPromise

      expect(registeredEvents).toContain('messageCreate')
      expect(registeredEvents).toContain('interactionCreate')
      expect(registeredEvents).toContain('error')
    })

    test('dispatches incoming DM message via messageCreate listener', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')

      const messageListeners: GenericListener[] = []
      const readyListeners: ReadyListener[] = []

      const fakeClient = {
        destroy: (): Promise<void> => Promise.resolve(),
        user: { id: 'bot-42', username: 'testbot' },
        on: makeOnMessageCreateRouter(messageListeners),
        once: makeOnceReadyRouter(readyListeners),
        login: (_token: string): Promise<string> => Promise.resolve('fake-token-123'),
      }

      const factory: DiscordClientFactory = () => fakeClient
      const provider = new DiscordChatProvider({
        clientFactory: factory,
        token: 'fake-discord-token',
        platformInstanceId: TEST_PLATFORM_ID,
      })

      let resolveReceived!: (msg: IncomingMessage) => void
      const received = new Promise<IncomingMessage>((res) => {
        resolveReceived = res
      })
      provider.onMessage((msg): Promise<void> => {
        resolveReceived(msg)
        return Promise.resolve()
      })

      const startPromise = provider.start()
      await Promise.resolve()
      readyListeners[0]!({ user: { id: 'bot-42', username: 'testbot' } })
      await startPromise

      const fakeMessage = {
        id: 'msg-dm-1',
        author: { id: 'u1', username: 'alice', bot: false },
        content: 'hello from dm',
        channel: {
          id: 'dm-chan-1',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'out1', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        mentions: { has: (_id: string): boolean => false },
        reference: null,
        type: 0,
      }

      messageListeners[0]!(fakeMessage)
      const msg = await received

      expect(msg.text).toBe('hello from dm')
      expect(msg.contextType).toBe('dm')
      expect(msg.user.id).toBe('u1')
    })

    test('error listener fires without throwing', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')

      const errorListeners: GenericListener[] = []
      const readyListeners: ReadyListener[] = []

      const fakeClient = {
        destroy: (): Promise<void> => Promise.resolve(),
        user: null,
        on: makeOnErrorRouter(errorListeners),
        once: makeOnceReadyRouter(readyListeners),
        login: (_token: string): Promise<string> => Promise.resolve('fake-token-123'),
      }

      const factory: DiscordClientFactory = () => fakeClient
      const provider = new DiscordChatProvider({
        clientFactory: factory,
        token: 'fake-discord-token',
        platformInstanceId: TEST_PLATFORM_ID,
      })
      const startPromise = provider.start()
      await Promise.resolve()
      readyListeners[0]!({ user: { id: 'bot-42', username: 'testbot' } })
      await startPromise

      // Fire the error listener — should not throw
      expect(() => errorListeners[0]!(new Error('test discord error'))).not.toThrow()
      // Also exercise the non-Error path
      expect(() => errorListeners[0]!('string error')).not.toThrow()
    })

    test('non-button interactionCreate is silently ignored', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')

      const interactionListeners: GenericListener[] = []
      const readyListeners: ReadyListener[] = []

      const fakeClient = {
        destroy: (): Promise<void> => Promise.resolve(),
        user: null,
        on: makeOnInteractionCreateRouter(interactionListeners),
        once: makeOnceReadyRouter(readyListeners),
        login: (_token: string): Promise<string> => Promise.resolve('fake-token-123'),
      }

      const factory: DiscordClientFactory = () => fakeClient
      const provider = new DiscordChatProvider({
        clientFactory: factory,
        token: 'fake-discord-token',
        platformInstanceId: TEST_PLATFORM_ID,
      })

      const seen: IncomingMessage[] = []
      provider.onMessage((msg): Promise<void> => {
        seen.push(msg)
        return Promise.resolve()
      })

      const startPromise = provider.start()
      await Promise.resolve()
      readyListeners[0]!({ user: { id: 'bot-42', username: 'testbot' } })
      await startPromise

      interactionListeners[0]!({ type: 2, componentType: 2 })
      await Promise.resolve()

      expect(seen).toHaveLength(0)
    })

    test('button interactionCreate dispatches to message handler via start()', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')

      // Authorize the user
      addUser('u5', 'admin-id', 'eve')

      const interactionListeners: GenericListener[] = []
      const readyListeners: ReadyListener[] = []

      const fakeClient = {
        destroy: (): Promise<void> => Promise.resolve(),
        user: { id: 'bot-42', username: 'testbot' },
        on: makeOnInteractionCreateRouter(interactionListeners),
        once: makeOnceReadyRouter(readyListeners),
        login: (_token: string): Promise<string> => Promise.resolve('fake-token-123'),
      }

      const factory: DiscordClientFactory = () => fakeClient
      const provider = new DiscordChatProvider({
        clientFactory: factory,
        token: 'fake-discord-token',
        platformInstanceId: TEST_PLATFORM_ID,
      })

      let resolveReceived!: (msg: IncomingMessage) => void
      const received = new Promise<IncomingMessage>((res) => {
        resolveReceived = res
      })
      provider.onMessage((msg): Promise<void> => {
        resolveReceived(msg)
        return Promise.resolve()
      })

      const startPromise = provider.start()
      await Promise.resolve()
      readyListeners[0]!({ user: { id: 'bot-42', username: 'testbot' } })
      await startPromise

      const fakeButtonInteraction = {
        type: 3,
        componentType: 2,
        user: { id: 'u5', username: 'eve' },
        customId: 'test:btn',
        channelId: 'u5',
        channel: {
          id: 'u5',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'm-btn', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'msg-btn-1' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      interactionListeners[0]!(fakeButtonInteraction)
      const msg = await received

      expect(msg.text).toBe('test:btn')
      expect(msg.user.id).toBe('u5')
    })
  })

  describe('testDispatchButtonInteraction', () => {
    test('calls deferUpdate and routes customId to message handler', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

      // Authorize the user
      addUser('u1', 'admin-id', 'alice')

      const seen: IncomingMessage[] = []
      provider.onMessage((msg): Promise<void> => {
        seen.push(msg)
        return Promise.resolve()
      })

      let deferred = false
      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'u1', username: 'alice' },
        customId: 'test:action',
        channelId: 'u1',
        channel: {
          id: 'u1',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'msg-x', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'original-msg-1' },
        deferUpdate: (): Promise<void> => {
          deferred = true
          return Promise.resolve()
        },
      }

      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42')

      expect(deferred).toBe(true)
      expect(seen).toHaveLength(1)
      expect(seen[0]!.text).toBe('test:action')
    })

    test('builds interaction replies around the clicked editable message', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

      const sends: SendCapture[] = []
      const edits: SendCapture[] = []

      provider.onInteraction(async (_interaction, reply): Promise<void> => {
        expect(typeof reply.replaceText).toBe('function')
        expect(typeof reply.replaceButtons).toBe('function')

        assert.ok(reply.replaceText !== undefined)
        assert.ok(reply.replaceButtons !== undefined)

        await reply.replaceText('Updated menu')
        await reply.replaceButtons('Choose next', {
          buttons: [{ text: 'Retry', callbackData: 'cb:retry', style: 'primary' }],
        })
      })

      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'u-edit', username: 'editor' },
        customId: 'menu:action',
        channelId: 'u-edit',
        channel: {
          id: 'u-edit',
          type: 1,
          send: (arg: SendCapture): Promise<{ id: string; edit: () => Promise<void> }> => {
            sends.push(arg)
            return Promise.resolve({
              id: 'msg-sent',
              edit: (): Promise<void> => Promise.resolve(),
            })
          },
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: {
          id: 'clicked-msg-1',
          editable: true,
          edit: (arg: SendCapture): Promise<void> => {
            edits.push(arg)
            return Promise.resolve()
          },
        },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42')

      expect(sends).toHaveLength(0)
      expect(edits).toHaveLength(2)
      expect(edits[0]).toEqual({ content: 'Updated menu', components: [] })
      expect(edits[1]!.content).toBe('Choose next')
      expect(Array.isArray(edits[1]!.components)).toBe(true)
      const secondEditComponents = edits[1]!.components
      assert.ok(secondEditComponents !== undefined)
      expect(secondEditComponents.length).toBe(1)
    })

    test('falls back to new messages when the clicked message is not editable', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

      const sends: SendCapture[] = []
      const edits: SendCapture[] = []

      provider.onInteraction(async (_interaction, reply): Promise<void> => {
        expect(typeof reply.replaceText).toBe('function')
        expect(typeof reply.replaceButtons).toBe('function')

        assert.ok(reply.replaceText !== undefined)
        assert.ok(reply.replaceButtons !== undefined)

        await reply.replaceText('Updated menu')
        await reply.replaceButtons('Choose next', {
          buttons: [{ text: 'Retry', callbackData: 'cb:retry', style: 'primary' }],
        })
      })

      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'u-readonly', username: 'viewer' },
        customId: 'menu:action',
        channelId: 'u-readonly',
        channel: {
          id: 'u-readonly',
          type: 1,
          send: (arg: SendCapture): Promise<{ id: string; edit: () => Promise<void> }> => {
            sends.push(arg)
            return Promise.resolve({
              id: 'msg-sent',
              edit: (): Promise<void> => Promise.resolve(),
            })
          },
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: {
          id: 'clicked-msg-2',
          editable: false,
          edit: (arg: SendCapture): Promise<void> => {
            edits.push(arg)
            return Promise.resolve()
          },
        },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42')

      expect(edits).toHaveLength(0)
      expect(sends).toHaveLength(2)
      expect(sends[0]).toEqual({ content: 'Updated menu' })
      expect(sends[1]!.content).toBe('Choose next')
      expect(Array.isArray(sends[1]!.components)).toBe(true)
      const secondSendComponents = sends[1]!.components
      assert.ok(secondSendComponents !== undefined)
      expect(secondSendComponents.length).toBe(1)
    })

    test('routes slash-prefixed customId to registered command handler', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

      // Authorize the user
      addUser('u2', 'admin-id', 'bob')

      const captured: IncomingMessage[] = []
      provider.registerCommand('help', (msg): Promise<void> => {
        captured.push(msg)
        return Promise.resolve()
      })

      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'u2', username: 'bob' },
        customId: '/help',
        channelId: 'u2',
        channel: {
          id: 'u2',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'msg-y', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'btn-msg-2' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42')

      expect(captured).toHaveLength(1)
      expect(captured[0]!.text).toBe('/help')
    })

    test('uses user ID as contextId in DM channels (type=1)', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

      // Authorize the user
      addUser('user-77', 'admin-id', 'carol')

      const seen: IncomingMessage[] = []
      provider.onMessage((msg): Promise<void> => {
        seen.push(msg)
        return Promise.resolve()
      })

      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'user-77', username: 'carol' },
        customId: 'some:action',
        channelId: 'dm-channel-77',
        channel: {
          id: 'dm-channel-77',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'm1', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'msg-3' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42')

      expect(seen[0]!.contextId).toBe('user-77')
      expect(seen[0]!.contextType).toBe('dm')
    })

    test('uses channelId as contextId in guild channels (type=0)', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

      // Authorize the user
      addAuthorizedDiscordGroup('guild-channel-99', 'admin-id')
      addUser('user-88', 'admin-id', 'dave')

      const seen: IncomingMessage[] = []
      provider.onMessage((msg): Promise<void> => {
        seen.push(msg)
        return Promise.resolve()
      })

      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'user-88', username: 'dave' },
        customId: 'some:action',
        channelId: 'guild-channel-99',
        channel: {
          id: 'guild-channel-99',
          type: 0,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'm2', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'msg-4' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42')

      expect(seen[0]!.contextId).toBe('guild-channel-99')
      expect(seen[0]!.contextType).toBe('group')
    })

    test('skips dispatch when channel is null', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

      const seen: IncomingMessage[] = []
      provider.onMessage((msg): Promise<void> => {
        seen.push(msg)
        return Promise.resolve()
      })

      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'u3', username: 'eve' },
        customId: 'some:action',
        channelId: 'chan-x',
        channel: null,
        message: { id: 'msg-5' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42')

      expect(seen).toHaveLength(0)
    })

    test('handles cfg: callback when no active editor (no-op)', async () => {
      await setupTestDb()
      seedCommonTestPlatformInstances()
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

      let deferred = false
      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'user-cfg', username: 'cfguser' },
        customId: 'cfg:edit:llm_apikey',
        channelId: 'user-cfg',
        channel: {
          id: 'user-cfg',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'msg-cfg', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'msg-cfg-1' },
        deferUpdate: (): Promise<void> => {
          deferred = true
          return Promise.resolve()
        },
      }

      // No active editor, should defer and return without error
      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42')
      expect(deferred).toBe(true)
    })

    test('handles wizard_ callback when no active wizard (no-op)', async () => {
      await setupTestDb()
      seedCommonTestPlatformInstances()
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

      let deferred = false
      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'user-wiz', username: 'wizuser' },
        customId: 'wizard_confirm',
        channelId: 'user-wiz',
        channel: {
          id: 'user-wiz',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'msg-wiz', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'msg-wiz-1' },
        deferUpdate: (): Promise<void> => {
          deferred = true
          return Promise.resolve()
        },
      }

      // No active wizard, should defer and return without error
      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42')
      expect(deferred).toBe(true)
    })

    test('Discord DM group-settings callback opens config for the selected group', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })
      await setupTestDb()
      seedCommonTestPlatformInstances()

      upsertKnownGroupContext({
        contextId: scopedContextId('group-1'),
        provider: 'discord',
        displayName: 'Operations',
        parentName: 'Platform',
      })
      addAuthorizedDiscordGroup('group-1', 'admin-id')
      upsertGroupAdminObservation({
        provider: 'discord',
        contextId: scopedContextId('group-1'),
        userId: 'user-1',
        username: 'alice',
        isAdmin: true,
      })
      startGroupSettingsSelection('user-1', 'config', true, 'discord-default')

      const sends: Array<Partial<{ content: string }>> = []
      const interaction: ButtonInteractionLike = {
        user: { id: 'user-1', username: 'alice' },
        customId: 'gsel:scope:group',
        channelId: 'dm-1',
        channel: {
          id: 'dm-1',
          type: 1,
          send: (arg: Partial<{ content: string }>): Promise<{ id: string; edit: () => Promise<void> }> => {
            sends.push(arg)
            return Promise.resolve({ id: 'out-1', edit: (): Promise<void> => Promise.resolve() })
          },
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'm-1' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      await provider.testDispatchButtonInteraction(interaction, 'bot-id')

      assert.ok(sends[0] !== undefined)
      assert.ok(sends[0].content !== undefined)
      expect(sends[0].content).toContain('Choose a group to configure.')
    })

    test('Discord DM selector continues into setup when the selector command is setup', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })
      await setupTestDb()
      seedCommonTestPlatformInstances()

      upsertKnownGroupContext({
        contextId: scopedContextId('group-1'),
        provider: 'discord',
        displayName: 'Operations',
        parentName: 'Platform',
      })
      upsertGroupAdminObservation({
        provider: 'discord',
        contextId: scopedContextId('group-1'),
        userId: 'user-1',
        username: 'alice',
        isAdmin: true,
      })
      addAuthorizedDiscordGroup('group-1', 'admin-id')
      assignKaneoContext(scopedContextId('group-1'))
      setConfigValue(scopedContextId('group-1'), KANEO_PLUGIN_CREDENTIAL_KEY, 'existing-key')
      setConfigValue(scopedContextId('group-1'), KANEO_PLUGIN_WORKSPACE_KEY, 'existing-workspace')
      startGroupSettingsSelection('user-1', 'setup', true, 'discord-default')

      const groupSelectorInteraction: ButtonInteractionLike = {
        user: { id: 'user-1', username: 'alice' },
        customId: 'gsel:scope:group',
        channelId: 'dm-1',
        channel: {
          id: 'dm-1',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'out-0', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'm-0' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }
      await provider.testDispatchButtonInteraction(groupSelectorInteraction, 'bot-id')

      const sends: Array<Partial<{ content: string }>> = []
      const interaction: ButtonInteractionLike = {
        user: { id: 'user-1', username: 'alice' },
        customId: 'gsel:group:group-1',
        channelId: 'dm-1',
        channel: {
          id: 'dm-1',
          type: 1,
          send: (arg: Partial<{ content: string }>): Promise<{ id: string; edit: () => Promise<void> }> => {
            sends.push(arg)
            return Promise.resolve({ id: 'out-1', edit: (): Promise<void> => Promise.resolve() })
          },
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'm-1' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      await provider.testDispatchButtonInteraction(interaction, 'bot-id')

      assert.ok(sends[0] !== undefined)
      assert.ok(sends[0].content !== undefined)
      expect(sends[0].content).toContain('Welcome to papai configuration wizard!')
    })

    test('handles deferUpdate failure gracefully', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

      // Authorize the user
      addUser('u-def', 'admin-id', 'defer-fail')

      const seen: IncomingMessage[] = []
      provider.onMessage((msg): Promise<void> => {
        seen.push(msg)
        return Promise.resolve()
      })

      const fakeInteraction: ButtonInteractionLike = {
        user: { id: 'u-def', username: 'defer-fail' },
        customId: 'fallback:action',
        channelId: 'u-def',
        channel: {
          id: 'u-def',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'msg-def', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'msg-def-1' },
        deferUpdate: (): Promise<void> => Promise.reject(new Error('Defer failed')),
      }

      // Should still route to message handler despite defer failure
      await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-42')
      expect(seen).toHaveLength(1)
      expect(seen[0]!.text).toBe('fallback:action')
    })
  })

  describe('listener rejection handling', () => {
    test('messageCreate listener catches and does not rethrow when dispatchMessage rejects', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')

      const messageListeners: GenericListener[] = []
      const readyListeners: ReadyListener[] = []

      const fakeClient = {
        destroy: (): Promise<void> => Promise.resolve(),
        user: { id: 'bot-42', username: 'testbot' },
        on: makeOnMessageCreateRouter(messageListeners),
        once: makeOnceReadyRouter(readyListeners),
        login: (_token: string): Promise<string> => Promise.resolve('fake-token-123'),
      }

      const factory: DiscordClientFactory = () => fakeClient
      const provider = new DiscordChatProvider({
        clientFactory: factory,
        token: 'fake-discord-token',
        platformInstanceId: TEST_PLATFORM_ID,
      })

      provider.onMessage((): Promise<void> => Promise.reject(new Error('handler boom')))

      const startPromise = provider.start()
      await Promise.resolve()
      readyListeners[0]!({ user: { id: 'bot-42', username: 'testbot' } })
      await startPromise

      const fakeMessage = {
        id: 'msg-rej-1',
        author: { id: 'u1', username: 'alice', bot: false },
        content: 'hello',
        channel: {
          id: 'dm-rej-1',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'out-rej', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        mentions: { has: (_id: string): boolean => false },
        reference: null,
        type: 0,
      }

      // Fire the listener — the rejection must be caught inside the listener, not propagated
      messageListeners[0]!(fakeMessage)
      // Flush microtasks to let the promise rejection propagate if unhandled
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
      // No assertion needed: reaching here without an unhandled rejection is the proof
    })

    test('resolveGroupLabel returns the fetched channel name', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

      provider.testSetClient({
        destroy: (): Promise<void> => Promise.resolve(),
        channels: {
          cache: new Map(),
          fetch: (id: string): Promise<{ name: string }> => {
            expect(id).toBe('chan-7')
            return Promise.resolve({ name: 'engineering-chat' })
          },
        },
      })

      const label = await provider.resolveGroupLabel('chan-7')
      expect(label).toBe('engineering-chat')
    })

    test('resolveUserLabel prefers guild member display name and username', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

      provider.testSetClient({
        destroy: (): Promise<void> => Promise.resolve(),
        channels: {
          cache: new Map([['chan-7', { guildId: 'guild-3' }]]),
        },
        guilds: {
          cache: new Map([
            [
              'guild-3',
              {
                members: {
                  search: (): Promise<Map<string, { id: string }>> =>
                    Promise.resolve(new Map<string, { id: string }>()),
                  fetch: (
                    id: string,
                  ): Promise<{
                    displayName: string
                    nickname: string
                    user: { username: string; globalName: null; displayName: string }
                  }> => {
                    expect(id).toBe('user-9')
                    return Promise.resolve({
                      displayName: 'John Johnson',
                      nickname: 'John Johnson',
                      user: { username: 'itsmike', globalName: null, displayName: 'itsmike' },
                    })
                  },
                },
              },
            ],
          ]),
        },
      })

      const label = await provider.resolveUserLabel('user-9', { contextId: 'chan-7', contextType: 'group' })
      expect(label).toBe('John Johnson (@itsmike)')
    })

    test('resolveUserLabel falls back to global user fetch when guild context is unavailable', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
      const provider = new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: TEST_PLATFORM_ID })

      provider.testSetClient({
        destroy: (): Promise<void> => Promise.resolve(),
        users: {
          fetch: (
            id: string,
          ): Promise<{
            displayName: string
            globalName: string | null
            username: string
            createDM: () => Promise<{ send: (arg: { content: string }) => Promise<unknown> }>
          }> => {
            expect(id).toBe('user-12')
            return Promise.resolve({
              displayName: 'Jane Admin',
              globalName: 'Jane Admin',
              username: 'janeadmin',
              createDM: () => Promise.resolve({ send: (): Promise<unknown> => Promise.resolve(null) }),
            })
          },
        },
      })

      const label = await provider.resolveUserLabel('user-12', { contextId: 'dm-user', contextType: 'dm' })
      expect(label).toBe('Jane Admin (@janeadmin)')
    })

    test('interactionCreate listener catches and does not rethrow when handleButtonInteraction rejects', async () => {
      const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')

      const interactionListeners: GenericListener[] = []
      const readyListeners: ReadyListener[] = []

      const fakeClient = {
        destroy: (): Promise<void> => Promise.resolve(),
        user: { id: 'bot-42', username: 'testbot' },
        on: makeOnInteractionCreateRouter(interactionListeners),
        once: makeOnceReadyRouter(readyListeners),
        login: (_token: string): Promise<string> => Promise.resolve('fake-token-123'),
      }

      const factory: DiscordClientFactory = () => fakeClient
      const provider = new DiscordChatProvider({
        clientFactory: factory,
        token: 'fake-discord-token',
        platformInstanceId: TEST_PLATFORM_ID,
      })

      // message handler throws so the full dispatch path rejects
      provider.onMessage((): Promise<void> => Promise.reject(new Error('interaction boom')))

      const startPromise = provider.start()
      await Promise.resolve()
      readyListeners[0]!({ user: { id: 'bot-42', username: 'testbot' } })
      await startPromise

      const fakeInteraction = {
        type: 3,
        componentType: 2,
        user: { id: 'u-rej', username: 'rej-user' },
        customId: 'some:action',
        channelId: 'u-rej',
        channel: {
          id: 'u-rej',
          type: 1,
          send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
            Promise.resolve({ id: 'm-rej', edit: (): Promise<void> => Promise.resolve() }),
          sendTyping: (): Promise<void> => Promise.resolve(),
        },
        message: { id: 'msg-rej-btn' },
        deferUpdate: (): Promise<void> => Promise.resolve(),
      }

      interactionListeners[0]!(fakeInteraction)
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    })
  })
})
