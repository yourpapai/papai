// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ChatRouter } from '../../src/chat/router.js'
import type { IncomingInteraction, IncomingMessage } from '../../src/chat/types.js'
import { subscribeCountForTest } from '../../src/debug/event-bus.js'
import { toolCapabilityCatalog } from '../../src/runtime/capability-catalog.js'
import { createPapaiRuntime } from '../../src/runtime/create-runtime.js'
import { createProductionRuntimeDeps } from '../../src/runtime/production-deps.js'
import {
  DEFAULT_SCHEDULER_TASK_NAMES,
  scheduler,
  unregisterDefaultSchedulerTasks,
} from '../../src/scheduler-instance.js'
import { setupTestDb } from '../utils/test-helpers.js'

const message = {
  user: { id: 'user-1', username: 'tester', isAdmin: false },
  contextId: 'user-1',
  contextType: 'dm',
  isMentioned: false,
  text: 'hello',
  platformInstanceId: 'production',
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

describe('createProductionRuntimeDeps', () => {
  test('starts and stops lazily loaded production background services when enabled', async () => {
    await setupTestDb()
    unregisterDefaultSchedulerTasks()
    const router = new ChatRouter(() => {
      throw new Error('No adapters are created by the background lifecycle test')
    })
    const deps = createProductionRuntimeDeps()

    await deps.background.start(router)
    expect(DEFAULT_SCHEDULER_TASK_NAMES.every((name) => scheduler.getTaskState(name)?.running === true)).toBe(true)

    let releaseHandler: (() => void) | undefined
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const gate = new Promise<void>((resolve) => {
      releaseHandler = resolve
    })
    scheduler.register('background-drain-test', {
      interval: 1000,
      handler: async (): Promise<void> => {
        markStarted?.()
        await gate
      },
      options: { immediate: true },
    })
    await started
    let stopCompleted = false
    const stopping = Promise.resolve(deps.background.stop()).then((): void => {
      stopCompleted = true
    })
    await Promise.resolve()
    expect(stopCompleted).toBe(false)
    releaseHandler?.()
    await stopping

    expect(DEFAULT_SCHEDULER_TASK_NAMES.every((name) => !scheduler.hasTask(name))).toBe(true)
    scheduler.unregister('background-drain-test')
  })
  test('uses the production capability catalog identity unless capabilities are overridden', () => {
    const defaults = createProductionRuntimeDeps()
    let cleared = false
    const overridden = createProductionRuntimeDeps({
      capabilities: {
        clear: (): void => {
          cleared = true
        },
      },
    })

    expect(Object.is(defaults.capabilities, toolCapabilityCatalog)).toBe(true)
    expect(Object.is(overridden.capabilities, toolCapabilityCatalog)).toBe(false)
    overridden.capabilities.clear()
    expect(cleared).toBe(true)
    expect(typeof overridden.capabilities.resolve).toBe('function')
  })

  test('shallow-merges overrides within each dependency group', async () => {
    let started = false
    const start = (): void => {
      started = true
    }

    const deps = createProductionRuntimeDeps({ database: { start } })

    await deps.database.start()
    expect(started).toBe(true)
    expect(typeof deps.database.stop).toBe('function')
    expect(typeof deps.application.setupBot).toBe('function')
  })

  test('rejects programmatic ingress when no scenario transport is configured', async () => {
    const deps = createProductionRuntimeDeps()

    await expect(deps.chat.ingress.dispatch(message)).rejects.toThrow(
      'Programmatic ingress is available only when configured',
    )
    await expect(deps.chat.ingress.dispatchInteraction(interaction)).rejects.toThrow(
      'Programmatic ingress is available only when configured',
    )
  })

  test('sets up the bot before chat start and preserves production shutdown safety order', async () => {
    const events: string[] = []
    const record = (event: string): void => {
      events.push(event)
    }
    const router = new ChatRouter(() => {
      throw new Error('No chat instances are created by this composition test')
    })
    router.start = (): Promise<void> => {
      record('chat:start')
      return Promise.resolve()
    }
    router.stop = (): Promise<void> => {
      record('chat:stop')
      return Promise.resolve()
    }
    const deps = createProductionRuntimeDeps({
      database: { start: () => record('database:start'), stop: () => record('database:stop') },
      chat: {
        createRouter: () => router,
        setRuntime: () => record('chat:set-runtime'),
        clearRuntime: () => record('chat:clear-runtime'),
      },
      extensions: {
        start: (): Promise<readonly string[]> => {
          record('extensions:start')
          return Promise.resolve([])
        },
        stop: (): Promise<void> => {
          record('extensions:stop')
          return Promise.resolve()
        },
      },
      application: {
        initializeStores: () => record('stores:initialize'),
        setupBot: () => record('bot:setup'),
        registerCommandMenu: (): Promise<void> => {
          record('commands:register')
          return Promise.resolve()
        },
        announceStartup: (): Promise<void> => Promise.resolve(),
        flush: (): Promise<void> => {
          record('application:flush')
          return Promise.resolve()
        },
      },
      background: { start: () => record('background:start'), stop: () => record('background:stop') },
      web: { start: () => record('web:start'), stop: () => record('web:stop') },
    })
    const runtime = createPapaiRuntime(
      {
        adminUserId: 'admin-1',
        pluginDirectory: 'plugins',
        startBackgroundServices: true,
        startNetworkServer: true,
        sendStartupAnnouncement: false,
      },
      deps,
    )

    await runtime.start()
    expect(events.indexOf('bot:setup')).toBeLessThan(events.indexOf('chat:start'))

    await runtime.stop()
    expect(events.slice(-7)).toEqual([
      'chat:clear-runtime',
      'application:flush',
      'extensions:stop',
      'background:stop',
      'web:stop',
      'chat:stop',
      'database:stop',
    ])
  })

  test('disposes membership subscribers across sequential production dependency runtimes', async () => {
    await setupTestDb()
    const baseline = subscribeCountForTest()
    const first = createProductionRuntimeDeps()
    const second = createProductionRuntimeDeps()
    const firstRouter = new ChatRouter(() => {
      throw new Error('No adapters are created by the membership lifecycle test')
    })
    const secondRouter = new ChatRouter(() => {
      throw new Error('No adapters are created by the membership lifecycle test')
    })

    first.chat.setRuntime(firstRouter)
    expect(subscribeCountForTest()).toBe(baseline + 1)
    first.chat.clearRuntime()
    expect(subscribeCountForTest()).toBe(baseline)

    second.chat.setRuntime(secondRouter)
    expect(subscribeCountForTest()).toBe(baseline + 1)
    second.chat.clearRuntime()
    expect(subscribeCountForTest()).toBe(baseline)
  })
})
