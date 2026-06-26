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
import {
  AGENTS,
  CODING_NAMESPACES,
  FORGE_KINDS,
  PROVIDERS,
  compatible,
  isAgent,
  isForgeKind,
  isProvider,
  needsInstanceUrl,
  type CodingNamespace,
} from '../../coding-credentials/types.js'
import { maskSensitiveValue } from '../../config.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

type FieldMeta = {
  key: string
  label: string
  required: boolean
  sensitive: boolean
  control?: 'select'
  options?: readonly string[]
}

const FIELDS_META: Record<CodingNamespace, readonly FieldMeta[]> = {
  'agent-provider': [
    { key: 'agent', label: 'Coding agent', required: true, sensitive: false, control: 'select', options: AGENTS },
    {
      key: 'provider',
      label: 'Model provider',
      required: true,
      sensitive: false,
      control: 'select',
      options: PROVIDERS,
    },
    { key: 'provider_api_key', label: 'API key', required: true, sensitive: true },
    { key: 'provider_base_url', label: 'Base URL (optional)', required: false, sensitive: false },
  ],
  forge: [
    { key: 'kind', label: 'Code host', required: true, sensitive: false, control: 'select', options: FORGE_KINDS },
    { key: 'instance_url', label: 'Instance URL (enterprise / self-hosted)', required: false, sensitive: false },
    { key: 'forge_token', label: 'Access token', required: true, sensitive: true },
  ],
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
    const entry: Record<string, unknown> = {
      key: field.key,
      label: field.label,
      required: field.required,
      sensitive: field.sensitive,
      hasValue,
      value: hasValue && field.sensitive ? maskSensitiveValue(raw) : raw,
    }
    if (field.control !== undefined) entry['control'] = field.control
    if (field.options !== undefined) entry['options'] = field.options
    return entry
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

const checkForgeKind = (contextId: string, toPersist: CodingCredentialConfig): Response | null => {
  const existing = getCodingCredentials(contextId, 'forge') ?? {}
  const merged = { ...existing, ...toPersist }
  const kindRaw = merged.kind?.trim()
  if (kindRaw === undefined || kindRaw.length === 0) return null
  if (!isForgeKind(kindRaw)) {
    return settingsJson(422, { error: `unknown forge kind: ${kindRaw}` })
  }
  if (needsInstanceUrl(kindRaw)) {
    const instanceUrl = merged.instance_url?.trim() ?? ''
    if (instanceUrl.length === 0 || !instanceUrl.startsWith('https://')) {
      return settingsJson(422, { error: 'instance_url must be an https URL for self-hosted forge kinds' })
    }
  }
  return null
}

const checkCompatibility = (contextId: string, toPersist: CodingCredentialConfig): Response | null => {
  const existing = getCodingCredentials(contextId, 'agent-provider') ?? {}
  const merged = { ...existing, ...toPersist }
  const agentRaw = merged.agent?.trim()
  const providerRaw = merged.provider?.trim()
  if (agentRaw !== undefined && agentRaw.length > 0 && !isAgent(agentRaw)) {
    return settingsJson(422, { error: `unknown agent: ${agentRaw}` })
  }
  if (providerRaw !== undefined && providerRaw.length > 0 && !isProvider(providerRaw)) {
    return settingsJson(422, { error: `unknown provider: ${providerRaw}` })
  }
  if (
    agentRaw !== undefined &&
    agentRaw.length > 0 &&
    providerRaw !== undefined &&
    providerRaw.length > 0 &&
    isAgent(agentRaw)
  ) {
    if (!compatible(agentRaw, providerRaw)) {
      return settingsJson(422, { error: 'incompatible agent/provider' })
    }
  }
  if (providerRaw === 'openai-compatible') {
    const baseUrl = merged.provider_base_url?.trim() ?? ''
    if (baseUrl.length === 0) {
      return settingsJson(422, { error: 'openai-compatible requires a base URL' })
    }
  }
  return null
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

    const toPersist = valuesToPersist(scope.scope.contextId, namespace, body.data.values)

    if (namespace === 'agent-provider') {
      const incompatibleErr = checkCompatibility(scope.scope.contextId, toPersist)
      if (incompatibleErr !== null) return incompatibleErr
    }

    if (namespace === 'forge') {
      const forgeErr = checkForgeKind(scope.scope.contextId, toPersist)
      if (forgeErr !== null) return forgeErr
    }

    updateCodingCredentials(scope.scope.contextId, namespace, toPersist, auth.authed.principal.platformUserId)
    return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
  }

  return settingsJson(405, { error: 'method not allowed' })
}
