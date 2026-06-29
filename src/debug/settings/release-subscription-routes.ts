// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getUserAnnounceSubscribed, setUserAnnounceSubscribed } from '../../announcements/store.js'
import { logger } from '../../logger.js'
import type { AuthenticatedSettingsRequest } from '../../settings/request-auth.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-release-subscription' })

const BodySchema = z.object({ enabled: z.boolean() })

function handleGet(authed: AuthenticatedSettingsRequest): Response {
  if (!authed.principal.authorized) return settingsJson(403, { error: 'forbidden' })
  const enabled = getUserAnnounceSubscribed(authed.principal.platformInstanceId, authed.principal.platformUserId)
  return settingsJson(200, { enabled })
}

async function handlePatch(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (!authed.principal.authorized) return settingsJson(403, { error: 'forbidden' })
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = BodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  setUserAnnounceSubscribed(authed.principal.platformInstanceId, authed.principal.platformUserId, body.data.enabled)
  // Read back the persisted value rather than echoing the request, so the response
  // reflects the actual stored state.
  const enabled = getUserAnnounceSubscribed(authed.principal.platformInstanceId, authed.principal.platformUserId)
  log.info({ platformInstanceId: authed.principal.platformInstanceId, enabled }, 'release subscription updated')
  return settingsJson(200, { ok: true, enabled })
}

export function handleReleaseSubscriptionRoutes(req: Request, _url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (req.method === 'GET') return Promise.resolve(handleGet(auth.authed))
  if (req.method === 'PATCH') return handlePatch(req, auth.authed)
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
