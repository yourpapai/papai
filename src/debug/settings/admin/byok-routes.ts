// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { disableByokForContext, enableByokForContext, listByokAdminSummaries } from '../../../byok-llm/store.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

const PatchBodySchema = z.object({ contextId: z.string().min(1), enabled: z.boolean() })

export async function handleAdminByokRoutes(req: Request, _url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response

  if (req.method === 'GET') {
    const guard = requireAdmin(auth.authed, 'read')
    if (guard !== null) return guard
    return settingsJson(200, { contexts: listByokAdminSummaries() })
  }

  if (req.method === 'PATCH') {
    const guard = requireAdmin(auth.authed, 'write')
    if (guard !== null) return guard

    const csrf = requireCsrf(req, auth.authed)
    if (csrf !== null) return csrf

    const parsed = await parseJsonBody(req)
    if (!parsed.ok) return parsed.response

    const body = PatchBodySchema.safeParse(parsed.value)
    if (!body.success) return settingsJson(422, { error: 'invalid request' })

    if (body.data.enabled) {
      enableByokForContext(body.data.contextId, auth.authed.principal.platformUserId)
    } else {
      disableByokForContext(body.data.contextId, auth.authed.principal.platformUserId)
    }

    return settingsJson(200, { ok: true, contextId: body.data.contextId, enabled: body.data.enabled })
  }

  return settingsJson(405, { error: 'method not allowed' })
}
