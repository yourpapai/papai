// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { ChatRouter, type ManagedChatInstanceFactory } from '../../src/chat/router.js'
import { dmTarget } from '../../src/chat/types.js'
import type {
  AuthorizationResult,
  ChatCapability,
  ChatProvider,
  CommandHandler,
  ContextRendered,
  ContextSnapshot,
  DeferredDeliveryTarget,
  IncomingInteraction,
  IncomingMessage,
  ReplyFn,
  ThreadCapabilities,
} from '../../src/chat/types.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import type { InstanceConfig, PlatformInstanceType } from '../../src/instances/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

type FakeProvider = ChatProvider & {
  deliverMessage: (msg: IncomingMessage) => Promise<void>
  deliverInteraction: (interaction: IncomingInteraction) => Promise<void>
  sent: Array<{ platformInstanceId: string; target: DeferredDeliveryTarget; markdown: string }>
  commandNames: string[]
  commandHandlers: Record<string, CommandHandler>
  setCommandsCalls: string[]
}

const fakeReply: ReplyFn = {
  text: async () => undefined,
  formatted: async () => undefined,
  typing: () => undefined,
  buttons: async () => undefined,
}

const fakeAuth: AuthorizationResult = {
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: 'user-1',
}

const contextSnapshot: ContextSnapshot = {
  modelName: 'model',
  sections: [],
  totalTokens: 0,
  maxTokens: null,
  approximate: false,
}

const makeProvider = (
  name: string,
  options: Partial<{
    capabilities: readonly ChatCapability[]
    start: () => Promise<void>
    stop: () => Promise<void>
    render: ContextRendered
    setCommands: (adminUserId: string, calls: string[]) => Promise<void>
    threadCapabilities: ThreadCapabilities
  }> = {},
): FakeProvider => {
  let messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null
  let interactionHandler: ((interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) | null = null
  const sent: Array<{ platformInstanceId: string; target: DeferredDeliveryTarget; markdown: string }> = []
  const commandNames: string[] = []
  const commandHandlers: Record<string, CommandHandler> = {}
  const setCommandsCalls: string[] = []
  return {
    name,
    threadCapabilities: options.threadCapabilities ?? { supportsThreads: true, canCreateThreads: false, threadScope: 'message' },
    capabilities: new Set(options.capabilities ?? []),
    traits: { observedGroupMessages: name === 'discord' ? 'mentions_only' : 'all' },
    configRequirements: [],
    registerCommand: (commandName: string, _handler: CommandHandler): void => {
      commandNames.push(commandName)
      commandHandlers[commandName] = _handler
    },
    onMessage: (handler): void => {
      messageHandler = handler
    },
    onInteraction: (handler): void => {
      interactionHandler = handler
    },
    sendMessage: (platformInstanceId, target, markdown): Promise<void> => {
      sent.push({ platformInstanceId, target, markdown })
      return Promise.resolve()
    },
    resolveUserId: (username): Promise<string | null> => Promise.resolve(`${name}:${username}`),
    resolveUserLabel: (userId): Promise<string | null> => Promise.resolve(`${name}:${userId}`),
    resolveGroupLabel: (groupId): Promise<string | null> => Promise.resolve(`${name}:${groupId}`),
    setCommands: (adminUserId): Promise<void> => {
      setCommandsCalls.push(adminUserId)
      return options.setCommands?.(adminUserId, setCommandsCalls) ?? Promise.resolve()
    },
    renderContext: () => options.render ?? { method: 'text', content: `${name} context` },
    start: options.start ?? (() => Promise.resolve()),
    stop: options.stop ?? (() => Promise.resolve()),
    deliverMessage: async (msg): Promise<void> => {
      if (messageHandler === null) throw new Error('message handler missing')
      await messageHandler(msg, fakeReply)
    },
    deliverInteraction: async (interaction): Promise<void> => {
      if (interactionHandler === null) throw new Error('interaction handler missing')
      await interactionHandler(interaction, fakeReply)
    },
    sent,
    commandNames,
    commandHandlers,
    setCommandsCalls,
  }
}

const makeMessage = (platformInstanceId: string): IncomingMessage => ({
  user: { id: 'user-1', username: 'alice', isAdmin: false },
  contextId: 'user-1',
  contextType: 'dm',
  isMentioned: false,
  text: 'hello',
  platformInstanceId,
})

const makeInteraction = (platformInstanceId: string): IncomingInteraction => ({
  kind: 'button',
  user: { id: 'user-1', username: 'alice', isAdmin: false },
  contextId: 'user-1',
  contextType: 'dm',
  platformInstanceId,
  storageContextId: 'user-1',
  callbackData: 'callback',
})

describe('ChatRouter', () => {
  let providers: Record<string, FakeProvider>
  let factory: ManagedChatInstanceFactory
  let router: ChatRouter

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    providers = {}
    factory = (id: string, type: PlatformInstanceType, _config: InstanceConfig): ChatProvider => {
      const provider = makeProvider(type)
      providers[id] = provider
      return provider
    }
    router = new ChatRouter(factory)
  })

  test('fans out command registrations and replays them to later instances', () => {
    router.addInstance('telegram-main', 'telegram', {})
    router.registerCommand('setup', async () => undefined)

    router.addInstance('discord-main', 'discord', {})

    expect(providers['telegram-main']?.commandNames).toEqual(['setup'])
    expect(providers['discord-main']?.commandNames).toEqual(['setup'])
  })

  test('injects managed platform instance IDs into messages and interactions', async () => {
    const forwardedMessages: IncomingMessage[] = []
    const forwardedInteractions: IncomingInteraction[] = []
    router.addInstance('telegram-main', 'telegram', {})
    router.onMessage((msg) => {
      forwardedMessages.push(msg)
      return Promise.resolve()
    })
    router.onInteraction?.((interaction) => {
      forwardedInteractions.push(interaction)
      return Promise.resolve()
    })

    await providers['telegram-main']?.deliverMessage(makeMessage('wrong-id'))
    await providers['telegram-main']?.deliverInteraction(makeInteraction('wrong-id'))

    expect(forwardedMessages[0]?.platformInstanceId).toBe('telegram-main')
    expect(forwardedInteractions[0]?.platformInstanceId).toBe('telegram-main')
  })

  test('routes proactive sends only to the named instance', async () => {
    router.addInstance('telegram-main', 'telegram', {})
    router.addInstance('discord-main', 'discord', {})

    await router.sendMessage('discord-main', dmTarget('user-1'), 'hello')
    await router.sendMessage('missing', dmTarget('user-1'), 'ignored')

    expect(providers['telegram-main']?.sent).toEqual([])
    expect(providers['discord-main']?.sent).toEqual([
      { platformInstanceId: 'discord-main', target: dmTarget('user-1'), markdown: 'hello' },
    ])
  })

  test('rejects duplicate instance IDs without replacing the existing provider', async () => {
    router.addInstance('same-id', 'telegram', {})
    const firstProvider = providers['same-id']

    expect(() => router.addInstance('same-id', 'discord', {})).toThrow('Chat instance already exists: same-id')

    expect(router.getInstance('same-id')?.provider).toBe(firstProvider)
    await router.sendMessage('same-id', dmTarget('user-1'), 'hello')
    expect(firstProvider?.sent).toEqual([{ platformInstanceId: 'same-id', target: dmTarget('user-1'), markdown: 'hello' }])
  })

  test('isolates start failures and starts remaining instances', async () => {
    const started: string[] = []
    factory = (id: string, type: PlatformInstanceType): ChatProvider => {
      const provider = makeProvider(type, {
        start: id === 'bad' ? () => Promise.reject(new Error('boom')) : () => Promise.resolve(started.push(id)).then(),
      })
      providers[id] = provider
      return provider
    }
    router = new ChatRouter(factory)
    router.addInstance('bad', 'telegram', {})
    router.addInstance('good', 'discord', {})

    await expect(router.start()).resolves.toBeUndefined()

    expect(started).toEqual(['good'])
    expect(router.getInstance('bad')?.status).toBe('stopped')
    expect(router.getInstance('good')?.status).toBe('active')
  })

  test('isolates stop failures and stops remaining instances during router shutdown', async () => {
    const stopped: string[] = []
    factory = (id: string, type: PlatformInstanceType): ChatProvider => {
      const provider = makeProvider(type, {
        stop: async () => {
          stopped.push(id)
          if (id === 'bad') throw new Error('stop failed')
        },
      })
      providers[id] = provider
      return provider
    }
    router = new ChatRouter(factory)
    router.addInstance('bad', 'telegram', {})
    router.addInstance('good', 'discord', {})

    await expect(router.stop()).resolves.toBeUndefined()

    expect(stopped).toEqual(['bad', 'good'])
    expect(router.getInstance('bad')?.status).toBe('stopped')
    expect(router.getInstance('good')?.status).toBe('stopped')
  })

  test('removes instances even when provider stop fails', async () => {
    factory = (id: string, type: PlatformInstanceType): ChatProvider => {
      const provider = makeProvider(type, { stop: () => Promise.reject(new Error(`stop ${id}`)) })
      providers[id] = provider
      return provider
    }
    router = new ChatRouter(factory)
    router.addInstance('telegram-main', 'telegram', {})

    await expect(router.removeInstance('telegram-main')).resolves.toBeUndefined()

    expect(router.getInstance('telegram-main')).toBeNull()
  })

  test('exposes metadata and delegates per-instance operations', async () => {
    factory = (id: string, type: PlatformInstanceType): ChatProvider => {
      const provider = makeProvider(type, {
        capabilities: id === 'telegram-main' ? ['commands.menu'] : ['messages.buttons', 'users.resolve'],
        render: { method: 'text', content: `${id} rendered` },
      })
      providers[id] = provider
      return provider
    }
    router = new ChatRouter(factory)
    router.addInstance('telegram-main', 'telegram', {})
    router.addInstance('discord-main', 'discord', {})
    router.registerCommand('help', async () => undefined)

    await router.setCommands?.('admin-1')
    const userId = await router.resolveUserId?.('alice', {
      contextId: 'user-1',
      contextType: 'dm',
      platformInstanceId: 'discord-main',
    })

    expect([...router.capabilities].sort()).toEqual(['commands.menu', 'messages.buttons', 'users.resolve'])
    expect(router.getInstanceTraits('discord-main')).toEqual({ observedGroupMessages: 'mentions_only' })
    expect(router.traits).toEqual({ observedGroupMessages: 'all' })
    expect(router.renderContextForInstance('discord-main', contextSnapshot)).toEqual({
      method: 'text',
      content: 'discord-main rendered',
    })
    expect(router.renderContextForInstance('missing', contextSnapshot)).toEqual({
      method: 'text',
      content: 'telegram-main rendered',
    })
    expect(providers['telegram-main']?.setCommandsCalls).toEqual(['admin-1'])
    expect(providers['discord-main']?.setCommandsCalls).toEqual(['admin-1'])
    expect(userId).toBe('discord:alice')
  })

  test('uses context settings to resolve users and groups when platform instance context is absent', async () => {
    router.addInstance('telegram-main', 'telegram', {})
    router.addInstance('discord-main', 'discord', {})
    setContextSettings({ contextId: 'group-1', taskInstanceId: 'tasks-1', platformInstanceId: 'discord-main' })

    const userId = await router.resolveUserId?.('alice', { contextId: 'group-1', contextType: 'group' })
    const userLabel = await router.resolveUserLabel?.('user-42', { contextId: 'group-1', contextType: 'group' })
    const groupLabel = await router.resolveGroupLabel?.('group-1')

    expect(userId).toBe('discord:alice')
    expect(userLabel).toBe('discord:user-42')
    expect(groupLabel).toBe('discord:group-1')
  })

  test('continues setting commands when one instance fails', async () => {
    factory = (id: string, type: PlatformInstanceType): ChatProvider => {
      const provider = makeProvider(type, {
        setCommands: id === 'bad' ? () => Promise.reject(new Error('command menu failed')) : undefined,
      })
      providers[id] = provider
      return provider
    }
    router = new ChatRouter(factory)
    router.addInstance('bad', 'telegram', {})
    router.addInstance('good', 'discord', {})

    await expect(router.setCommands?.('admin-1')).resolves.toBeUndefined()

    expect(providers['bad']?.setCommandsCalls).toEqual(['admin-1'])
    expect(providers['good']?.setCommandsCalls).toEqual(['admin-1'])
  })

  test('excludes stopped instances from aggregate metadata and command menus', async () => {
    factory = (id: string, type: PlatformInstanceType): ChatProvider => {
      const provider = makeProvider(type, {
        capabilities:
          id === 'stopped'
            ? ['commands.menu']
            : id === 'pending'
              ? ['messages.buttons']
              : ['users.resolve'],
        threadCapabilities:
          id === 'stopped'
            ? { supportsThreads: true, canCreateThreads: true, threadScope: 'post' }
            : { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
      })
      providers[id] = provider
      return provider
    }
    router = new ChatRouter(factory)
    router.addInstance('stopped', 'telegram', {})
    router.addInstance('pending', 'discord', {})
    router.addInstance('active', 'mattermost', {})
    await router.stopInstance('stopped')
    await router.startInstance('active')

    await router.setCommands?.('admin-1')

    expect([...router.capabilities].sort()).toEqual(['messages.buttons', 'users.resolve'])
    expect(router.traits).toEqual({ observedGroupMessages: 'mentions_only' })
    expect(router.threadCapabilities).toEqual({ supportsThreads: false, canCreateThreads: false, threadScope: 'message' })
    expect(providers['stopped']?.setCommandsCalls).toEqual([])
    expect(providers['pending']?.setCommandsCalls).toEqual(['admin-1'])
    expect(providers['active']?.setCommandsCalls).toEqual(['admin-1'])
  })

  test('registered command handlers receive managed platform instance IDs', async () => {
    const commandMessages: IncomingMessage[] = []
    router.addInstance('telegram-main', 'telegram', {})
    router.registerCommand('setup', async (msg) => {
      commandMessages.push(msg)
    })

    const registered = providers['telegram-main']?.commandNames[0]
    expect(registered).toBe('setup')
    await providers['telegram-main']?.commandHandlers['setup']?.(makeMessage('wrong-id'), fakeReply, fakeAuth)

    expect(commandMessages[0]?.platformInstanceId).toBe('telegram-main')
  })
})
