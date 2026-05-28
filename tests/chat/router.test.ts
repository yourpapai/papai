// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { ChatRouter, type ManagedChatInstance, type ManagedChatInstanceFactory } from '../../src/chat/router.js'
import { dmTarget } from '../../src/chat/types.js'
import type {
  AuthorizationResult,
  ChatCapability,
  ChatProvider,
  ChatProviderTraits,
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
import {
  createTrackedLoggerMock,
  mockLogger,
  seedCommonTestPlatformInstances,
  seedTestTaskInstance,
  setupTestDb,
} from '../utils/test-helpers.js'

type FakeProvider = ChatProvider & {
  deliverMessage: (msg: IncomingMessage) => Promise<void>
  deliverInteraction: (interaction: IncomingInteraction) => Promise<void>
  downloadFile: (fileId: string) => Promise<Buffer | null>
  downloadFileCalls: string[]
  sent: Array<{ platformInstanceId: string; target: DeferredDeliveryTarget; markdown: string }>
  commandNames: string[]
  commandHandlers: Record<string, CommandHandler>
  setCommandsCalls: string[]
}

type RouterModule = typeof import('../../src/chat/router.js')

const fakeReply: ReplyFn = {
  text: () => Promise.resolve(),
  formatted: () => Promise.resolve(),
  typing: () => {},
  buttons: () => Promise.resolve(),
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

const telegramTraits: ChatProviderTraits = { observedGroupMessages: 'all' }

const providerTraits: Record<string, ChatProviderTraits> = {
  discord: { observedGroupMessages: 'mentions_only' },
  mattermost: { observedGroupMessages: 'all' },
  telegram: telegramTraits,
}

const defaultThreadCapabilities: ThreadCapabilities = {
  supportsThreads: true,
  canCreateThreads: false,
  threadScope: 'message',
}

const noopPromise = (): Promise<void> => Promise.resolve()

const callResolver = (resolve: (() => void) | undefined): void => {
  if (resolve === undefined) throw new Error('resolver missing')
  resolve()
}

const requireSetCommands = (
  setCommandsById: Record<string, () => Promise<void>>,
  id: string,
): (() => Promise<void>) => {
  const setCommands = setCommandsById[id]
  if (setCommands === undefined) throw new Error(`missing setCommands for ${id}`)
  return setCommands
}

const isRouterModule = (module: unknown): module is RouterModule =>
  typeof module === 'object' && module !== null && 'ChatRouter' in module && typeof module.ChatRouter === 'function'

const loadFreshRouterModule = async (): Promise<RouterModule> => {
  const module: unknown = await import(`../../src/chat/router.js?test=${crypto.randomUUID()}`)
  if (!isRouterModule(module)) {
    throw new Error('Failed to load chat router module for testing')
  }
  return module
}

type FakeProviderOptions = Partial<{
  capabilities: readonly ChatCapability[]
  start: () => Promise<void>
  stop: () => Promise<void>
  render: ContextRendered
  setCommands: (adminUserId: string, calls: string[]) => Promise<void>
  threadCapabilities: ThreadCapabilities
  downloadFile: (fileId: string) => Promise<Buffer | null>
}>

const threadCapabilitiesForOptions = (options: FakeProviderOptions): ThreadCapabilities => {
  if (options.threadCapabilities === undefined) return defaultThreadCapabilities
  return options.threadCapabilities
}

const capabilitiesForOptions = (options: FakeProviderOptions): readonly ChatCapability[] => {
  if (options.capabilities === undefined) return []
  return options.capabilities
}

const traitsForName = (name: string): ChatProviderTraits => {
  const traits = providerTraits[name]
  if (traits === undefined) return telegramTraits
  return traits
}

const startForOptions = (options: FakeProviderOptions): (() => Promise<void>) => {
  if (options.start === undefined) return noopPromise
  return options.start
}

const stopForOptions = (options: FakeProviderOptions): (() => Promise<void>) => {
  if (options.stop === undefined) return noopPromise
  return options.stop
}

const makeProvider = (name: string, options: FakeProviderOptions): FakeProvider => {
  let messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null
  let interactionHandler: ((interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) | null = null
  const sent: Array<{ platformInstanceId: string; target: DeferredDeliveryTarget; markdown: string }> = []
  const commandNames: string[] = []
  const commandHandlers: Record<string, CommandHandler> = {}
  const setCommandsCalls: string[] = []
  const downloadFileCalls: string[] = []
  const setCommands = options.setCommands
  const render = options.render
  return {
    name,
    threadCapabilities: threadCapabilitiesForOptions(options),
    capabilities: new Set(capabilitiesForOptions(options)),
    traits: traitsForName(name),
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
    downloadFile: (fileId: string): Promise<Buffer | null> => {
      downloadFileCalls.push(fileId)
      if (options.downloadFile === undefined) return Promise.resolve(null)
      return options.downloadFile(fileId)
    },
    setCommands: (adminUserId): Promise<void> => {
      setCommandsCalls.push(adminUserId)
      if (setCommands === undefined) return Promise.resolve()
      return setCommands(adminUserId, setCommandsCalls)
    },
    renderContext: (): ContextRendered => {
      if (render === undefined) return { method: 'text', content: `${name} context` }
      return render
    },
    start: startForOptions(options),
    stop: stopForOptions(options),
    deliverMessage: async (msg): Promise<void> => {
      if (messageHandler === null) throw new Error('message handler missing')
      await messageHandler(msg, fakeReply)
    },
    deliverInteraction: async (interaction): Promise<void> => {
      if (interactionHandler === null) throw new Error('interaction handler missing')
      await interactionHandler(interaction, fakeReply)
    },
    sent,
    downloadFileCalls,
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

  const getProvider = (id: string): FakeProvider => {
    const instance = providers[id]
    if (instance === undefined) throw new Error(`missing provider ${id}`)
    return instance
  }

  const routerInstance = (id: string): ManagedChatInstance => {
    const instance = router.getInstance(id)
    if (instance === null) throw new Error(`missing instance ${id}`)
    return instance
  }

  const commandHandler = (providerId: string, commandName: string): CommandHandler => {
    const handler = getProvider(providerId).commandHandlers[commandName]
    if (handler === undefined) throw new Error(`missing command handler ${commandName}`)
    return handler
  }

  const instanceStatus = (id: string): string => {
    const instance = router.getInstance(id)
    if (instance === null) throw new Error(`missing instance ${id}`)
    return instance.status
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    seedTestTaskInstance({ id: 'tasks-1' })
    providers = {}
    factory = (id: string, type: PlatformInstanceType, _config: InstanceConfig): ChatProvider => {
      const fakeProvider = makeProvider(type, {})
      providers[id] = fakeProvider
      return fakeProvider
    }
    router = new ChatRouter(factory)
  })

  test('fans out command registrations and replays them to later instances', () => {
    router.addInstance('telegram-main', 'telegram', {})
    router.registerCommand('setup', () => Promise.resolve())

    router.addInstance('discord-main', 'discord', {})

    expect(getProvider('telegram-main').commandNames).toEqual(['setup'])
    expect(getProvider('discord-main').commandNames).toEqual(['setup'])
  })

  test('injects managed platform instance IDs into messages and interactions', async () => {
    const forwardedMessages: IncomingMessage[] = []
    const forwardedInteractions: IncomingInteraction[] = []
    router.addInstance('telegram-main', 'telegram', {})
    router.onMessage((msg): Promise<void> => {
      forwardedMessages.push(msg)
      return Promise.resolve()
    })
    router.onInteraction((interaction): Promise<void> => {
      forwardedInteractions.push(interaction)
      return Promise.resolve()
    })

    await getProvider('telegram-main').deliverMessage(makeMessage('wrong-id'))
    await getProvider('telegram-main').deliverInteraction(makeInteraction('wrong-id'))

    expect(forwardedMessages.map((msg): string => msg.platformInstanceId)).toEqual(['telegram-main'])
    expect(forwardedInteractions.map((interaction): string => interaction.platformInstanceId)).toEqual([
      'telegram-main',
    ])
  })

  test('routes proactive sends only to the named instance', async () => {
    router.addInstance('telegram-main', 'telegram', {})
    router.addInstance('discord-main', 'discord', {})
    await router.startInstance('discord-main')

    await router.sendMessage('discord-main', dmTarget('user-1'), 'hello')
    await router.sendMessage('missing', dmTarget('user-1'), 'ignored')

    expect(getProvider('telegram-main').sent).toEqual([])
    expect(getProvider('discord-main').sent).toEqual([
      { platformInstanceId: 'discord-main', target: dmTarget('user-1'), markdown: 'hello' },
    ])
  })

  test('refuses routed sends to pending and stopped instances', async () => {
    router.addInstance('pending-main', 'telegram', {})
    router.addInstance('stopped-main', 'discord', {})
    await router.startInstance('stopped-main')
    await router.stopInstance('stopped-main')

    const pendingDelivered = await router.sendMessage('pending-main', dmTarget('user-1'), 'pending')
    const stoppedDelivered = await router.sendMessage('stopped-main', dmTarget('user-1'), 'stopped')

    expect(pendingDelivered).toBe(false)
    expect(stoppedDelivered).toBe(false)
    expect(getProvider('pending-main').sent).toEqual([])
    expect(getProvider('stopped-main').sent).toEqual([])
  })

  test('marks instance inactive before awaiting stop to refuse racing sends', async () => {
    let resolveStop: (() => void) | undefined
    const stopPromise = new Promise<void>((resolve) => {
      resolveStop = resolve
    })
    factory = (id: string, type: PlatformInstanceType): ChatProvider => {
      const fakeProvider = makeProvider(type, { stop: () => stopPromise })
      providers[id] = fakeProvider
      return fakeProvider
    }
    router = new ChatRouter(factory)
    router.addInstance('telegram-main', 'telegram', {})
    await router.startInstance('telegram-main')

    const stopping = router.stopInstance('telegram-main')
    const delivered = await router.sendMessage('telegram-main', dmTarget('user-1'), 'racing')
    callResolver(resolveStop)
    await stopping

    expect(delivered).toBe(false)
    expect(getProvider('telegram-main').sent).toEqual([])
  })

  test('propagates delegated provider send refusal', async () => {
    factory = (id: string, type: PlatformInstanceType): ChatProvider => {
      const fakeProvider = {
        ...makeProvider(type, {}),
        sendMessage: (
          _platformInstanceId: string,
          _target: DeferredDeliveryTarget,
          _markdown: string,
        ): Promise<false> => Promise.resolve(false),
      }
      providers[id] = fakeProvider
      return fakeProvider
    }
    router = new ChatRouter(factory)
    router.addInstance('telegram-main', 'telegram', {})
    await router.startInstance('telegram-main')

    const delivered = await router.sendMessage('telegram-main', dmTarget('user-1'), 'refused')

    expect(delivered).toBe(false)
  })

  test('reports instance active state only after start and before stop', async () => {
    router.addInstance('telegram-main', 'telegram', {})

    expect(router.isInstanceActive('telegram-main')).toBe(false)
    expect(router.isInstanceActive('missing')).toBe(false)

    await router.startInstance('telegram-main')

    expect(router.isInstanceActive('telegram-main')).toBe(true)

    await router.stopInstance('telegram-main')

    expect(router.isInstanceActive('telegram-main')).toBe(false)
  })

  test('rejects duplicate instance IDs without replacing the existing provider', async () => {
    router.addInstance('same-id', 'telegram', {})
    const firstProvider = getProvider('same-id')

    expect(() => router.addInstance('same-id', 'discord', {})).toThrow('Chat instance already exists: same-id')

    expect(routerInstance('same-id').provider).toBe(firstProvider)
    await router.startInstance('same-id')
    await router.sendMessage('same-id', dmTarget('user-1'), 'hello')
    expect(firstProvider.sent).toEqual([
      { platformInstanceId: 'same-id', target: dmTarget('user-1'), markdown: 'hello' },
    ])
  })

  test('listInstances returns readonly snapshots of managed instances', async () => {
    router.addInstance('telegram-main', 'telegram', {})
    router.addInstance('discord-main', 'discord', {})
    await router.startInstance('telegram-main')
    await router.stopInstance('discord-main')

    const snapshots = router.listInstances()

    expect(snapshots).toEqual([
      { id: 'telegram-main', type: 'telegram', status: 'active' },
      { id: 'discord-main', type: 'discord', status: 'stopped' },
    ])
    expect('provider' in snapshots[0]!).toBe(false)
    expect(snapshots[0]).not.toBe(routerInstance('telegram-main'))
  })

  test('isolates start failures and starts remaining instances', async () => {
    const started: string[] = []
    const startById: Record<string, () => Promise<void>> = {
      bad: () => Promise.reject(new Error('boom')),
      good: () => Promise.resolve(started.push('good')).then(),
    }
    factory = (id: string, type: PlatformInstanceType): ChatProvider => {
      const fakeProvider = makeProvider(type, {
        start: startById[id],
      })
      providers[id] = fakeProvider
      return fakeProvider
    }
    router = new ChatRouter(factory)
    router.addInstance('bad', 'telegram', {})
    router.addInstance('good', 'discord', {})

    await expect(router.start()).resolves.toBeUndefined()

    expect(started).toEqual(['good'])
    expect(instanceStatus('bad')).toBe('stopped')
    expect(instanceStatus('good')).toBe('active')
  })

  test('isolates stop failures and stops remaining instances during router shutdown', async () => {
    const stopped: string[] = []
    const stopById: Record<string, () => Promise<void>> = {
      bad: () => {
        stopped.push('bad')
        return Promise.reject(new Error('stop failed'))
      },
      good: () => Promise.resolve(stopped.push('good')).then(),
    }
    factory = (id: string, type: PlatformInstanceType): ChatProvider => {
      const fakeProvider = makeProvider(type, {
        stop: stopById[id],
      })
      providers[id] = fakeProvider
      return fakeProvider
    }
    router = new ChatRouter(factory)
    router.addInstance('bad', 'telegram', {})
    router.addInstance('good', 'discord', {})

    await expect(router.stop()).resolves.toBeUndefined()

    expect(stopped).toEqual(['bad', 'good'])
    expect(instanceStatus('bad')).toBe('stopped')
    expect(instanceStatus('good')).toBe('stopped')
  })

  test('removes instances even when provider stop fails', async () => {
    factory = (id: string, type: PlatformInstanceType): ChatProvider => {
      const fakeProvider = makeProvider(type, { stop: () => Promise.reject(new Error(`stop ${id}`)) })
      providers[id] = fakeProvider
      return fakeProvider
    }
    router = new ChatRouter(factory)
    router.addInstance('telegram-main', 'telegram', {})

    await expect(router.removeInstance('telegram-main')).resolves.toBeUndefined()

    expect(router.getInstance('telegram-main')).toBeNull()
  })

  test('exposes metadata and delegates per-instance operations', async () => {
    factory = (id: string, type: PlatformInstanceType): ChatProvider => {
      const capabilitiesById: Record<string, readonly ChatCapability[]> = {
        'discord-main': ['messages.buttons', 'users.resolve'],
        'telegram-main': ['commands.menu'],
      }
      const fakeProvider = makeProvider(type, {
        capabilities: capabilitiesById[id],
        render: { method: 'text', content: `${id} rendered` },
      })
      providers[id] = fakeProvider
      return fakeProvider
    }
    router = new ChatRouter(factory)
    router.addInstance('telegram-main', 'telegram', {})
    router.addInstance('discord-main', 'discord', {})
    router.registerCommand('help', () => Promise.resolve())

    await router.setCommands('admin-1')
    const userId = await router.resolveUserId('alice', {
      contextId: 'user-1',
      contextType: 'dm',
      platformInstanceId: 'discord-main',
    })

    expect([...router.capabilities].toSorted()).toEqual(['commands.menu', 'messages.buttons', 'users.resolve'])
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
    expect(getProvider('telegram-main').setCommandsCalls).toEqual(['admin-1'])
    expect(getProvider('discord-main').setCommandsCalls).toEqual(['admin-1'])
    expect(userId).toBe('discord:alice')
  })

  test('getPlatformInstanceCapabilities returns capabilities for an active managed instance', async () => {
    const capabilityRouter = new ChatRouter((id: string, type: PlatformInstanceType, _config: InstanceConfig) => {
      const fakeProvider = makeProvider(type, { capabilities: ['messages.buttons'] })
      providers[id] = fakeProvider
      return fakeProvider
    })
    capabilityRouter.addInstance('telegram-a', 'telegram', { token: 'x' })
    await capabilityRouter.startInstance('telegram-a')

    expect(capabilityRouter.getPlatformInstanceCapabilities('telegram-a')).toEqual(new Set(['messages.buttons']))
    expect(capabilityRouter.getPlatformInstanceCapabilities('missing')).toEqual(new Set())
  })

  test('getPlatformInstanceCapabilities returns no capabilities for a stopped managed instance', async () => {
    const capabilityRouter = new ChatRouter((id: string, type: PlatformInstanceType, _config: InstanceConfig) => {
      const fakeProvider = makeProvider(type, { capabilities: ['messages.buttons'] })
      providers[id] = fakeProvider
      return fakeProvider
    })
    capabilityRouter.addInstance('telegram-a', 'telegram', { token: 'x' })
    await capabilityRouter.stopInstance('telegram-a')

    expect(capabilityRouter.getPlatformInstanceCapabilities('telegram-a')).toEqual(new Set())
  })

  test('downloads staged files through the active exact source instance', async () => {
    const bytes = Buffer.from('telegram-file')
    factory = (id: string, type: PlatformInstanceType): ChatProvider => {
      const fakeProvider = makeProvider(type, { downloadFile: () => Promise.resolve(bytes) })
      providers[id] = fakeProvider
      return fakeProvider
    }
    router = new ChatRouter(factory)
    router.addInstance('telegram-a', 'telegram', {})
    router.addInstance('telegram-b', 'telegram', {})
    await router.startInstance('telegram-a')
    await router.startInstance('telegram-b')

    const result = await router.downloadFileFromInstance('telegram-a', 'telegram', 'file-1')

    expect(result).toEqual(bytes)
    expect(getProvider('telegram-a').downloadFileCalls).toEqual(['file-1'])
    expect(getProvider('telegram-b').downloadFileCalls).toEqual([])
  })

  test('returns null when staged file source instance is missing inactive wrong-provider or lacks downloader', async () => {
    router.addInstance('inactive', 'telegram', {})
    router.addInstance('wrong-provider', 'mattermost', {})
    router.addInstance('active-no-downloader', 'discord', {})
    await router.startInstance('wrong-provider')
    await router.startInstance('active-no-downloader')

    expect(await router.downloadFileFromInstance('missing', 'telegram', 'file-1')).toBeNull()
    expect(await router.downloadFileFromInstance('inactive', 'telegram', 'file-1')).toBeNull()
    expect(await router.downloadFileFromInstance('wrong-provider', 'telegram', 'file-1')).toBeNull()
    expect(await router.downloadFileFromInstance('active-no-downloader', 'discord', 'file-1')).toBeNull()
  })

  test('uses context settings to resolve users and groups when platform instance context is absent', async () => {
    router.addInstance('telegram-main', 'telegram', {})
    router.addInstance('discord-main', 'discord', {})
    setContextSettings({ contextId: 'group-1', taskInstanceId: 'tasks-1', platformInstanceId: 'discord-main' })

    const userId = await router.resolveUserId('alice', { contextId: 'group-1', contextType: 'group' })
    const userLabel = await router.resolveUserLabel('user-42', { contextId: 'group-1', contextType: 'group' })
    const groupLabel = await router.resolveGroupLabel('group-1')

    expect(userId).toBe('discord:alice')
    expect(userLabel).toBe('discord:user-42')
    expect(groupLabel).toBe('discord:group-1')
  })

  test('rejects setting commands when one instance fails', async () => {
    const setCommandsById: Record<string, (adminUserId: string, calls: string[]) => Promise<void>> = {
      bad: () => Promise.reject(new Error('command menu failed')),
      good: () => Promise.resolve(),
    }
    factory = (id: string, type: PlatformInstanceType): ChatProvider => {
      const fakeProvider = makeProvider(type, {
        setCommands: setCommandsById[id],
      })
      providers[id] = fakeProvider
      return fakeProvider
    }
    router = new ChatRouter(factory)
    router.addInstance('bad', 'telegram', {})
    router.addInstance('good', 'discord', {})

    await expect(router.setCommands('admin-1')).rejects.toThrow('command menu failed')

    expect(getProvider('bad').setCommandsCalls).toEqual(['admin-1'])
    expect(getProvider('good').setCommandsCalls).toEqual(['admin-1'])
  })

  test('logs and rethrows synchronous command publication failures', async () => {
    const trackedLogger = createTrackedLoggerMock()
    void mock.module('../../src/logger.js', () => ({
      getLogLevel: trackedLogger.getLogLevel,
      logger: trackedLogger.logger,
    }))
    const routerModule = await loadFreshRouterModule()
    const FreshChatRouter = routerModule.ChatRouter

    const setCommandsById: Record<string, () => Promise<void>> = {
      bad: () => {
        throw new Error('sync command failure')
      },
      good: () => Promise.resolve(),
    }

    factory = (id: string, type: PlatformInstanceType): ChatProvider => {
      const fakeProvider = makeProvider(type, {
        setCommands: () => requireSetCommands(setCommandsById, id)(),
      })
      providers[id] = fakeProvider
      return fakeProvider
    }

    const freshRouter = new FreshChatRouter(factory)
    freshRouter.addInstance('bad', 'telegram', {})
    freshRouter.addInstance('good', 'discord', {})

    await expect(freshRouter.setCommands('admin-1')).rejects.toThrow('sync command failure')

    expect(getProvider('bad').setCommandsCalls).toEqual(['admin-1'])
    expect(getProvider('good').setCommandsCalls).toEqual(['admin-1'])
    expect(trackedLogger.getCallsByLevel('warn')).toContainEqual({
      level: 'warn',
      args: [{ platformInstanceId: 'bad', error: 'sync command failure' }, 'failed to set chat commands'],
    })
  })

  test('excludes stopped instances from aggregate metadata and command menus', async () => {
    const capabilitiesById: Record<string, readonly ChatCapability[]> = {
      active: ['users.resolve'],
      pending: ['messages.buttons'],
      stopped: ['commands.menu'],
    }
    const threadCapabilitiesById: Record<string, ThreadCapabilities> = {
      active: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
      pending: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
      stopped: { supportsThreads: true, canCreateThreads: true, threadScope: 'post' },
    }
    factory = (id: string, type: PlatformInstanceType): ChatProvider => {
      const fakeProvider = makeProvider(type, {
        capabilities: capabilitiesById[id],
        threadCapabilities: threadCapabilitiesById[id],
      })
      providers[id] = fakeProvider
      return fakeProvider
    }
    router = new ChatRouter(factory)
    router.addInstance('stopped', 'telegram', {})
    router.addInstance('pending', 'discord', {})
    router.addInstance('active', 'mattermost', {})
    await router.stopInstance('stopped')
    await router.startInstance('active')

    await router.setCommands('admin-1')

    expect([...router.capabilities].toSorted()).toEqual(['messages.buttons', 'users.resolve'])
    expect(router.traits).toEqual({ observedGroupMessages: 'mentions_only' })
    expect(router.threadCapabilities).toEqual({
      supportsThreads: false,
      canCreateThreads: false,
      threadScope: 'message',
    })
    expect(getProvider('stopped').setCommandsCalls).toEqual([])
    expect(getProvider('pending').setCommandsCalls).toEqual(['admin-1'])
    expect(getProvider('active').setCommandsCalls).toEqual(['admin-1'])
  })

  test('registered command handlers receive managed platform instance IDs', async () => {
    const commandMessages: IncomingMessage[] = []
    router.addInstance('telegram-main', 'telegram', {})
    router.registerCommand('setup', (msg): Promise<void> => {
      commandMessages.push(msg)
      return Promise.resolve()
    })

    const registered = getProvider('telegram-main').commandNames[0]
    expect(registered).toBe('setup')
    await commandHandler('telegram-main', 'setup')(makeMessage('wrong-id'), fakeReply, fakeAuth)

    expect(commandMessages.map((msg): string => msg.platformInstanceId)).toEqual(['telegram-main'])
  })
})
