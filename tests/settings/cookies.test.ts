// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  SESSION_COOKIE_NAME,
  buildSessionCookie,
  clearSessionCookie,
  parseSessionCookie,
} from '../../src/settings/cookies.js'

describe('settings cookies', () => {
  test('buildSessionCookie sets hardened attributes scoped to /settings', () => {
    const cookie = buildSessionCookie('sid-value', 3600)
    expect(cookie).toBe(
      `${SESSION_COOKIE_NAME}=sid-value; HttpOnly; Secure; SameSite=Lax; Path=/settings; Max-Age=3600`,
    )
  })

  test('clearSessionCookie expires the cookie with the same path scope', () => {
    expect(clearSessionCookie()).toBe(
      `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/settings; Max-Age=0`,
    )
  })

  test('parseSessionCookie extracts the session id', () => {
    const req = new Request('https://x/settings/api/session', {
      headers: { Cookie: `other=1; ${SESSION_COOKIE_NAME}=sid-value; more=2` },
    })
    expect(parseSessionCookie(req)).toBe('sid-value')
  })

  test('parseSessionCookie returns null when absent', () => {
    expect(parseSessionCookie(new Request('https://x/settings/api/session'))).toBeNull()
  })
})
