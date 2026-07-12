// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ChatRouter } from '../../src/chat/router.js'
import type { IncomingInteraction, IncomingMessage } from '../../src/chat/types.js'
import { createPapaiRuntime } from '../../src/runtime/create-runtime.js'
import { createProductionRuntimeDeps } from '../../src/runtime/production-deps.js'

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
})
