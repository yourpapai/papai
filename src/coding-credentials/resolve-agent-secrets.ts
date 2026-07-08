// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getGroupCodingIdentity } from '../authorized-groups.js'
import {
  getConfigContextIdFromStorageContextId,
  parseScopedContextId,
  toScopedContextId,
} from '../chat/scoped-context.js'
import { logger } from '../logger.js'
import { adminCodingGuardrailsContextId, resolveCodingGuardrails } from './guardrails.js'
import { getCodingCredentials } from './store.js'
import { deriveApiBaseUrl, deriveProviderHost, forgeMagiKind, isProvider, type Provider } from './types.js'

const log = logger.child({ scope: 'coding-credentials:resolve-agent-secrets' })

export function configContextOf(storageContextId: string): string {
  return getConfigContextIdFromStorageContextId(storageContextId)
}

/** When the platform instance forces a shared key, returns the admin context that holds it; else null. */
function sharedKeyContext(storageContextId: string): string | null {
  const pi = parseScopedContextId(storageContextId)?.platformInstanceId
  if (pi === undefined) return null
  return resolveCodingGuardrails(pi).forceSharedKey ? adminCodingGuardrailsContextId(pi) : null
}

/**
 * The context whose vault holds the acting identity's creds for this session.
 *
 * For a DM, configContextOf(dmCtx) === toScopedContextId({pi, nativeContextId: chatUserId}),
 * and getGroupCodingIdentity(dmCtx) returns 'initiator' (no authorized_groups row), so the
 * result is byte-identical to today's behavior.
 */
export function identityContext(storageContextId: string, chatUserId: string): string {
  const pi = parseScopedContextId(storageContextId)?.platformInstanceId
  // Legacy/non-scoped context id → unchanged behavior
  if (pi === undefined) return configContextOf(storageContextId)
  const groupCtx = configContextOf(storageContextId)
  const policy = getGroupCodingIdentity(groupCtx)
  if (policy === 'shared') return groupCtx
  if (policy.startsWith('designated:')) {
    return toScopedContextId({ platformInstanceId: pi, nativeContextId: policy.slice('designated:'.length) })
  }
  // 'initiator' (default) — and the default for DMs / non-group contexts, which yields the user's own context
  return toScopedContextId({ platformInstanceId: pi, nativeContextId: chatUserId })
}

const PROVIDER_ENV: Record<Provider, { key: string; base: string }> = {
  anthropic: { key: 'ANTHROPIC_API_KEY', base: 'ANTHROPIC_BASE_URL' },
  openai: { key: 'OPENAI_API_KEY', base: 'OPENAI_BASE_URL' },
  'openai-compatible': { key: 'OPENAI_API_KEY', base: 'OPENAI_BASE_URL' },
}

/**
 * Resolve the acting identity's agent-provider credentials and map them to the
 * env-name-keyed secrets the magi request expects. The mapping is provider-aware:
 * anthropic → ANTHROPIC_API_KEY, openai → OPENAI_API_KEY. Defaults to anthropic
 * when the provider field is absent (backward-compat). Returns null when no api
 * key is stored.
 *
 * For provider key resolution, 5a's force-shared-key wins over the identity context.
 */
export function resolveAgentSecrets(storageContextId: string, chatUserId: string): Record<string, string> | null {
  const creds = getCodingCredentials(
    sharedKeyContext(storageContextId) ?? identityContext(storageContextId, chatUserId),
    'agent-provider',
  )
  const apiKey = creds?.provider_api_key?.trim()
  if (apiKey === undefined || apiKey.length === 0) return null
  const provider = creds?.provider?.trim() ?? 'anthropic'
  if (!isProvider(provider)) return null
  const methodRaw = creds?.auth_method?.trim() ?? ''
  const method = methodRaw === '' ? 'api-key' : methodRaw
  if (provider === 'anthropic' && method === 'oauth-subscription') {
    return { CLAUDE_CODE_OAUTH_TOKEN: apiKey }
  }
  const env = PROVIDER_ENV[provider]
  const out: Record<string, string> = { [env.key]: apiKey }
  const baseUrl = creds?.provider_base_url?.trim()
  if (baseUrl !== undefined && baseUrl.length > 0) out[env.base] = baseUrl
  return out
}

/**
 * Resolve the acting identity's configured coding agent name.
 * Returns null when the agent field is absent or empty.
 */
export function resolveAgent(storageContextId: string, chatUserId: string): string | null {
  const creds = getCodingCredentials(identityContext(storageContextId, chatUserId), 'agent-provider')
  const agent = creds?.agent?.trim()
  return agent === undefined || agent.length === 0 ? null : agent
}

/**
 * Resolve the acting identity's configured model. Like resolveAgent, this reads
 * the identity context only (a user's model is their preference; an operator-forced
 * shared key does not override it). Returns null when absent or empty.
 */
export function resolveModel(storageContextId: string, chatUserId: string): string | null {
  const creds = getCodingCredentials(identityContext(storageContextId, chatUserId), 'agent-provider')
  const model = creds?.model?.trim()
  return model === undefined || model.length === 0 ? null : model
}

/**
 * Resolve the acting identity's forge (code-host) token.
 * Returns null when no token is stored.
 */
export function resolveForgeToken(storageContextId: string, chatUserId: string): string | null {
  const creds = getCodingCredentials(identityContext(storageContextId, chatUserId), 'forge')
  const token = creds?.forge_token?.trim()
  return token === undefined || token.length === 0 ? null : token
}

/**
 * Resolve the acting identity's provider host from the agent-provider vault.
 * Returns the base URL host when a custom base URL is set; otherwise the well-known
 * host for the provider (anthropic → api.anthropic.com, openai → api.openai.com).
 * Returns null when no vault is stored or when the host cannot be determined
 * (e.g. openai-compatible without a base URL, or a malformed base URL).
 *
 * For provider host resolution, 5a's force-shared-key wins over the identity context.
 */
export function resolveProviderHost(storageContextId: string, chatUserId: string): string | null {
  const creds = getCodingCredentials(
    sharedKeyContext(storageContextId) ?? identityContext(storageContextId, chatUserId),
    'agent-provider',
  )
  if (creds === null) return null
  const provider = creds.provider?.trim() ?? 'anthropic'
  return deriveProviderHost(provider, creds.provider_base_url)
}

/**
 * Resolve the acting identity's typed forge connection (kind + apiBaseUrl).
 * Legacy token-only vaults (no kind stored) default to github SaaS.
 * Returns null when no forge vault is stored or when the kind cannot be derived.
 */
export function resolveForge(
  storageContextId: string,
  chatUserId: string,
): { kind: 'github' | 'gitlab'; apiBaseUrl: string } | null {
  const creds = getCodingCredentials(identityContext(storageContextId, chatUserId), 'forge')
  if (creds === null) return null
  const kind = creds.kind?.trim()
  const instanceUrl = creds.instance_url?.trim()
  if (kind === undefined || kind.length === 0) {
    // A vault carrying an instance_url but no kind is an inconsistent partial save:
    // refuse rather than silently mis-deriving GitHub SaaS and ignoring instance_url.
    if (instanceUrl !== undefined && instanceUrl.length > 0) return null
    // Legacy token-only vaults stored before kind was required; default to github SaaS.
    return { kind: 'github', apiBaseUrl: deriveApiBaseUrl('github', undefined) }
  }
  try {
    return { kind: forgeMagiKind(kind), apiBaseUrl: deriveApiBaseUrl(kind, instanceUrl) }
  } catch {
    return null
  }
}

/** Non-secret MCP broker config resolved from the identity's `mcp` vault. Never carries the token. */
export interface ResolvedMcp {
  url: string
  host: string
  header: string
  allowedHosts: string[]
}

/**
 * Resolve the acting identity's MCP broker config (non-secret) from the `mcp` vault.
 * Returns null when no vault is stored, when the vault is partial (url or token
 * missing), or when the stored url is malformed or not https (fail-closed). The
 * token itself is never included here — see resolveMcpToken.
 */
export function resolveMcp(storageContextId: string, chatUserId: string): ResolvedMcp | null {
  const ctx = identityContext(storageContextId, chatUserId)
  const creds = getCodingCredentials(ctx, 'mcp')
  if (creds === null) return null
  const url = creds.upstream_url?.trim()
  const token = creds.upstream_token?.trim()
  if (url === undefined || url.length === 0 || token === undefined || token.length === 0) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    log.warn({ contextId: ctx }, 'mcp upstream_url is malformed')
    return null
  }
  if (parsed.protocol !== 'https:') {
    log.warn({ contextId: ctx }, 'mcp upstream_url is not https; refusing to resolve')
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const header = creds.upstream_header?.trim()
  return {
    url,
    host,
    header: header === undefined || header.length === 0 ? 'Authorization' : header,
    allowedHosts: [host],
  }
}

/**
 * Resolve the acting identity's MCP upstream credential.
 * Returns undefined when no token is stored.
 */
export function resolveMcpToken(storageContextId: string, chatUserId: string): string | undefined {
  const creds = getCodingCredentials(identityContext(storageContextId, chatUserId), 'mcp')
  const token = creds?.upstream_token?.trim()
  return token === undefined || token.length === 0 ? undefined : token
}
