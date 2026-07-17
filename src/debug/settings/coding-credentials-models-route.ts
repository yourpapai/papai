// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { fetchProviderModels } from '../../modules/coding/credentials/provider-models.js'
import { getCodingCredentials } from '../../modules/coding/credentials/store.js'
import type { AuthenticatedSettingsRequest } from '../../settings/request-auth.js'
import { authenticate, resolveContextScope, settingsJson } from './respond.js'

async function handleModels(authed: AuthenticatedSettingsRequest, url: URL): Promise<Response> {
  const scope = resolveContextScope(authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response
  const agent = url.searchParams.get('agent') ?? ''
  const creds = getCodingCredentials(scope.scope.contextId, 'agent-provider') ?? {}
  const provider = (creds as Record<string, string | undefined>)['provider']?.trim() ?? 'anthropic'
  const key = (creds as Record<string, string | undefined>)['provider_api_key']?.trim() ?? ''
  const baseUrl = (creds as Record<string, string | undefined>)['provider_base_url']?.trim()
  if (key.length === 0) return settingsJson(200, { ok: false, models: [] })
  try {
    const models = await fetchProviderModels(provider, baseUrl, key, agent)
    return settingsJson(200, { ok: true, models })
  } catch {
    return settingsJson(200, { ok: false, models: [] })
  }
}

export function handleCodingCredentialsModelsRoute(req: Request, url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (req.method === 'GET') return handleModels(auth.authed, url)
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
