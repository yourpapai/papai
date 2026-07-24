// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../logger.js'
import {
  clearMemoryScope,
  getMemoryProfile,
  listMemoryRecords,
  purgeMemoryRecord,
  saveMemoryProfile,
  setMemoryCaptureEnabled,
  setMemoryRecordInjectionEnabled,
} from '../../long-term-memory/store.js'
import type { MemoryRecord } from '../../long-term-memory/types.js'
import { toMemoryScope } from './memory-scope.js'
import { authenticateForWrite, resolveWriteBody } from './memory-write-gate.js'
import { authenticate, parseJsonBody, resolveContextScope, settingsJson, type ParsedBody } from './respond.js'

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

const RecordInjectionPatchBodySchema = z.object({
  contextId: z.string().optional(),
  enabled: z.boolean(),
})

const ContextBodySchema = z.object({
  contextId: z.string().optional(),
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

function decodeRecordId(rawRecordId: string): string | null {
  try {
    return decodeURIComponent(rawRecordId)
  } catch {
    return null
  }
}

function handleGet(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response

  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response

  const memoryScope = toMemoryScope(scope.scope)
  const profile = getMemoryProfile(memoryScope)
  const records = listMemoryRecords({
    ...memoryScope,
    statuses: ['active', 'provisional'],
    limit: RECORD_LIST_LIMIT,
  }).map(recordView)

  return settingsJson(200, {
    contextId: memoryScope.scopeId,
    scopeType: memoryScope.scopeType,
    enabled: profile?.enabled ?? true,
    injectRecords: profile?.injectRecords ?? false,
    profile: profile?.profile ?? '',
    records,
  })
}

async function handleProfilePatch(req: Request): Promise<Response> {
  const gate = authenticateForWrite(req)
  if (!gate.ok) return gate.response

  const resolved = await resolveWriteBody(req, gate.authed, ProfilePatchBodySchema)
  if (!resolved.ok) return resolved.response
  const { memoryScope, data } = resolved

  const profile = saveMemoryProfile(memoryScope, data.profile, new Date().toISOString())
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
  const gate = authenticateForWrite(req)
  if (!gate.ok) return gate.response

  const resolved = await resolveWriteBody(req, gate.authed, CapturePatchBodySchema)
  if (!resolved.ok) return resolved.response
  const { memoryScope, data } = resolved

  const profile = setMemoryCaptureEnabled(memoryScope, data.enabled, new Date().toISOString())
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

async function handleRecordInjectionPatch(req: Request): Promise<Response> {
  const gate = authenticateForWrite(req)
  if (!gate.ok) return gate.response

  const resolved = await resolveWriteBody(req, gate.authed, RecordInjectionPatchBodySchema)
  if (!resolved.ok) return resolved.response
  const { memoryScope, data } = resolved

  const profile = setMemoryRecordInjectionEnabled(memoryScope, data.enabled, new Date().toISOString())
  log.info(
    {
      scopeId: memoryScope.scopeId,
      scopeType: memoryScope.scopeType,
      action: 'record-injection.update',
      injectRecords: profile.injectRecords,
    },
    'Settings memory record injection updated',
  )
  return settingsJson(200, {
    ok: true,
    contextId: memoryScope.scopeId,
    scopeType: memoryScope.scopeType,
    injectRecords: profile.injectRecords,
  })
}

async function handleRecordDelete(req: Request, recordId: string): Promise<Response> {
  const gate = authenticateForWrite(req)
  if (!gate.ok) return gate.response

  const decodedRecordId = decodeRecordId(recordId)
  if (decodedRecordId === null) return settingsJson(400, { error: 'invalid record id' })

  const resolved = await resolveWriteBody(req, gate.authed, ContextBodySchema, parseOptionalJsonBody)
  if (!resolved.ok) return resolved.response
  const { memoryScope } = resolved

  const purged = purgeMemoryRecord(memoryScope, decodedRecordId, new Date().toISOString())
  const status = purged ? 'forgotten' : 'not_found'
  log.info(
    { scopeId: memoryScope.scopeId, scopeType: memoryScope.scopeType, action: 'record.purge', status },
    'Settings memory record purge requested',
  )
  return settingsJson(200, { ok: true, status })
}

async function handleClear(req: Request): Promise<Response> {
  const gate = authenticateForWrite(req)
  if (!gate.ok) return gate.response

  const resolved = await resolveWriteBody(req, gate.authed, ContextBodySchema)
  if (!resolved.ok) return resolved.response
  const { memoryScope } = resolved

  const counts = clearMemoryScope(memoryScope)
  log.info(
    {
      scopeId: memoryScope.scopeId,
      scopeType: memoryScope.scopeType,
      action: 'scope.clear',
      profileDeleted: counts.profileDeleted,
      recordsDeleted: counts.recordsDeleted,
      workingMemoryKeysCleared: counts.workingMemoryKeysCleared,
      extractionStateDeleted: counts.extractionStateDeleted,
      tombstonesDeleted: counts.tombstonesDeleted,
    },
    'Settings memory scope cleared',
  )
  return settingsJson(200, {
    ok: true,
    contextId: memoryScope.scopeId,
    scopeType: memoryScope.scopeType,
    profileDeleted: counts.profileDeleted,
    recordsDeleted: counts.recordsDeleted,
    workingMemoryKeysCleared: counts.workingMemoryKeysCleared,
    extractionStateDeleted: counts.extractionStateDeleted,
    tombstonesDeleted: counts.tombstonesDeleted,
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
  if (url.pathname === '/settings/api/memory/record-injection') {
    if (req.method === 'PATCH') return handleRecordInjectionPatch(req)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  if (url.pathname === '/settings/api/memory/clear') {
    if (req.method === 'POST') return handleClear(req)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }

  const recordId = url.pathname.match(/^\/settings\/api\/memory\/records\/([^/]+)$/u)?.[1]
  if (recordId !== undefined) {
    if (req.method === 'DELETE') return handleRecordDelete(req, recordId)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }

  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
