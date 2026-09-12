// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { runWithProviderRequestScope, NO_ANALYTICS_SCOPE } from './analytics/provider-request-scope.js'
import type { ProviderRequestScope } from './analytics/provider-request-scope.js'
import { resolveSchedulerProviderRequestScope } from './analytics/provider-scope-factory.js'
import type { ChatProvider } from './chat/types.js'
import { emitGlobal } from './debug/event-bus.js'
import { logger } from './logger.js'
import { defaultTaskProviderResolver } from './providers/resolver.js'
import type { TaskProvider } from './providers/types.js'
import {
  recordOccurrence,
  recordFailedExecution,
  type RecurringTaskRecord,
  getDueRecurringTasks,
  getRecurringTask,
} from './recurring.js'
import { scheduler } from './scheduler-instance.js'
import {
  applyLabels,
  buildRecurringTaskInput,
  canRouteRecurringNotification,
  finalizeCreatedRecurringTask,
  notifyRecurringFailure,
} from './scheduler-recurring.js'

const log = logger.child({ scope: 'scheduler' })

export interface SchedulerDeps {
  resolve: (contextId: string) => Promise<TaskProvider | null> | TaskProvider | null
  chat?: ChatProvider | null
  /** Per-task provider request scope; defaults to the scheduler scope resolver. */
  resolveScope?: (task: RecurringTaskRecord) => ProviderRequestScope
}

const defaultSchedulerDeps: SchedulerDeps = {
  resolve: (contextId): Promise<TaskProvider | null> => defaultTaskProviderResolver.resolve(contextId),
}

const defaultResolveScope = (task: RecurringTaskRecord): ProviderRequestScope =>
  resolveSchedulerProviderRequestScope({ recurringTaskId: task.id, userId: task.userId })

const TICK_INTERVAL_MS = 60 * 1000

let chatProviderRef: ChatProvider | null = null
let activeTickPromise: Promise<void> | null = null
let tickCount = 0

const HEARTBEAT_INTERVAL = 60

/** Permanent-failure policy (spec: recurring-failure-handling): a provider-classified
 * missing project consumes the scheduled slot (stopping the per-tick retry storm),
 * then notifies the owner. Schedule advances before the notice so a send failure can
 * never resurrect the storm. */
const handlePermanentRecurringFailure = async (
  task: RecurringTaskRecord,
  chat: ChatProvider | null,
  classifiedCode: string,
): Promise<void> => {
  if (classifiedCode !== 'project-not-found') return
  recordFailedExecution(task.id)
  await notifyRecurringFailure(chat, task.userId, task)
}

/** Scope resolution must never block execution (spec: recurring-task-provider-scope):
 * a throwing resolver degrades to the explicit unobserved sentinel. */
const resolveTaskScope = (task: RecurringTaskRecord, deps: SchedulerDeps): ProviderRequestScope => {
  const resolveScope = deps.resolveScope ?? defaultResolveScope
  try {
    return resolveScope(task)
  } catch (scopeError) {
    log.warn(
      { taskId: task.id, error: scopeError instanceof Error ? scopeError.message : String(scopeError) },
      'Scheduler scope resolution failed; proceeding unobserved',
    )
    return NO_ANALYTICS_SCOPE
  }
}

const executeRecurringTask = async (task: RecurringTaskRecord, deps: SchedulerDeps): Promise<void> => {
  log.debug(
    { taskId: task.id, title: task.title, userId: task.userId, chatUserId: task.userId },
    'Executing recurring task',
  )

  const chat = deps.chat ?? chatProviderRef
  if (!canRouteRecurringNotification(chat, task.userId)) {
    log.warn({ taskId: task.id, contextId: task.userId }, 'Skipping recurring task: notification route unavailable')
    return
  }

  const scope = resolveTaskScope(task, deps)

  const providerRef: { current: TaskProvider | null } = { current: null }
  try {
    // Provider resolution, task creation, and finalization (label application)
    // all settle inside this one per-task scope lease (design D2).
    const providerAvailable = await runWithProviderRequestScope(scope, async (): Promise<boolean> => {
      const provider = await deps.resolve(task.userId)
      providerRef.current = provider
      if (provider === null) return false
      const created = await provider.createTask(buildRecurringTaskInput(task))
      await finalizeCreatedRecurringTask(task, provider, created, chat)
      return true
    })
    if (!providerAvailable) {
      log.warn({ taskId: task.id, contextId: task.userId }, 'Skipping recurring task: task provider unavailable')
    }
  } catch (error) {
    log.error(
      { taskId: task.id, error: error instanceof Error ? error.message : String(error) },
      'Failed to create recurring task instance',
    )
    const failedProvider: TaskProvider | null = providerRef.current
    if (failedProvider !== null) {
      await handlePermanentRecurringFailure(task, chat, failedProvider.classifyError(error).code)
    }
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

  const provider = await resolvedDeps.resolve(task.userId)
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
    activeTickPromise = null
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
