// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const SESSION_COOKIE_NAME = 'dashboard_session'

export const readSessionCookie = (req: Readonly<Request>): string | null => {
  const raw = req.headers.get('Cookie')
  if (raw === null) return null
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (name !== SESSION_COOKIE_NAME) continue
    const rawValue = part.slice(eq + 1).trim()
    if (rawValue === '') return null
    try {
      return decodeURIComponent(rawValue)
    } catch {
      return null
    }
  }
  return null
}

interface BuildOptions {
  value: string
  maxAgeSeconds: number
  secure: boolean
}

export const buildSetCookie = (opts: BuildOptions): string => {
  const attrs = [
    `${SESSION_COOKIE_NAME}=${opts.value}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${opts.maxAgeSeconds}`,
  ]
  if (opts.secure) attrs.push('Secure')
  return attrs.join('; ')
}

export const buildClearCookie = (opts: { secure: boolean }): string =>
  buildSetCookie({ value: '', maxAgeSeconds: 0, secure: opts.secure })
