import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { BotDeps } from '../src/bot.js'
import type { ChatProvider } from '../src/chat/types.js'

const indexModuleCoverage: null | typeof import('../src/index.js') = null
void indexModuleCoverage

type LoggerMethods = {
  info: () => void
  error: () => void
  warn: () => void
  debug: () => void
}

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

describe('index.ts - graceful shutdown', () => {
  beforeEach(() => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.example.test'
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
    expect(countMatches(source, /flushOnShutdown\(\s*\{\s*timeoutMs:\s*5000\s*\}\s*\)/g)).toBe(1)
  })

  test('startup registers bot wiring before provider start and passes a lazy staged downloader', async () => {
    const callOrder: string[] = []
    let capturedDeps: BotDeps | undefined
    let telegramFetcher: ((fileId: string) => Promise<Buffer | null>) | undefined

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
      announceNewVersion: (): Promise<void> => Promise.resolve(),
    }))
    void mock.module('../src/attachments/index.js', () => ({
      isS3Configured: (): boolean => true,
    }))
    void mock.module('../src/attachments/staged-download.js', () => ({
      createStagedDownloader: (deps: {
        telegramFetcher: (fileId: string) => Promise<Buffer | null>
        mattermostFetcher: (fileId: string) => Promise<Buffer | null>
      }): ((fileId: string) => Promise<Buffer | null>) => deps.telegramFetcher,
    }))
    void mock.module('../src/bot.js', () => ({
      setupBot: (_chat: ChatProvider, _adminUserId: string, deps: BotDeps): void => {
        callOrder.push('setupBot')
        capturedDeps = deps
      },
    }))
    void mock.module('../src/chat/registry.js', () => ({
      createChatProvider: (): ChatProvider => chatProvider,
    }))
    void mock.module('../src/chat/startup.js', () => ({
      registerCommandMenuIfSupported: (): Promise<void> => Promise.resolve(),
    }))
    void mock.module('../src/chat/telegram/index.js', () => ({
      getTelegramFileFetcher: (): ((fileId: string) => Promise<Buffer | null>) | undefined => telegramFetcher,
    }))
    void mock.module('../src/chat/mattermost/index.js', () => ({
      getMattermostFileFetcher: (): ((fileId: string) => Promise<Buffer | null>) | undefined => telegramFetcher,
    }))
    void mock.module('../src/db/drizzle.js', () => ({
      closeDrizzleDb: (): void => undefined,
    }))
    void mock.module('../src/db/index.js', () => ({
      closeMigrationDbInstance: (): void => undefined,
      initDb: (): void => undefined,
    }))
    void mock.module('../src/deferred-prompts/poller.js', () => ({
      startPollers: (): void => undefined,
      stopPollers: (): void => undefined,
    }))
    void mock.module('../src/logger.js', () => ({
      logger: {
        child: (): LoggerMethods => createMockChildLogger(),
      },
    }))
    void mock.module('../src/message-cache/index.js', () => ({
      initializeMessageCache: (): void => undefined,
    }))
    void mock.module('../src/message-queue/index.js', () => ({
      flushOnShutdown: (): Promise<void> => Promise.resolve(),
    }))
    void mock.module('../src/providers/factory.js', () => ({
      buildProviderForUser: (): null => null,
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

    await import(`../src/index.js?startup-order=${crypto.randomUUID()}`)

    expect(callOrder).toEqual(['setupBot', 'start'])
    assert.ok(capturedDeps !== undefined)
    assert.ok(capturedDeps.stagedDownloadFn !== undefined)

    telegramFetcher = (fileId: string): Promise<Buffer | null> => Promise.resolve(Buffer.from(`telegram:${fileId}`))

    const downloaded = await capturedDeps.stagedDownloadFn('file-123', 'telegram')

    assert.ok(downloaded !== null)
    expect(downloaded.toString()).toBe('telegram:file-123')
  })

  test('global preload restores the real message queue module before the next test', async () => {
    const messageQueueModule = await import(`../src/message-queue/index.js?post-reset=${crypto.randomUUID()}`)

    expect('registry' in messageQueueModule).toBe(true)
    expect(typeof messageQueueModule.cleanupExpiredQueues).toBe('function')
    expect(typeof messageQueueModule.flushOnShutdown).toBe('function')
  })
})
