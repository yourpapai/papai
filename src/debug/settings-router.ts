// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { handleSettingsBootstrap, handleSettingsExchange, handleSettingsLogout } from './settings-routes.js'

/** True for any path the settings trust domain owns. */
export function isSettingsPath(pathname: string): boolean {
  return pathname === '/settings' || pathname.startsWith('/settings/')
}

const methodNotAllowed = (): Response => new Response('Method not allowed', { status: 405 })

/**
 * Dispatch `/settings/*` requests. Returns a Response for any settings path
 * (including 404/405), and never consults DEBUG_TOKEN. Returns null only for
 * paths it does not own (so a caller can fall through).
 */
export function routeSettingsPaths(req: Request, url: URL): Promise<Response | null> {
  if (!isSettingsPath(url.pathname)) return Promise.resolve(null)

  if (url.pathname === '/settings/auth/exchange') {
    return req.method === 'POST' ? handleSettingsExchange(req) : Promise.resolve(methodNotAllowed())
  }
  if (url.pathname === '/settings/auth/logout') {
    return Promise.resolve(req.method === 'POST' ? handleSettingsLogout(req) : methodNotAllowed())
  }
  if (url.pathname === '/settings/api/session') {
    return Promise.resolve(req.method === 'GET' ? handleSettingsBootstrap(req) : methodNotAllowed())
  }

  // Static SPA serving (client/settings) and the per-capability /settings/api/*
  // write routes are delivered by the Surface spec. Anything else is 404.
  return Promise.resolve(new Response('Not found', { status: 404 }))
}
