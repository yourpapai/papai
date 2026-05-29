// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../logger.js'
import { provisionAndConfigure, type ProvisionOutcome } from '../../providers/kaneo/provision.js'
import { listUsers } from '../../users.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'
import type { ContextScope } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-provision' })
const BodySchema = z.object({ contextId: z.string().optional() })

function resolveProvisionUsername(
  scope: ContextScope,
  platformInstanceId: string,
  platformUserId: string,
): string | null {
  if (scope.kind === 'group') return null
  return listUsers(platformInstanceId).find((u) => u.platform_user_id === platformUserId)?.username ?? null
}

function outcomeToResponse(scope: ContextScope, outcome: ProvisionOutcome): Response {
  if (outcome.status === 'provisioned') {
    log.info({ contextId: scope.contextId, status: 'provisioned' }, 'Settings Kaneo provision succeeded')
    // One-time login reveal: email/password are not logged — returned in body only. The
    // generated API key is persisted into config by provisionAndConfigure and is never
    // returned in the response (it would needlessly widen secret exposure to the SPA).
    return settingsJson(200, {
      status: 'provisioned',
      contextId: scope.contextId,
      email: outcome.email,
      password: outcome.password,
      kaneoUrl: outcome.kaneoUrl,
      workspaceId: outcome.workspaceId,
    })
  }
  if (outcome.status === 'registration_disabled') {
    return settingsJson(422, { status: 'registration_disabled', error: 'Kaneo registration is disabled' })
  }
  log.warn({ contextId: scope.contextId, status: 'failed', error: outcome.error }, 'Settings Kaneo provision failed')
  return settingsJson(422, { status: 'failed', error: outcome.error })
}

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

  const { principal } = auth.authed
  const scope = resolveContextScope(principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const username = resolveProvisionUsername(scope.scope, principal.platformInstanceId, principal.platformUserId)
  const publicUrl = process.env['KANEO_CLIENT_URL']
  const internalUrl = process.env['KANEO_INTERNAL_URL']
  const outcome = await provisionAndConfigure(scope.scope.contextId, username, { publicUrl, internalUrl })
  return outcomeToResponse(scope.scope, outcome)
}
