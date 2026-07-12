// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { routeSettingsApi } from './settings-api-router.js'
import { handleSettingsBootstrap, handleSettingsExchange, handleSettingsLogout } from './settings-routes.js'
import { setSettingsRequestNowMs } from './settings/request-clock.js'

export type SettingsRouteOptions = Readonly<{ nowMs?: number }>

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
export function routeSettingsPaths(
  req: Request,
  url: URL,
  options: SettingsRouteOptions = {},
): Promise<Response | null> {
  if (!isSettingsPath(url.pathname)) return Promise.resolve(null)
  setSettingsRequestNowMs(req, options.nowMs)

  if (url.pathname === '/settings/auth/exchange') {
    return req.method === 'POST' ? handleSettingsExchange(req, options.nowMs) : Promise.resolve(methodNotAllowed())
  }
  if (url.pathname === '/settings/auth/logout') {
    return Promise.resolve(req.method === 'POST' ? handleSettingsLogout(req, options.nowMs) : methodNotAllowed())
  }
  if (url.pathname === '/settings/api/session') {
    return Promise.resolve(req.method === 'GET' ? handleSettingsBootstrap(req, options.nowMs) : methodNotAllowed())
  }
  if (url.pathname === '/settings/api/bootstrap') {
    return Promise.resolve(req.method === 'GET' ? handleSettingsBootstrap(req, options.nowMs) : methodNotAllowed())
  }

  if (url.pathname.startsWith('/settings/api/')) {
    return routeSettingsApi(req, url).then((res) => res ?? new Response('Not found', { status: 404 }))
  }

  // Static SPA serving (client/settings) is delivered by the Surface spec Part B.
  // Anything else is 404.
  return Promise.resolve(new Response('Not found', { status: 404 }))
}
