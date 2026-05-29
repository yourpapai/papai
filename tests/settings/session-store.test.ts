// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { hashToken } from '../../src/settings/crypto.js'
import {
  SESSION_TTL_MS,
  createSession,
  deleteSession,
  deleteSessionsForPrincipal,
  getSession,
  rotateSessionCsrf,
} from '../../src/settings/session-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const principal = { platformInstanceId: 'pi-1', platformUserId: 'u-1' }

describe('settings session store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('createSession then getSession returns the principal and stored csrf hash', () => {
    const created = createSession(principal, 1000)
    const session = getSession(created.sessionId, 2000)
    expect(session?.platformInstanceId).toBe('pi-1')
    expect(session?.platformUserId).toBe('u-1')
    expect(session?.csrfTokenHash).toBe(hashToken(created.csrfToken))
  })

  test('getSession slides the expiry on activity', () => {
    const created = createSession(principal, 1000)
    const session = getSession(created.sessionId, 5000)
    expect(session?.expiresAt).toBe(5000 + SESSION_TTL_MS)
  })

  test('an expired session is rejected and removed', () => {
    const created = createSession(principal, 1000)
    expect(getSession(created.sessionId, 1000 + SESSION_TTL_MS + 1)).toBeNull()
    // even with a fresh clock, the row is gone
    expect(getSession(created.sessionId, 2000)).toBeNull()
  })

  test('rotateSessionCsrf issues a new token and updates the stored hash', () => {
    const created = createSession(principal, 1000)
    const rotated = rotateSessionCsrf(created.sessionId, 2000)
    expect(rotated).not.toBeNull()
    expect(rotated).not.toBe(created.csrfToken)
    const session = getSession(created.sessionId, 3000)
    expect(session?.csrfTokenHash).toBe(hashToken(rotated!))
  })

  test('deleteSession removes the session', () => {
    const created = createSession(principal, 1000)
    deleteSession(created.sessionId)
    expect(getSession(created.sessionId, 2000)).toBeNull()
  })

  test('deleteSessionsForPrincipal removes all and reports the count', () => {
    createSession(principal, 1000)
    createSession(principal, 1100)
    expect(deleteSessionsForPrincipal('pi-1', 'u-1')).toBe(2)
  })
})
