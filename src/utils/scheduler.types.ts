// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Type definitions for the centralized Scheduler utility.
 *
 * Provides robust error handling, retries, and graceful shutdown support
 * for scheduled tasks, replacing raw `setInterval` usage.
 */

/**
 * Configuration options for the scheduler instance.
 */
export interface SchedulerOptions {
  /** Allow process to exit if only scheduler is running (default: true) */
  readonly unrefByDefault?: boolean

  /** Default retry attempts for failed tasks (default: 3) */
  readonly defaultRetries?: number

  /** Maximum retry delay in milliseconds (default: 60000) */
  readonly maxRetryDelay?: number
}

/**
 * Handler function type for scheduled tasks.
 */
export type TaskHandler = () => Promise<void> | void

/**
 * Additional options for individual task configuration.
 */
export interface TaskOptions {
  /** Execute task immediately upon registration (default: false) */
  readonly immediate?: boolean

  /** Number of retry attempts for this specific task */
  readonly retries?: number

  /** Allow process to exit if only this task is running */
  readonly unref?: boolean
}

/**
 * Configuration for a scheduled task.
 */
export interface TaskConfig {
  /** Unique task name/identifier */
  readonly name: string

  /** Handler function to execute */
  readonly handler: TaskHandler

  /** Millisecond interval for execution (mutually exclusive with cron) */
  readonly interval?: number

  /** Cron expression for execution (mutually exclusive with interval) */
  readonly cron?: string

  /** Additional task-specific options */
  readonly options?: TaskOptions
}

/**
 * Current state of a scheduled task.
 */
export interface TaskState {
  /** Whether the task is currently running */
  readonly running: boolean

  /** Timestamp of last successful execution, or null if never run */
  readonly lastRun: Date | null

  /** Timestamp of next scheduled execution, or null if not scheduled */
  readonly nextRun: Date | null

  /** Total number of errors encountered across all executions */
  readonly errorCount: number

  /** Current retry attempt number (0 if not retrying) */
  readonly retryAttempt: number
}

// --- Event Types ---

/**
 * Payload for task execution events.
 */
export interface TickEvent {
  /** Task name */
  readonly name: string

  /** Execution duration in milliseconds */
  readonly duration: number

  /** Event timestamp */
  readonly timestamp: Date
}

/**
 * Payload for task error events.
 */
export interface ErrorEvent {
  /** Task name */
  readonly name: string

  /** Error that occurred */
  readonly error: Error

  /** Current retry attempt number */
  readonly attempt: number

  /** Event timestamp */
  readonly timestamp: Date
}

/**
 * Payload for task retry events.
 */
export interface RetryEvent {
  /** Task name */
  readonly name: string

  /** Retry attempt number */
  readonly attempt: number

  /** Delay before next retry in milliseconds */
  readonly delay: number

  /** Event timestamp */
  readonly timestamp: Date
}

/**
 * Payload for fatal error events (max retries exceeded).
 */
export interface FatalErrorEvent {
  /** Task name */
  readonly name: string

  /** Error that caused the fatal failure */
  readonly error: Error

  /** Event timestamp */
  readonly timestamp: Date
}

// --- Event Handler Types ---

/**
 * Handler for task execution events.
 */
export type TickHandler = (event: TickEvent) => void

/**
 * Handler for task error events.
 */
export type ErrorHandler = (event: ErrorEvent) => void

/**
 * Handler for task retry events.
 */
export type RetryHandler = (event: RetryEvent) => void

/**
 * Handler for fatal error events.
 */
export type FatalErrorHandler = (event: FatalErrorEvent) => void
