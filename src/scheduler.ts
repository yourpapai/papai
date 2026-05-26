// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider } from './chat/types.js'
import { emitGlobal } from './debug/event-bus.js'
import { logger } from './logger.js'
import { defaultTaskProviderResolver } from './providers/resolver.js'
import type { TaskProvider } from './providers/types.js'
import { recordOccurrence } from './recurring-occurrences.js'
import { type RecurringTaskRecord, getDueRecurringTasks, getRecurringTask } from './recurring.js'
import { scheduler } from './scheduler-instance.js'
import {
  applyLabels,
  buildRecurringTaskInput,
  canRouteRecurringNotification,
  finalizeCreatedRecurringTask,
} from './scheduler-recurring.js'

const log = logger.child({ scope: 'scheduler' })

export interface SchedulerDeps {
  resolve: (contextId: string) => TaskProvider | null
}

const defaultSchedulerDeps: SchedulerDeps = {
  resolve: (contextId): TaskProvider | null => defaultTaskProviderResolver.resolve(contextId),
}

const TICK_INTERVAL_MS = 60 * 1000

let chatProviderRef: ChatProvider | null = null
let activeTickPromise: Promise<void> | null = null
let tickCount = 0

const HEARTBEAT_INTERVAL = 60

const executeRecurringTask = async (task: RecurringTaskRecord, deps: SchedulerDeps): Promise<void> => {
  log.debug({ taskId: task.id, title: task.title, userId: task.userId }, 'Executing recurring task')

  if (!canRouteRecurringNotification(chatProviderRef, task.userId)) {
    log.warn({ taskId: task.id, contextId: task.userId }, 'Skipping recurring task: notification route unavailable')
    return
  }

  const provider = deps.resolve(task.userId)
  if (provider === null) {
    log.warn({ taskId: task.id, contextId: task.userId }, 'Skipping recurring task: task provider unavailable')
    return
  }

  try {
    const created = await provider.createTask(buildRecurringTaskInput(task))
    await finalizeCreatedRecurringTask(task, provider, created, chatProviderRef)
  } catch (error) {
    log.error(
      { taskId: task.id, error: error instanceof Error ? error.message : String(error) },
      'Failed to create recurring task instance',
    )
  }
}

export async function createMissedTasks(
  ...args:
    | [recurringTaskId: string, missedDates: readonly string[]]
    | [recurringTaskId: string, missedDates: readonly string[], deps: SchedulerDeps | undefined]
): Promise<number> {
  const [recurringTaskId, missedDates, deps] = args
  let resolvedDeps = defaultSchedulerDeps
  if (deps !== undefined) {
    resolvedDeps = deps
  }
  if (missedDates.length === 0) return 0

  const task = getRecurringTask(recurringTaskId)
  if (task === null) return 0

  const provider = resolvedDeps.resolve(task.userId)
  if (provider === null) {
    log.warn({ recurringTaskId, contextId: task.userId }, 'Skipping missed tasks: task provider unavailable')
    return 0
  }

  const createOne = async (dueDate: string): Promise<boolean> => {
    try {
      const newTask = await provider.createTask(buildRecurringTaskInput(task, dueDate))
      await applyLabels(provider, newTask.id, task.labels)
      recordOccurrence(recurringTaskId, newTask.id)
      log.debug({ recurringTaskId, createdTaskId: newTask.id, dueDate }, 'Missed task created')
      return true
    } catch (error) {
      log.warn(
        { recurringTaskId, dueDate, error: error instanceof Error ? error.message : String(error) },
        'Failed to create missed task',
      )
      return false
    }
  }

  const results = await missedDates.reduce(
    (chain, dueDate) => chain.then(async (count) => ((await createOne(dueDate)) ? count + 1 : count)),
    Promise.resolve(0),
  )

  log.info({ recurringTaskId, missedCount: missedDates.length, created: results }, 'Missed tasks creation complete')
  return results
}

export function tick(...args: [] | [deps: SchedulerDeps]): Promise<void> {
  const [deps] = args
  let resolvedDeps = defaultSchedulerDeps
  if (deps !== undefined) {
    resolvedDeps = deps
  }
  if (activeTickPromise !== null) {
    log.debug('Tick skipped: previous tick still running')
    return Promise.resolve()
  }
  const work = (async (): Promise<void> => {
    try {
      const dueTasks = getDueRecurringTasks()
      tickCount++
      emitGlobal('scheduler:tick', { tickCount, dueTaskCount: dueTasks.length })

      if (dueTasks.length === 0) {
        if (tickCount % HEARTBEAT_INTERVAL === 0) {
          log.info({ tickCount }, 'Scheduler heartbeat: no due tasks')
        }
        return
      }

      log.info({ count: dueTasks.length, tickCount }, 'Processing due recurring tasks')

      await dueTasks.reduce(
        (chain, task) => chain.then(() => executeRecurringTask(task, resolvedDeps)),
        Promise.resolve(),
      )
    } catch (error) {
      log.error({ error: error instanceof Error ? error.message : String(error) }, 'Scheduler tick failed')
    }
  })()
  activeTickPromise = work.finally(() => {
    activeTickPromise = null
  })
  return activeTickPromise
}

export function startScheduler(
  ...args: [chatProvider: ChatProvider] | [chatProvider: ChatProvider, deps: SchedulerDeps]
): void {
  const [chatProvider, deps] = args
  let resolvedDeps = defaultSchedulerDeps
  if (deps !== undefined) {
    resolvedDeps = deps
  }
  if (scheduler.hasTask('recurring-tasks')) {
    log.warn('Scheduler already running')
    return
  }

  chatProviderRef = chatProvider

  scheduler.register('recurring-tasks', {
    interval: TICK_INTERVAL_MS,
    handler: async () => {
      await tick(resolvedDeps)
    },
    options: { immediate: true },
  })

  scheduler.start('recurring-tasks')
  log.info({ intervalMs: TICK_INTERVAL_MS }, 'Started recurring task scheduler')
}

export const stopScheduler = (): void => {
  if (scheduler.hasTask('recurring-tasks')) {
    scheduler.stop('recurring-tasks')
    scheduler.unregister('recurring-tasks')
    chatProviderRef = null
    tickCount = 0
    log.info('Stopped recurring task scheduler')
  }
}

export type SchedulerSnapshot = {
  running: boolean
  tickCount: number
  tickIntervalMs: number
  heartbeatInterval: number
  activeTickInProgress: boolean
  taskProvider: string
}

export function getSchedulerSnapshot(): SchedulerSnapshot {
  return {
    running: scheduler.hasTask('recurring-tasks'),
    tickCount,
    tickIntervalMs: TICK_INTERVAL_MS,
    heartbeatInterval: HEARTBEAT_INTERVAL,
    activeTickInProgress: activeTickPromise !== null,
    taskProvider: 'context-assigned',
  }
}
