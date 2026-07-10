// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  mcpRedactionConfigSchema,
  resolveMcpRedactionConfig,
  setMcpRedactionConfig,
  type McpRedactionConfig,
} from '../../../coding-credentials/mcp-redaction.js'
import { logger } from '../../../logger.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-admin-mcp-redaction' })

interface MaskedMcpRedactionConfig {
  model_url: string
  model_name: string
  timeout_ms?: number
  api_key_set: boolean
}

function mask(config: McpRedactionConfig): MaskedMcpRedactionConfig {
  return {
    model_url: config.model_url,
    model_name: config.model_name,
    timeout_ms: config.timeout_ms,
    api_key_set: true,
  }
}

function view(pi: string): Response {
  const config = resolveMcpRedactionConfig(pi)
  return settingsJson(200, { config: config === null ? null : mask(config) })
}

function handleGet(authed: AuthenticatedSettingsRequest): Response {
  const guard = requireAdmin(authed, 'read')
  if (guard !== null) return guard
  return view(authed.principal.platformInstanceId)
}

async function handlePut(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = mcpRedactionConfigSchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const pi = authed.principal.platformInstanceId
  setMcpRedactionConfig(pi, body.data)
  log.info({ platformInstanceId: pi }, 'MCP redaction config updated')

  return view(pi)
}

export function handleAdminMcpRedactionRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (pathname === '/settings/api/admin/mcp-redaction') {
    if (req.method === 'GET') return Promise.resolve(handleGet(auth.authed))
    if (req.method === 'PUT') return handlePut(req, auth.authed)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
