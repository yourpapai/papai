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
  test('buildSessionCookie sets hardened attributes incl. Secure over HTTPS', () => {
    const cookie = buildSessionCookie('sid-value', 3600, true)
    expect(cookie).toBe(
      `${SESSION_COOKIE_NAME}=sid-value; HttpOnly; SameSite=Lax; Path=/settings; Max-Age=3600; Secure`,
    )
  })

  test('buildSessionCookie omits Secure over plain HTTP', () => {
    const cookie = buildSessionCookie('sid-value', 3600, false)
    expect(cookie).toBe(`${SESSION_COOKIE_NAME}=sid-value; HttpOnly; SameSite=Lax; Path=/settings; Max-Age=3600`)
    expect(cookie).not.toContain('Secure')
  })

  test('clearSessionCookie expires the cookie with matching attributes (secure)', () => {
    expect(clearSessionCookie(true)).toBe(
      `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/settings; Max-Age=0; Secure`,
    )
  })

  test('clearSessionCookie omits Secure over plain HTTP', () => {
    const cookie = clearSessionCookie(false)
    expect(cookie).toBe(`${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/settings; Max-Age=0`)
    expect(cookie).not.toContain('Secure')
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
