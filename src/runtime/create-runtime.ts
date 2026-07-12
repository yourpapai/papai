// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatRouter } from '../chat/router.js'
import type { IncomingInteraction, IncomingMessage } from '../chat/types.js'
import { createRuntimeLifecycle, type RuntimeLifecycle } from './lifecycle.js'
import type { PapaiRuntime, PapaiRuntimeConfig, PapaiRuntimeDeps } from './types.js'

const CLEANUP_PRIORITY = {
  clearIngress: 100,
  flush: 90,
  extensions: 80,
  background: 70,
  web: 60,
  chat: 50,
  capabilities: 10,
  database: 0,
} as const

type RuntimeState = 'new' | 'starting' | 'started' | 'stopping' | 'stopped'

type StartupContext = Readonly<{
  config: PapaiRuntimeConfig
  deps: PapaiRuntimeDeps
  lifecycle: RuntimeLifecycle
}>

function registerCleanup(
  context: StartupContext,
  name: string,
  cleanup: () => void | Promise<void>,
  priority: number,
): void {
  context.lifecycle.add(name, cleanup, priority)
}

async function startRequiredServices(context: StartupContext): Promise<ChatRouter> {
  const { deps, lifecycle, config } = context
  deps.capabilities.clear()
  lifecycle.add(
    'capabilities',
    () => {
      deps.capabilities.clear()
    },
    CLEANUP_PRIORITY.capabilities,
  )

  await deps.database.start()
  registerCleanup(context, 'database', () => deps.database.stop(), CLEANUP_PRIORITY.database)

  deps.application.initializeStores()
  registerCleanup(context, 'flush', () => deps.application.flush(), CLEANUP_PRIORITY.flush)

  const router = deps.chat.createRouter()
  deps.chat.setRuntime(router)
  registerCleanup(
    context,
    'ingress',
    () => {
      deps.chat.clearRuntime()
    },
    CLEANUP_PRIORITY.clearIngress,
  )

  await deps.extensions.start(router)
  registerCleanup(context, 'extensions', () => deps.extensions.stop(), CLEANUP_PRIORITY.extensions)
  deps.application.setupBot(router, config.adminUserId)

  await router.start()
  registerCleanup(context, 'chat', () => router.stop(), CLEANUP_PRIORITY.chat)
  await deps.application.registerCommandMenu(router, config.adminUserId)
  return router
}

async function startOptionalServices(context: StartupContext, router: ChatRouter): Promise<void> {
  const { config, deps } = context
  if (config.sendStartupAnnouncement) {
    await deps.application.announceStartup(router, config.adminUserId)
  }
  if (config.startBackgroundServices) {
    deps.background.start(router)
    registerCleanup(
      context,
      'background',
      () => {
        deps.background.stop()
      },
      CLEANUP_PRIORITY.background,
    )
  }
  if (config.startNetworkServer) {
    deps.web.start(config.adminUserId)
    registerCleanup(
      context,
      'web',
      () => {
        deps.web.stop()
      },
      CLEANUP_PRIORITY.web,
    )
  }
}

async function startServices(context: StartupContext): Promise<void> {
  const router = await startRequiredServices(context)
  await startOptionalServices(context, router)
}

function startupError(startupFailure: unknown, rollbackFailure: unknown): AggregateError {
  return new AggregateError([startupFailure, rollbackFailure], 'Papai runtime startup and rollback failed')
}

type RuntimeStateController = Readonly<{
  assertStarted(): void
  start(): Promise<void>
  stop(): Promise<void>
}>

function createRuntimeStateController(context: StartupContext): RuntimeStateController {
  let state: RuntimeState = 'new'
  let stopInFlight: Promise<void> | undefined

  const assertStarted = (): void => {
    if (state !== 'started') throw new Error('Papai runtime is not started')
  }

  const start = async (): Promise<void> => {
    if (state !== 'new') throw new Error(`Papai runtime cannot start from state '${state}'`)
    state = 'starting'
    try {
      await startServices(context)
      state = 'started'
    } catch (startupFailure) {
      try {
        await context.lifecycle.stop()
      } catch (rollbackFailure) {
        state = 'stopped'
        throw startupError(startupFailure, rollbackFailure)
      }
      state = 'stopped'
      throw startupFailure
    }
  }

  const stop = (): Promise<void> => {
    if (state === 'stopped') return Promise.resolve()
    if (stopInFlight !== undefined) return stopInFlight
    state = 'stopping'
    const stopping = context.lifecycle.stop().finally(() => {
      state = 'stopped'
      if (stopInFlight === stopping) stopInFlight = undefined
    })
    stopInFlight = stopping
    return stopping
  }

  return { assertStarted, start, stop }
}

export function createPapaiRuntime(config: PapaiRuntimeConfig, deps: PapaiRuntimeDeps): PapaiRuntime {
  const lifecycle = createRuntimeLifecycle()
  const context = { config, deps, lifecycle } as const satisfies StartupContext
  const state = createRuntimeStateController(context)

  return {
    start: state.start,
    stop: state.stop,
    async dispatch(message: IncomingMessage): Promise<void> {
      state.assertStarted()
      await deps.chat.ingress.dispatch(message)
    },
    async dispatchInteraction(interaction: IncomingInteraction): Promise<void> {
      state.assertStarted()
      await deps.chat.ingress.dispatchInteraction(interaction)
    },
    async request(request: Request): Promise<Response> {
      state.assertStarted()
      const response = await deps.web.route(request)
      return response
    },
    resolveToolCapability(capabilityId: string): string {
      state.assertStarted()
      return deps.capabilities.resolve(capabilityId)
    },
  }
}
