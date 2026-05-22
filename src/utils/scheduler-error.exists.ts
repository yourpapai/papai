// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { SchedulerError } from './scheduler-error.base.js'

/**
 * Error thrown when attempting to register a task that already exists.
 *
 * This error is thrown when:
 * - Registering a task with a name that's already in use
 * - Duplicate task registration attempts
 *
 * To update an existing task, remove it first then re-register.
 *
 * @example
 * ```typescript
 * try {
 *   scheduler.register({ name: 'cleanup', handler: cleanupFn, interval: 60000 })
 * } catch (error) {
 *   if (error instanceof TaskAlreadyExistsError) {
 *     console.log(`Task "${error.taskName}" is already registered`)
 *     // Remove and re-register if needed
 *     scheduler.remove(error.taskName)
 *     scheduler.register({ name: 'cleanup', handler: cleanupFn, interval: 60000 })
 *   }
 * }
 * ```
 */
export class TaskAlreadyExistsError extends SchedulerError {
  readonly taskName: string

  constructor(taskName: string) {
    super(`Task "${taskName}" is already registered`)
    this.name = 'TaskAlreadyExistsError'
    this.taskName = taskName
  }
}
