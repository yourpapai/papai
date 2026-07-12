// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ChatRouter } from '../../src/chat/router.js'
import type { IncomingInteraction, IncomingMessage } from '../../src/chat/types.js'
import { createToolCapabilityCatalog } from '../../src/runtime/capability-catalog.js'
import { createPapaiRuntime } from '../../src/runtime/create-runtime.js'
import type { PapaiRuntime, PapaiRuntimeConfig, PapaiRuntimeDeps } from '../../src/runtime/types.js'

const config = {
  adminUserId: 'admin-1',
  pluginDirectory: '/scenario/plugins',
  startBackgroundServices: false,
  startNetworkServer: false,
  sendStartupAnnouncement: false,
} as const satisfies PapaiRuntimeConfig

const message = {
  user: { id: 'user-1', username: 'tester', isAdmin: true },
  contextId: 'user-1',
  contextType: 'dm',
  isMentioned: false,
  text: 'hello',
  platformInstanceId: 'scenario',
} as const satisfies IncomingMessage

const interaction = {
  kind: 'button',
  user: message.user,
  contextId: message.contextId,
  contextType: message.contextType,
  platformInstanceId: message.platformInstanceId,
  storageContextId: message.contextId,
  callbackData: 'confirm',
} as const satisfies IncomingInteraction

type FakeOptions = Readonly<{
  failAt?: string
  cleanupFailureAt?: string
  stopGate?: Promise<void>
}>

type FakeRuntime = Readonly<{
  deps: PapaiRuntimeDeps
  events: string[]
}>

function createFakeRuntime(options: FakeOptions = {}): FakeRuntime {
  const events: string[] = []
  const catalog = createToolCapabilityCatalog()
  catalog.register('stale', 'stale_wire')
  const record = (event: string): void => {
    events.push(event)
    if (options.failAt === event) throw new Error(`${event} failed`)
    if (options.cleanupFailureAt === event) throw new Error(`${event} failed`)
  }
  const router = new ChatRouter(() => {
    throw new Error('The runtime test does not create chat instances')
  })
  router.start = (): Promise<void> => {
    record('chat:start')
    return Promise.resolve()
  }
  router.stop = async (): Promise<void> => {
    record('chat:stop')
    await options.stopGate
  }

  const deps = {
    database: {
      start: (): void => record('database:start'),
      stop: (): void => record('database:stop'),
    },
    chat: {
      createRouter: (): ChatRouter => router,
      ingress: {
        dispatch: (): Promise<void> => {
          record('ingress:dispatch')
          return Promise.resolve()
        },
        dispatchInteraction: (): Promise<void> => {
          record('ingress:interaction')
          return Promise.resolve()
        },
      },
      setRuntime: (): void => record('chat:set-runtime'),
      clearRuntime: (): void => record('chat:clear-runtime'),
    },
    extensions: {
      start: (): Promise<readonly string[]> => {
        record('extensions:start')
        return Promise.resolve(['extension'])
      },
      stop: (): Promise<void> => {
        record('extensions:stop')
        return Promise.resolve()
      },
    },
    application: {
      initializeStores: (): void => record('stores:initialize'),
      setupBot: (): void => record('bot:setup'),
      registerCommandMenu: (): Promise<void> => {
        record('commands:register')
        return Promise.resolve()
      },
      announceStartup: (): Promise<void> => {
        record('announcement:send')
        return Promise.resolve()
      },
      flush: (): Promise<void> => {
        record('stores:flush')
        return Promise.resolve()
      },
    },
    background: {
      start: (): void => record('background:start'),
      stop: (): void => record('background:stop'),
    },
    web: {
      start: (): void => record('web:start'),
      stop: (): void => record('web:stop'),
      route: (): Promise<Response> => {
        record('web:route')
        return Promise.resolve(new Response('routed'))
      },
    },
    capabilities: {
      register: (capabilityId, wireName): void => catalog.register(capabilityId, wireName),
      resolve: (capabilityId): string => catalog.resolve(capabilityId),
      entries: (): ReadonlyArray<readonly [string, string]> => catalog.entries(),
      clear: (): void => {
        record('capabilities:clear')
        catalog.clear()
      },
    },
  } as const satisfies PapaiRuntimeDeps

  return { deps, events }
}

const startRuntime = async (fake: FakeRuntime, runtimeConfig: PapaiRuntimeConfig = config): Promise<PapaiRuntime> => {
  const runtime = createPapaiRuntime(runtimeConfig, fake.deps)
  await runtime.start()
  return runtime
}

function requireAggregateError(value: unknown): AggregateError {
  if (value instanceof AggregateError) return value
  throw new Error('Expected an AggregateError')
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

describe('createPapaiRuntime', () => {
  test('starts required services in runtime order and clears stale capabilities first', async () => {
    const fake = createFakeRuntime()
    await startRuntime(fake)

    expect(fake.events).toEqual([
      'capabilities:clear',
      'database:start',
      'stores:initialize',
      'chat:set-runtime',
      'extensions:start',
      'bot:setup',
      'chat:start',
      'commands:register',
    ])
    expect(() => fake.deps.capabilities.resolve('stale')).toThrow("Unknown tool capability id 'stale'")
  })

  test('starts enabled optional services after required startup', async () => {
    const fake = createFakeRuntime()
    await startRuntime(fake, {
      ...config,
      sendStartupAnnouncement: true,
      startBackgroundServices: true,
      startNetworkServer: true,
    })

    expect(fake.events.slice(-3)).toEqual(['announcement:send', 'background:start', 'web:start'])
  })

  test.each([
    ['sendStartupAnnouncement', 'announcement:send', ['background:start', 'web:start']],
    ['startBackgroundServices', 'background:start', ['announcement:send', 'web:start']],
    ['startNetworkServer', 'web:start', ['announcement:send', 'background:start']],
  ] as const)('honors the %s flag independently', async (flag, expectedEvent, absentEvents) => {
    const fake = createFakeRuntime()
    await startRuntime(fake, { ...config, [flag]: true })

    expect(fake.events.filter((event) => event === expectedEvent)).toHaveLength(1)
    expect(fake.events).not.toContain(absentEvents[0])
    expect(fake.events).not.toContain(absentEvents[1])
  })

  test('stops cleanups in safety-priority order', async () => {
    const fake = createFakeRuntime()
    const runtime = await startRuntime(fake, {
      ...config,
      startBackgroundServices: true,
      startNetworkServer: true,
    })

    await runtime.stop()

    expect(fake.events.slice(-8)).toEqual([
      'chat:clear-runtime',
      'stores:flush',
      'extensions:stop',
      'background:stop',
      'web:stop',
      'chat:stop',
      'capabilities:clear',
      'database:stop',
    ])
  })

  test('rolls back database, stores, ingress, and capabilities when extensions fail', async () => {
    const fake = createFakeRuntime({ failAt: 'extensions:start' })
    const runtime = createPapaiRuntime(config, fake.deps)

    await expect(runtime.start()).rejects.toThrow('extensions:start failed')

    expect(fake.events).toEqual([
      'capabilities:clear',
      'database:start',
      'stores:initialize',
      'chat:set-runtime',
      'extensions:start',
      'chat:clear-runtime',
      'stores:flush',
      'capabilities:clear',
      'database:stop',
    ])
    await expect(runtime.dispatch(message)).rejects.toThrow('Papai runtime is not started')
  })

  test('rolls back the router and extensions when a later startup phase fails', async () => {
    const fake = createFakeRuntime({ failAt: 'commands:register' })
    const runtime = createPapaiRuntime(config, fake.deps)

    await expect(runtime.start()).rejects.toThrow('commands:register failed')

    expect(fake.events.slice(-6)).toEqual([
      'chat:clear-runtime',
      'stores:flush',
      'extensions:stop',
      'chat:stop',
      'capabilities:clear',
      'database:stop',
    ])
  })

  test('preserves startup and rollback failures deterministically', async () => {
    const fake = createFakeRuntime({ failAt: 'extensions:start', cleanupFailureAt: 'database:stop' })
    const runtime = createPapaiRuntime(config, fake.deps)

    const caught: unknown = await runtime.start().catch((error: unknown): unknown => error)
    const failure = requireAggregateError(caught)

    expect(failure.message).toBe('Papai runtime startup and rollback failed')
    expect(failure.errors.map(errorMessage)).toEqual([
      'extensions:start failed',
      'Runtime cleanup failed: database: database:stop failed',
    ])
  })

  test('guards runtime access before start and after stop', async () => {
    const fake = createFakeRuntime()
    const runtime = createPapaiRuntime(config, fake.deps)

    await expect(runtime.dispatch(message)).rejects.toThrow('Papai runtime is not started')
    await expect(runtime.dispatchInteraction(interaction)).rejects.toThrow('Papai runtime is not started')
    await expect(runtime.request(new Request('http://scenario.test'))).rejects.toThrow('Papai runtime is not started')
    expect(() => runtime.resolveToolCapability('known')).toThrow('Papai runtime is not started')

    await runtime.start()
    await runtime.stop()

    await expect(runtime.dispatch(message)).rejects.toThrow('Papai runtime is not started')
    expect(() => runtime.resolveToolCapability('known')).toThrow('Papai runtime is not started')
  })

  test('delegates ingress, web routing, and capability resolution while started', async () => {
    const fake = createFakeRuntime()
    const runtime = await startRuntime(fake)
    fake.deps.capabilities.register('known', 'known_wire')

    await runtime.dispatch(message)
    await runtime.dispatchInteraction(interaction)
    expect(await runtime.request(new Request('http://scenario.test'))).toEqual(new Response('routed'))
    expect(runtime.resolveToolCapability('known')).toBe('known_wire')
    expect(fake.events.slice(-3)).toEqual(['ingress:dispatch', 'ingress:interaction', 'web:route'])
  })

  test('rejects duplicate and concurrent starts without restarting resources', async () => {
    const fake = createFakeRuntime()
    const runtime = createPapaiRuntime(config, fake.deps)
    const firstStart = runtime.start()

    await expect(runtime.start()).rejects.toThrow("Papai runtime cannot start from state 'starting'")
    await firstStart
    await expect(runtime.start()).rejects.toThrow("Papai runtime cannot start from state 'started'")
    expect(fake.events.filter((event) => event === 'database:start')).toHaveLength(1)
  })

  test('shares concurrent stop work and remains stopped after cleanup failure', async () => {
    let releaseStop: (() => void) | undefined
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve
    })
    const fake = createFakeRuntime({ stopGate, cleanupFailureAt: 'database:stop' })
    const runtime = await startRuntime(fake)
    const firstStop = runtime.stop()
    const secondStop = runtime.stop()

    releaseStop?.()
    await expect(firstStop).rejects.toThrow('Runtime cleanup failed: database: database:stop failed')
    await expect(secondStop).rejects.toThrow('Runtime cleanup failed: database: database:stop failed')
    await runtime.stop()
    expect(fake.events.filter((event) => event === 'database:stop')).toHaveLength(1)
    await expect(runtime.dispatch(message)).rejects.toThrow('Papai runtime is not started')
  })
})
