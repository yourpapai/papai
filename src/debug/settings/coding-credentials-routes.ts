// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  clearCodingCredentials,
  getCodingCredentialState,
  getCodingCredentials,
  updateCodingCredentials,
} from '../../coding-credentials/store.js'
import type { CodingCredentialConfig } from '../../coding-credentials/types.js'
import { maskSensitiveValue } from '../../config.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const NAMESPACE = 'agent-provider' as const

const CODING_FIELDS = [
  { key: 'provider_api_key', label: 'Anthropic API Key', required: true, sensitive: true },
  { key: 'provider_base_url', label: 'Anthropic Base URL (optional)', required: false, sensitive: false },
] as const

const SaveBodySchema = z.object({ contextId: z.string().optional(), values: z.record(z.string(), z.string()) }).strict()
const ClearBodySchema = z.object({ contextId: z.string().optional(), clear: z.literal(true) }).strict()
const PatchBodySchema = z.union([ClearBodySchema, SaveBodySchema])

const allowedKeys = new Set<string>(CODING_FIELDS.map((f) => f.key))

const fieldResponse = (contextId: string): unknown => {
  const state = getCodingCredentialState(contextId, NAMESPACE)
  const config = getCodingCredentials(contextId, NAMESPACE) ?? {}
  const fields = CODING_FIELDS.map((field) => {
    const raw = (config as Record<string, string | undefined>)[field.key] ?? ''
    const hasValue = raw.length > 0
    return { ...field, hasValue, value: hasValue && field.sensitive ? maskSensitiveValue(raw) : raw }
  })
  return { namespace: NAMESPACE, ...state, fields }
}

const valuesToPersist = (contextId: string, values: Record<string, string>): CodingCredentialConfig => {
  const current = getCodingCredentials(contextId, NAMESPACE) ?? {}
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => {
      if (!allowedKeys.has(key)) return []
      const field = CODING_FIELDS.find((c) => c.key === key)
      const existing = (current as Record<string, string | undefined>)[key] ?? ''
      const keepExistingSensitive =
        field?.sensitive === true &&
        (value.length === 0 || (existing.length > 0 && value === maskSensitiveValue(existing)))
      return keepExistingSensitive ? [] : [[key, value]]
    }),
  ) as CodingCredentialConfig
}

export async function handleCodingCredentialsRoutes(req: Request, url: URL): Promise<Response> {
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

    if ('clear' in body.data) {
      clearCodingCredentials(scope.scope.contextId, NAMESPACE, auth.authed.principal.platformUserId)
      return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
    }

    updateCodingCredentials(
      scope.scope.contextId,
      NAMESPACE,
      valuesToPersist(scope.scope.contextId, body.data.values),
      auth.authed.principal.platformUserId,
    )
    return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
  }

  return settingsJson(405, { error: 'method not allowed' })
}
