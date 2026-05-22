// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Test-only error constructors for testing error handling.
 * These were moved from src/errors.ts since they're only used in tests.
 */

import type { AppError } from '../../src/errors.js'

export const llmError = {
  apiError: (message: string): AppError => ({ type: 'llm', code: 'api-error', message }),
  rateLimited: (): AppError => ({ type: 'llm', code: 'rate-limited' }),
  timeout: (): AppError => ({ type: 'llm', code: 'timeout' }),
  tokenLimit: (): AppError => ({ type: 'llm', code: 'token-limit' }),
}

export const validationError = {
  invalidInput: (field: string, reason: string): AppError => ({
    type: 'validation',
    code: 'invalid-input',
    field,
    reason,
  }),
  missingRequired: (field: string): AppError => ({ type: 'validation', code: 'missing-required', field }),
}
