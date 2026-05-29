// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import {
  handleSettingsBootstrap,
  handleSettingsExchange,
  handleSettingsLogout,
} from '../../src/debug/settings-routes.js'
import { issueAuthCode } from '../../src/settings/auth-code-store.js'
import { SESSION_COOKIE_NAME } from '../../src/settings/cookies.js'
import { CSRF_HEADER } from '../../src/settings/request-auth.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const readJson = async (res: Response): Promise<object> => {
  const parsed: unknown = JSON.parse(await res.text())
  assert(typeof parsed === 'object' && parsed !== null, 'expected JSON object')
  return parsed
}

const pick = (obj: object, key: string): unknown => Reflect.get(obj, key) as unknown

const pickString = (obj: object, key: string): string => {
  const v = pick(obj, key)
  assert(typeof v === 'string', `expected ${key} to be a string`)
  return v
}

const pickArray = (obj: object, key: string): unknown[] => {
  const v = pick(obj, key)
  assert(Array.isArray(v), `expected ${key} to be an array`)
  return v
}

const principal = { platformInstanceId: 'pi-1', platformUserId: 'u-1' }

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('Set-Cookie')
  if (setCookie === null) throw new Error('no Set-Cookie')
  const value = setCookie.split(';')[0]?.split('=')[1]
  if (value === undefined) throw new Error('no cookie value')
  return value
}

describe('settings routes', () => {
  const original = process.env['SETTINGS_PUBLIC_BASE_URL']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
  })

  afterEach(() => {
    if (original === undefined) delete process.env['SETTINGS_PUBLIC_BASE_URL']
    else process.env['SETTINGS_PUBLIC_BASE_URL'] = original
  })

  function exchangeRequest(code: string): Request {
    return new Request('https://x/settings/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
  }

  test('exchange rejects an invalid code with 401 and ignores DEBUG_TOKEN', async () => {
    process.env['DEBUG_TOKEN'] = 'operator-secret'
    const res = await handleSettingsExchange(exchangeRequest('bogus'), 1000)
    expect(res.status).toBe(401)
    delete process.env['DEBUG_TOKEN']
  })

  test('exchange consumes a valid code, sets a session cookie, returns csrf + contexts', async () => {
    const code = issueAuthCode(principal, 1000)
    const res = await handleSettingsExchange(exchangeRequest(code), 2000)
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(res.headers.get('Set-Cookie')).toContain('HttpOnly')
    const body = await readJson(res)
    expect(typeof pickString(body, 'csrfToken')).toBe('string')
    expect(Array.isArray(pickArray(body, 'contexts'))).toBe(true)
  })

  test('bootstrap rejects an unauthenticated request with 401', () => {
    const res = handleSettingsBootstrap(new Request('https://x/settings/api/session'), 2000)
    expect(res.status).toBe(401)
  })

  test('bootstrap returns a fresh csrf token for a valid session', async () => {
    const code = issueAuthCode(principal, 1000)
    const exchanged = await handleSettingsExchange(exchangeRequest(code), 2000)
    const sid = cookieFrom(exchanged)
    const res = handleSettingsBootstrap(
      new Request('https://x/settings/api/session', { headers: { Cookie: `${SESSION_COOKIE_NAME}=${sid}` } }),
      3000,
    )
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(typeof pickString(body, 'csrfToken')).toBe('string')
  })

  test('logout requires a valid CSRF token then clears the cookie', async () => {
    const code = issueAuthCode(principal, 1000)
    const exchanged = await handleSettingsExchange(exchangeRequest(code), 2000)
    const sid = cookieFrom(exchanged)
    const exchangeBody = await readJson(exchanged)
    const csrf = pickString(exchangeBody, 'csrfToken')

    const noCsrf = await handleSettingsLogout(
      new Request('https://x/settings/auth/logout', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sid}` },
      }),
      3000,
    )
    expect(noCsrf.status).toBe(403)

    const ok = await handleSettingsLogout(
      new Request('https://x/settings/auth/logout', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sid}`, [CSRF_HEADER]: csrf },
      }),
      3000,
    )
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Set-Cookie')).toContain('Max-Age=0')
  })

  test('exchange returns 429 with Retry-After once the quota is exhausted', async () => {
    for (let i = 0; i < 10; i += 1) {
      await handleSettingsExchange(exchangeRequest('bogus'), 1000)
    }
    const res = await handleSettingsExchange(exchangeRequest('bogus'), 1000)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).not.toBeNull()
  })

  test('exchange rejects a replayed (already-consumed) code with 401', async () => {
    const code = issueAuthCode(principal, 1000)
    const first = await handleSettingsExchange(exchangeRequest(code), 2000)
    expect(first.status).toBe(200)
    const replay = await handleSettingsExchange(exchangeRequest(code), 3000)
    expect(replay.status).toBe(401)
  })
})
