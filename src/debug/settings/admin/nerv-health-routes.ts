// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getPluginAdminConfig } from '../../../plugins/store.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { authenticate, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

export type NervHealthStatus = 'connected' | 'misconfigured' | 'unreachable'

const PROBE_TIMEOUT_MS = 5000

/**
 * Connectivity probe for the nerv coding-supervisor plugin: reads its admin-scoped config
 * (nerv_base_url/nerv_token) and calls nerv's GET /health liveness endpoint. Never throws —
 * a missing config, a timeout, or a non-2xx all resolve to a status string, never a hard crash.
 */
export async function probeNervHealth(): Promise<NervHealthStatus> {
  const baseUrl = getPluginAdminConfig('nerv', 'nerv_base_url')
  const token = getPluginAdminConfig('nerv', 'nerv_token')
  if (baseUrl === undefined || baseUrl.trim() === '' || token === undefined || token.trim() === '') {
    return 'misconfigured'
  }
  // Intentionally mirrors readNervConfig's baseUrl trim/trailing-slash-strip in plugins/nerv/client.ts —
  // core can't import a plugin's impl module across that boundary, so keep the two in sync by hand.
  const url = `${baseUrl.trim().replace(/\/+$/u, '')}/health`
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token.trim()}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    return res.ok ? 'connected' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}

async function handleGet(authed: AuthenticatedSettingsRequest): Promise<Response> {
  const guard = requireAdmin(authed, 'read')
  if (guard !== null) return guard
  const status = await probeNervHealth()
  return settingsJson(200, { status })
}

export function handleAdminNervHealthRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (pathname === '/settings/api/admin/nerv-health') {
    if (req.method === 'GET') return handleGet(auth.authed)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
