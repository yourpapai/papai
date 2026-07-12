// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { broadcastMessage } from '../../../commands/announce-broadcast.js'
import { addAdmin, listAdmins, removeAdmin } from '../../../instances/admin-store.js'
import { logger } from '../../../logger.js'
import { activatePlugins, deactivatePluginById } from '../../../plugins/loader.js'
import type { ProviderRuntimeDeps } from '../../../plugins/provider-runtime.js'
import { pluginRegistry } from '../../../plugins/registry.js'
import { getPluginAdminState } from '../../../plugins/store.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { getRuntimeChatRouter } from '../../chat-router-runtime.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin, requireSuperAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-admin-roster' })

const AdminBodySchema = z.object({ userId: z.string().min(1), platformInstanceId: z.string().min(1) })

async function handleRoster(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (req.method === 'GET') {
    const guard = requireAdmin(authed, 'read')
    if (guard !== null) return guard
    return settingsJson(200, { admins: listAdmins() })
  }
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return settingsJson(405, { error: 'method not allowed' })
  }
  const guard = requireSuperAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = AdminBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  if (req.method === 'POST') {
    addAdmin(body.data.userId, body.data.platformInstanceId)
    log.info({ platformInstanceId: body.data.platformInstanceId }, 'Settings SA added admin')
    return settingsJson(200, { ok: true })
  }
  removeAdmin(body.data.userId, body.data.platformInstanceId)
  log.info({ platformInstanceId: body.data.platformInstanceId }, 'Settings SA removed admin')
  return settingsJson(200, { ok: true })
}

const PluginActionSchema = z.object({ pluginId: z.string().min(1), action: z.enum(['approve', 'reject']) })

export type AdminRosterPluginRouteOptions = Readonly<{ pluginProviderRuntimeDeps?: ProviderRuntimeDeps }>

async function handlePluginApproval(
  req: Request,
  authed: AuthenticatedSettingsRequest,
  options: AdminRosterPluginRouteOptions,
): Promise<Response> {
  if (req.method !== 'POST') return settingsJson(405, { error: 'method not allowed' })
  const guard = requireSuperAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PluginActionSchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const entry = pluginRegistry.getEntry(body.data.pluginId)
  if (entry === undefined) return settingsJson(422, { error: 'unknown plugin' })

  if (body.data.action === 'approve') {
    pluginRegistry.approve(body.data.pluginId, authed.principal.platformUserId, entry.discoveredPlugin.manifestHash)
    const approvedEntry = pluginRegistry.getEntry(body.data.pluginId)
    if (approvedEntry !== undefined && approvedEntry.state === 'approved') {
      await activatePlugins([approvedEntry.discoveredPlugin], {
        providerRuntimeDeps: options.pluginProviderRuntimeDeps,
      })
    }
  } else {
    await deactivatePluginById(body.data.pluginId)
    pluginRegistry.reject(body.data.pluginId)
  }
  log.info({ pluginId: body.data.pluginId, action: body.data.action }, 'Settings SA changed plugin approval')
  return settingsJson(200, { ok: true, state: getPluginAdminState(body.data.pluginId)?.state ?? null })
}

const AnnounceSchema = z.object({ message: z.string().min(1) })

async function handleAnnounce(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (req.method !== 'POST') return settingsJson(405, { error: 'method not allowed' })
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = AnnounceSchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const chat = getRuntimeChatRouter()
  if (chat === null) return settingsJson(422, { error: 'chat router not running' })
  const result = await broadcastMessage(chat, authed.principal.platformInstanceId, body.data.message)
  return settingsJson(200, result)
}

export function handleAdminRosterPluginsRoutes(
  req: Request,
  _url: URL,
  pathname: string,
  options: AdminRosterPluginRouteOptions = {},
): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (pathname === '/settings/api/admin/admins') return handleRoster(req, auth.authed)
  if (pathname === '/settings/api/admin/plugin-approval') return handlePluginApproval(req, auth.authed, options)
  if (pathname === '/settings/api/admin/announce') return handleAnnounce(req, auth.authed)
  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
