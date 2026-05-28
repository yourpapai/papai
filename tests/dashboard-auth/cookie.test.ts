// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  buildSetCookie,
  buildClearCookie,
  readSessionCookie,
  SESSION_COOKIE_NAME,
} from '../../src/dashboard-auth/cookie.js'

const reqWith = (headers: Record<string, string>): Request => new Request('http://localhost/test', { headers })

describe('readSessionCookie', () => {
  test('returns null when no Cookie header', () => {
    expect(readSessionCookie(reqWith({}))).toBeNull()
  })

  test('returns the dashboard_session value', () => {
    expect(readSessionCookie(reqWith({ Cookie: `${SESSION_COOKIE_NAME}=abc123` }))).toBe('abc123')
  })

  test('skips other cookies', () => {
    expect(readSessionCookie(reqWith({ Cookie: `theme=dark; ${SESSION_COOKIE_NAME}=abc123; lang=en` }))).toBe('abc123')
  })

  test('trims surrounding whitespace', () => {
    expect(readSessionCookie(reqWith({ Cookie: `  ${SESSION_COOKIE_NAME} = xyz  ` }))).toBe('xyz')
  })

  test('returns null on malformed percent-encoding instead of throwing', () => {
    expect(readSessionCookie(reqWith({ Cookie: `${SESSION_COOKIE_NAME}=%E0%A4%A` }))).toBeNull()
  })
})

describe('buildSetCookie', () => {
  test('emits HttpOnly SameSite=Strict Path=/ with max-age', () => {
    const value = buildSetCookie({ value: 'token', maxAgeSeconds: 60, secure: true })
    expect(value).toContain(`${SESSION_COOKIE_NAME}=token`)
    expect(value).toContain('HttpOnly')
    expect(value).toContain('SameSite=Strict')
    expect(value).toContain('Path=/')
    expect(value).toContain('Max-Age=60')
    expect(value).toContain('Secure')
  })

  test('omits Secure when secure=false (localhost http dev)', () => {
    expect(buildSetCookie({ value: 'token', maxAgeSeconds: 60, secure: false })).not.toContain('Secure')
  })
})

describe('buildClearCookie', () => {
  test('emits Max-Age=0 and the same attributes', () => {
    const value = buildClearCookie({ secure: true })
    expect(value).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(value).toContain('Max-Age=0')
    expect(value).toContain('HttpOnly')
    expect(value).toContain('SameSite=Strict')
    expect(value).toContain('Path=/')
  })
})
