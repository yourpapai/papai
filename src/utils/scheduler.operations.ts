// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Scheduler operations - register, start, stop, unregister tasks.
 */

import { logger } from '../logger.js'
import { TaskAlreadyExistsError, TaskNotFoundError } from './scheduler.errors.js'
import { type Emitters, type EventEmitter, type Task, mergeTaskOptions } from './scheduler.helpers.js'
import { executeTask, scheduleTask } from './scheduler.internal.js'
import type { SchedulerOptions, TaskConfig, TaskState } from './scheduler.types.js'

const log = logger.child({ scope: 'scheduler:operations' })

/**
 * Operation context shared between scheduler operations.
 */
export interface SchedulerContext {
  readonly tasks: Map<string, Task>
  readonly activeExecutions: Set<Promise<void>>
  readonly events: EventEmitter
  readonly emitters: Emitters
  readonly schedulerOptions: Required<SchedulerOptions>
}

/**
 * Validate task config has exactly one of interval or cron.
 */
const validateTaskConfig = (config: Omit<TaskConfig, 'name'>): void => {
  const hasCron = config.cron !== undefined
  const hasInterval = config.interval !== undefined

  if (hasCron && hasInterval) {
    throw new Error('Task cannot have both interval and cron')
  }

  if (!hasCron && !hasInterval) {
    throw new Error('Task must have either interval or cron')
  }
}

/**
 * Register a new task.
 */
export const registerTask = (
  context: SchedulerContext,
  name: string,
  config: Omit<TaskConfig, 'name'>,
  startFn: (name: string) => void,
): void => {
  const { tasks, schedulerOptions } = context

  if (tasks.has(name)) {
    throw new TaskAlreadyExistsError(name)
  }

  validateTaskConfig(config)

  const mergedOptions = mergeTaskOptions(config.options, schedulerOptions)

  const task: Task = {
    name,
    handler: config.handler,
    interval: config.interval ?? 0,
    cron: config.cron ?? null,
    options: mergedOptions,
    registered: true,
    running: false,
    intervalId: null,
    timeoutId: null,
    lastRun: null,
    nextRun: null,
    errorCount: 0,
    retryAttempt: 0,
    retryTimeoutId: null,
  }

  tasks.set(name, task)

  log.info({ taskName: name, interval: task.interval, cron: task.cron, options: mergedOptions }, 'Task registered')

  if (mergedOptions.immediate) {
    startFn(name)
  }
}

/**
 * Start a registered task.
 */
export const startTask = (context: SchedulerContext, name: string, stopFn: (name: string) => void): void => {
  const { tasks, activeExecutions, emitters, schedulerOptions } = context
  const task = tasks.get(name)

  if (task === undefined) {
    throw new TaskNotFoundError(name)
  }

  if (task.running) {
    log.debug({ taskName: name }, 'Task already running, skipping start')
    return
  }

  task.running = true
  const stopIfCurrent = (taskName: string): void => {
    if (tasks.get(taskName) === task) stopFn(taskName)
  }

  // Execute immediately if configured
  if (task.options.immediate) {
    queueMicrotask(() => {
      if (!task.running || tasks.get(name) !== task) return
      void executeTask(task, schedulerOptions, emitters, stopIfCurrent, activeExecutions).then(() => {
        // For cron tasks, scheduling is handled after execution completes
        if (task.running && tasks.get(name) === task && task.cron === null) {
          scheduleTask(task, schedulerOptions, emitters, stopIfCurrent, activeExecutions)
        }
      })
    })
  } else {
    scheduleTask(task, schedulerOptions, emitters, stopIfCurrent, activeExecutions)
  }

  log.info({ taskName: name }, 'Task started')
}

/**
 * Stop a running task.
 */
export const stopTask = (context: SchedulerContext, name: string): void => {
  const { tasks } = context
  const task = tasks.get(name)

  if (task === undefined) {
    throw new TaskNotFoundError(name)
  }

  if (!task.running) log.debug({ taskName: name }, 'Task already stopped, clearing residual timers')
  task.running = false

  // Clear interval for interval-based tasks
  if (task.intervalId !== null) {
    clearInterval(task.intervalId)
    task.intervalId = null
  }

  // Clear timeout for cron-based tasks
  if (task.timeoutId !== null) {
    clearTimeout(task.timeoutId)
    task.timeoutId = null
  }

  // Clear retry timeout
  if (task.retryTimeoutId !== null) {
    clearTimeout(task.retryTimeoutId)
    task.retryTimeoutId = null
  }

  task.nextRun = null

  log.info({ taskName: name }, 'Task stopped')
}

/**
 * Unregister a task (removes it from the scheduler).
 */
export const unregisterTask = (context: SchedulerContext, name: string, stopFn: (name: string) => void): void => {
  const { tasks } = context
  const task = tasks.get(name)

  if (task === undefined) {
    throw new TaskNotFoundError(name)
  }

  task.registered = false
  stopFn(name)

  tasks.delete(name)

  log.info({ taskName: name }, 'Task unregistered')
}

/**
 * Start all registered tasks.
 */
export const startAllTasks = (context: SchedulerContext, startFn: (name: string) => void): void => {
  const { tasks } = context

  log.info({ taskCount: tasks.size }, 'Starting all tasks')
  tasks.forEach((_, name) => {
    try {
      startFn(name)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      log.error({ taskName: name, error: msg }, 'Failed to start task')
    }
  })
}

/**
 * Stop all registered tasks.
 */
export const stopAllTasks = (context: SchedulerContext, stopFn: (name: string) => void): void => {
  const { tasks } = context

  log.info({ taskCount: tasks.size }, 'Stopping all tasks')
  tasks.forEach((_, name) => {
    try {
      stopFn(name)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      log.error({ taskName: name, error: msg }, 'Failed to stop task')
    }
  })
}

export const drainAllTasks = (context: SchedulerContext): Promise<void> =>
  Promise.all([...context.activeExecutions]).then((): void => undefined)

/**
 * Check if a task exists.
 */
export const taskExists = (context: SchedulerContext, name: string): boolean => context.tasks.has(name)

/**
 * Get task state.
 */
export const getTaskState = (context: SchedulerContext, name: string): TaskState | null => {
  const task = context.tasks.get(name)
  if (task === undefined) {
    return null
  }

  return {
    running: task.running,
    lastRun: task.lastRun,
    nextRun: task.nextRun,
    errorCount: task.errorCount,
    retryAttempt: task.retryAttempt,
  }
}
