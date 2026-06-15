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

const escapeHtml = (value: string): string =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')

const renderClaimConfirmPage = (nonce: string): string =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Dashboard sign-in</title>
</head>
<body>
<main>
<h1>Sign in to the dashboard</h1>
<p>Press the button below to complete sign-in. This link can be used once and expires shortly.</p>
<form method="post" action="/auth/claim">
<input type="hidden" name="n" value="${escapeHtml(nonce)}">
<button type="submit">Sign in</button>
</form>
</main>
</body>
</html>`

/**
 * GET /auth/claim — renders a confirmation page only.
 *
 * The single-use nonce is NOT consumed here. Messaging-platform link-preview
 * crawlers (Telegram, Slack, etc.) issue a GET when the sign-in link is sent,
 * which would otherwise burn the claim before the user opens it. Consumption is
 * deferred to the POST form submission in {@link handleAuthClaimConfirm}, which
 * crawlers do not perform.
 */
export const handleAuthClaim = (_req: Request, url: URL): Response => {
  const nonce = url.searchParams.get('n')
  if (nonce === null || nonce === '') return new Response('Unauthorized', { status: 401 })
  return new Response(renderClaimConfirmPage(nonce), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
    },
  })
}

const readClaimNonce = async (req: Request): Promise<string | null> => {
  try {
    const form = await req.formData()
    const value = form.get('n')
    return typeof value === 'string' && value !== '' ? value : null
  } catch {
    return null
  }
}

/**
 * POST /auth/claim — consumes the single-use nonce, mints a session, redirects.
 */
export const handleAuthClaimConfirm = async (req: Request): Promise<Response> => {
  const nonce = await readClaimNonce(req)
  if (nonce === null) return new Response('Unauthorized', { status: 401 })
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
      Location: '/debug',
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

/**
 * Public `/auth/*` route table — mounted before the session-cookie gate.
 * Returns null when the path/method is not an auth route.
 */
export const routePublicAuthPaths = (req: Request, url: URL): Response | Promise<Response> | null => {
  if (url.pathname === '/auth/claim' && req.method === 'GET') return handleAuthClaim(req, url)
  if (url.pathname === '/auth/claim' && req.method === 'POST') return handleAuthClaimConfirm(req)
  if (url.pathname === '/auth/logout' && req.method === 'POST') return handleAuthLogout(req)
  if (url.pathname === '/auth/whoami' && req.method === 'GET') return handleAuthWhoami(req)
  return null
}
