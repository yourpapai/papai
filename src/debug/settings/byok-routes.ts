// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  disableByokForContext,
  enableByokForContext,
  getByokCredentialState,
  getByokLlmConfig,
  updateByokLlmConfig,
} from '../../byok-llm/store.js'
import { BYOK_LLM_KEYS, type ByokLlmKey, type PartialByokLlmConfig } from '../../byok-llm/types.js'
import { maskSensitiveValue } from '../../config.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const BYOK_FIELDS = [
  { key: 'llm_apikey', label: 'LLM API Key', required: true, sensitive: true },
  { key: 'llm_baseurl', label: 'LLM Base URL', required: true, sensitive: false },
  { key: 'main_model', label: 'Main Model', required: true, sensitive: false },
  { key: 'small_model', label: 'Small Model', required: false, sensitive: false },
  { key: 'embedding_model', label: 'Embedding Model', required: false, sensitive: false },
] as const satisfies readonly {
  readonly key: ByokLlmKey
  readonly label: string
  readonly required: boolean
  readonly sensitive: boolean
}[]

const ToggleBodySchema = z
  .object({
    contextId: z.string().optional(),
    action: z.enum(['enable', 'disable']),
  })
  .strict()
const SaveBodySchema = z
  .object({
    contextId: z.string().optional(),
    values: z.record(z.string(), z.string()),
  })
  .strict()
const PatchBodySchema = z.union([ToggleBodySchema, SaveBodySchema])

const allowedKeys = new Set<string>(BYOK_LLM_KEYS)

const fieldResponse = (contextId: string): unknown => {
  const state = getByokCredentialState(contextId)
  if (!state.enabled) return { enabled: false, complete: false, missing: [], fields: [] }

  const config = getByokLlmConfig(contextId) ?? {}
  const fields = BYOK_FIELDS.map((field) => {
    const raw = config[field.key] ?? ''
    const hasValue = raw.length > 0
    return {
      ...field,
      hasValue,
      value: hasValue && field.sensitive ? maskSensitiveValue(raw) : raw,
    }
  })

  return { ...state, fields }
}

const isAllowedKey = (key: string): key is ByokLlmKey => allowedKeys.has(key)

const valuesToPersist = (contextId: string, values: Record<string, string>): PartialByokLlmConfig => {
  const current = getByokLlmConfig(contextId) ?? {}
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => {
      if (!isAllowedKey(key)) return []

      const field = BYOK_FIELDS.find((candidate) => candidate.key === key)
      const existing = current[key] ?? ''
      const keepExistingSensitive =
        field?.sensitive === true &&
        (value.length === 0 || (existing.length > 0 && value === maskSensitiveValue(existing)))

      return keepExistingSensitive ? [] : [[key, value]]
    }),
  ) as PartialByokLlmConfig
}

export async function handleByokRoutes(req: Request, url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response

  if (req.method === 'GET') {
    const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
    if (!scope.ok) return scope.response
    return settingsJson(200, fieldResponse(scope.scope.contextId))
  }

  if (req.method === 'PATCH') {
    const csrf = requireCsrf(req, auth.authed)
    if (csrf !== null) return csrf

    const parsed = await parseJsonBody(req)
    if (!parsed.ok) return parsed.response

    const body = PatchBodySchema.safeParse(parsed.value)
    if (!body.success) return settingsJson(422, { error: 'invalid request' })

    const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
    if (!scope.ok) return scope.response

    if ('action' in body.data) {
      const enabled = body.data.action === 'enable'
      if (enabled) {
        enableByokForContext(scope.scope.contextId, auth.authed.principal.platformUserId)
      } else {
        disableByokForContext(scope.scope.contextId, auth.authed.principal.platformUserId)
      }
      return settingsJson(200, { ok: true, contextId: scope.scope.contextId, enabled })
    }

    const state = getByokCredentialState(scope.scope.contextId)
    if (!state.enabled) return settingsJson(403, { error: 'BYOK is not enabled for this context' })

    updateByokLlmConfig(
      scope.scope.contextId,
      valuesToPersist(scope.scope.contextId, body.data.values),
      auth.authed.principal.platformUserId,
    )

    return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
  }

  return settingsJson(405, { error: 'method not allowed' })
}
