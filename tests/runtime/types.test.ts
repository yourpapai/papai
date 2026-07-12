// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ChatRouter } from '../../src/chat/router.js'
import type { IncomingInteraction, IncomingMessage } from '../../src/chat/types.js'
import { createToolCapabilityCatalog } from '../../src/runtime/capability-catalog.js'
import { normalizePapaiRuntimeConfig, type PapaiRuntimeDeps, type RuntimeIngress } from '../../src/runtime/types.js'

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

const createIngress = (): RuntimeIngress => ({
  dispatch: (): Promise<void> => Promise.resolve(),
  dispatchInteraction: (): Promise<void> => Promise.resolve(),
})

const createDeps = (): PapaiRuntimeDeps => ({
  database: {
    start: (): void => undefined,
    stop: (): Promise<void> => Promise.resolve(),
  },
  chat: {
    createRouter: (): ChatRouter =>
      new ChatRouter(() => {
        throw new Error('The contract test does not create chat instances')
      }),
    ingress: createIngress(),
    setRuntime: (): void => undefined,
    clearRuntime: (): void => undefined,
  },
  extensions: {
    start: (): Promise<readonly string[]> => Promise.resolve(['extension']),
    stop: (): Promise<void> => Promise.resolve(),
  },
  application: {
    initializeStores: (): void => undefined,
    setupBot: (): void => undefined,
    registerCommandMenu: (): Promise<void> => Promise.resolve(),
    announceStartup: (): Promise<void> => Promise.resolve(),
    flush: (): Promise<void> => Promise.resolve(),
  },
  background: {
    start: (): void => undefined,
    stop: (): void => undefined,
  },
  web: {
    start: (): void => undefined,
    stop: (): void => undefined,
    route: (): Promise<Response> => Promise.resolve(new Response('ok')),
  },
  capabilities: createToolCapabilityCatalog(),
})

describe('runtime contracts', () => {
  test('production config enables optional services by default', () => {
    const config = normalizePapaiRuntimeConfig({
      adminUserId: 'admin-1',
      pluginDirectory: '/plugins',
    })

    expect(config).toEqual({
      adminUserId: 'admin-1',
      pluginDirectory: '/plugins',
      startBackgroundServices: true,
      startNetworkServer: true,
      sendStartupAnnouncement: true,
    })
  })

  test('scenario config can disable every optional service explicitly', () => {
    const config = normalizePapaiRuntimeConfig({
      adminUserId: 'scenario-admin',
      pluginDirectory: '/scenario/plugins',
      startBackgroundServices: false,
      startNetworkServer: false,
      sendStartupAnnouncement: false,
    })

    expect(config.startBackgroundServices).toBeFalse()
    expect(config.startNetworkServer).toBeFalse()
    expect(config.sendStartupAnnouncement).toBeFalse()
  })

  test('dependency groups expose callable lifecycle and ingress boundaries', async () => {
    const deps = createDeps()
    const router = deps.chat.createRouter()

    await deps.database.start()
    deps.chat.setRuntime(router)
    expect(await deps.extensions.start(router)).toEqual(['extension'])
    deps.application.initializeStores()
    deps.application.setupBot(router, 'admin-1')
    await deps.application.registerCommandMenu(router, 'admin-1')
    await deps.application.announceStartup(router, 'admin-1')
    deps.background.start(router)
    deps.web.start('admin-1')
    await deps.chat.ingress.dispatch(message)
    await deps.chat.ingress.dispatchInteraction(interaction)
    expect(await deps.web.route(new Request('http://scenario.test'))).toEqual(new Response('ok'))
    deps.web.stop()
    deps.background.stop()
    await deps.application.flush()
    await deps.extensions.stop()
    deps.chat.clearRuntime()
    await deps.database.stop()
  })
})
