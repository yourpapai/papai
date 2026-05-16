// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Internal scheduler implementation details.
 *
 * This module contains the internal types, defaults, and helper functions
 * used by the main scheduler. Separated to reduce file size and improve
 * maintainability.
 */

import { logger } from '../logger.js'
import { FatalError, RetryableError, SchedulerError } from './scheduler.errors.js'
import { calculateBackoff, getErrorMessage, getErrorObject, type Emitters, type Task } from './scheduler.helpers.js'
import type { SchedulerOptions } from './scheduler.types.js'

const log = logger.child({ scope: 'scheduler:internal' })

/**
 * Handle successful task execution.
 */
const handleTaskSuccess = (task: Task, startTime: number, emitters: Emitters): void => {
  const duration = Date.now() - startTime
  const timestamp = new Date(startTime)
  task.lastRun = timestamp
  task.retryAttempt = 0

  emitters.emitTick({
    name: task.name,
    duration,
    timestamp,
  })

  log.info({ taskName: task.name, duration }, 'Task executed successfully')
}

/**
 * Schedule a retry for a failed task.
 */
const scheduleRetry = (
  task: Task,
  schedulerOptions: Required<SchedulerOptions>,
  emitters: Emitters,
  stopTask: (name: string) => void,
): void => {
  task.retryAttempt++
  const maxRetryDelay = schedulerOptions.maxRetryDelay
  const delay = calculateBackoff(task.retryAttempt, maxRetryDelay)

  log.warn(
    {
      taskName: task.name,
      attempt: task.retryAttempt,
      delay,
      maxRetries: task.options.retries,
    },
    'Scheduling retry with backoff',
  )

  emitters.emitRetry({
    name: task.name,
    attempt: task.retryAttempt,
    delay,
    timestamp: new Date(),
  })

  task.retryTimeoutId = setTimeout(() => {
    task.retryTimeoutId = null
    // Only execute if task is still running
    if (task.running) {
      void executeTask(task, schedulerOptions, emitters, stopTask)
    }
  }, delay)

  if (task.options.unref && task.retryTimeoutId !== null) {
    task.retryTimeoutId.unref()
  }
}

/**
 * Handle fatal error - stop the task and emit fatal error event.
 */
const handleFatalError = (
  task: Task,
  error: unknown,
  reason: string,
  emitters: Emitters,
  stopTask: (name: string) => void,
): void => {
  const errorMessage = getErrorMessage(error)
  const errorObj = getErrorObject(error)

  log.error({ taskName: task.name, error: errorMessage }, reason)

  stopTask(task.name)

  emitters.emitFatalError({
    name: task.name,
    error: errorObj,
    timestamp: new Date(),
  })
}

/**
 * Log task execution error.
 */
const logTaskError = (task: Task, error: unknown): Error => {
  const errorMessage = getErrorMessage(error)
  const errorObj = getErrorObject(error)

  log.error(
    {
      taskName: task.name,
      error: errorMessage,
      errorType: errorObj.name,
      attempt: task.retryAttempt,
    },
    'Task execution failed',
  )

  return errorObj
}

/**
 * Handle task failure and determine retry behavior.
 */
const handleTaskFailure = (
  task: Task,
  error: unknown,
  timestamp: Date,
  schedulerOptions: Required<SchedulerOptions>,
  emitters: Emitters,
  stopTask: (name: string) => void,
): void => {
  task.errorCount++
  const errorObj = logTaskError(task, error)

  emitters.emitError({
    name: task.name,
    error: errorObj,
    attempt: task.retryAttempt,
    timestamp,
  })

  // Determine if we should retry
  const shouldRetry =
    error instanceof RetryableError || (!(error instanceof FatalError) && !(error instanceof SchedulerError))

  if (shouldRetry && task.retryAttempt < task.options.retries) {
    scheduleRetry(task, schedulerOptions, emitters, stopTask)
  } else if (error instanceof FatalError) {
    handleFatalError(task, error, 'Fatal error occurred, stopping task', emitters, stopTask)
  } else if (task.retryAttempt >= task.options.retries) {
    handleFatalError(task, error, 'Max retries exceeded, stopping task', emitters, stopTask)
  }
}

/**
 * Execute a single task with error handling and retries.
 */
export const executeTask = async (
  task: Task,
  schedulerOptions: Required<SchedulerOptions>,
  emitters: Emitters,
  stopTask: (name: string) => void,
): Promise<void> => {
  const startTime = Date.now()
  const timestamp = new Date(startTime)

  log.debug({ taskName: task.name }, 'Executing task')

  // Catch synchronous throws before awaiting so Bun does not surface them as
  // process-level errors via its async context tracker (a void-ed async call
  // where a sync throw flows through `await` can trigger process exit in
  // Bun's concurrent test runner even when the error is caught).
  let handlerResult: void | Promise<void>
  try {
    handlerResult = task.handler()
  } catch (error) {
    handleTaskFailure(task, error, timestamp, schedulerOptions, emitters, stopTask)
    return
  }

  try {
    await handlerResult
    handleTaskSuccess(task, startTime, emitters)
  } catch (error) {
    handleTaskFailure(task, error, timestamp, schedulerOptions, emitters, stopTask)
  }
}

/**
 * Calculate next run time for a cron expression.
 *
 * @param cronExpr - Valid cron expression
 * @returns Milliseconds until next execution
 */
export const calculateNextCronRun = (cronExpr: string): number => {
  const next = Bun.cron.parse(cronExpr)
  if (next === null) {
    throw new Error(`Invalid cron expression: ${cronExpr}`)
  }
  return next.getTime() - Date.now()
}

/**
 * Schedule next execution for a cron-based task.
 *
 * Uses setTimeout instead of setInterval to handle varying intervals.
 */
const scheduleCronTask = (
  task: Task,
  schedulerOptions: Required<SchedulerOptions>,
  emitters: Emitters,
  stopTask: (name: string) => void,
): void => {
  if (task.cron === null) {
    return
  }

  const delay = calculateNextCronRun(task.cron)
  task.nextRun = new Date(Date.now() + delay)

  task.timeoutId = setTimeout(() => {
    void executeTask(task, schedulerOptions, emitters, stopTask).then(() => {
      // Reschedule after execution if still running
      if (task.running && task.cron !== null) {
        scheduleCronTask(task, schedulerOptions, emitters, stopTask)
      }
    })
  }, delay)

  if (task.options.unref && task.timeoutId !== null) {
    task.timeoutId.unref()
  }

  log.debug({ taskName: task.name, cron: task.cron, delay }, 'Cron task scheduled')
}

/**
 * Schedule a task for periodic execution.
 */
export const scheduleTask = (
  task: Task,
  schedulerOptions: Required<SchedulerOptions>,
  emitters: Emitters,
  stopTask: (name: string) => void,
): void => {
  // Cron-based tasks use setTimeout and reschedule
  if (task.cron !== null) {
    scheduleCronTask(task, schedulerOptions, emitters, stopTask)
    return
  }

  // Interval-based tasks use setInterval
  if (task.intervalId !== null) {
    return
  }

  task.nextRun = new Date(Date.now() + task.interval)

  task.intervalId = setInterval(() => {
    task.nextRun = new Date(Date.now() + task.interval)
    void executeTask(task, schedulerOptions, emitters, stopTask)
  }, task.interval)

  if (task.options.unref) {
    task.intervalId.unref()
  }

  log.debug({ taskName: task.name, interval: task.interval }, 'Task scheduled')
}
