// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import assert from 'node:assert/strict'

import { z } from 'zod'

import { handleSettingsExchange } from '../../../src/debug/settings-routes.js'
import { issueAuthCode } from '../../../src/settings/auth-code-store.js'
import { SESSION_COOKIE_NAME } from '../../../src/settings/cookies.js'
import { CSRF_HEADER } from '../../../src/settings/request-auth.js'

const ExchangeResponseSchema = z.object({ csrfToken: z.string() })

export interface SettingsSession {
  cookie: string
  csrf: string
}

/** Issue a code, exchange it, and return the cookie + CSRF token for the principal. */
export async function establishSession(
  principal: { platformInstanceId: string; platformUserId: string },
  nowMs = Date.now(),
): Promise<SettingsSession> {
  const code = issueAuthCode(principal, nowMs)
  const req = new Request('https://x/settings/auth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  const res = await handleSettingsExchange(req, nowMs + 1)
  assert.equal(res.status, 200, 'exchange should succeed')
  const setCookie = res.headers.get('Set-Cookie')
  assert(setCookie !== null, 'expected Set-Cookie')
  const cookie = setCookie.split(';')[0]!.split('=')[1]!
  const body = ExchangeResponseSchema.parse(await res.json())
  return { cookie, csrf: body.csrfToken }
}

/** Build request headers carrying the session cookie and (optionally) the CSRF token. */
export function authHeaders(session: SettingsSession, withCsrf = false): Record<string, string> {
  const headers: Record<string, string> = { Cookie: `${SESSION_COOKIE_NAME}=${session.cookie}` }
  if (withCsrf) headers[CSRF_HEADER] = session.csrf
  return headers
}
