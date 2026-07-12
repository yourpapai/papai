// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatRouter } from '../chat/router.js'
import { startSweeper } from '../dashboard-auth/sweeper.js'
import { startPollers, stopPollers } from '../deferred-prompts/poller.js'
import { defaultTaskProviderResolver } from '../providers/resolver.js'
import { registerDefaultSchedulerTasks, scheduler, unregisterDefaultSchedulerTasks } from '../scheduler-instance.js'
import { startScheduler, stopScheduler } from '../scheduler.js'

export type ProductionBackgroundDeps = {
  registerDefaultTasks(): void
  startRecurring(router: ChatRouter): void
  startPollers(router: ChatRouter): void
  startTasks(): void
  startSweeper(): () => void
  stopTasks(): void
  drainTasks(): Promise<void>
  stopRecurring(): void
  stopPollers(): void
  unregisterDefaultTasks(): void
}

export type ProductionBackgroundHandle = Readonly<{ stop(): Promise<void> }>

type CleanupStep = () => void | Promise<void>

const defaultDeps: ProductionBackgroundDeps = {
  registerDefaultTasks: registerDefaultSchedulerTasks,
  startRecurring: startScheduler,
  startPollers: (router) => {
    startPollers(router, (contextId) => defaultTaskProviderResolver.resolve(contextId))
  },
  startTasks: scheduler.startAll,
  startSweeper,
  stopTasks: scheduler.stopAll,
  drainTasks: scheduler.drainAll,
  stopRecurring: stopScheduler,
  stopPollers,
  unregisterDefaultTasks: unregisterDefaultSchedulerTasks,
}

async function attemptCleanup(step: CleanupStep, errors: unknown[]): Promise<void> {
  try {
    await step()
  } catch (error) {
    errors.push(error)
  }
}

async function runCleanupSteps(deps: ProductionBackgroundDeps, stopSweeper?: () => void): Promise<void> {
  const errors: unknown[] = []
  await attemptCleanup((): void => {
    deps.stopTasks()
  }, errors)
  await attemptCleanup((): Promise<void> => deps.drainTasks(), errors)
  await attemptCleanup((): void => {
    deps.stopRecurring()
  }, errors)
  await attemptCleanup((): void => {
    deps.stopPollers()
  }, errors)
  await attemptCleanup((): void => {
    deps.unregisterDefaultTasks()
  }, errors)
  await attemptCleanup((): void => stopSweeper?.(), errors)
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Production background shutdown failed')
  }
}

export async function startProductionBackground(
  router: ChatRouter,
  deps: ProductionBackgroundDeps = defaultDeps,
): Promise<ProductionBackgroundHandle> {
  let stopSweeper: (() => void) | undefined
  let stopPromise: Promise<void> | undefined
  const stop = (): Promise<void> => {
    stopPromise ??= runCleanupSteps(deps, stopSweeper)
    return stopPromise
  }
  try {
    deps.registerDefaultTasks()
    deps.startRecurring(router)
    deps.startPollers(router)
    deps.startTasks()
    stopSweeper = deps.startSweeper()
    return { stop }
  } catch (error) {
    await stop()
    throw error
  }
}
