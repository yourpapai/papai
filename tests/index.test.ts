// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { BotDeps } from '../src/bot.js'
import type { ChatProvider } from '../src/chat/types.js'
import type { InstanceConfig, PlatformInstance, PlatformInstanceType } from '../src/instances/types.js'
import type { TaskProvider } from '../src/providers/types.js'

const indexModuleCoverage: null | typeof import('../src/index.js') = null
void indexModuleCoverage

type LoggerMethods = {
  info: (...args: readonly unknown[]) => void
  error: (...args: readonly unknown[]) => void
  warn: (...args: readonly unknown[]) => void
  debug: (...args: readonly unknown[]) => void
}

type MessageQueueModule = Pick<
  typeof import('../src/message-queue/index.js'),
  'registry' | 'cleanupExpiredQueues' | 'flushOnShutdown'
>

const countMatches = (source: string, pattern: RegExp): number => {
  const matches = source.match(pattern)
  return matches === null ? 0 : matches.length
}

const createMockChildLogger = (): LoggerMethods => ({
  info: (): void => undefined,
  error: (): void => undefined,
  warn: (): void => undefined,
  debug: (): void => undefined,
})

const isMessageQueueModule = (value: unknown): value is MessageQueueModule =>
  typeof value === 'object' &&
  value !== null &&
  'registry' in value &&
  'cleanupExpiredQueues' in value &&
  typeof value.cleanupExpiredQueues === 'function' &&
  'flushOnShutdown' in value &&
  typeof value.flushOnShutdown === 'function'

describe('index.ts - graceful shutdown', () => {
  beforeEach(() => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    delete process.env['KANEO_CLIENT_URL']
    delete process.env['DEBUG_SERVER']
  })
  test('message queue module exports a callable flushOnShutdown', () => {
    const result = Bun.spawnSync({
      cmd: [
        'bun',
        '-e',
        `const mod = await import('./src/message-queue/index.js?index-test=${crypto.randomUUID()}'); if (typeof mod.flushOnShutdown !== 'function') process.exit(1); await mod.flushOnShutdown({ timeoutMs: 5000 });`,
      ],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(result.exitCode).toBe(0)
  })

  test('startup wires graceful shutdown for SIGTERM and SIGINT', async () => {
    const source = await Bun.file('src/index.ts').text()

    expect(source).toContain("process.on('SIGTERM'")
    expect(source).toContain("process.on('SIGINT'")
    expect(countMatches(source, /flushOnShutdown\(\s*\{\s*timeoutMs:\s*5000\s*\}\s*\)/gu)).toBe(1)
    expect(source).toContain('clearRuntimeChatRouter()')
    expect(countMatches(source, /clearRuntimeChatRouter\(\)/gu)).toBe(1)
    expect(source.indexOf('clearRuntimeChatRouter()')).toBeLessThan(source.indexOf('chatProvider.stop()'))
  })

  test('startup registers bot wiring before provider start and passes a lazy staged downloader', async () => {
    delete process.env['CHAT_PROVIDER']
    const callOrder: string[] = []
    const activePlatformInstance = {
      id: 'telegram-default',
      type: 'telegram',
      config: { token: 'telegram-token' },
      status: 'active',
      createdAt: '2026-05-24T00:00:00.000Z',
    } as const satisfies PlatformInstance
    const invalidPlatformInstance = {
      id: 'telegram-invalid',
      type: 'telegram',
      config: { token: '' },
      status: 'active',
      createdAt: '2026-05-24T00:00:01.000Z',
    } as const satisfies PlatformInstance
    const activePlatformInstances = [activePlatformInstance, invalidPlatformInstance] as const
    const addedInstances: Array<Pick<PlatformInstance, 'id' | 'type' | 'config'>> = []
    let capturedDeps: BotDeps | undefined
    let capturedAnnouncementPlatformInstanceId: string | undefined
    const resolverContexts: string[] = []
    const loggedErrors: Array<readonly unknown[]> = []
    let telegramFetcher: ((fileId: string) => Promise<Buffer | null>) | undefined
    let mattermostFetcher: ((fileId: string) => Promise<Buffer | null>) | undefined
    let createChatProviderCalls = 0
    let createChatProviderFromConfigCalls = 0
    const runtimeRouterCalls: ChatProvider[] = []
    const originalExit = process.exit.bind(process)

    const chatProvider: ChatProvider = {
      name: 'telegram',
      threadCapabilities: {
        supportsThreads: true,
        canCreateThreads: true,
        threadScope: 'message',
      },
      capabilities: new Set(),
      traits: { observedGroupMessages: 'all' },
      configRequirements: [],
      registerCommand: (): void => undefined,
      onMessage: (): void => undefined,
      sendMessage: (): Promise<void> => Promise.resolve(),
      renderContext: () => ({ method: 'text', content: 'mock' }),
      start: (): Promise<void> => {
        callOrder.push('start')
        return Promise.resolve()
      },
      stop: (): Promise<void> => Promise.resolve(),
    }

    void mock.module('../src/announcements.js', () => ({
      announceNewVersion: (_chat: ChatProvider, platformInstanceId: string): Promise<void> => {
        capturedAnnouncementPlatformInstanceId = platformInstanceId
        return Promise.resolve()
      },
    }))
    void mock.module('../src/attachments/index.js', () => ({
      isS3Configured: (): boolean => true,
    }))
    void mock.module('../src/attachments/staged-download.js', () => ({
      createStagedDownloader: (deps: {
        telegramFetcher: (fileId: string) => Promise<Buffer | null>
        mattermostFetcher: (fileId: string) => Promise<Buffer | null>
      }): ((
        fileId: string,
        sourceProvider: 'telegram' | 'mattermost' | 'discord' | 'unknown',
      ) => Promise<Buffer | null>) => {
        const fetchers = {
          telegram: deps.telegramFetcher,
          mattermost: deps.mattermostFetcher,
          discord: (): Promise<Buffer | null> => Promise.resolve(null),
          unknown: (): Promise<Buffer | null> => Promise.resolve(null),
        } as const
        return (fileId, sourceProvider) => fetchers[sourceProvider](fileId)
      },
    }))
    void mock.module('../src/bot.js', () => ({
      setupBot: (_chat: ChatProvider, _adminUserId: string, deps: BotDeps): void => {
        callOrder.push('setupBot')
        capturedDeps = deps
      },
    }))
    const providerFactoriesById: Record<string, () => ChatProvider> = {
      [activePlatformInstance.id]: (): ChatProvider => chatProvider,
      [invalidPlatformInstance.id]: (): ChatProvider => {
        throw new Error('invalid platform config')
      },
    }

    void mock.module('../src/chat/registry.js', () => ({
      createChatProvider: (): ChatProvider => {
        createChatProviderCalls += 1
        return chatProvider
      },
      createChatProviderFromConfig: (
        id: string,
        _type: PlatformInstanceType,
        _config: InstanceConfig,
      ): ChatProvider => {
        createChatProviderFromConfigCalls += 1
        return providerFactoriesById[id]!()
      },
    }))
    void mock.module('../src/chat/router.js', () => ({
      ChatRouter: class MockChatRouter implements ChatProvider {
        readonly name = 'router'
        readonly threadCapabilities = chatProvider.threadCapabilities
        readonly capabilities = chatProvider.capabilities
        readonly traits = chatProvider.traits
        readonly configRequirements = []

        constructor(
          private readonly factory: (id: string, type: PlatformInstanceType, config: InstanceConfig) => ChatProvider,
        ) {}

        addInstance(id: string, type: PlatformInstanceType, config: InstanceConfig): void {
          void this.factory(id, type, config)
          addedInstances.push({ id, type, config })
        }

        registerCommand(name: string, handler: Parameters<ChatProvider['registerCommand']>[1]): void {
          chatProvider.registerCommand(name, handler)
        }

        onMessage(handler: Parameters<ChatProvider['onMessage']>[0]): void {
          chatProvider.onMessage(handler)
        }

        sendMessage(...args: Parameters<ChatProvider['sendMessage']>): Promise<void> {
          return chatProvider.sendMessage(...args)
        }

        renderContext(
          snapshot: Parameters<ChatProvider['renderContext']>[0],
        ): ReturnType<ChatProvider['renderContext']> {
          return chatProvider.renderContext(snapshot)
        }

        start(): Promise<void> {
          callOrder.push('start')
          return Promise.resolve()
        }

        stop(): Promise<void> {
          return Promise.resolve()
        }
      },
    }))
    void mock.module('../src/chat/startup.js', () => ({
      registerCommandMenuIfSupported: (): Promise<void> => Promise.resolve(),
    }))
    void mock.module('../src/chat/telegram/index.js', () => ({
      getTelegramFileFetcher: (): ((fileId: string) => Promise<Buffer | null>) | undefined => telegramFetcher,
    }))
    void mock.module('../src/chat/mattermost/index.js', () => ({
      getMattermostFileFetcher: (): ((fileId: string) => Promise<Buffer | null>) | undefined => mattermostFetcher,
    }))
    void mock.module('../src/db/drizzle.js', () => ({
      closeDrizzleDb: (): void => undefined,
    }))
    void mock.module('../src/db/index.js', () => ({
      closeMigrationDbInstance: (): void => undefined,
      initDb: (): void => undefined,
    }))
    void mock.module('../src/system-config.js', () => ({
      seedSystemConfigFromEnv: (): void => undefined,
      primeSystemConfigCache: (): void => undefined,
      missingSystemConfigKeys: (): readonly string[] => [],
      isSystemConfigComplete: (): boolean => true,
      getSystemConfig: (): string | null => null,
      setSystemConfig: (): void => undefined,
      SYSTEM_CONFIG_KEYS: [],
      resetSystemConfigCacheForTesting: (): void => undefined,
    }))
    void mock.module('../src/instances/bootstrap.js', () => ({
      bootstrapInstancesFromEnv: (): { bootstrapped: false; reason: 'no-env' } => ({
        bootstrapped: false,
        reason: 'no-env',
      }),
    }))
    void mock.module('../src/instances/platform-store.js', () => ({
      listActivePlatformInstances: (): readonly PlatformInstance[] => activePlatformInstances,
    }))
    void mock.module('../src/deferred-prompts/poller.js', () => ({
      startPollers: (_chat: ChatProvider, resolveProvider: (contextId: string) => TaskProvider | null): void => {
        void resolveProvider('poller-context-1')
      },
      stopPollers: (): void => undefined,
    }))
    void mock.module('../src/debug/chat-router-runtime.js', () => ({
      setRuntimeChatRouter: (router: ChatProvider): void => {
        runtimeRouterCalls.push(router)
      },
      getRuntimeChatRouter: (): ChatProvider | null => null,
      clearRuntimeChatRouter: (): void => {
        runtimeRouterCalls.length = 0
      },
    }))
    void mock.module('../src/logger.js', () => ({
      logger: {
        child: (): LoggerMethods => ({
          ...createMockChildLogger(),
          error: (...args: readonly unknown[]): void => {
            loggedErrors.push(args)
          },
        }),
      },
    }))
    void mock.module('../src/message-cache/index.js', () => ({
      initializeMessageCache: (): void => undefined,
    }))
    void mock.module('../src/message-queue/index.js', () => ({
      flushOnShutdown: (): Promise<void> => Promise.resolve(),
    }))
    void mock.module('../src/providers/resolver.js', () => ({
      defaultTaskProviderResolver: {
        resolve: (contextId: string): TaskProvider | null => {
          resolverContexts.push(contextId)
          return null
        },
      },
    }))
    void mock.module('../src/scheduler-instance.js', () => ({
      scheduler: {
        startAll: (): void => undefined,
        stopAll: (): void => undefined,
        hasTask: (): boolean => false,
        register: (): void => undefined,
        unregister: (): void => undefined,
        start: (): void => undefined,
        stop: (): void => undefined,
        getTaskState: (): undefined => undefined,
        on: (): void => undefined,
        off: (): void => undefined,
      },
    }))
    void mock.module('../src/scheduler.js', () => ({
      startScheduler: (): void => undefined,
      stopScheduler: (): void => undefined,
    }))
    void mock.module('../src/users.js', () => ({
      addUser: (): void => undefined,
    }))

    process.exit = ((...args: [] | [code: string | number | null]): never => {
      throw new Error(`process.exit:${String(args[0])}`)
    }) as typeof process.exit

    try {
      await import(`../src/index.js?startup-order=${crypto.randomUUID()}`)
    } finally {
      process.exit = originalExit
    }

    expect(callOrder).toEqual(['setupBot', 'start'])
    expect(addedInstances).toEqual([
      {
        id: activePlatformInstance.id,
        type: activePlatformInstance.type,
        config: activePlatformInstance.config,
      },
    ])
    expect(createChatProviderCalls).toBe(0)
    expect(createChatProviderFromConfigCalls).toBe(2)
    expect(runtimeRouterCalls).toHaveLength(1)
    expect(loggedErrors.length).toBeGreaterThan(0)
    expect(capturedAnnouncementPlatformInstanceId).toBe(activePlatformInstance.id)
    expect(resolverContexts).toEqual(['poller-context-1', 'admin-1'])
    assert.ok(capturedDeps !== undefined)
    assert.ok(capturedDeps.stagedDownloadFn !== undefined)

    telegramFetcher = (fileId: string): Promise<Buffer | null> => Promise.resolve(Buffer.from(`telegram:${fileId}`))

    const downloaded = await capturedDeps.stagedDownloadFn('file-123', 'telegram')

    assert.ok(downloaded !== null)
    expect(downloaded.toString()).toBe('telegram:file-123')

    mattermostFetcher = (fileId: string): Promise<Buffer | null> => Promise.resolve(Buffer.from(`mattermost:${fileId}`))

    const mattermostDownloaded = await capturedDeps.stagedDownloadFn('file-456', 'mattermost')

    assert.ok(mattermostDownloaded !== null)
    expect(mattermostDownloaded.toString()).toBe('mattermost:file-456')
  })

  test('global preload restores the real message queue module before the next test', async () => {
    const messageQueueModule: unknown = await import(`../src/message-queue/index.js?post-reset=${crypto.randomUUID()}`)

    expect(isMessageQueueModule(messageQueueModule)).toBe(true)
  })
})
