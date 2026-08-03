// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// src/llm-providers/resolver.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { type ByokBundle, getByokBundle } from '../byok-llm/store.js'
import { getAdminRoleBindings, getLlmProvider } from './store.js'
import type { EffectiveLlmConfig, LlmConfigResult, ResolvedRole, RoleBinding } from './types.js'

const UNREADABLE_ERROR = 'stored BYOK LLM credentials are unreadable'

type Creds = { readonly apiKey: string; readonly baseUrl: string }
type ProviderLookup = ReadonlyMap<string, Creds>

const byokProviderMap = (bundle: ByokBundle): ProviderLookup => {
  const providers = bundle.blob === null ? [] : bundle.blob.providers
  return new Map(providers.map((p): [string, Creds] => [p.id, { apiKey: p.apiKey, baseUrl: p.baseUrl }]))
}

const adminCredsFor = (providerId: string): Creds | null => {
  const provider = getLlmProvider(providerId)
  if (provider === null) return null
  return { apiKey: provider.apiKey, baseUrl: provider.baseUrl }
}

const resolveAdminRole = (adminBinding: RoleBinding): ResolvedRole | null => {
  if (adminBinding !== null && adminBinding.providerId !== '') {
    const creds = adminCredsFor(adminBinding.providerId)
    if (creds !== null) {
      return { apiKey: creds.apiKey, baseUrl: creds.baseUrl, model: adminBinding.model, source: 'global' }
    }
  }
  return null
}

const resolveRole = (
  byokBinding: RoleBinding,
  adminBinding: RoleBinding,
  byokProviders: ProviderLookup,
): ResolvedRole | null => {
  if (byokBinding !== null && byokBinding.providerId !== '') {
    const creds = byokProviders.get(byokBinding.providerId)
    if (creds !== undefined) {
      return { apiKey: creds.apiKey, baseUrl: creds.baseUrl, model: byokBinding.model, source: 'byok' }
    }
  }
  return resolveAdminRole(adminBinding)
}

const aggregateSource = (
  mainSource: ResolvedRole['source'],
  smallSource: ResolvedRole['source'],
  embeddingSource: ResolvedRole['source'],
): EffectiveLlmConfig['source'] => {
  if (mainSource === smallSource && smallSource === embeddingSource) return mainSource
  return 'mixed'
}

export function resolveLlmConfig(configContextId: string): LlmConfigResult {
  const bundle = getByokBundle(configContextId)
  if (bundle.enabled && bundle.unreadable) {
    return { ok: false, type: 'error', source: 'byok', error: bundle.error ?? UNREADABLE_ERROR }
  }

  const byokProviders = byokProviderMap(bundle)
  const byokRoles = bundle.blob === null ? null : bundle.blob.roles
  const adminBindings = getAdminRoleBindings()

  const main = resolveRole(byokRoles?.main ?? null, adminBindings?.main ?? null, byokProviders)
  if (main === null) {
    return { ok: false, type: 'missing', source: bundle.enabled ? 'byok' : 'global', missing: ['main'] }
  }

  const small = resolveRole(byokRoles?.small ?? null, adminBindings?.small ?? null, byokProviders) ?? main
  const embedding = resolveRole(byokRoles?.embedding ?? null, adminBindings?.embedding ?? null, byokProviders) ?? main

  return { ok: true, source: aggregateSource(main.source, small.source, embedding.source), main, small, embedding }
}

// Admin-only resolution: the configured central/main LLM with no context/BYOK
// layer. Used by callers with no chat context (e.g. the changelog humanizer).
// `source` is always 'global' since no BYOK provider is ever consulted.
export function resolveAdminLlmConfig(): LlmConfigResult {
  const adminBindings = getAdminRoleBindings()
  if (adminBindings === null) {
    return { ok: false, type: 'missing', source: 'global', missing: ['main'] }
  }

  const main = resolveAdminRole(adminBindings.main)
  if (main === null) {
    return { ok: false, type: 'missing', source: 'global', missing: ['main'] }
  }

  const small = resolveAdminRole(adminBindings.small) ?? main
  const embedding = resolveAdminRole(adminBindings.embedding) ?? main

  return { ok: true, source: 'global', main, small, embedding }
}
