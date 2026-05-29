// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { safeBuildProvider } from '../../commands/context-tool-resolution.js'
import { logger } from '../../logger.js'
import { getToolMetadata, TOOL_METADATA, type ToolDomain } from '../../tools/tool-metadata.js'
import {
  getDomainStatus,
  getToolPrefs,
  isToolEnabled,
  setToolPrefs,
  toggleDomain,
  toggleTool,
  type ToolPrefs,
} from '../../tools/tool-preferences.js'
import { buildTools } from '../../tools/tools-builder.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-tools' })
const DOMAIN_SET = new Set<string>(Object.values(TOOL_METADATA).map((m) => m.domain))

function isToolDomain(value: string): value is ToolDomain {
  return DOMAIN_SET.has(value)
}

/** Computed, capability+context-gated tool names for a context (mirrors the tgl: flow). */
function availableToolNames(contextId: string, actorUserId: string, contextType: 'dm' | 'group'): string[] {
  const provider = safeBuildProvider(contextId)
  if (provider === null) return []
  const tools = buildTools(provider, actorUserId, contextId, 'normal', contextType)
  return Object.keys(tools).filter((name) => getToolMetadata(name) !== undefined)
}

function groupByDomain(names: readonly string[]): Map<ToolDomain, string[]> {
  const map = new Map<ToolDomain, string[]>()
  for (const name of names) {
    const meta = getToolMetadata(name)
    if (meta === undefined) continue
    const existing = map.get(meta.domain)
    if (existing === undefined) map.set(meta.domain, [name])
    else existing.push(name)
  }
  return map
}

function buildDomainView(names: readonly string[], prefs: ToolPrefs): unknown[] {
  const grouped = groupByDomain(names)
  return [...grouped.entries()].map(([domain, domainTools]) => ({
    domain,
    status: getDomainStatus(prefs, domain, domainTools),
    tools: [...domainTools].toSorted().map((name) => {
      const meta = getToolMetadata(name)
      return { name, enabled: isToolEnabled(prefs, name), risk: meta?.risk ?? 'read' }
    }),
  }))
}

function handleGet(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response

  const contextType = scope.scope.kind === 'group' ? 'group' : 'dm'
  const names = availableToolNames(scope.scope.contextId, auth.authed.principal.platformUserId, contextType)
  const prefs = getToolPrefs(scope.scope.contextId)
  return settingsJson(200, { contextId: scope.scope.contextId, domains: buildDomainView(names, prefs) })
}

const ToggleBodySchema = z.object({
  kind: z.enum(['domain', 'tool']),
  domain: z.string().optional(),
  tool: z.string().optional(),
  contextId: z.string().optional(),
})

async function handleToggle(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ToggleBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const contextType = scope.scope.kind === 'group' ? 'group' : 'dm'
  const names = availableToolNames(scope.scope.contextId, auth.authed.principal.platformUserId, contextType)
  const prefs = getToolPrefs(scope.scope.contextId)

  if (body.data.kind === 'domain') {
    const domain = body.data.domain ?? ''
    if (!isToolDomain(domain)) return settingsJson(422, { error: 'unknown tool domain' })
    const domainNames = names.filter((n) => getToolMetadata(n)?.domain === domain)
    setToolPrefs(scope.scope.contextId, toggleDomain(prefs, domain, domainNames))
    log.info({ contextId: scope.scope.contextId, domain }, 'Settings tool domain toggled')
  } else {
    const toolName = body.data.tool ?? ''
    const meta = getToolMetadata(toolName)
    if (meta === undefined || !names.includes(toolName)) return settingsJson(422, { error: 'unknown tool' })
    const domainNames = names.filter((n) => getToolMetadata(n)?.domain === meta.domain)
    setToolPrefs(scope.scope.contextId, toggleTool(prefs, toolName, domainNames))
    log.info({ contextId: scope.scope.contextId, tool: toolName }, 'Settings tool toggled')
  }

  const updated = getToolPrefs(scope.scope.contextId)
  return settingsJson(200, { contextId: scope.scope.contextId, domains: buildDomainView(names, updated) })
}

export function handleToolsRoutes(req: Request, url: URL, pathname: string): Promise<Response> {
  if (pathname === '/settings/api/tools') {
    if (req.method === 'GET') return Promise.resolve(handleGet(req, url))
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  if (pathname === '/settings/api/tools/toggle') {
    if (req.method === 'POST') return handleToggle(req)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
