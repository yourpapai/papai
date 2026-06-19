// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { safeBuildProvider } from '../../commands/context-tool-resolution.js'
import { logger } from '../../logger.js'
import { getToolMetadata, isToolDomain, type ToolDomain } from '../../tools/tool-metadata.js'
import {
  applyPreset,
  detectActivePreset,
  getDomainSummary,
  getToolPrefs,
  resolveToolPermission,
  setToolPrefs,
  type Permission,
  type ToolPrefs,
} from '../../tools/tool-preferences.js'
import { buildTools } from '../../tools/tools-builder.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-tools' })

/** Computed, capability+context-gated tool names for a context. */
async function availableToolNames(
  contextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
): Promise<string[]> {
  const provider = await safeBuildProvider(contextId)
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

export function buildDomainView(names: readonly string[], prefs: ToolPrefs): unknown[] {
  const grouped = groupByDomain(names)
  return [...grouped.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([domain, domainTools]) => ({
      domain,
      summary: getDomainSummary(prefs, domain, domainTools),
      tools: [...domainTools].toSorted().map((name) => {
        const meta = getToolMetadata(name)
        return { name, permission: resolveToolPermission(prefs, name), risk: meta?.risk ?? 'read' }
      }),
    }))
}

async function handleGet(req: Request, url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response

  const contextType = scope.scope.kind === 'group' ? 'group' : 'dm'
  const names = await availableToolNames(scope.scope.contextId, auth.authed.principal.platformUserId, contextType)
  const prefs = getToolPrefs(scope.scope.contextId)
  return settingsJson(200, {
    contextId: scope.scope.contextId,
    domains: buildDomainView(names, prefs),
    activePreset: detectActivePreset(prefs),
  })
}

/** Set a specific permission for a domain; clears per-tool overrides in that domain. */
export function setDomainPermission(prefs: ToolPrefs, domain: ToolDomain, permission: Permission): ToolPrefs {
  const domainDefaults = { ...prefs.domainDefaults, [domain]: permission }
  // Clear per-tool overrides inside the domain so the bulk action wins cleanly.
  const toolOverrides: Record<string, Permission> = {}
  for (const [name, value] of Object.entries(prefs.toolOverrides)) {
    const meta = getToolMetadata(name)
    if (meta !== undefined && meta.domain === domain) continue
    toolOverrides[name] = value
  }
  // Prune redundant domain defaults (allow = default, no need to store)
  const prunedDomainDefaults: Partial<Record<ToolDomain, Permission>> = {}
  for (const [d, v] of Object.entries(domainDefaults)) {
    if (v !== 'allow' && isToolDomain(d)) prunedDomainDefaults[d] = v as Permission
  }
  return { riskDefaults: prefs.riskDefaults ?? {}, domainDefaults: prunedDomainDefaults, toolOverrides }
}

/** Set a specific permission for a single tool; prunes redundant override if it matches domain/risk default. */
export function setToolPermission(prefs: ToolPrefs, toolName: string, permission: Permission): ToolPrefs {
  const meta = getToolMetadata(toolName)
  const baseline: Permission =
    meta === undefined
      ? 'allow'
      : (prefs.domainDefaults[meta.domain] ?? (prefs.riskDefaults ?? {})[meta.risk] ?? 'allow')
  // Prune redundant override: if permission matches baseline, no per-tool entry needed.
  const toolOverrides: Record<string, Permission> = {}
  for (const [name, value] of Object.entries(prefs.toolOverrides)) {
    if (name !== toolName) toolOverrides[name] = value
  }
  if (permission !== baseline) toolOverrides[toolName] = permission
  return { riskDefaults: prefs.riskDefaults ?? {}, domainDefaults: { ...prefs.domainDefaults }, toolOverrides }
}

const ToggleBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('domain'),
    permission: z.enum(['allow', 'ask', 'deny']),
    domain: z.string(),
    contextId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('tool'),
    permission: z.enum(['allow', 'ask', 'deny']),
    tool: z.string(),
    contextId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('preset'),
    preset: z.enum(['allow-all', 'non-destructive', 'read-only']),
    contextId: z.string().optional(),
  }),
])

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
  const names = await availableToolNames(scope.scope.contextId, auth.authed.principal.platformUserId, contextType)
  const prefs = getToolPrefs(scope.scope.contextId)

  if (body.data.kind === 'domain') {
    const domain = body.data.domain
    if (!isToolDomain(domain)) return settingsJson(422, { error: 'unknown tool domain' })
    setToolPrefs(scope.scope.contextId, setDomainPermission(prefs, domain, body.data.permission))
    log.info(
      { contextId: scope.scope.contextId, domain, permission: body.data.permission },
      'Settings tool domain permission set',
    )
  } else if (body.data.kind === 'tool') {
    const toolName = body.data.tool
    const meta = getToolMetadata(toolName)
    if (meta === undefined || !names.includes(toolName)) return settingsJson(422, { error: 'unknown tool' })
    setToolPrefs(scope.scope.contextId, setToolPermission(prefs, toolName, body.data.permission))
    log.info(
      { contextId: scope.scope.contextId, tool: toolName, permission: body.data.permission },
      'Settings tool permission set',
    )
  } else {
    setToolPrefs(scope.scope.contextId, applyPreset(body.data.preset))
    log.info({ contextId: scope.scope.contextId, preset: body.data.preset }, 'Settings tool preset applied')
  }

  const updated = getToolPrefs(scope.scope.contextId)
  return settingsJson(200, {
    contextId: scope.scope.contextId,
    domains: buildDomainView(names, updated),
    activePreset: detectActivePreset(updated),
  })
}

export function handleToolsRoutes(req: Request, url: URL, pathname: string): Promise<Response> {
  if (pathname === '/settings/api/tools') {
    if (req.method === 'GET') return handleGet(req, url)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  if (pathname === '/settings/api/tools/toggle') {
    if (req.method === 'POST') return handleToggle(req)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
