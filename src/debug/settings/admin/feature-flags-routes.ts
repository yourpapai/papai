// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../../logger.js'
import {
  AdminFeatureFlagsError,
  applyAdminFeatureFlagsUpdate,
  getAdminFeatureFlagsSnapshot,
} from '../../admin-feature-flags.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireSuperAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-admin-feature-flags' })

const FlagsSchema = z
  .object({
    result_compaction: z.boolean(),
    progressive_disclosure: z.boolean(),
    semantic_tool_retrieval: z.boolean(),
  })
  .strict()

const PutBodySchema = z.object({ contextId: z.string().min(1), flags: FlagsSchema }).strict()

export function handleAdminFeatureFlagsRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  if (pathname !== '/settings/api/admin/feature-flags') {
    return Promise.resolve(settingsJson(404, { error: 'not found' }))
  }

  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)

  if (req.method === 'GET') {
    const guard = requireSuperAdmin(auth.authed, 'read')
    if (guard !== null) return Promise.resolve(guard)
    return Promise.resolve(settingsJson(200, getAdminFeatureFlagsSnapshot()))
  }

  if (req.method === 'PUT') {
    return handlePut(req, auth.authed)
  }

  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}

async function handlePut(req: Request, authed: Parameters<typeof requireSuperAdmin>[0]): Promise<Response> {
  const guard = requireSuperAdmin(authed, 'write')
  if (guard !== null) return guard

  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PutBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  try {
    const row = applyAdminFeatureFlagsUpdate(body.data.contextId, body.data.flags)
    log.info({ contextId: body.data.contextId }, 'Settings admin updated reduction flags')
    return settingsJson(200, row)
  } catch (err) {
    if (err instanceof AdminFeatureFlagsError) return settingsJson(422, { error: err.message })
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'Settings admin feature-flags PUT failed')
    return settingsJson(500, { error: 'internal server error' })
  }
}
