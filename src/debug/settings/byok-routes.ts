// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getFeatureObserver } from '../../analytics/feature-observer.js'
import type { AnalyticsRequestContext } from '../../analytics/provider-observer.js'
import { buildSettingsActorRequestContext } from '../../analytics/provider-scope-factory.js'
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
import type { AuthenticatedSettingsRequest } from '../../settings/request-auth.js'
import { BYOK_FIELDS, buildByokFieldResponse } from './byok-field-response.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-byok' })

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

const applyByokAction = (
  body: ByokActionBody,
  contextId: string,
  updatedBy: string,
  actorContext: AnalyticsRequestContext | null,
): Response => {
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
    const observer = getFeatureObserver()
    if (observer !== null && actorContext !== null) {
      observer.featureUsed(actorContext, { feature: 'byok', operation: 'enable', outcome: 'success' })
    }
  } else {
    disableByokForContext(contextId, updatedBy)
  }
  return settingsJson(200, { ok: true, contextId, enabled })
}

// A v2 multi-provider blob lives under the `v2` storage key, which the flat legacy
// reader (getByokLlmConfig) reads as `{}`; a legacy `values` save would then merge
// against `{}` and overwrite the v2 provider/role config. getByokBundle migrates a
// legacy flat config into a single-provider v2 blob in memory, so a non-empty flat
// config distinguishes the legacy case (allowed) from real v2 data (rejected here).
const rejectLegacyValuesAgainstV2Blob = (contextId: string): Response | null => {
  const bundle = getByokBundle(contextId)
  const flatConfig = getByokLlmConfig(contextId) ?? {}
  if (bundle.blob !== null && bundle.blob.providers.length > 0 && Object.keys(flatConfig).length === 0)
    return settingsJson(409, {
      error: 'multi-provider BYOK config is active; use the upsert-provider/set-roles actions',
    })
  return null
}

const handleByokPatch = async (req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> => {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response

  const body = PatchBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  if ('action' in body.data) {
    return applyByokAction(
      body.data,
      scope.scope.contextId,
      authed.principal.platformUserId,
      buildSettingsActorRequestContext({
        platformInstanceId: authed.principal.platformInstanceId,
        platformUserId: authed.principal.platformUserId,
        configContextId: scope.scope.contextId,
        contextType: scope.scope.kind === 'group' ? 'group' : 'dm',
        actorRole: authed.principal.isBotAdmin || authed.principal.isSuperAdmin ? 'admin' : 'member',
      }),
    )
  }

  const state = getByokCredentialState(scope.scope.contextId)
  if (!state.enabled)
    return settingsJson(403, {
      error: 'BYOK is not enabled for this context',
    })

  const rejected = rejectLegacyValuesAgainstV2Blob(scope.scope.contextId)
  if (rejected !== null) return rejected

  updateByokLlmConfig(
    scope.scope.contextId,
    valuesToPersist(scope.scope.contextId, body.data.values),
    authed.principal.platformUserId,
  )

  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}

export async function handleByokRoutes(req: Request, url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response

  if (req.method === 'GET') {
    const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
    if (!scope.ok) return scope.response
    return settingsJson(200, buildByokFieldResponse(scope.scope.contextId))
  }

  if (req.method === 'PATCH') {
    const response = await handleByokPatch(req, auth.authed)
    return response
  }

  return settingsJson(405, { error: 'method not allowed' })
}
