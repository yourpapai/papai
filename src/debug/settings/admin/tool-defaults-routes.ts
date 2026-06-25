// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../../logger.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { adminToolDefaultsContextId } from '../../../tools/admin-tool-defaults.js'
import { getToolMetadata, isToolDomain, TOOL_METADATA } from '../../../tools/tool-metadata.js'
import {
  applyPreset,
  clearToolPrefs,
  detectActivePreset,
  getToolPrefs,
  hasStoredToolPrefs,
  setToolPrefs,
} from '../../../tools/tool-preferences.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { buildDomainView, setDomainPermission, setToolPermission } from '../tools-routes.js'
import { requireAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-admin-tool-defaults' })

const CATALOG_NAMES: readonly string[] = Object.keys(TOOL_METADATA)

const ToggleBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('domain'), permission: z.enum(['allow', 'ask', 'deny']), domain: z.string() }),
  z.object({ kind: z.literal('tool'), permission: z.enum(['allow', 'ask', 'deny']), tool: z.string() }),
  z.object({ kind: z.literal('preset'), preset: z.enum(['allow-all', 'non-destructive', 'read-only']) }),
  z.object({ kind: z.literal('unset') }),
])

function view(contextId: string): Response {
  const prefs = getToolPrefs(contextId)
  // When no row exists, the admin default is unconfigured — report null, not 'allow-all'.
  const activePreset = hasStoredToolPrefs(contextId) ? detectActivePreset(prefs) : null
  return settingsJson(200, {
    contextId,
    domains: buildDomainView(CATALOG_NAMES, prefs),
    activePreset,
  })
}

function handleGet(authed: AuthenticatedSettingsRequest): Response {
  const guard = requireAdmin(authed, 'read')
  if (guard !== null) return guard
  return view(adminToolDefaultsContextId(authed.principal.platformInstanceId))
}

async function handlePost(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ToggleBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const ctx = adminToolDefaultsContextId(authed.principal.platformInstanceId)
  const prefs = getToolPrefs(ctx)

  if (body.data.kind === 'unset') {
    clearToolPrefs(ctx)
    log.info({ platformInstanceId: authed.principal.platformInstanceId }, 'Admin tool defaults unset')
    return view(ctx)
  } else if (body.data.kind === 'domain') {
    if (!isToolDomain(body.data.domain)) return settingsJson(422, { error: 'unknown tool domain' })
    setToolPrefs(ctx, setDomainPermission(prefs, body.data.domain, body.data.permission))
  } else if (body.data.kind === 'tool') {
    // catalog membership only — admin defaults are provider-agnostic (no live context to gate against)
    if (getToolMetadata(body.data.tool) === undefined) return settingsJson(422, { error: 'unknown tool' })
    setToolPrefs(ctx, setToolPermission(prefs, body.data.tool, body.data.permission))
  } else {
    setToolPrefs(ctx, applyPreset(body.data.preset))
  }
  log.info({ platformInstanceId: authed.principal.platformInstanceId, kind: body.data.kind }, 'Admin tool default set')
  return view(ctx)
}

export function handleAdminToolDefaultsRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (pathname === '/settings/api/admin/tool-defaults') {
    if (req.method === 'GET') return Promise.resolve(handleGet(auth.authed))
    if (req.method === 'POST') return handlePost(req, auth.authed)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
