// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { count, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../../db/drizzle.js'
import { messageMetadata } from '../../../db/schema.js'
import { logger } from '../../../logger.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { authenticate, requireCsrf, settingsJson } from '../respond.js'
import { requireSuperAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-admin-message-history' })

const CONTEXT_PREFIX = '/settings/api/admin/contexts/'
const SUFFIX = '/message-history'
const CLEAR_ALL_PATH = '/settings/api/admin/message-history'

function gatePurge(req: Request, authed: AuthenticatedSettingsRequest): Response | null {
  const guard = requireSuperAdmin(authed, 'write')
  if (guard !== null) return guard
  return requireCsrf(req, authed)
}

function purgeAllMessageHistory(): Response {
  const db = getDrizzleDb()
  const row = db.select({ n: count() }).from(messageMetadata).get()
  const purged = row?.n ?? 0
  db.delete(messageMetadata).run()
  log.warn({ purged }, 'Settings SA purged ALL message history')
  return settingsJson(200, { purged })
}

function purgeScopeMessageHistory(scopeId: string): Response {
  const db = getDrizzleDb()
  const row = db.select({ n: count() }).from(messageMetadata).where(eq(messageMetadata.groupContextId, scopeId)).get()
  const purged = row?.n ?? 0
  db.delete(messageMetadata).where(eq(messageMetadata.groupContextId, scopeId)).run()
  log.warn({ scopeId, purged }, 'Settings SA purged message history for scope')
  return settingsJson(200, { scopeId, purged })
}

export function handleAdminMessageHistoryRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (req.method !== 'DELETE') return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))

  if (pathname === CLEAR_ALL_PATH) {
    const gate = gatePurge(req, auth.authed)
    if (gate !== null) return Promise.resolve(gate)
    return Promise.resolve(purgeAllMessageHistory())
  }

  if (pathname.startsWith(CONTEXT_PREFIX) && pathname.endsWith(SUFFIX)) {
    const gate = gatePurge(req, auth.authed)
    if (gate !== null) return Promise.resolve(gate)
    const scopeId = pathname.slice(CONTEXT_PREFIX.length, pathname.length - SUFFIX.length)
    if (scopeId.length === 0) return Promise.resolve(settingsJson(400, { error: 'missing scope id' }))
    return Promise.resolve(purgeScopeMessageHistory(scopeId))
  }

  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
