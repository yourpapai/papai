// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { validateConfigField } from '../../config-editor/validation.js'
import { getConfigFieldsForContext } from '../../config-keys.js'
import { getConfigValue, maskSensitiveValue, setConfigValue, unsetConfigValue } from '../../config.js'
import { logger } from '../../logger.js'
import { isFieldUnsettable } from '../../types/config.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-config' })

const SetBodySchema = z.object({
  action: z.literal('set').optional(),
  key: z.string().min(1),
  value: z.string(),
  contextId: z.string().optional(),
})
const UnsetBodySchema = z.object({
  action: z.literal('unset'),
  key: z.string().min(1),
  contextId: z.string().optional(),
})
const PatchBodySchema = z.union([UnsetBodySchema, SetBodySchema])

function handleGet(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response

  const fields = getConfigFieldsForContext(scope.scope.contextId).map((field) => {
    const raw = getConfigValue(scope.scope.contextId, field.storageKey)
    const hasValue = raw !== null && raw.length > 0
    return {
      key: field.key,
      storageKey: field.storageKey,
      label: field.label,
      required: field.required,
      sensitive: field.sensitive,
      kind: field.kind,
      control: field.control,
      options: field.options,
      hasValue,
      value: hasValue && field.sensitive ? maskSensitiveValue(raw) : (raw ?? ''),
    }
  })
  return settingsJson(200, { contextId: scope.scope.contextId, fields })
}

async function handlePatch(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PatchBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const field = getConfigFieldsForContext(scope.scope.contextId).find(
    (f) => f.key === body.data.key || f.storageKey === body.data.key,
  )
  if (field === undefined) return settingsJson(422, { error: 'unknown config field' })

  if (body.data.action === 'unset') {
    if (!isFieldUnsettable(field)) return settingsJson(422, { error: 'field cannot be unset' })
    unsetConfigValue(scope.scope.contextId, field.storageKey)
    log.info({ contextId: scope.scope.contextId, key: field.key }, 'Settings config field unset')
    return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
  }

  // Masked secrets: an empty submit or a submit equal to the masked form of the stored value means "no change".
  if (field.sensitive) {
    const current = getConfigValue(scope.scope.contextId, field.storageKey) ?? ''
    if (body.data.value.length === 0 || (current.length > 0 && body.data.value === maskSensitiveValue(current))) {
      return settingsJson(200, { ok: true, contextId: scope.scope.contextId, unchanged: true })
    }
  }

  const validation = validateConfigField(field, body.data.value)
  if (!validation.valid) return settingsJson(422, { error: validation.error ?? 'validation failed' })

  setConfigValue(scope.scope.contextId, field.storageKey, body.data.value)
  log.info({ contextId: scope.scope.contextId, key: field.key }, 'Settings config field updated')
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}

export function handleConfigRoutes(req: Request, url: URL): Promise<Response> {
  if (req.method === 'GET') return Promise.resolve(handleGet(req, url))
  if (req.method === 'PATCH') return handlePatch(req)
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
