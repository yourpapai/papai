// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  addAuthorizedGroup,
  isAuthorizedGroup,
  listAuthorizedGroups,
  removeAuthorizedGroup,
} from '../../../authorized-groups.js'
import {
  getConfigContextIdFromStorageContextId,
  isScopedContextId,
  toScopedContextId,
} from '../../../chat/scoped-context.js'
import { listKnownGroupContextsForPlatform } from '../../../group-settings/admin-group-list.js'
import { logger } from '../../../logger.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { addUser, listUsers, removeUser } from '../../../users.js'
import { applyAdminLlmUpdate, getAdminLlmSnapshot } from '../../admin-llm.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-admin-system' })

const UserBodySchema = z.object({ userId: z.string().min(1), username: z.string().optional() })
const GroupBodySchema = z.object({ groupId: z.string().min(1) })
const LlmBodySchema = z.object({
  key: z.enum(['llm_apikey', 'llm_baseurl', 'main_model', 'small_model', 'embedding_model']),
  value: z.string(),
})

async function handleSystem(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (req.method === 'GET') {
    const guard = requireAdmin(authed, 'read')
    if (guard !== null) return guard
    return settingsJson(200, { config: getAdminLlmSnapshot() })
  }
  if (req.method === 'POST') {
    const guard = requireAdmin(authed, 'write')
    if (guard !== null) return guard
    const csrf = requireCsrf(req, authed)
    if (csrf !== null) return csrf
    const parsed = await parseJsonBody(req)
    if (!parsed.ok) return parsed.response
    const body = LlmBodySchema.safeParse(parsed.value)
    if (!body.success) return settingsJson(422, { error: 'invalid request' })
    try {
      const result = applyAdminLlmUpdate(body.data, authed.principal.platformUserId)
      log.info({ key: body.data.key }, 'Settings admin updated system config')
      return settingsJson(200, { ok: true, key: result.key })
    } catch (error) {
      return settingsJson(422, { error: error instanceof Error ? error.message : String(error) })
    }
  }
  return settingsJson(405, { error: 'method not allowed' })
}

async function handleUsers(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (req.method === 'GET') {
    const guard = requireAdmin(authed, 'read')
    if (guard !== null) return guard
    return settingsJson(200, { users: listUsers(authed.principal.platformInstanceId) })
  }
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return settingsJson(405, { error: 'method not allowed' })
  }
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = UserBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  if (req.method === 'POST') {
    addUser({
      userId: body.data.userId,
      platformInstanceId: authed.principal.platformInstanceId,
      addedBy: authed.principal.platformUserId,
      username: body.data.username,
    })
    log.info({ platformInstanceId: authed.principal.platformInstanceId }, 'Settings admin added user')
    return settingsJson(200, { ok: true })
  }
  const removed = removeUser(body.data.userId, authed.principal.platformInstanceId)
  return settingsJson(200, { ok: removed })
}

async function handleGroups(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (req.method === 'GET') {
    const guard = requireAdmin(authed, 'read')
    if (guard !== null) return guard
    const observed = listKnownGroupContextsForPlatform(authed.principal.platformInstanceId)
      .filter((group) => !isAuthorizedGroup(group.contextId))
      .map((group) => ({ contextId: group.contextId, displayName: group.displayName, parentName: group.parentName }))
    return settingsJson(200, { groups: listAuthorizedGroups(), observed })
  }
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return settingsJson(405, { error: 'method not allowed' })
  }
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = GroupBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  if (req.method === 'POST') {
    const raw = body.data.groupId.trim()
    if (raw === '') return settingsJson(422, { error: 'invalid request' })
    const groupId = isScopedContextId(raw)
      ? getConfigContextIdFromStorageContextId(raw)
      : toScopedContextId({ platformInstanceId: authed.principal.platformInstanceId, nativeContextId: raw })
    addAuthorizedGroup(groupId, authed.principal.platformUserId)
    return settingsJson(200, { ok: true })
  }
  return settingsJson(200, { ok: removeAuthorizedGroup(body.data.groupId) })
}

export function handleAdminSystemAccessRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (pathname === '/settings/api/admin/system') return handleSystem(req, auth.authed)
  if (pathname === '/settings/api/admin/users') return handleUsers(req, auth.authed)
  if (pathname === '/settings/api/admin/groups') return handleGroups(req, auth.authed)
  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
