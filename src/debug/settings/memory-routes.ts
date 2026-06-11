// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../logger.js'
import {
  archiveMemoryRecord,
  clearMemoryScope,
  getMemoryProfile,
  listMemoryRecords,
  saveMemoryProfile,
  setMemoryCaptureEnabled,
} from '../../long-term-memory/store.js'
import type { MemoryRecord, MemoryScope } from '../../long-term-memory/types.js'
import {
  authenticate,
  parseJsonBody,
  requireCsrf,
  resolveContextScope,
  settingsJson,
  type ParsedBody,
} from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-memory' })
const MAX_PROFILE_LENGTH = 20_000
const RECORD_LIST_LIMIT = 100

const ProfilePatchBodySchema = z.object({
  contextId: z.string().optional(),
  profile: z.string().max(MAX_PROFILE_LENGTH),
})

const CapturePatchBodySchema = z.object({
  contextId: z.string().optional(),
  enabled: z.boolean(),
})

const ContextBodySchema = z.object({
  contextId: z.string().optional(),
})

const toMemoryScope = (scope: { readonly contextId: string; readonly kind: 'personal' | 'group' }): MemoryScope => ({
  scopeId: scope.contextId,
  scopeType: scope.kind,
})

const recordView = (record: MemoryRecord): Omit<MemoryRecord, 'embedding'> => ({
  id: record.id,
  scopeId: record.scopeId,
  scopeType: record.scopeType,
  kind: record.kind,
  content: record.content,
  summary: record.summary,
  tags: record.tags,
  confidence: record.confidence,
  status: record.status,
  source: record.source,
  evidence: record.evidence,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  lastSeenAt: record.lastSeenAt,
  validFrom: record.validFrom,
  validUntil: record.validUntil,
  expiresAt: record.expiresAt,
})

function parseOptionalJsonBody(req: Request): Promise<ParsedBody> {
  if (req.headers.get('Content-Type') === null) return Promise.resolve({ ok: true, value: {} })
  return parseJsonBody(req)
}

function handleGet(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response

  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response

  const memoryScope = toMemoryScope(scope.scope)
  const profile = getMemoryProfile(memoryScope)
  const records = listMemoryRecords({ ...memoryScope, status: 'active', limit: RECORD_LIST_LIMIT }).map(recordView)

  return settingsJson(200, {
    contextId: memoryScope.scopeId,
    scopeType: memoryScope.scopeType,
    enabled: profile?.enabled ?? true,
    profile: profile?.profile ?? '',
    records,
  })
}

async function handleProfilePatch(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ProfilePatchBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const memoryScope = toMemoryScope(scope.scope)
  const profile = saveMemoryProfile(memoryScope, body.data.profile, new Date().toISOString())
  log.info(
    { scopeId: memoryScope.scopeId, scopeType: memoryScope.scopeType, action: 'profile.update' },
    'Settings memory profile updated',
  )
  return settingsJson(200, {
    ok: true,
    contextId: memoryScope.scopeId,
    scopeType: memoryScope.scopeType,
    profile: profile.profile,
  })
}

async function handleCapturePatch(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = CapturePatchBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const memoryScope = toMemoryScope(scope.scope)
  const profile = setMemoryCaptureEnabled(memoryScope, body.data.enabled, new Date().toISOString())
  log.info(
    {
      scopeId: memoryScope.scopeId,
      scopeType: memoryScope.scopeType,
      action: 'capture.update',
      enabled: profile.enabled,
    },
    'Settings memory capture updated',
  )
  return settingsJson(200, {
    ok: true,
    contextId: memoryScope.scopeId,
    scopeType: memoryScope.scopeType,
    enabled: profile.enabled,
  })
}

async function handleRecordDelete(req: Request, recordId: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf

  const parsed = await parseOptionalJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ContextBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const memoryScope = toMemoryScope(scope.scope)
  const archived = archiveMemoryRecord(memoryScope, recordId, new Date().toISOString())
  const status = archived ? 'archived' : 'not_found'
  log.info(
    { scopeId: memoryScope.scopeId, scopeType: memoryScope.scopeType, action: 'record.archive', status },
    'Settings memory record archive requested',
  )
  return settingsJson(200, { ok: true, status })
}

async function handleClear(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ContextBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const memoryScope = toMemoryScope(scope.scope)
  const counts = clearMemoryScope(memoryScope)
  log.info(
    {
      scopeId: memoryScope.scopeId,
      scopeType: memoryScope.scopeType,
      action: 'scope.clear',
      profileDeleted: counts.profileDeleted,
      recordsDeleted: counts.recordsDeleted,
    },
    'Settings memory scope cleared',
  )
  return settingsJson(200, {
    ok: true,
    contextId: memoryScope.scopeId,
    scopeType: memoryScope.scopeType,
    profileDeleted: counts.profileDeleted,
    recordsDeleted: counts.recordsDeleted,
  })
}

export function handleMemoryRoutes(req: Request, url: URL): Promise<Response> {
  if (url.pathname === '/settings/api/memory') {
    if (req.method === 'GET') return Promise.resolve(handleGet(req, url))
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  if (url.pathname === '/settings/api/memory/profile') {
    if (req.method === 'PATCH') return handleProfilePatch(req)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  if (url.pathname === '/settings/api/memory/capture') {
    if (req.method === 'PATCH') return handleCapturePatch(req)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  if (url.pathname === '/settings/api/memory/clear') {
    if (req.method === 'POST') return handleClear(req)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }

  const recordId = url.pathname.match(/^\/settings\/api\/memory\/records\/([^/]+)$/u)?.[1]
  if (recordId !== undefined) {
    if (req.method === 'DELETE') return handleRecordDelete(req, decodeURIComponent(recordId))
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }

  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
