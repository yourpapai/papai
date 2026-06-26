// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { handleAdminByokRoutes } from './settings/admin/byok-routes.js'
import { handleAdminFeatureFlagsRoutes } from './settings/admin/feature-flags-routes.js'
import { handleAdminInstancesRoutes } from './settings/admin/instances-routes.js'
import { handleAdminPluginConfigRoutes } from './settings/admin/plugin-config-routes.js'
import { handleAdminReleaseNotesRoutes } from './settings/admin/release-notes-routes.js'
import { handleAdminRosterPluginsRoutes } from './settings/admin/roster-plugins-routes.js'
import { handleAdminSystemAccessRoutes } from './settings/admin/system-access-routes.js'
import { handleAdminToolDefaultsRoutes } from './settings/admin/tool-defaults-routes.js'
import { handleByokRoutes } from './settings/byok-routes.js'
import { handleCodingCredentialsRoutes } from './settings/coding-credentials-routes.js'
import { handleConfigRoutes } from './settings/config-routes.js'
import { handleContextTaskInstanceRoutes } from './settings/context-task-instance-routes.js'
import { handleGroupRoutes } from './settings/group-routes.js'
import { handleIdentityRoutes } from './settings/identity-routes.js'
import { handleKaneoCredentialsRoutes } from './settings/kaneo-credentials-routes.js'
import { handleMcpRoutes } from './settings/mcp-routes.js'
import { handleMemoryRoutes } from './settings/memory-routes.js'
import { handlePluginsRoutes } from './settings/plugins-routes.js'
import { handleProvisionKaneo } from './settings/provision-routes.js'
import { handleToolsRoutes } from './settings/tools-routes.js'

function routeAdminApi(req: Request, url: URL): Promise<Response> | null {
  const p = url.pathname
  if (
    p.startsWith('/settings/api/admin/platform-instances') ||
    p.startsWith('/settings/api/admin/task-instances') ||
    p === '/settings/api/admin/platform-provider-types' ||
    p === '/settings/api/admin/task-provider-types'
  )
    return handleAdminInstancesRoutes(req, url, p)
  if (
    p === '/settings/api/admin/system' ||
    p === '/settings/api/admin/users' ||
    p === '/settings/api/admin/users/block' ||
    p === '/settings/api/admin/open-access' ||
    p === '/settings/api/admin/groups'
  )
    return handleAdminSystemAccessRoutes(req, url, p)
  if (
    p === '/settings/api/admin/admins' ||
    p === '/settings/api/admin/plugin-approval' ||
    p === '/settings/api/admin/announce'
  )
    return handleAdminRosterPluginsRoutes(req, url, p)
  if (p === '/settings/api/admin/plugin-config') return handleAdminPluginConfigRoutes(req, url, p)
  if (p === '/settings/api/admin/feature-flags') return handleAdminFeatureFlagsRoutes(req, url, p)
  if (p === '/settings/api/admin/byok') return handleAdminByokRoutes(req, url)
  if (p === '/settings/api/admin/tool-defaults') return handleAdminToolDefaultsRoutes(req, url, p)
  if (p === '/settings/api/admin/release-notes') return handleAdminReleaseNotesRoutes(req, url, p)
  return null
}

/**
 * Dispatch `/settings/api/*` requests (excluding `/settings/api/session`, owned by
 * settings-router.ts). Returns a Response for owned paths, or null to fall through
 * to the 404 handler. Never consults DEBUG_TOKEN.
 */
export function routeSettingsApi(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname.startsWith('/settings/api/admin/')) {
    const adminResult = routeAdminApi(req, url)
    if (adminResult !== null) return adminResult
  }
  if (url.pathname === '/settings/api/byok') return handleByokRoutes(req, url)
  if (url.pathname === '/settings/api/coding-credentials') return handleCodingCredentialsRoutes(req, url)
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
  if (url.pathname === '/settings/api/kaneo/credentials') return handleKaneoCredentialsRoutes(req, url)
  return Promise.resolve(null)
}
