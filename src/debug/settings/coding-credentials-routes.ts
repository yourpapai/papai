// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { resolveCodingGuardrails } from '../../coding-credentials/guardrails.js'
import { resolveMcpCatalog } from '../../coding-credentials/mcp-catalog.js'
import { listEnabledInternalMcpServers } from '../../coding-credentials/mcp-plugin-servers.js'
import { codingMcpSelectionsSchema, serializeMcpSelections } from '../../coding-credentials/mcp-selections.js'
import {
  clearCodingCredentials,
  getCodingCredentialState,
  getCodingCredentials,
  updateCodingCredentials,
} from '../../coding-credentials/store.js'
import type { CodingCredentialConfig } from '../../coding-credentials/types.js'
import {
  CODING_NAMESPACES,
  compatible,
  isAgent,
  isAuthMethod,
  isForgeKind,
  isProvider,
  needsInstanceUrl,
  type CodingNamespace,
} from '../../coding-credentials/types.js'
import { maskSensitiveValue } from '../../config.js'
import type { AuthenticatedSettingsRequest } from '../../settings/request-auth.js'
import { FIELDS_META } from './coding-credentials-fields-meta.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

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
  .object({
    contextId: z.string().optional(),
    namespace: z.string().optional(),
    clear: z.literal(true),
  })
  .strict()
const PatchBodySchema = z.union([ClearBodySchema, SaveBodySchema])

const fieldResponse = (contextId: string, namespace: CodingNamespace): Record<string, unknown> => {
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
      return settingsJson(422, {
        error: 'instance_url must be an https URL for self-hosted forge kinds',
      })
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
    isAgent(agentRaw) &&
    !compatible(agentRaw, providerRaw)
  ) {
    return settingsJson(422, { error: 'incompatible agent/provider' })
  }
  if (providerRaw === 'openai-compatible' && (merged.provider_base_url?.trim() ?? '').length === 0) {
    return settingsJson(422, { error: 'openai-compatible requires a base URL' })
  }
  const modelRaw = merged.model?.trim()
  if (modelRaw !== undefined && modelRaw.length > 0) {
    if (modelRaw.length > 200) return settingsJson(422, { error: 'model too long (max 200)' })
    const hasCtrl = Array.from(modelRaw).some((ch) => {
      const cp = ch.codePointAt(0) ?? 0
      return cp < 0x20 || cp === 0x7f
    })
    if (hasCtrl) return settingsJson(422, { error: 'model contains control characters' })
  }
  const methodRaw = merged.auth_method?.trim()
  if (methodRaw !== undefined && methodRaw.length > 0) {
    if (!isAuthMethod(methodRaw)) return settingsJson(422, { error: `unknown auth method: ${methodRaw}` })
    if (methodRaw === 'oauth-subscription') {
      if (providerRaw !== undefined && providerRaw.length > 0 && providerRaw !== 'anthropic') {
        return settingsJson(422, { error: 'oauth-subscription requires the anthropic provider' })
      }
      if ((merged.provider_base_url?.trim() ?? '').length > 0) {
        return settingsJson(422, { error: 'oauth-subscription does not use a base URL' })
      }
    }
  }
  return null
}

const checkMcpServers = (
  platformInstanceId: string,
  toPersist: CodingCredentialConfig,
): Response | { toPersist: CodingCredentialConfig } => {
  const raw = toPersist.servers
  if (raw === undefined) return { toPersist }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return settingsJson(422, { error: 'invalid mcp servers' })
  }
  const parsed = codingMcpSelectionsSchema.safeParse(json)
  if (!parsed.success) return settingsJson(422, { error: 'invalid mcp servers' })
  const maxMcpServers = resolveCodingGuardrails(platformInstanceId).maxMcpServers
  if (parsed.data.length > maxMcpServers) {
    return settingsJson(422, { error: 'too many MCP servers' })
  }
  return { toPersist: { ...toPersist, servers: serializeMcpSelections(parsed.data) } }
}

function handleGet(authed: AuthenticatedSettingsRequest, url: URL): Response {
  const namespace = parseNamespace(url.searchParams.get('namespace'))
  if (namespace === null) return settingsJson(400, { error: 'unknown namespace' })
  const scope = resolveContextScope(authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response
  const fields = fieldResponse(scope.scope.contextId, namespace)
  if (namespace === 'agent-provider') {
    const allowedAgents = resolveCodingGuardrails(authed.principal.platformInstanceId).allowedAgents
    return settingsJson(200, { ...fields, allowedAgents })
  }
  if (namespace === 'mcp') {
    const catalog = resolveMcpCatalog(authed.principal.platformInstanceId)
    const pluginServers = listEnabledInternalMcpServers(authed.principal.platformInstanceId, scope.scope.contextId).map(
      (s) => ({ name: s.name, label: s.label }),
    )
    const maxMcpServers = resolveCodingGuardrails(authed.principal.platformInstanceId).maxMcpServers
    return settingsJson(200, { ...fields, catalog, pluginServers, maxMcpServers })
  }
  return settingsJson(200, fields)
}

async function handlePatch(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PatchBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const namespace = parseNamespace('namespace' in body.data ? body.data.namespace : undefined)
  if (namespace === null) return settingsJson(400, { error: 'unknown namespace' })

  const scope = resolveContextScope(authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  if ('clear' in body.data) {
    clearCodingCredentials(scope.scope.contextId, namespace, authed.principal.platformUserId)
    return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
  }

  let toPersist = valuesToPersist(scope.scope.contextId, namespace, body.data.values)

  if (namespace === 'agent-provider') {
    const incompatibleErr = checkCompatibility(scope.scope.contextId, toPersist)
    if (incompatibleErr !== null) return incompatibleErr
  }

  if (namespace === 'forge') {
    const forgeErr = checkForgeKind(scope.scope.contextId, toPersist)
    if (forgeErr !== null) return forgeErr
  }

  if (namespace === 'mcp') {
    const mcpResult = checkMcpServers(authed.principal.platformInstanceId, toPersist)
    if (mcpResult instanceof Response) return mcpResult
    toPersist = mcpResult.toPersist
  }

  updateCodingCredentials(scope.scope.contextId, namespace, toPersist, authed.principal.platformUserId)
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}

export function handleCodingCredentialsRoutes(req: Request, url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (req.method === 'GET') return Promise.resolve(handleGet(auth.authed, url))
  if (req.method === 'PATCH') return handlePatch(req, auth.authed)
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
