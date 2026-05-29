// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const SESSION_COOKIE_NAME = 'papai_settings_session'

const ATTRIBUTES = 'HttpOnly; Secure; SameSite=Lax; Path=/settings'

export function buildSessionCookie(sessionId: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE_NAME}=${sessionId}; ${ATTRIBUTES}; Max-Age=${maxAgeSec}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; ${ATTRIBUTES}; Max-Age=0`
}

export function parseSessionCookie(req: Request): string | null {
  const header = req.headers.get('Cookie')
  if (header === null) return null
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    if (trimmed.slice(0, eq) === SESSION_COOKIE_NAME) {
      const value = trimmed.slice(eq + 1)
      return value === '' ? null : value
    }
  }
  return null
}
