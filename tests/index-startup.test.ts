// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { ChatRouter } from '../src/chat/router.js'
import type { ChatProvider } from '../src/chat/types.js'
import type { PlatformInstance } from '../src/instances/types.js'

type ProductionDepsModule = typeof import('../src/runtime/production-deps.js')

const isProductionDepsModule = (value: unknown): value is ProductionDepsModule =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'createProductionRuntimeDeps') === 'function'

async function loadProductionDeps(tag: string): Promise<ProductionDepsModule> {
  const loaded: unknown = await import(`../src/runtime/production-deps.ts?${tag}=${crypto.randomUUID()}`)
  if (isProductionDepsModule(loaded)) return loaded
  throw new Error('Production dependency module did not export createProductionRuntimeDeps')
}

const platformInstance = {
  id: 'telegram-a',
  type: 'telegram',
  config: { token: 'token' },
  status: 'active',
  createdAt: 'now',
} as const satisfies PlatformInstance

const fakeProvider = (): ChatProvider => ({
  name: 'mock',
  threadCapabilities: { supportsThreads: false, canCreateThreads: false, threadScope: 'message' },
  capabilities: new Set(),
  traits: { observedGroupMessages: 'all' },
  configRequirements: [],
  registerCommand: (): void => undefined,
  onMessage: (): void => undefined,
  sendMessage: (): Promise<void> => Promise.resolve(),
  renderContext: (): ReturnType<ChatProvider['renderContext']> => ({ method: 'text', content: 'mock' }),
  start: (): Promise<void> => Promise.resolve(),
  stop: (): Promise<void> => Promise.resolve(),
})

const mockMembership = (): void => {
  void mock.module('../src/providers/membership/index.js', () => ({
    defaultMembershipDeps: {},
    ensureWorkspaceMember: (): Promise<'skipped'> => Promise.resolve('skipped'),
    markMemberInactive: (): void => undefined,
    registerMembershipSubscriber: (): void => undefined,
    runMembershipBackfill: (): Promise<{ processed: number }> => Promise.resolve({ processed: 0 }),
  }))
}

describe('production dependency composition', () => {
  test('skips unreadable rows and evaluates plugin compatibility across readable instances', async () => {
    const warnings: string[] = []
    const events: string[] = []
    mockMembership()
    void mock.module('../src/logger.js', () => ({
      logger: {
        child: (): unknown => ({
          info: (): void => undefined,
          error: (): void => undefined,
          fatal: (): void => undefined,
          warn: (_data: unknown, message?: string): void => {
            warnings.push(String(message))
          },
        }),
      },
    }))
    void mock.module('../src/instances/platform-store.js', () => ({
      listActivePlatformInstancesSafe: (): unknown => ({
        instances: [platformInstance],
        failures: [{ id: 'bad-platform', error: 'unreadable' }],
      }),
    }))
    void mock.module('../src/instances/task-store.js', () => ({
      listTaskInstancesSafe: (): unknown => ({
        instances: [{ id: 'task-a', type: 'youtrack', config: {}, status: 'active', createdAt: 'now' }],
        failures: [{ id: 'bad-task', error: 'unreadable' }],
      }),
    }))
    void mock.module('../src/chat/registry.js', () => ({ createChatProviderFromConfig: fakeProvider }))
    void mock.module('../src/plugins/discovery.js', () => ({
      discoverPlugins: (): unknown => ({
        plugins: [{ manifest: { id: 'plugin-a' } }],
        errors: [],
        directoryMissing: false,
      }),
    }))
    void mock.module('../src/plugins/startup-guard.js', () => ({
      evaluateStartupGuard: (input: unknown): { readonly action: 'continue' } => {
        events.push(`guard:${JSON.stringify(input)}`)
        return { action: 'continue' }
      },
    }))
    void mock.module('../src/plugins/startup-compatibility.js', () => ({
      collectStartupCompatibilityInstances: (
        _router: unknown,
        taskInstances: readonly unknown[],
        platformInstances: readonly unknown[],
      ): readonly unknown[] => {
        events.push(`inputs:${String(platformInstances.length)}:${String(taskInstances.length)}`)
        return [...platformInstances, ...taskInstances]
      },
    }))
    void mock.module('../src/plugins/registry.js', () => ({
      syncRegistryFromDb: (): void => {
        events.push('registry:sync')
      },
      pluginRegistry: {
        evaluateCompatibilityAcrossInstances: (instances: readonly unknown[]): void => {
          events.push(`compatibility:${String(instances.length)}`)
        },
        getApprovedCompatiblePlugins: (): readonly string[] => ['plugin-a'],
      },
    }))
    void mock.module('../src/plugins/loader.js', () => ({
      activatePlugins: (plugins: readonly unknown[]): Promise<void> => {
        events.push(`activate:${String(plugins.length)}`)
        return Promise.resolve()
      },
      deactivateAllPlugins: (): Promise<void> => Promise.resolve(),
      getActivatedPluginIds: (): readonly string[] => ['plugin-a'],
    }))
    void mock.module('../src/instances/health.js', () => ({ warnUnresolvedTaskInstances: (): void => undefined }))
    void mock.module('../src/startup-helpers.js', () => ({ warnIfLegacyDebugToken: (): void => undefined }))

    const { createProductionRuntimeDeps } = await loadProductionDeps('compatibility')
    const scenarioRouter = new ChatRouter(() => {
      throw new Error('Scenario chat composition must not construct production adapters')
    })
    const deps = createProductionRuntimeDeps({
      chat: {
        createRouter: () => scenarioRouter,
        ingress: {
          dispatch: (): Promise<void> => Promise.resolve(),
          dispatchInteraction: (): Promise<void> => Promise.resolve(),
        },
        setRuntime: (): void => undefined,
        clearRuntime: (): void => undefined,
      },
    })
    const router = deps.chat.createRouter()
    await deps.extensions.start(router)

    expect(warnings).toContain('Skipping unreadable active platform instance during startup')
    expect(warnings).toContain('Skipping unreadable task instance during plugin compatibility evaluation')
    expect(events).toEqual([
      'guard:{"directoryMissing":false,"debugServerEnabled":false}',
      'registry:sync',
      'inputs:1:1',
      'compatibility:2',
      'activate:1',
    ])
  })

  test('preserves degraded plugin discovery guard behavior', async () => {
    const warnings: string[] = []
    mockMembership()
    void mock.module('../src/logger.js', () => ({
      logger: {
        child: (): unknown => ({
          info: (): void => undefined,
          error: (): void => undefined,
          fatal: (): void => undefined,
          warn: (_data: unknown, message?: string): void => {
            warnings.push(String(message))
          },
        }),
      },
    }))
    void mock.module('../src/instances/platform-store.js', () => ({
      listActivePlatformInstancesSafe: (): unknown => ({ instances: [], failures: [] }),
    }))
    void mock.module('../src/instances/task-store.js', () => ({
      listTaskInstancesSafe: (): unknown => ({ instances: [], failures: [] }),
    }))
    void mock.module('../src/plugins/discovery.js', () => ({
      discoverPlugins: (): unknown => ({ plugins: [], errors: [], directoryMissing: true }),
    }))
    void mock.module('../src/plugins/startup-guard.js', () => ({
      evaluateStartupGuard: (): unknown => ({ action: 'warn', reason: 'plugins directory missing' }),
    }))
    void mock.module('../src/plugins/registry.js', () => ({
      syncRegistryFromDb: (): void => undefined,
      pluginRegistry: {
        evaluateCompatibilityAcrossInstances: (): void => undefined,
        getApprovedCompatiblePlugins: (): readonly unknown[] => [],
      },
    }))
    void mock.module('../src/plugins/loader.js', () => ({
      activatePlugins: (): Promise<void> => Promise.resolve(),
      deactivateAllPlugins: (): Promise<void> => Promise.resolve(),
      getActivatedPluginIds: (): readonly string[] => [],
    }))
    void mock.module('../src/instances/health.js', () => ({ warnUnresolvedTaskInstances: (): void => undefined }))
    void mock.module('../src/startup-helpers.js', () => ({ warnIfLegacyDebugToken: (): void => undefined }))

    const { createProductionRuntimeDeps } = await loadProductionDeps('guard')
    const deps = createProductionRuntimeDeps()
    await deps.extensions.start(deps.chat.createRouter())

    expect(warnings).toContain('Starting in degraded mode')
  })

  test('starts the always-on web boundary with debug routes disabled and shares its route function', async () => {
    const starts: unknown[][] = []
    const route = mock(() => Promise.resolve(new Response('routed')))
    void mock.module('../src/debug/server.js', () => ({
      startDebugServer: (...args: unknown[]): void => {
        starts.push(args)
      },
      stopDebugServer: (): void => undefined,
      routeRequest: route,
    }))

    const { createProductionRuntimeDeps } = await loadProductionDeps('web')
    const deps = createProductionRuntimeDeps()
    delete process.env['DEBUG_SERVER']
    deps.web.start('admin-1')
    const response = await deps.web.route(new Request('http://scenario.test/health'))

    expect(starts).toEqual([['admin-1', { debugEnabled: false }]])
    expect(await response.text()).toBe('routed')
    expect(route).toHaveBeenCalledTimes(1)
  })
})
