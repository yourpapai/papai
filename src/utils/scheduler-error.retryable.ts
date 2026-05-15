// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { SchedulerError } from './scheduler-error.base.js'

/**
 * Error indicating a task failure that can be retried with backoff.
 *
 * Throw this error when a task fails due to transient issues (network timeouts,
 * temporary unavailability, rate limiting) where retrying may succeed.
 * The scheduler will automatically retry the task with exponential backoff.
 *
 * @example
 * ```typescript
 * async function fetchData() {
 *   try {
 *     return await api.fetch()
 *   } catch (error) {
 *     if (isNetworkError(error)) {
 *       throw new RetryableError('API temporarily unavailable', { cause: error })
 *     }
 *     throw error
 *   }
 * }
 * ```
 */
export class RetryableError extends SchedulerError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options)
    this.name = 'RetryableError'
  }
}
