// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readSessionCookie } from '../dashboard-auth/cookie.js'
import {
  authenticate,
  buildClearCookie,
  consumeClaim,
  mintSession,
  recordActivity,
  revokeSession,
} from '../dashboard-auth/index.js'
import { logger } from '../logger.js'
import { isSecureRequest } from '../settings/request-auth.js'

const log = logger.child({ scope: 'auth-routes' })

export const handleAuthClaim = (req: Request, url: URL): Response => {
  const nonce = url.searchParams.get('n')
  if (nonce === null || nonce === '') return new Response('Unauthorized', { status: 401 })
  const result = consumeClaim(nonce)
  if (result === null) return new Response('Unauthorized', { status: 401 })
  let setCookie: string
  try {
    setCookie = mintSession(result.adminUserId, { secure: isSecureRequest(req) }).setCookie
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), adminUserId: result.adminUserId },
      'auth/claim: mintSession failed after claim was consumed',
    )
    return new Response('Service unavailable', { status: 503 })
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/admin',
      'Set-Cookie': setCookie,
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    },
  })
}

export const handleAuthLogout = (req: Request): Response => {
  const cookie = readSessionCookie(req)
  if (cookie !== null) revokeSession(cookie)
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': buildClearCookie({ secure: isSecureRequest(req) }) },
  })
}

export const handleAuthWhoami = (req: Request): Response => {
  const session = authenticate(req)
  if (session === null) return new Response('Unauthorized', { status: 401 })
  recordActivity(session.sessionIdHash, req)
  return new Response(JSON.stringify({ adminUserId: session.adminUserId, expiresAt: session.expiresAt }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
