// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readSessionCookie } from '../dashboard-auth/cookie.js'
import { authenticate, buildClearCookie, consumeClaim, mintSession, revokeSession } from '../dashboard-auth/index.js'

const isSecureRequest = (req: Request): boolean => {
  const proto = req.headers.get('X-Forwarded-Proto')
  if (proto !== null) return proto === 'https'
  return new URL(req.url).protocol === 'https:'
}

export const handleAuthClaim = (req: Request, url: URL): Response => {
  const nonce = url.searchParams.get('n')
  if (nonce === null || nonce === '') return new Response('Unauthorized', { status: 401 })
  const result = consumeClaim(nonce)
  if (result === null) return new Response('Unauthorized', { status: 401 })
  const { setCookie } = mintSession(result.adminUserId, { secure: isSecureRequest(req) })
  return new Response(null, {
    status: 302,
    headers: { Location: '/admin', 'Set-Cookie': setCookie, 'Referrer-Policy': 'no-referrer' },
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
  return new Response(JSON.stringify({ adminUserId: session.adminUserId, expiresAt: session.expiresAt }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
