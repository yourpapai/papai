// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../../logger.js'
import {
  adminCodingGuardrailsContextId,
  guardrailsSchema,
  resolveCodingGuardrails,
  setCodingGuardrails,
} from '../../../modules/coding/credentials/guardrails.js'
import {
  clearCodingCredentials,
  getCodingCredentials,
  updateCodingCredentials,
} from '../../../modules/coding/credentials/store.js'
import { PROVIDERS } from '../../../modules/coding/credentials/types.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-admin-coding-guardrails' })

const PostBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('policy'), guardrails: guardrailsSchema }),
  z.object({
    kind: z.literal('shared-key'),
    provider: z.enum(PROVIDERS),
    api_key: z.string().min(1),
    base_url: z.string().optional(),
  }),
  z.object({ kind: z.literal('shared-key-clear') }),
])

function view(pi: string): Response {
  const guardrails = resolveCodingGuardrails(pi)
  const creds = getCodingCredentials(adminCodingGuardrailsContextId(pi), 'agent-provider')
  const sharedKeySet = creds !== null && (creds.provider_api_key?.trim() ?? '').length > 0
  return settingsJson(200, { guardrails, sharedKeySet })
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
  const principalId = authed.principal.platformUserId

  if (body.data.kind === 'policy') {
    setCodingGuardrails(pi, body.data.guardrails)
    log.info({ platformInstanceId: pi }, 'Coding guardrails policy updated')
  } else if (body.data.kind === 'shared-key') {
    updateCodingCredentials(
      adminCodingGuardrailsContextId(pi),
      'agent-provider',
      {
        provider: body.data.provider,
        provider_api_key: body.data.api_key,
        ...(body.data.base_url === undefined ? {} : { provider_base_url: body.data.base_url }),
      },
      principalId,
    )
    log.info({ platformInstanceId: pi }, 'Coding guardrails shared key updated')
  } else {
    clearCodingCredentials(adminCodingGuardrailsContextId(pi), 'agent-provider', principalId)
    log.info({ platformInstanceId: pi }, 'Coding guardrails shared key cleared')
  }

  return view(pi)
}

export function handleAdminCodingGuardrailsRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (pathname === '/settings/api/admin/coding-guardrails') {
    if (req.method === 'GET') return Promise.resolve(handleGet(auth.authed))
    if (req.method === 'POST') return handlePost(req, auth.authed)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
