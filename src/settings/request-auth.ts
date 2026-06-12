// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseSessionCookie } from './cookies.js'
import { hashToken, timingSafeEqualHex } from './crypto.js'
import { type SettingsPrincipal, resolveSettingsPrincipal } from './principal.js'
import { type SessionRecord, getSession } from './session-store.js'

export const CSRF_HEADER = 'X-Settings-CSRF'

/**
 * Whether the request arrived over HTTPS. Behind a reverse proxy the real scheme
 * is carried by the LAST `X-Forwarded-Proto` hop the trusted proxy appended;
 * otherwise fall back to the request URL's protocol. Used to gate the `Secure`
 * cookie attribute — emitting `Secure` over plain HTTP makes browsers drop the cookie.
 */
export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get('X-Forwarded-Proto')
  if (proto !== null) {
    const first = proto.split(',')[0]?.trim()
    return first === 'https'
  }
  return new URL(req.url).protocol === 'https:'
}

export type AuthenticatedSettingsRequest = {
  readonly sessionId: string
  readonly session: SessionRecord
  readonly principal: SettingsPrincipal
}

/**
 * Resolve the settings session from the request cookie (sliding its expiry) and
 * recompute the live principal scope. Returns null if unauthenticated.
 */
export function authenticateSettingsRequest(
  req: Request,
  nowMs: number = Date.now(),
): AuthenticatedSettingsRequest | null {
  const sessionId = parseSessionCookie(req)
  if (sessionId === null) return null
  const session = getSession(sessionId, nowMs)
  if (session === null) return null
  const principal = resolveSettingsPrincipal(session.platformInstanceId, session.platformUserId)
  return { sessionId, session, principal }
}

/** Verify the synchronizer CSRF token against the session's stored hash. */
export function verifyCsrf(req: Request, session: SessionRecord): boolean {
  const provided = req.headers.get(CSRF_HEADER)
  if (provided === null || provided === '') return false
  return timingSafeEqualHex(hashToken(provided), session.csrfTokenHash)
}
