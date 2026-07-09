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
import { mintPluginMcpToken } from '../mcp-server/token.js'
import type { Permission } from '../tools/tool-preferences.js'
import { adminCodingGuardrailsContextId, resolveCodingGuardrails } from './guardrails.js'
import { resolveMcpCatalog, type McpCatalogEntry } from './mcp-catalog.js'
import { INTERNAL_SERVER_PREFIX, listEnabledInternalMcpServers } from './mcp-plugin-servers.js'
import { parseMcpSelections } from './mcp-selections.js'
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

/** Per-tool MCP permission policy resolved from the selected catalog entry. */
export interface ToolPolicy {
  default: Permission
  tools?: Record<string, Permission>
}

/** A resolved MCP upstream for the projectSpec.mcp array. Never carries the token. */
export interface ResolvedMcpServer {
  id: string
  url: string
  host: string
  header: string
  allowedHosts: string[]
  toolPolicy?: ToolPolicy
}

export type ResolveMcpResult = { ok: true; servers: ResolvedMcpServer[] } | { ok: false; error: string }

function catalogToolPolicy(entry: McpCatalogEntry): ToolPolicy {
  return { default: entry.default_tool_policy ?? 'deny', tools: entry.tool_policy }
}

/**
 * Resolve a single selected MCP server (internal plugin server or external catalog entry)
 * against the operator's current enabled-server list / catalog. Fail-closed: returns a
 * structured `{ error }` naming this server when it doesn't (or no longer) resolve.
 */
function resolveOneMcpServer(
  server: string,
  upstreamToken: string | undefined,
  storageContextId: string,
  pi: string,
): ResolvedMcpServer | { error: string } {
  if (server.startsWith(INTERNAL_SERVER_PREFIX)) {
    const entry = listEnabledInternalMcpServers(pi, configContextOf(storageContextId)).find((e) => e.name === server)
    if (entry === undefined) return { error: `MCP server '${server}' is not an enabled internal server` }
    let hostname: string
    try {
      hostname = new URL(entry.upstreamUrl).hostname
    } catch {
      return { error: `MCP server '${server}' has an unparseable upstream URL` }
    }
    return {
      id: server,
      url: entry.upstreamUrl,
      host: hostname,
      header: entry.header,
      allowedHosts: [hostname],
      toolPolicy: entry.toolPolicy,
    }
  }
  const token = upstreamToken?.trim()
  if (token === undefined || token.length === 0) return { error: `MCP server '${server}' is missing its credential` }
  const entry = resolveMcpCatalog(pi).find((e) => e.name === server)
  if (entry === undefined) return { error: `MCP server '${server}' is not in the catalog` }
  let hostname: string
  try {
    hostname = new URL(entry.upstream_url).hostname
  } catch {
    return { error: `MCP server '${server}' has an unparseable upstream URL` }
  }
  return {
    id: server,
    url: entry.upstream_url,
    host: hostname,
    header: entry.header ?? 'Authorization',
    allowedHosts: [hostname],
    toolPolicy: catalogToolPolicy(entry),
  }
}

/**
 * Resolve the acting identity's full MCP set from the `servers` vault array, joined against
 * the platform instance's admin-configured catalog + enabled internal plugin servers.
 *
 * Fail-closed, all-or-nothing: if any selection doesn't currently resolve (disabled/removed
 * internal server, missing token, unknown catalog entry, duplicate selection) or the set
 * exceeds the operator's `maxMcpServers` guardrail, the whole call fails and the error names
 * the offending server. An empty selection resolves to an empty (ok) set.
 */
export function resolveMcpServers(storageContextId: string, chatUserId: string): ResolveMcpResult {
  const ctx = identityContext(storageContextId, chatUserId)
  const selections = parseMcpSelections(getCodingCredentials(ctx, 'mcp'))
  if (selections.length === 0) return { ok: true, servers: [] }
  const pi = parseScopedContextId(storageContextId)?.platformInstanceId
  if (pi === undefined) {
    log.warn({ contextId: ctx }, 'mcp vault has no platform instance to resolve against; refusing (fail-closed)')
    return { ok: false, error: 'no platform instance for MCP resolution' }
  }
  const cap = resolveCodingGuardrails(pi).maxMcpServers
  if (selections.length > cap) return { ok: false, error: `too many MCP servers selected (max ${cap})` }
  const servers: ResolvedMcpServer[] = []
  const seen = new Set<string>()
  for (const sel of selections) {
    if (seen.has(sel.server)) return { ok: false, error: `MCP server '${sel.server}' selected more than once` }
    seen.add(sel.server)
    const resolved = resolveOneMcpServer(sel.server, sel.upstream_token, storageContextId, pi)
    if ('error' in resolved) {
      log.warn({ contextId: ctx, server: sel.server }, 'mcp selection failed to resolve; refusing (fail-closed)')
      return { ok: false, error: resolved.error }
    }
    servers.push(resolved)
  }
  return { ok: true, servers }
}

/**
 * Per-server credential map for the acting identity's full MCP selection. Internal papai-hosted
 * plugin servers mint a signed binding token instead of reading one from the vault (internal
 * servers never store an upstream_token); external catalog servers use their vault token.
 */
export function resolveMcpTokens(storageContextId: string, chatUserId: string): Record<string, string> {
  const selections = parseMcpSelections(getCodingCredentials(identityContext(storageContextId, chatUserId), 'mcp'))
  const tokens: Record<string, string> = {}
  for (const sel of selections) {
    if (sel.server.startsWith(INTERNAL_SERVER_PREFIX)) {
      tokens[sel.server] = mintPluginMcpToken({
        storageContextId,
        chatUserId,
        pluginId: sel.server.slice(INTERNAL_SERVER_PREFIX.length),
      })
    } else {
      const token = sel.upstream_token?.trim()
      if (token !== undefined && token.length > 0) tokens[sel.server] = token
    }
  }
  return tokens
}
