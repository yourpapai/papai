// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

const restoreAdminUserId = (originalValue: string | undefined): void => {
  if (originalValue === undefined) {
    delete process.env['ADMIN_USER_ID']
    return
  }
  process.env['ADMIN_USER_ID'] = originalValue
}

describe('index.ts startup', () => {
  const warnedUnreadableTaskMessage = (
    calls: readonly { readonly data: unknown; readonly message?: string }[],
  ): boolean =>
    calls.some(
      (call) =>
        call.message === 'Skipping unreadable task instance during plugin compatibility evaluation' &&
        typeof call.data === 'object' &&
        call.data !== null &&
        Reflect.get(call.data, 'id') === 'bad',
    )

  test('does not auto-add ADMIN_USER_ID to authorized users', async () => {
    const source = await Bun.file('src/index.ts').text()

    expect(source).not.toMatch(/import\s+\{[^}]*addUser/u)
    expect(source).not.toMatch(/\baddUser\s*\(/u)
  })

  test('evaluates plugin compatibility across startup instances', async () => {
    const originalAdminUserId = process.env['ADMIN_USER_ID']
    process.env['ADMIN_USER_ID'] = 'admin-1'
    let evaluatedCompatibilityInstances = 0
    let resolverCalls = 0

    void mock.module('../src/announcements.js', () => ({ announceNewVersion: (): void => {} }))
    void mock.module('../src/attachments/index.js', () => ({ isS3Configured: (): boolean => false }))
    void mock.module('../src/attachments/staged-download.js', () => ({
      createStagedDownloader: (): (() => Promise<null>) => () => Promise.resolve(null),
    }))
    void mock.module('../src/bot.js', () => ({ setupBot: (): void => {} }))
    void mock.module('../src/chat/registry.js', () => ({
      createChatProviderFromConfig: (): unknown => ({
        name: 'mock',
        threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
        capabilities: new Set(['messages.buttons']),
        traits: { observedGroupMessages: 'all' },
        configRequirements: [],
        registerCommand: (): void => {},
        onMessage: (): void => {},
        sendMessage: (): Promise<void> => Promise.resolve(),
        renderContext: (): unknown => ({ method: 'text', content: 'mock' }),
        start: (): Promise<void> => Promise.resolve(),
        stop: (): Promise<void> => Promise.resolve(),
      }),
    }))
    void mock.module('../src/chat/startup.js', () => ({ registerCommandMenuIfSupported: (): void => {} }))
    void mock.module('../src/chat/telegram/index.js', () => ({ getTelegramFileFetcher: (): undefined => undefined }))
    void mock.module('../src/chat/mattermost/index.js', () => ({
      getMattermostFileFetcher: (): undefined => undefined,
    }))
    void mock.module('../src/db/index.js', () => ({ initDb: (): void => {}, closeMigrationDbInstance: (): void => {} }))
    void mock.module('../src/db/drizzle.js', () => ({ closeDrizzleDb: (): void => {} }))
    void mock.module('../src/debug/chat-router-runtime.js', () => ({
      setRuntimeChatRouter: (): void => {},
      clearRuntimeChatRouter: (): void => {},
    }))
    void mock.module('../src/deferred-prompts/poller.js', () => ({
      startPollers: (): void => {},
      stopPollers: (): void => {},
    }))
    void mock.module('../src/instances/bootstrap.js', () => ({
      bootstrapInstancesFromEnv: (): unknown => ({ bootstrapped: false, reason: 'already-bootstrapped' }),
    }))
    void mock.module('../src/instances/platform-store.js', () => ({
      listActivePlatformInstancesSafe: (): unknown => ({
        instances: [{ id: 'telegram-a', type: 'telegram', config: { token: 'x' }, status: 'active', createdAt: 'now' }],
        failures: [],
      }),
    }))
    void mock.module('../src/instances/task-store.js', () => ({
      listTaskInstancesSafe: (): unknown => ({
        instances: [
          {
            id: 'youtrack-a',
            type: 'youtrack',
            config: { baseUrl: 'https://youtrack.invalid' },
            status: 'active',
            createdAt: 'now',
          },
        ],
        failures: [],
      }),
    }))
    void mock.module('../src/message-cache/index.js', () => ({ initializeMessageCache: (): void => {} }))
    void mock.module('../src/message-queue/index.js', () => ({
      flushOnShutdown: (): Promise<void> => Promise.resolve(),
    }))
    void mock.module('../src/plugins/discovery.js', () => ({
      discoverPlugins: (): unknown => ({ plugins: [], errors: [] }),
    }))
    void mock.module('../src/plugins/loader.js', () => ({
      activatePlugins: (): Promise<void> => Promise.resolve(),
      deactivateAllPlugins: (): Promise<void> => Promise.resolve(),
      getActivatedPluginIds: (): unknown[] => [],
    }))
    void mock.module('../src/plugins/registry.js', () => ({
      syncRegistryFromDb: (): void => {},
      pluginRegistry: {
        evaluateCompatibilityAcrossInstances: (instances: readonly unknown[]): void => {
          evaluatedCompatibilityInstances = instances.length
        },
        getApprovedCompatiblePlugins: (): unknown[] => [],
      },
    }))
    void mock.module('../src/providers/resolver.js', () => ({
      defaultTaskProviderResolver: {
        resolve: (): null => {
          resolverCalls += 1
          return null
        },
      },
    }))
    void mock.module('../src/scheduler-instance.js', () => ({
      scheduler: { startAll: (): void => {}, stopAll: (): void => {} },
    }))
    void mock.module('../src/scheduler.js', () => ({ startScheduler: (): void => {}, stopScheduler: (): void => {} }))
    void mock.module('../src/system-config.js', () => ({
      seedSystemConfigFromEnv: (): void => {},
      missingSystemConfigKeys: (): string[] => [],
    }))
    void mock.module('../src/usage/index.js', () => ({ initUsageRecorder: (): void => {} }))

    try {
      await import(`../src/index.ts?startup-compatibility=${Date.now()}`)
    } finally {
      restoreAdminUserId(originalAdminUserId)
    }

    expect(evaluatedCompatibilityInstances).toBeGreaterThan(0)
    expect(resolverCalls).toBe(0)
  })

  test('unreadable task rows do not block plugin compatibility evaluation for readable task rows', async () => {
    const originalAdminUserId = process.env['ADMIN_USER_ID']
    process.env['ADMIN_USER_ID'] = 'admin-1'
    let evaluatedCompatibilityInstances = 0
    let compatibilityEvaluated = false
    const warnCalls: Array<{ readonly data: unknown; readonly message?: string }> = []

    void mock.module('../src/announcements.js', () => ({ announceNewVersion: (): void => {} }))
    void mock.module('../src/attachments/index.js', () => ({ isS3Configured: (): boolean => false }))
    void mock.module('../src/attachments/staged-download.js', () => ({
      createStagedDownloader: (): (() => Promise<null>) => () => Promise.resolve(null),
    }))
    void mock.module('../src/bot.js', () => ({ setupBot: (): void => {} }))
    void mock.module('../src/chat/registry.js', () => ({
      createChatProviderFromConfig: (): unknown => ({
        name: 'mock',
        threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
        capabilities: new Set(['messages.buttons']),
        traits: { observedGroupMessages: 'all' },
        configRequirements: [],
        registerCommand: (): void => {},
        onMessage: (): void => {},
        sendMessage: (): Promise<void> => Promise.resolve(),
        renderContext: (): unknown => ({ method: 'text', content: 'mock' }),
        start: (): Promise<void> => Promise.resolve(),
        stop: (): Promise<void> => Promise.resolve(),
      }),
    }))
    void mock.module('../src/chat/startup.js', () => ({ registerCommandMenuIfSupported: (): void => {} }))
    void mock.module('../src/chat/telegram/index.js', () => ({ getTelegramFileFetcher: (): undefined => undefined }))
    void mock.module('../src/chat/mattermost/index.js', () => ({
      getMattermostFileFetcher: (): undefined => undefined,
    }))
    void mock.module('../src/db/index.js', () => ({ initDb: (): void => {}, closeMigrationDbInstance: (): void => {} }))
    void mock.module('../src/db/drizzle.js', () => ({ closeDrizzleDb: (): void => {} }))
    void mock.module('../src/debug/chat-router-runtime.js', () => ({
      setRuntimeChatRouter: (): void => {},
      clearRuntimeChatRouter: (): void => {},
    }))
    void mock.module('../src/deferred-prompts/poller.js', () => ({
      startPollers: (): void => {},
      stopPollers: (): void => {},
    }))
    void mock.module('../src/instances/bootstrap.js', () => ({
      bootstrapInstancesFromEnv: (): unknown => ({ bootstrapped: false, reason: 'already-bootstrapped' }),
    }))
    void mock.module('../src/instances/platform-store.js', () => ({
      listActivePlatformInstancesSafe: (): unknown => ({
        instances: [{ id: 'telegram-a', type: 'telegram', config: { token: 'x' }, status: 'active', createdAt: 'now' }],
        failures: [],
      }),
    }))
    void mock.module('../src/instances/task-store.js', () => ({
      listTaskInstancesSafe: (): unknown => ({
        instances: [
          {
            id: 'youtrack-a',
            type: 'youtrack',
            config: { baseUrl: 'https://youtrack.invalid' },
            status: 'active',
            createdAt: 'now',
          },
        ],
        failures: [{ table: 'task_instances', id: 'bad', type: 'youtrack', error: 'Encrypted payload malformed' }],
      }),
    }))
    void mock.module('../src/logger.js', () => ({
      logger: {
        child: (): unknown => ({
          info: (): void => {},
          error: (): void => {},
          debug: (): void => {},
          warn: (data: unknown, message?: string): void => {
            warnCalls.push({ data, message })
          },
        }),
      },
    }))
    void mock.module('../src/message-cache/index.js', () => ({ initializeMessageCache: (): void => {} }))
    void mock.module('../src/message-queue/index.js', () => ({
      flushOnShutdown: (): Promise<void> => Promise.resolve(),
    }))
    void mock.module('../src/plugins/discovery.js', () => ({
      discoverPlugins: (): unknown => ({ plugins: [], errors: [] }),
    }))
    void mock.module('../src/plugins/loader.js', () => ({
      activatePlugins: (): Promise<void> => Promise.resolve(),
      deactivateAllPlugins: (): Promise<void> => Promise.resolve(),
      getActivatedPluginIds: (): unknown[] => [],
    }))
    void mock.module('../src/plugins/registry.js', () => ({
      syncRegistryFromDb: (): void => {},
      pluginRegistry: {
        evaluateCompatibilityAcrossInstances: (instances: readonly unknown[]): void => {
          compatibilityEvaluated = true
          evaluatedCompatibilityInstances = instances.length
        },
        getApprovedCompatiblePlugins: (): unknown[] => [],
      },
    }))
    void mock.module('../src/providers/resolver.js', () => ({
      defaultTaskProviderResolver: { resolve: (): null => null },
    }))
    void mock.module('../src/scheduler-instance.js', () => ({
      scheduler: { startAll: (): void => {}, stopAll: (): void => {} },
    }))
    void mock.module('../src/scheduler.js', () => ({ startScheduler: (): void => {}, stopScheduler: (): void => {} }))
    void mock.module('../src/system-config.js', () => ({
      seedSystemConfigFromEnv: (): void => {},
      missingSystemConfigKeys: (): string[] => [],
    }))
    void mock.module('../src/usage/index.js', () => ({ initUsageRecorder: (): void => {} }))

    try {
      await import(`../src/index.ts?startup-safe-task-compatibility=${Date.now()}`)
    } finally {
      restoreAdminUserId(originalAdminUserId)
    }

    expect(compatibilityEvaluated).toBe(true)
    expect(evaluatedCompatibilityInstances).toBeGreaterThan(0)
    expect(warnedUnreadableTaskMessage(warnCalls)).toBe(true)
  })
})
