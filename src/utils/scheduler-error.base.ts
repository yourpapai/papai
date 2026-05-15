// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Base error class for all scheduler-related errors.
 *
 * Use this as the base class for all scheduler errors to allow catching
 * scheduler-specific errors separately from other application errors.
 *
 * @example
 * ```typescript
 * try {
 *   await scheduler.start('my-task')
 * } catch (error) {
 *   if (error instanceof SchedulerError) {
 *     // Handle scheduler-specific error
 *   }
 * }
 * ```
 */
export class SchedulerError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options)
    this.name = 'SchedulerError'
  }
}
