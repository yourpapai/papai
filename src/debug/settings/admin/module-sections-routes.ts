// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../../logger.js'
import {
  applyModuleSectionUnset,
  applyModuleSectionUpdate,
  buildModuleSectionDescriptors,
  getModuleSectionsSnapshot,
  ModuleSectionConfigError,
  PatchModuleSectionBodySchema,
} from '../../admin-module-sections.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-admin-module-sections' })

export function handleAdminModuleSectionsRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  if (pathname !== '/settings/api/admin/module-sections') {
    return Promise.resolve(settingsJson(404, { error: 'not found' }))
  }

  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)

  if (req.method === 'GET') {
    const guard = requireAdmin(auth.authed, 'read')
    if (guard !== null) return Promise.resolve(guard)
    return Promise.resolve(settingsJson(200, getModuleSectionsSnapshot(buildModuleSectionDescriptors())))
  }

  if (req.method === 'PATCH') {
    return handlePatch(req, auth.authed)
  }

  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}

async function handlePatch(req: Request, authed: Parameters<typeof requireAdmin>[0]): Promise<Response> {
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard

  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf

  const rawParsed = await parseJsonBody(req)
  if (!rawParsed.ok) return rawParsed.response

  const body = PatchModuleSectionBodySchema.safeParse(rawParsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  try {
    const descriptors = buildModuleSectionDescriptors()
    if (body.data.action === 'unset') {
      const result = applyModuleSectionUnset(body.data, authed.principal.platformUserId, descriptors)
      log.info({ section: result.id, key: result.key }, 'Settings admin unset module section config')
      return settingsJson(200, { ok: true, id: result.id, key: result.key })
    }
    const result = applyModuleSectionUpdate(body.data, authed.principal.platformUserId, descriptors)
    log.info({ section: result.id, key: result.key }, 'Settings admin updated module section config')
    return settingsJson(200, { ok: true, id: result.id, key: result.key, updatedAt: result.updatedAt })
  } catch (err) {
    if (err instanceof ModuleSectionConfigError) return settingsJson(422, { error: err.message })
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'Settings admin module section PATCH failed')
    return settingsJson(500, { error: 'internal server error' })
  }
}
