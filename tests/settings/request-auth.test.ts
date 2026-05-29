// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { SESSION_COOKIE_NAME } from '../../src/settings/cookies.js'
import { CSRF_HEADER, authenticateSettingsRequest, verifyCsrf } from '../../src/settings/request-auth.js'
import { SESSION_TTL_MS, createSession } from '../../src/settings/session-store.js'
import type { SessionRecord } from '../../src/settings/session-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const principal = { platformInstanceId: 'pi-1', platformUserId: 'u-1' }

function requestWithCookie(sessionId: string, extraHeaders: Record<string, string> = {}): Request {
  return new Request('https://x/settings/api/session', {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionId}`, ...extraHeaders },
  })
}

function requireSession(session: SessionRecord | undefined): SessionRecord {
  if (session === undefined) throw new Error('expected session to be defined')
  return session
}

describe('settings request auth', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('authenticates a valid session and resolves the principal', () => {
    const created = createSession(principal, 1000)
    const authed = authenticateSettingsRequest(requestWithCookie(created.sessionId), 2000)
    expect(authed?.principal.platformUserId).toBe('u-1')
  })

  test('returns null without a cookie', () => {
    expect(authenticateSettingsRequest(new Request('https://x/settings/api/session'), 2000)).toBeNull()
  })

  test('returns null for an unknown session id', () => {
    expect(authenticateSettingsRequest(requestWithCookie('bogus'), 2000)).toBeNull()
  })

  test('returns null for an expired session', () => {
    const created = createSession(principal, 1000)
    expect(authenticateSettingsRequest(requestWithCookie(created.sessionId), 1000 + SESSION_TTL_MS + 1)).toBeNull()
  })

  test('verifyCsrf accepts the matching token and rejects others', () => {
    const created = createSession(principal, 1000)
    const authed = authenticateSettingsRequest(
      requestWithCookie(created.sessionId, { [CSRF_HEADER]: created.csrfToken }),
      2000,
    )
    expect(authed).not.toBeNull()
    const session = requireSession(authed?.session)
    expect(verifyCsrf(requestWithCookie(created.sessionId, { [CSRF_HEADER]: created.csrfToken }), session)).toBe(true)
    expect(verifyCsrf(requestWithCookie(created.sessionId, { [CSRF_HEADER]: 'wrong' }), session)).toBe(false)
    expect(verifyCsrf(requestWithCookie(created.sessionId), session)).toBe(false)
  })
})
