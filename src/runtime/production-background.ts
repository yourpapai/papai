// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatRouter } from '../chat/router.js'
import { startSweeper } from '../dashboard-auth/sweeper.js'
import { startPollers, stopPollers } from '../deferred-prompts/poller.js'
import { defaultTaskProviderResolver } from '../providers/resolver.js'
import type { TaskProvider } from '../providers/types.js'
import {
  registerAnalyticsSchedulerJobs,
  registerDefaultSchedulerTasks,
  scheduler,
  unregisterAnalyticsSchedulerJobs,
  unregisterDefaultSchedulerTasks,
} from '../scheduler-instance.js'
import { startScheduler, stopScheduler } from '../scheduler.js'

/** Production `buildProviderFn`: an alert's pinned task instance routes to
 * `resolveForInstance` so the pin wins over the context's current assignment;
 * unpinned polls keep `resolve`. */
export const resolveProductionTaskProvider = (
  contextId: string,
  taskInstanceId?: string | null,
): Promise<TaskProvider | null> => {
  if (taskInstanceId !== null && taskInstanceId !== undefined) {
    return defaultTaskProviderResolver.resolveForInstance(contextId, taskInstanceId)
  }
  return defaultTaskProviderResolver.resolve(contextId)
}

export type ProductionBackgroundDeps = {
  registerDefaultTasks(): void
  registerAnalyticsJobs?(): void
  startRecurring(router: ChatRouter): void
  startPollers(router: ChatRouter): void
  startTasks(): void
  startSweeper(): () => void
  stopTasks(): void
  drainTasks(): Promise<void>
  stopRecurring(): void
  stopPollers(): void
  unregisterAnalyticsJobs?(): void
  unregisterDefaultTasks(): void
}

export type ProductionBackgroundHandle = Readonly<{ stop(): Promise<void> }>

type CleanupStep = () => void | Promise<void>

const defaultDeps: ProductionBackgroundDeps = {
  registerDefaultTasks: registerDefaultSchedulerTasks,
  registerAnalyticsJobs: registerAnalyticsSchedulerJobs,
  startRecurring: startScheduler,
  startPollers: (router) => {
    startPollers(router, resolveProductionTaskProvider)
  },
  startTasks: scheduler.startAll,
  startSweeper,
  stopTasks: scheduler.stopAll,
  drainTasks: scheduler.drainAll,
  stopRecurring: stopScheduler,
  stopPollers,
  unregisterAnalyticsJobs: unregisterAnalyticsSchedulerJobs,
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
    deps.unregisterAnalyticsJobs?.()
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
    deps.registerAnalyticsJobs?.()
    deps.startRecurring(router)
    deps.startPollers(router)
    deps.startTasks()
    stopSweeper = deps.startSweeper()
    return { stop }
  } catch (error) {
    try {
      await stop()
    } catch (rollbackError) {
      const aggregate = new AggregateError([error, rollbackError], 'Production background startup and rollback failed')
      aggregate.cause = error
      throw aggregate
    }
    throw error
  }
}
