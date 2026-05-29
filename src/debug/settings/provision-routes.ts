// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../logger.js'
import { provisionAndConfigure } from '../../providers/kaneo/provision.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-provision' })
const BodySchema = z.object({ contextId: z.string().optional() })

export async function handleProvisionKaneo(req: Request): Promise<Response> {
  if (req.method !== 'POST') return settingsJson(405, { error: 'method not allowed' })
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = BodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const publicUrl = process.env['KANEO_CLIENT_URL']
  const internalUrl = process.env['KANEO_INTERNAL_URL']
  const outcome = await provisionAndConfigure(scope.scope.contextId, auth.authed.principal.platformUserId, {
    publicUrl,
    internalUrl,
  })

  if (outcome.status === 'provisioned') {
    log.info({ contextId: scope.scope.contextId, status: 'provisioned' }, 'Settings Kaneo provision succeeded')
    // One-time credential reveal: email/password/apiKey are not logged — returned in body only.
    return settingsJson(200, {
      status: 'provisioned',
      contextId: scope.scope.contextId,
      email: outcome.email,
      password: outcome.password,
      kaneoUrl: outcome.kaneoUrl,
      apiKey: outcome.apiKey,
      workspaceId: outcome.workspaceId,
    })
  }
  if (outcome.status === 'registration_disabled') {
    return settingsJson(422, { status: 'registration_disabled', error: 'Kaneo registration is disabled' })
  }
  log.warn({ contextId: scope.scope.contextId, status: 'failed' }, 'Settings Kaneo provision failed')
  return settingsJson(422, { status: 'failed', error: outcome.error })
}
