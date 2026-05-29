// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { handleConfigRoutes } from './settings/config-routes.js'
import { handleMcpRoutes } from './settings/mcp-routes.js'
import { handleToolsRoutes } from './settings/tools-routes.js'

/**
 * Dispatch `/settings/api/*` requests (excluding `/settings/api/session`, owned by
 * settings-router.ts). Returns a Response for owned paths, or null to fall through
 * to the 404 handler. Never consults DEBUG_TOKEN.
 */
export function routeSettingsApi(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname === '/settings/api/config') return handleConfigRoutes(req, url)
  if (url.pathname === '/settings/api/tools' || url.pathname === '/settings/api/tools/toggle') {
    return handleToolsRoutes(req, url, url.pathname)
  }
  if (url.pathname === '/settings/api/mcp') return handleMcpRoutes(req, url)
  return Promise.resolve(null)
}
