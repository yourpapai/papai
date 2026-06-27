// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigContextIdFromStorageContextId, parseScopedContextId } from '../chat/scoped-context.js'
import { adminCodingGuardrailsContextId, resolveCodingGuardrails } from './guardrails.js'
import { getCodingCredentials } from './store.js'
import { deriveApiBaseUrl, deriveProviderHost, forgeMagiKind, isProvider, type Provider } from './types.js'

export function configContextOf(storageContextId: string): string {
  return getConfigContextIdFromStorageContextId(storageContextId)
}

/** When the platform instance forces a shared key, returns the admin context that holds it; else null. */
function sharedKeyContext(storageContextId: string): string | null {
  const pi = parseScopedContextId(storageContextId)?.platformInstanceId
  if (pi === undefined) return null
  return resolveCodingGuardrails(pi).forceSharedKey ? adminCodingGuardrailsContextId(pi) : null
}

const PROVIDER_ENV: Record<Provider, { key: string; base: string }> = {
  anthropic: { key: 'ANTHROPIC_API_KEY', base: 'ANTHROPIC_BASE_URL' },
  openai: { key: 'OPENAI_API_KEY', base: 'OPENAI_BASE_URL' },
  'openai-compatible': { key: 'OPENAI_API_KEY', base: 'OPENAI_BASE_URL' },
}

/**
 * Resolve the acting context's agent-provider credentials and map them to the
 * env-name-keyed secrets the magi request expects. The mapping is provider-aware:
 * anthropic → ANTHROPIC_API_KEY, openai → OPENAI_API_KEY. Defaults to anthropic
 * when the provider field is absent (backward-compat). Returns null when no api
 * key is stored.
 */
export function resolveAgentSecrets(storageContextId: string): Record<string, string> | null {
  const creds = getCodingCredentials(
    sharedKeyContext(storageContextId) ?? configContextOf(storageContextId),
    'agent-provider',
  )
  const apiKey = creds?.provider_api_key?.trim()
  if (apiKey === undefined || apiKey.length === 0) return null
  const provider = creds?.provider?.trim() ?? 'anthropic'
  if (!isProvider(provider)) return null
  const env = PROVIDER_ENV[provider]
  const out: Record<string, string> = { [env.key]: apiKey }
  const baseUrl = creds?.provider_base_url?.trim()
  if (baseUrl !== undefined && baseUrl.length > 0) out[env.base] = baseUrl
  return out
}

/**
 * Resolve the acting context's configured coding agent name.
 * Returns null when the agent field is absent or empty.
 */
export function resolveAgent(storageContextId: string): string | null {
  const creds = getCodingCredentials(configContextOf(storageContextId), 'agent-provider')
  const agent = creds?.agent?.trim()
  return agent === undefined || agent.length === 0 ? null : agent
}

/**
 * Resolve the acting context's forge (code-host) token.
 * Returns null when no token is stored.
 */
export function resolveForgeToken(storageContextId: string): string | null {
  const creds = getCodingCredentials(configContextOf(storageContextId), 'forge')
  const token = creds?.forge_token?.trim()
  return token === undefined || token.length === 0 ? null : token
}

/**
 * Resolve the acting context's provider host from the agent-provider vault.
 * Returns the base URL host when a custom base URL is set; otherwise the well-known
 * host for the provider (anthropic → api.anthropic.com, openai → api.openai.com).
 * Returns null when no vault is stored or when the host cannot be determined
 * (e.g. openai-compatible without a base URL, or a malformed base URL).
 */
export function resolveProviderHost(storageContextId: string): string | null {
  const creds = getCodingCredentials(
    sharedKeyContext(storageContextId) ?? configContextOf(storageContextId),
    'agent-provider',
  )
  if (creds === null) return null
  const provider = creds.provider?.trim() ?? 'anthropic'
  return deriveProviderHost(provider, creds.provider_base_url)
}

/**
 * Resolve the acting context's typed forge connection (kind + apiBaseUrl).
 * Legacy token-only vaults (no kind stored) default to github SaaS.
 * Returns null when no forge vault is stored or when the kind cannot be derived.
 */
export function resolveForge(storageContextId: string): { kind: 'github' | 'gitlab'; apiBaseUrl: string } | null {
  const creds = getCodingCredentials(configContextOf(storageContextId), 'forge')
  if (creds === null) return null
  const kind = creds.kind?.trim()
  // Legacy vaults stored before kind was required; default to github SaaS.
  const uiKind = kind === undefined || kind.length === 0 ? 'github' : kind
  try {
    return { kind: forgeMagiKind(uiKind), apiBaseUrl: deriveApiBaseUrl(uiKind, creds.instance_url?.trim()) }
  } catch {
    return null
  }
}
