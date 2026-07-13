// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Scheduler helper functions and types.
 *
 * Contains defaults, type definitions, and utility functions used by the scheduler.
 */

import type {
  ErrorEvent,
  ErrorHandler,
  FatalErrorEvent,
  FatalErrorHandler,
  RetryEvent,
  RetryHandler,
  SchedulerOptions,
  TaskHandler,
  TaskOptions,
  TickEvent,
  TickHandler,
} from './scheduler.types.js'

/**
 * Internal task record containing runtime state.
 */
export interface Task {
  readonly name: string
  readonly handler: TaskHandler
  readonly interval: number
  readonly cron: string | null
  readonly options: Required<TaskOptions>
  registered: boolean
  running: boolean
  intervalId: ReturnType<typeof setInterval> | null
  timeoutId: ReturnType<typeof setTimeout> | null
  lastRun: Date | null
  nextRun: Date | null
  errorCount: number
  retryAttempt: number
  retryTimeoutId: ReturnType<typeof setTimeout> | null
}

/**
 * Default scheduler options.
 */
export const DEFAULT_OPTIONS: Required<SchedulerOptions> = {
  unrefByDefault: true,
  defaultRetries: 3,
  maxRetryDelay: 60000,
}

/**
 * Default task options.
 */
export const DEFAULT_TASK_OPTIONS: Required<TaskOptions> = {
  immediate: false,
  retries: 3,
  unref: true,
}

/**
 * Event emitter for scheduler events.
 */
export interface EventEmitter {
  readonly tick: Set<TickHandler>
  readonly error: Set<ErrorHandler>
  readonly retry: Set<RetryHandler>
  readonly fatalError: Set<FatalErrorHandler>
}

/**
 * Emitters interface returned by createEmitters.
 */
export interface Emitters {
  readonly emitTick: (event: TickEvent) => void
  readonly emitError: (event: ErrorEvent) => void
  readonly emitRetry: (event: RetryEvent) => void
  readonly emitFatalError: (event: FatalErrorEvent) => void
}

/**
 * Calculate exponential backoff with jitter.
 *
 * Formula: min(2^attempt * 1000, maxDelay) + random(0, 10%)
 */
export const calculateBackoff = (attempt: number, maxDelay: number): number => {
  const baseDelay = Math.min(2 ** attempt * 1000, maxDelay)
  const jitter = baseDelay * 0.1 * Math.random()
  return Math.floor(baseDelay + jitter)
}

/**
 * Merge options with defaults.
 */
export const mergeOptions = (options: SchedulerOptions | undefined): Required<SchedulerOptions> => ({
  ...DEFAULT_OPTIONS,
  ...options,
})

/**
 * Merge task options with defaults.
 */
export const mergeTaskOptions = (
  options: TaskOptions | undefined,
  schedulerDefaults: Required<SchedulerOptions>,
): Required<TaskOptions> => ({
  ...DEFAULT_TASK_OPTIONS,
  retries: schedulerDefaults.defaultRetries,
  unref: schedulerDefaults.unrefByDefault,
  ...options,
})

/**
 * Get error message safely from unknown value.
 */
export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return typeof error === 'string' ? error : 'Unknown error'
}

/**
 * Get error object safely from unknown value.
 */
export const getErrorObject = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }
  return new Error(typeof error === 'string' ? error : 'Unknown error')
}
