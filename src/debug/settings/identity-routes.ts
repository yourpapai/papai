// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { clearIdentityMapping, getIdentityMapping, setIdentityMapping } from '../../identity/mapping.js'
import { getContextSettings } from '../../instances/context-store.js'
import { getTaskInstance } from '../../instances/task-store.js'
import { logger } from '../../logger.js'
import type { AuthenticatedSettingsRequest } from '../../settings/request-auth.js'
import {
  authenticate,
  parseJsonBody,
  requireCsrf,
  resolveContextScope,
  settingsJson,
  type ContextScope,
} from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-identity' })

/** Resolve the task-provider name (e.g. 'kaneo') for a context, or null if unconfigured. */
function providerNameFor(contextId: string): string | null {
  const settings = getContextSettings(contextId)
  if (settings === null) return null
  const instance = getTaskInstance(settings.taskInstanceId)
  return instance?.type ?? null
}

function handleGet(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response
  const provider = providerNameFor(scope.scope.contextId)
  if (provider === null) return settingsJson(422, { error: 'no task instance configured for this context' })
  return settingsJson(200, {
    contextId: scope.scope.contextId,
    providerName: provider,
    mapping: getIdentityMapping(scope.scope.contextId, provider),
  })
}

const PutBodySchema = z.object({
  providerUserId: z.string().min(1),
  providerUserLogin: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  contextId: z.string().optional(),
})

function resolveProviderScope(
  authed: AuthenticatedSettingsRequest,
  rawContextId: string | undefined,
): { ok: true; scope: ContextScope; provider: string } | { ok: false; response: Response } {
  const scope = resolveContextScope(authed.principal, 'write', rawContextId)
  if (!scope.ok) return { ok: false, response: scope.response }
  const provider = providerNameFor(scope.scope.contextId)
  if (provider === null)
    return { ok: false, response: settingsJson(422, { error: 'no task instance configured for this context' }) }
  return { ok: true, scope: scope.scope, provider }
}

async function handlePut(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PutBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  const resolved = resolveProviderScope(auth.authed, body.data.contextId)
  if (!resolved.ok) return resolved.response

  setIdentityMapping({
    contextId: resolved.scope.contextId,
    providerName: resolved.provider,
    providerUserId: body.data.providerUserId,
    providerUserLogin: body.data.providerUserLogin ?? null,
    displayName: body.data.displayName ?? null,
    matchMethod: 'manual_nl',
    confidence: 1,
  })
  log.info({ contextId: resolved.scope.contextId, providerName: resolved.provider }, 'Settings identity mapping set')
  return settingsJson(200, { ok: true, contextId: resolved.scope.contextId })
}

function handleDelete(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf
  const resolved = resolveProviderScope(auth.authed, url.searchParams.get('contextId') ?? undefined)
  if (!resolved.ok) return resolved.response
  clearIdentityMapping(resolved.scope.contextId, resolved.provider)
  log.info(
    { contextId: resolved.scope.contextId, providerName: resolved.provider },
    'Settings identity mapping cleared',
  )
  return settingsJson(200, { ok: true, contextId: resolved.scope.contextId })
}

export function handleIdentityRoutes(req: Request, url: URL): Promise<Response> {
  if (req.method === 'GET') return Promise.resolve(handleGet(req, url))
  if (req.method === 'PUT') return handlePut(req)
  if (req.method === 'DELETE') return Promise.resolve(handleDelete(req, url))
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
