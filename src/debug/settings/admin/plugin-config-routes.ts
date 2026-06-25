// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../../logger.js'
import {
  AdminPluginConfigError,
  applyAdminPluginConfigUnset,
  applyAdminPluginConfigUpdate,
  buildPluginConfigDescriptors,
  getAdminPluginConfigSnapshot,
  PatchAdminPluginConfigBodySchema,
} from '../../admin-plugin-config.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-admin-plugin-config' })

export function handleAdminPluginConfigRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  if (pathname !== '/settings/api/admin/plugin-config') {
    return Promise.resolve(settingsJson(404, { error: 'not found' }))
  }

  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)

  if (req.method === 'GET') {
    const guard = requireAdmin(auth.authed, 'read')
    if (guard !== null) return Promise.resolve(guard)
    const snapshot = getAdminPluginConfigSnapshot(buildPluginConfigDescriptors())
    return Promise.resolve(settingsJson(200, snapshot))
  }

  if (req.method === 'PATCH') {
    return handlePatch(req, auth.authed)
  }

  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}

async function handlePatch(req: Request, authed: Parameters<typeof requireAdmin>[0]): Promise<Response> {
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard

  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf

  const rawParsed = await parseJsonBody(req)
  if (!rawParsed.ok) return rawParsed.response

  const body = PatchAdminPluginConfigBodySchema.safeParse(rawParsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  try {
    if (body.data.action === 'unset') {
      const result = applyAdminPluginConfigUnset(
        body.data,
        authed.principal.platformUserId,
        buildPluginConfigDescriptors(),
      )
      log.info({ pluginId: result.pluginId, key: result.key }, 'Settings admin unset plugin config')
      return settingsJson(200, { ok: true, pluginId: result.pluginId, key: result.key })
    }
    const result = applyAdminPluginConfigUpdate(
      body.data,
      authed.principal.platformUserId,
      buildPluginConfigDescriptors(),
    )
    log.info({ pluginId: result.pluginId, key: result.key }, 'Settings admin updated plugin config')
    return settingsJson(200, { ok: true, pluginId: result.pluginId, key: result.key, updatedAt: result.updatedAt })
  } catch (err) {
    if (err instanceof AdminPluginConfigError) {
      return settingsJson(422, { error: err.message })
    }
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'Settings admin plugin config PATCH failed')
    return settingsJson(500, { error: 'internal server error' })
  }
}
