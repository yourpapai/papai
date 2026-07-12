// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { routeRequestForTest } from '../../src/debug/server.js'
import { CODE_TTL_MS, issueAuthCode } from '../../src/settings/auth-code-store.js'
import { SESSION_COOKIE_NAME } from '../../src/settings/cookies.js'
import { SESSION_TTL_MS } from '../../src/settings/session-store.js'
import { addUser } from '../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../utils/test-helpers.js'

const FIXED_NOW = Date.UTC(2026, 0, 1)

describe('settings route clock', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'alice', platformInstanceId: 'pi-1', addedBy: 'admin', username: 'alice' })
  })

  test('uses one injected instant for auth-code exchange and authenticated API expiry', async () => {
    const code = issueAuthCode({ platformInstanceId: 'pi-1', platformUserId: 'alice' }, FIXED_NOW)
    const exchanged = await routeRequestForTest(
      new Request('https://scenario.invalid/settings/auth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }),
      { nowMs: FIXED_NOW },
    )
    expect(exchanged.status).toBe(200)
    const cookiePair = exchanged.headers.get('Set-Cookie')?.split(';', 1)[0]
    assert(cookiePair !== undefined)
    expect(cookiePair.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true)

    const expired = await routeRequestForTest(
      new Request('https://scenario.invalid/settings/api/context/task-instance', {
        headers: { Cookie: cookiePair },
      }),
      { nowMs: FIXED_NOW + SESSION_TTL_MS },
    )
    expect(expired.status).toBe(401)
  })

  test('rejects an auth code at its exact injected expiration boundary', async () => {
    const code = issueAuthCode({ platformInstanceId: 'pi-1', platformUserId: 'alice' }, FIXED_NOW)
    const response = await routeRequestForTest(
      new Request('https://scenario.invalid/settings/auth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }),
      { nowMs: FIXED_NOW + CODE_TTL_MS },
    )

    expect(response.status).toBe(401)
  })
})
