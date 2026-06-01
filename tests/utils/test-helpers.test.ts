// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getUserMessage, webFetchError } from '../../src/errors.js'
import { issueAuthCode } from '../../src/settings/auth-code-store.js'
import { consumeSettingsQuota } from '../../src/settings/rate-limit.js'
import { createSession } from '../../src/settings/session-store.js'
import { expectAppError, mockLogger, setupSettingsAuthTestDb } from './test-helpers.js'

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

describe('setupSettingsAuthTestDb', () => {
  beforeEach(async () => {
    mockLogger()
    await setupSettingsAuthTestDb()
  })

  test('supports settings auth code, session, and quota stores without full migrations', () => {
    const principal = { platformInstanceId: 'pi-1', platformUserId: 'u-1' }

    const code = issueAuthCode(principal, 1_000)
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/u)

    const createdSession = createSession(principal, 2_000)
    expect(createdSession.expiresAt).toBeGreaterThan(2_000)

    expect(consumeSettingsQuota('issue', 'u-1', 2, 60_000, 0)).toEqual({
      allowed: true,
      remaining: 1,
    })
  })
})
