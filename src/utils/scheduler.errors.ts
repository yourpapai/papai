// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Error classes for the centralized Scheduler utility.
 *
 * Provides specific error types for different scheduler failure scenarios,
 * enabling proper error handling and recovery strategies.
 *
 * All error classes are re-exported from their individual files for backward
 * compatibility and tree-shaking support.
 */

export { SchedulerError } from './scheduler-error.base.js'
export { RetryableError } from './scheduler-error.retryable.js'
export { FatalError } from './scheduler-error.fatal.js'
export { TaskNotFoundError } from './scheduler-error.not-found.js'
export { TaskAlreadyExistsError } from './scheduler-error.exists.js'
