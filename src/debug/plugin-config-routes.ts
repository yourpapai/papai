// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { pluginRegistry } from '../plugins/registry.js'
import {
  AdminPluginConfigError,
  applyAdminPluginConfigUpdate,
  getAdminPluginConfigSnapshot,
  type PluginConfigDescriptor,
} from './admin-plugin-config.js'

const log = logger.child({ scope: 'debug-server:plugin-config-routes' })

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

function buildDescriptors(): PluginConfigDescriptor[] {
  const entries = pluginRegistry.getAllEntries()
  return entries.map((entry) => ({
    pluginId: entry.discoveredPlugin.manifest.id,
    configRequirements: entry.discoveredPlugin.manifest.configRequirements.map((req) => ({
      key: req.key,
      label: req.label,
      required: req.required,
      sensitive: req.sensitive,
      scope: req.scope,
    })),
  }))
}

export const handleAdminPluginConfigGet = (): Response => {
  const snapshot = getAdminPluginConfigSnapshot(buildDescriptors())
  return jsonResponse(200, snapshot)
}

export const handleAdminPluginConfigPost = async (req: Request): Promise<Response> => {
  const debugToken = process.env['DEBUG_TOKEN']
  if (debugToken === undefined || debugToken === '') {
    log.warn('admin/plugin-config POST refused: DEBUG_TOKEN is not set in env')
    return jsonResponse(401, { error: 'credentials API requires DEBUG_TOKEN' })
  }
  const adminUserId = process.env['ADMIN_USER_ID']
  if (adminUserId === undefined || adminUserId === '') {
    log.error('admin/plugin-config POST refused: ADMIN_USER_ID is not set in env')
    return jsonResponse(503, { error: 'admin user id not configured' })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'invalid JSON body' })
  }

  try {
    const result = applyAdminPluginConfigUpdate(body, adminUserId, buildDescriptors())
    return jsonResponse(200, { ok: true, pluginId: result.pluginId, key: result.key, updatedAt: result.updatedAt })
  } catch (err) {
    if (err instanceof AdminPluginConfigError) {
      return jsonResponse(400, { error: err.message })
    }
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'admin/plugin-config POST failed')
    return jsonResponse(500, { error: 'internal server error' })
  }
}
