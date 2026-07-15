// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { fetchProviderModels, type DiscoveryResult } from '../../../llm-providers/discovery.js'
import {
  createLlmProvider,
  deleteLlmProvider,
  getAdminRoleBindings,
  listLlmProviders,
  setAdminRoleBindings,
  updateLlmProvider,
  updateProviderVerification,
} from '../../../llm-providers/store.js'
import { LLM_PROVIDER_TYPES, type LlmProviderAccount, type Verification } from '../../../llm-providers/types.js'
import { logger } from '../../../logger.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-admin-providers' })

const ProviderBodySchema = z.object({
  label: z.string().min(1),
  providerType: z.enum(LLM_PROVIDER_TYPES),
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
})
const ProviderPatchSchema = ProviderBodySchema.partial()
const RoleBindingSchema = z.object({ providerId: z.string().min(1), model: z.string().min(1) }).nullable()
const RolesBodySchema = z.object({
  main: z.object({ providerId: z.string().min(1), model: z.string().min(1) }),
  small: RoleBindingSchema,
  embedding: RoleBindingSchema,
})

const mask = (apiKey: string): string => `****${apiKey.slice(-4)}`

type PublicProviderAccount = {
  readonly id: string
  readonly label: string
  readonly providerType: LlmProviderAccount['providerType']
  readonly baseUrl: string
  readonly apiKeyMasked: string
  readonly verification: Verification
}

const publicAccount = (p: LlmProviderAccount): PublicProviderAccount => ({
  id: p.id,
  label: p.label,
  providerType: p.providerType,
  baseUrl: p.baseUrl,
  apiKeyMasked: mask(p.apiKey),
  verification: p.verification,
})

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

const verifyInBackground = (id: string, baseUrl: string, apiKey: string): void => {
  void fetchProviderModels(baseUrl, apiKey)
    .then((r) => {
      updateProviderVerification(id, toVerification(r))
    })
    .catch((error: unknown) => {
      log.warn(
        { id, error: error instanceof Error ? error.message : String(error) },
        'background provider verification failed',
      )
    })
}

const PROVIDERS_PREFIX = '/settings/api/admin/providers/'

async function handleProvidersCollection(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (req.method === 'GET') {
    const guard = requireAdmin(authed, 'read')
    if (guard !== null) return guard
    return settingsJson(200, { providers: listLlmProviders().map(publicAccount) })
  }
  if (req.method !== 'POST') return settingsJson(405, { error: 'method not allowed' })
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ProviderBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  const provider = createLlmProvider(body.data, authed.principal.platformUserId)
  verifyInBackground(provider.id, provider.baseUrl, provider.apiKey)
  log.info({ id: provider.id, label: provider.label }, 'admin LLM provider created')
  return settingsJson(200, { provider: publicAccount(provider) })
}

async function handleProviderItem(req: Request, authed: AuthenticatedSettingsRequest, id: string): Promise<Response> {
  if (req.method === 'PATCH') {
    const guard = requireAdmin(authed, 'write')
    if (guard !== null) return guard
    const csrf = requireCsrf(req, authed)
    if (csrf !== null) return csrf
    const parsed = await parseJsonBody(req)
    if (!parsed.ok) return parsed.response
    const body = ProviderPatchSchema.safeParse(parsed.value)
    if (!body.success) return settingsJson(422, { error: 'invalid request' })
    const updated = updateLlmProvider(id, body.data, authed.principal.platformUserId)
    if (updated === null) return settingsJson(404, { error: 'not found' })
    if (body.data.apiKey !== undefined || body.data.baseUrl !== undefined) {
      verifyInBackground(updated.id, updated.baseUrl, updated.apiKey)
    }
    return settingsJson(200, { provider: publicAccount(updated) })
  }
  if (req.method !== 'DELETE') return settingsJson(405, { error: 'method not allowed' })
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  try {
    deleteLlmProvider(id)
    log.info({ id }, 'admin LLM provider deleted')
    return settingsJson(200, { ok: true })
  } catch (error) {
    return settingsJson(409, { error: error instanceof Error ? error.message : String(error) })
  }
}

async function handleRoles(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (req.method === 'GET') {
    const guard = requireAdmin(authed, 'read')
    if (guard !== null) return guard
    return settingsJson(200, { roles: getAdminRoleBindings() })
  }
  if (req.method !== 'PUT') return settingsJson(405, { error: 'method not allowed' })
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = RolesBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  setAdminRoleBindings(body.data, authed.principal.platformUserId)
  log.info({}, 'admin LLM role bindings set')
  return settingsJson(200, { ok: true })
}

export function handleAdminLlmProvidersRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (pathname === '/settings/api/admin/providers') return handleProvidersCollection(req, auth.authed)
  if (pathname.startsWith(PROVIDERS_PREFIX)) {
    return handleProviderItem(req, auth.authed, pathname.slice(PROVIDERS_PREFIX.length))
  }
  if (pathname === '/settings/api/admin/llm-roles') return handleRoles(req, auth.authed)
  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
