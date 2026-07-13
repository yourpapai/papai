// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../logger.js'
import { consumeAuthCode } from '../settings/auth-code-store.js'
import { listAvailableContexts } from '../settings/contexts.js'
import { buildSessionCookie, clearSessionCookie } from '../settings/cookies.js'
import { resolveSettingsPrincipal } from '../settings/principal.js'
import { consumeSettingsQuota } from '../settings/rate-limit.js'
import { authenticateSettingsRequest, isSecureRequest, verifyCsrf } from '../settings/request-auth.js'
import { requireScope } from '../settings/scope-guard.js'
import { createSession, deleteSession, rotateSessionCsrf } from '../settings/session-store.js'
import { listUsers } from '../users.js'
import { settingsRequestNowMs } from './settings/request-clock.js'

const log = logger.child({ scope: 'debug-server:settings-routes' })

const EXCHANGE_LIMIT = 10
const EXCHANGE_WINDOW_MS = 10 * 60 * 1000

const ExchangeBodySchema = z.object({ code: z.string().min(1) })

const jsonResponse = (status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })

/**
 * Best-effort client IP for rate-limiting. Behind the reverse-proxy deployment
 * model the trusted proxy appends the real client IP as the LAST X-Forwarded-For
 * hop; the leftmost hops are client-controllable and must not be trusted.
 */
function clientIp(req: Request): string {
  const xff = req.headers.get('X-Forwarded-For')
  if (xff !== null && xff.length > 0) {
    const hops = xff.split(',')
    const last = hops.at(-1)?.trim()
    if (last !== undefined && last !== '') return last
  }
  return 'unknown'
}

/** Best-effort display name: the authorized username, else the platform user id. */
function principalDisplay(platformInstanceId: string, platformUserId: string): string {
  const match = listUsers(platformInstanceId).find((u) => u.platform_user_id === platformUserId)
  const username = match?.username
  return username !== null && username !== undefined && username.length > 0 ? username : platformUserId
}

export async function handleSettingsExchange(
  req: Request,
  nowMs: number = settingsRequestNowMs(req),
): Promise<Response> {
  const quota = consumeSettingsQuota('exchange', clientIp(req), EXCHANGE_LIMIT, EXCHANGE_WINDOW_MS, nowMs)
  if (!quota.allowed) {
    return jsonResponse(429, { error: 'rate limited' }, { 'Retry-After': String(quota.retryAfterSec) })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'invalid JSON body' })
  }

  const parsed = ExchangeBodySchema.safeParse(body)
  if (!parsed.success) return jsonResponse(400, { error: 'invalid request' })

  const authPrincipal = consumeAuthCode(parsed.data.code, nowMs)
  if (authPrincipal === null) return jsonResponse(401, { error: 'invalid or expired code' })

  const created = createSession(authPrincipal, nowMs)
  const resolved = resolveSettingsPrincipal(authPrincipal.platformInstanceId, authPrincipal.platformUserId)
  const maxAgeSec = Math.max(0, Math.floor((created.expiresAt - nowMs) / 1000))

  log.info({ platformInstanceId: authPrincipal.platformInstanceId }, 'Settings session established')
  return jsonResponse(
    200,
    {
      csrfToken: created.csrfToken,
      display: principalDisplay(authPrincipal.platformInstanceId, authPrincipal.platformUserId),
      principal: { isBotAdmin: resolved.isBotAdmin, isSuperAdmin: resolved.isSuperAdmin },
      contexts: listAvailableContexts(resolved),
    },
    { 'Set-Cookie': buildSessionCookie(created.sessionId, maxAgeSec, isSecureRequest(req)) },
  )
}

export function handleSettingsBootstrap(req: Request, nowMs: number = settingsRequestNowMs(req)): Response {
  const authed = authenticateSettingsRequest(req, nowMs)
  if (authed === null) return jsonResponse(401, { error: 'unauthenticated' })

  // Live authorization: a session whose principal lost access (e.g. de-authorized
  // after login) must not keep working. A principal with any manageable group is
  // necessarily authorized, so a personal-read scope check covers all access.
  const access = requireScope(authed.principal, { action: 'read', target: { kind: 'personal' } })
  if (!access.ok) return jsonResponse(403, { error: 'forbidden' })

  const csrfToken = rotateSessionCsrf(authed.sessionId, nowMs)
  if (csrfToken === null) return jsonResponse(401, { error: 'unauthenticated' })

  return jsonResponse(200, {
    csrfToken,
    display: principalDisplay(authed.principal.platformInstanceId, authed.principal.platformUserId),
    principal: { isBotAdmin: authed.principal.isBotAdmin, isSuperAdmin: authed.principal.isSuperAdmin },
    contexts: listAvailableContexts(authed.principal),
  })
}

export function handleSettingsLogout(req: Request, nowMs: number = settingsRequestNowMs(req)): Response {
  const authed = authenticateSettingsRequest(req, nowMs)
  if (authed === null) {
    return jsonResponse(401, { error: 'unauthenticated' }, { 'Set-Cookie': clearSessionCookie(isSecureRequest(req)) })
  }
  if (!verifyCsrf(req, authed.session)) {
    return jsonResponse(403, { error: 'invalid csrf token' })
  }
  deleteSession(authed.sessionId)
  return jsonResponse(200, { ok: true }, { 'Set-Cookie': clearSessionCookie(isSecureRequest(req)) })
}
