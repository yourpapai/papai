// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { handleAdminByokRoutes } from './settings/admin/byok-routes.js'
import { handleAdminFeatureFlagsRoutes } from './settings/admin/feature-flags-routes.js'
import { handleAdminInstancesRoutes } from './settings/admin/instances-routes.js'
import { handleAdminPluginConfigRoutes } from './settings/admin/plugin-config-routes.js'
import { handleAdminRosterPluginsRoutes } from './settings/admin/roster-plugins-routes.js'
import { handleAdminSystemAccessRoutes } from './settings/admin/system-access-routes.js'
import { handleByokRoutes } from './settings/byok-routes.js'
import { handleConfigRoutes } from './settings/config-routes.js'
import { handleContextTaskInstanceRoutes } from './settings/context-task-instance-routes.js'
import { handleGroupRoutes } from './settings/group-routes.js'
import { handleIdentityRoutes } from './settings/identity-routes.js'
import { handleMcpRoutes } from './settings/mcp-routes.js'
import { handleMemoryRoutes } from './settings/memory-routes.js'
import { handlePluginsRoutes } from './settings/plugins-routes.js'
import { handleProvisionKaneo } from './settings/provision-routes.js'
import { handleToolsRoutes } from './settings/tools-routes.js'

/**
 * Dispatch `/settings/api/*` requests (excluding `/settings/api/session`, owned by
 * settings-router.ts). Returns a Response for owned paths, or null to fall through
 * to the 404 handler. Never consults DEBUG_TOKEN.
 */
export function routeSettingsApi(req: Request, url: URL): Promise<Response | null> {
  if (
    url.pathname.startsWith('/settings/api/admin/platform-instances') ||
    url.pathname.startsWith('/settings/api/admin/task-instances') ||
    url.pathname === '/settings/api/admin/platform-provider-types' ||
    url.pathname === '/settings/api/admin/task-provider-types'
  ) {
    return handleAdminInstancesRoutes(req, url, url.pathname)
  }
  if (
    url.pathname === '/settings/api/admin/system' ||
    url.pathname === '/settings/api/admin/users' ||
    url.pathname === '/settings/api/admin/users/block' ||
    url.pathname === '/settings/api/admin/open-access' ||
    url.pathname === '/settings/api/admin/groups'
  ) {
    return handleAdminSystemAccessRoutes(req, url, url.pathname)
  }
  if (
    url.pathname === '/settings/api/admin/admins' ||
    url.pathname === '/settings/api/admin/plugin-approval' ||
    url.pathname === '/settings/api/admin/announce'
  ) {
    return handleAdminRosterPluginsRoutes(req, url, url.pathname)
  }
  if (url.pathname === '/settings/api/admin/plugin-config') {
    return handleAdminPluginConfigRoutes(req, url, url.pathname)
  }
  if (url.pathname === '/settings/api/admin/feature-flags') {
    return handleAdminFeatureFlagsRoutes(req, url, url.pathname)
  }
  if (url.pathname === '/settings/api/admin/byok') return handleAdminByokRoutes(req, url)
  if (url.pathname === '/settings/api/byok') return handleByokRoutes(req, url)
  if (url.pathname === '/settings/api/config') return handleConfigRoutes(req, url)
  if (url.pathname === '/settings/api/context/task-instance') return handleContextTaskInstanceRoutes(req, url)
  if (url.pathname === '/settings/api/tools' || url.pathname === '/settings/api/tools/toggle') {
    return handleToolsRoutes(req, url, url.pathname)
  }
  if (url.pathname === '/settings/api/mcp') return handleMcpRoutes(req, url)
  if (url.pathname === '/settings/api/memory' || url.pathname.startsWith('/settings/api/memory/')) {
    return handleMemoryRoutes(req, url)
  }
  if (url.pathname.startsWith('/settings/api/plugins')) return handlePluginsRoutes(req, url, url.pathname)
  if (url.pathname === '/settings/api/identity') return handleIdentityRoutes(req, url)
  if (url.pathname.startsWith('/settings/api/group/')) return handleGroupRoutes(req, url, url.pathname)
  if (url.pathname === '/settings/api/provision/kaneo') return handleProvisionKaneo(req)
  return Promise.resolve(null)
}
