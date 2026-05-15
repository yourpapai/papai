// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getUserMessage, webFetchError } from '../../src/errors.js'
import { expectAppError } from './test-helpers.js'

describe('expectAppError', () => {
  test('accepts classified errors that carry an AppError in appError', () => {
    const error = Object.assign(new Error('Invalid URL'), {
      appError: webFetchError.invalidUrl(),
      type: 'web-fetch' as const,
      code: 'invalid-url' as const,
    })

    expect(() => expectAppError(error, getUserMessage(webFetchError.invalidUrl()))).not.toThrow()
  })
})
