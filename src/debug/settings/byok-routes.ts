// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  deleteByokProvider,
  disableByokForContext,
  enableByokForContext,
  getByokBundle,
  getByokCredentialState,
  getByokLlmConfig,
  setByokRoles,
  updateByokLlmConfig,
  updateByokProviderVerification,
  upsertByokProvider,
} from '../../byok-llm/store.js'
import { BYOK_LLM_KEYS, type ByokLlmKey, type PartialByokLlmConfig } from '../../byok-llm/types.js'
import { maskSensitiveValue } from '../../config.js'
import { fetchProviderModels, type DiscoveryResult } from '../../llm-providers/discovery.js'
import {
  LLM_PROVIDER_TYPES,
  VERIFICATION_STATUSES,
  type LlmProviderAccount,
  type Verification,
} from '../../llm-providers/types.js'
import { logger } from '../../logger.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-byok' })

const BYOK_FIELDS = [
  { key: 'llm_apikey', label: 'LLM API Key', required: true, sensitive: true },
  {
    key: 'llm_baseurl',
    label: 'LLM Base URL',
    required: true,
    sensitive: false,
  },
  { key: 'main_model', label: 'Main Model', required: true, sensitive: false },
  {
    key: 'small_model',
    label: 'Small Model',
    required: false,
    sensitive: false,
  },
  {
    key: 'embedding_model',
    label: 'Embedding Model',
    required: false,
    sensitive: false,
  },
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

const VerificationSchema = z.object({
  status: z.enum(VERIFICATION_STATUSES),
  error: z.string().nullable(),
  at: z.number().nullable(),
  models: z.array(z.string()),
  modelsFetchedAt: z.number().nullable(),
})
const ProviderInBlobSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  providerType: z.enum(LLM_PROVIDER_TYPES),
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  verification: VerificationSchema,
})
const RoleBindingSchema = z.object({ providerId: z.string().min(1), model: z.string().min(1) }).nullable()
const RolesSchema = z.object({
  main: z.object({ providerId: z.string().min(1), model: z.string().min(1) }),
  small: RoleBindingSchema,
  embedding: RoleBindingSchema,
})
const UpsertProviderBodySchema = z
  .object({
    contextId: z.string().optional(),
    action: z.literal('upsert-provider'),
    provider: ProviderInBlobSchema,
  })
  .strict()
const DeleteProviderBodySchema = z
  .object({
    contextId: z.string().optional(),
    action: z.literal('delete-provider'),
    id: z.string().min(1),
  })
  .strict()
const SetRolesBodySchema = z
  .object({
    contextId: z.string().optional(),
    action: z.literal('set-roles'),
    roles: RolesSchema,
  })
  .strict()
const RefreshModelsBodySchema = z
  .object({
    contextId: z.string().optional(),
    action: z.literal('refresh-models'),
    id: z.string().min(1),
  })
  .strict()
const PatchBodySchema = z.union([
  ToggleBodySchema,
  SaveBodySchema,
  UpsertProviderBodySchema,
  DeleteProviderBodySchema,
  SetRolesBodySchema,
  RefreshModelsBodySchema,
])

const toVerification = (r: DiscoveryResult): Verification => {
  const now = Date.now()
  return {
    status: r.status,
    error: r.error,
    at: now,
    models: r.models,
    modelsFetchedAt: r.status === 'verified' ? now : null,
  }
}

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

type ByokActionBody = Extract<z.infer<typeof PatchBodySchema>, { action: string }>

const verifyByokProviderInBackground = (
  contextId: string,
  provider: Pick<LlmProviderAccount, 'id' | 'baseUrl' | 'apiKey'>,
  updatedBy: string,
): void => {
  void fetchProviderModels(provider.baseUrl, provider.apiKey)
    .then((r) => {
      updateByokProviderVerification(contextId, provider.id, toVerification(r), updatedBy)
    })
    .catch((error: unknown) => {
      log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'background BYOK provider verification failed',
      )
    })
}

const applyByokAction = (body: ByokActionBody, contextId: string, updatedBy: string): Response => {
  if (body.action === 'upsert-provider') {
    if (!getByokCredentialState(contextId).enabled)
      return settingsJson(403, {
        error: 'BYOK is not enabled for this context',
      })
    upsertByokProvider(contextId, body.provider, updatedBy)
    verifyByokProviderInBackground(contextId, body.provider, updatedBy)
    return settingsJson(200, { ok: true, contextId })
  }
  if (body.action === 'delete-provider') {
    deleteByokProvider(contextId, body.id, updatedBy)
    return settingsJson(200, { ok: true, contextId })
  }
  if (body.action === 'set-roles') {
    setByokRoles(contextId, body.roles, updatedBy)
    return settingsJson(200, { ok: true, contextId })
  }
  if (body.action === 'refresh-models') {
    const targetId = body.id
    const bundle = getByokBundle(contextId)
    const provider = bundle.blob?.providers.find((p) => p.id === targetId)
    if (provider === undefined) return settingsJson(404, { error: 'provider not found' })
    verifyByokProviderInBackground(contextId, provider, updatedBy)
    return settingsJson(200, { ok: true })
  }
  const enabled = body.action === 'enable'
  if (enabled) {
    enableByokForContext(contextId, updatedBy)
  } else {
    disableByokForContext(contextId, updatedBy)
  }
  return settingsJson(200, { ok: true, contextId, enabled })
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
      return applyByokAction(body.data, scope.scope.contextId, auth.authed.principal.platformUserId)
    }

    const state = getByokCredentialState(scope.scope.contextId)
    if (!state.enabled)
      return settingsJson(403, {
        error: 'BYOK is not enabled for this context',
      })

    updateByokLlmConfig(
      scope.scope.contextId,
      valuesToPersist(scope.scope.contextId, body.data.values),
      auth.authed.principal.platformUserId,
    )

    return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
  }

  return settingsJson(405, { error: 'method not allowed' })
}
