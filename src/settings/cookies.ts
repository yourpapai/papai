// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const SESSION_COOKIE_NAME = 'papai_settings_session'

const BASE_ATTRIBUTES = 'HttpOnly; SameSite=Lax; Path=/settings'

/**
 * Build the session cookie. `Secure` is appended only when the request arrived
 * over HTTPS — browsers silently reject a `Secure` cookie sent over plain HTTP,
 * which would make the session appear to expire immediately.
 */
export function buildSessionCookie(sessionId: string, maxAgeSec: number, secure: boolean): string {
  const cookie = `${SESSION_COOKIE_NAME}=${sessionId}; ${BASE_ATTRIBUTES}; Max-Age=${maxAgeSec}`
  return secure ? `${cookie}; Secure` : cookie
}

export function clearSessionCookie(secure: boolean): string {
  const cookie = `${SESSION_COOKIE_NAME}=; ${BASE_ATTRIBUTES}; Max-Age=0`
  return secure ? `${cookie}; Secure` : cookie
}

export function parseSessionCookie(req: Request): string | null {
  const header = req.headers.get('Cookie')
  if (header === null) return null
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    if (trimmed.slice(0, eq) === SESSION_COOKIE_NAME) {
      const value = trimmed.slice(eq + 1).trim()
      return value === '' ? null : value
    }
  }
  return null
}
