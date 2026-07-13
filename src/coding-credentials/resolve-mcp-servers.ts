// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseScopedContextId } from '../chat/scoped-context.js'
import { logger } from '../logger.js'
import { mintPluginMcpToken } from '../mcp-server/token.js'
import type { Permission } from '../tools/tool-preferences.js'
import { resolveCodingGuardrails } from './guardrails.js'
import { resolveMcpCatalog, type McpCatalogEntry } from './mcp-catalog.js'
import { INTERNAL_SERVER_PREFIX, listEnabledInternalMcpServers } from './mcp-plugin-servers.js'
import { hasMalformedMcpSelections, parseMcpSelections } from './mcp-selections.js'
import { configContextOf, identityContext } from './resolve-agent-secrets.js'
import { getCodingCredentials } from './store.js'

const log = logger.child({ scope: 'coding-credentials:resolve-mcp-servers' })

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
  const credentials = getCodingCredentials(ctx, 'mcp')
  if (hasMalformedMcpSelections(credentials)) {
    log.warn({ contextId: ctx }, 'mcp selection settings are malformed; refusing (fail-closed)')
    return { ok: false, error: 'MCP settings are malformed' }
  }
  const selections = parseMcpSelections(credentials)
  if (selections.length === 0) return { ok: true, servers: [] }
  const pi = parseScopedContextId(storageContextId)?.platformInstanceId
  if (pi === undefined) {
    log.warn({ contextId: ctx }, 'mcp vault has no platform instance to resolve against; refusing (fail-closed)')
    return { ok: false, error: 'no platform instance for MCP resolution' }
  }
  const cap = resolveCodingGuardrails(pi).maxMcpServers
  if (selections.length > cap) {
    log.warn(
      { contextId: ctx, selected: selections.length, cap },
      'mcp selection exceeds maxMcpServers guardrail; refusing (fail-closed)',
    )
    return { ok: false, error: `too many MCP servers selected (max ${cap})` }
  }
  const servers: ResolvedMcpServer[] = []
  const seen = new Set<string>()
  for (const sel of selections) {
    if (seen.has(sel.server)) {
      log.warn({ contextId: ctx, server: sel.server }, 'mcp server selected more than once; refusing (fail-closed)')
      return { ok: false, error: `MCP server '${sel.server}' selected more than once` }
    }
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
 * Per-server credential map for the acting identity's full MCP selection. Derived strictly from
 * `resolveMcpServers`' validated set (never independently re-parses the vault into an id list) so
 * it can never drift from — or emit tokens for servers outside — the fail-closed validated set.
 * Internal papai-hosted plugin servers mint a signed binding token instead of reading one from the
 * vault (internal servers never store an upstream_token); external catalog servers use their vault
 * token, which `resolveMcpServers` has already guaranteed is present and non-empty.
 */
export function resolveMcpTokens(storageContextId: string, chatUserId: string): Record<string, string> {
  const result = resolveMcpServers(storageContextId, chatUserId)
  if (!result.ok) return {}
  const selections = parseMcpSelections(getCodingCredentials(identityContext(storageContextId, chatUserId), 'mcp'))
  const tokens: Record<string, string> = {}
  for (const server of result.servers) {
    if (server.id.startsWith(INTERNAL_SERVER_PREFIX)) {
      tokens[server.id] = mintPluginMcpToken({
        storageContextId,
        chatUserId,
        pluginId: server.id.slice(INTERNAL_SERVER_PREFIX.length),
      })
    } else {
      const token = selections.find((sel) => sel.server === server.id)?.upstream_token?.trim()
      // Defensive only: resolveMcpServers already refuses external selections with a missing
      // token, so this branch is unreachable in practice.
      if (token !== undefined && token.length > 0) tokens[server.id] = token
    }
  }
  return tokens
}
