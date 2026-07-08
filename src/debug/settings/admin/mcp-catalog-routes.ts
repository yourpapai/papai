// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../../logger.js'
import { mcpCatalogSchema, resolveMcpCatalog, setMcpCatalog } from '../../../modules/coding/credentials/mcp-catalog.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-admin-mcp-catalog' })

const PostBodySchema = z.object({ kind: z.literal('catalog'), entries: mcpCatalogSchema })

function view(pi: string): Response {
  return settingsJson(200, { entries: resolveMcpCatalog(pi) })
}

function handleGet(authed: AuthenticatedSettingsRequest): Response {
  const guard = requireAdmin(authed, 'read')
  if (guard !== null) return guard
  return view(authed.principal.platformInstanceId)
}

async function handlePost(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PostBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const pi = authed.principal.platformInstanceId
  setMcpCatalog(pi, body.data.entries)
  log.info({ platformInstanceId: pi }, 'MCP catalog updated')

  return view(pi)
}

export function handleAdminMcpCatalogRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (pathname === '/settings/api/admin/mcp-catalog') {
    if (req.method === 'GET') return Promise.resolve(handleGet(auth.authed))
    if (req.method === 'POST') return handlePost(req, auth.authed)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
