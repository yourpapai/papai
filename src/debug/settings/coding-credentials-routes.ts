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
import { CODING_NAMESPACES, type CodingNamespace } from '../../coding-credentials/types.js'
import { maskSensitiveValue } from '../../config.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

type FieldMeta = { key: string; label: string; required: boolean; sensitive: boolean }

const FIELDS_META: Record<CodingNamespace, readonly FieldMeta[]> = {
  'agent-provider': [
    { key: 'provider_api_key', label: 'Anthropic API Key', required: true, sensitive: true },
    { key: 'provider_base_url', label: 'Anthropic Base URL (optional)', required: false, sensitive: false },
  ],
  forge: [{ key: 'forge_token', label: 'Code-host token', required: true, sensitive: true }],
}

const NamespaceSchema = z.enum(CODING_NAMESPACES).default('agent-provider')

const parseNamespace = (raw: string | null | undefined): CodingNamespace | null => {
  const result = NamespaceSchema.safeParse(raw ?? undefined)
  return result.success ? result.data : null
}

const SaveBodySchema = z
  .object({
    contextId: z.string().optional(),
    namespace: z.string().optional(),
    values: z.record(z.string(), z.string()),
  })
  .strict()
const ClearBodySchema = z
  .object({ contextId: z.string().optional(), namespace: z.string().optional(), clear: z.literal(true) })
  .strict()
const PatchBodySchema = z.union([ClearBodySchema, SaveBodySchema])

const fieldResponse = (contextId: string, namespace: CodingNamespace): unknown => {
  const fields = FIELDS_META[namespace]
  const state = getCodingCredentialState(contextId, namespace)
  const config = getCodingCredentials(contextId, namespace) ?? {}
  const fieldList = fields.map((field) => {
    const raw = (config as Record<string, string | undefined>)[field.key] ?? ''
    const hasValue = raw.length > 0
    return { ...field, hasValue, value: hasValue && field.sensitive ? maskSensitiveValue(raw) : raw }
  })
  return { namespace, ...state, fields: fieldList }
}

const valuesToPersist = (
  contextId: string,
  namespace: CodingNamespace,
  values: Record<string, string>,
): CodingCredentialConfig => {
  const fields = FIELDS_META[namespace]
  const allowedKeys = new Set<string>(fields.map((f) => f.key))
  const current = getCodingCredentials(contextId, namespace) ?? {}
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => {
      if (!allowedKeys.has(key)) return []
      const field = fields.find((c) => c.key === key)
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
    const namespace = parseNamespace(url.searchParams.get('namespace'))
    if (namespace === null) return settingsJson(400, { error: 'unknown namespace' })
    const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
    if (!scope.ok) return scope.response
    return settingsJson(200, fieldResponse(scope.scope.contextId, namespace))
  }

  if (req.method === 'PATCH') {
    const csrf = requireCsrf(req, auth.authed)
    if (csrf !== null) return csrf
    const parsed = await parseJsonBody(req)
    if (!parsed.ok) return parsed.response
    const body = PatchBodySchema.safeParse(parsed.value)
    if (!body.success) return settingsJson(422, { error: 'invalid request' })

    const namespace = parseNamespace('namespace' in body.data ? body.data.namespace : undefined)
    if (namespace === null) return settingsJson(400, { error: 'unknown namespace' })

    const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
    if (!scope.ok) return scope.response

    if ('clear' in body.data) {
      clearCodingCredentials(scope.scope.contextId, namespace, auth.authed.principal.platformUserId)
      return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
    }

    updateCodingCredentials(
      scope.scope.contextId,
      namespace,
      valuesToPersist(scope.scope.contextId, namespace, body.data.values),
      auth.authed.principal.platformUserId,
    )
    return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
  }

  return settingsJson(405, { error: 'method not allowed' })
}
