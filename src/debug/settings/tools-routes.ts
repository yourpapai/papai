// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { safeBuildProvider } from '../../commands/context-tool-resolution.js'
import { logger } from '../../logger.js'
import { buildProviderlessToolDescriptors, buildToolDescriptors, type MakeToolsOptions } from '../../tools/index.js'
import { getToolMetadata, isToolDomain, type ToolDomain } from '../../tools/tool-metadata.js'
import {
  applyPreset,
  clearToolPrefs,
  detectActivePreset,
  getDomainSummary,
  getToolPrefs,
  resolveToolPermission,
  setToolPrefs,
  type Permission,
  type ToolPrefs,
} from '../../tools/tool-preferences.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'
import { activePluginSegmentMap, deriveToolGroup, resolveGroupTools } from './tool-grouping.js'

const log = logger.child({ scope: 'debug-server:settings-tools' })

/**
 * Computed tool names for a context, mirroring the runtime surface exactly:
 * builtins + user MCP tools + plugin tools + plugin-declared MCP tools, with
 * runtime capability/eligibility/collision rules. MCP connections are pooled
 * and best-effort — a downed server degrades to "tools absent", never an error.
 */
async function availableToolNames(
  contextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
): Promise<string[]> {
  const provider = await safeBuildProvider(contextId)
  // NOTE: tools that require live-turn-only inputs are absent from the displayed list
  // even when a real turn would expose them — a known display-only discrepancy. Two
  // classes: `resolve_chat_participant` needs a ChatRouter-bound `chatParticipantResolver`
  // (intentionally omitted; none exists outside a chat turn), and thread-gated builtins
  // like `lookup_group_history` need a thread-scoped storage context id, while settings
  // always operates on the config-context id. Such tools still obey domain/risk-tier
  // prefs at runtime; only per-tool overrides can't be set from the UI.
  const options: MakeToolsOptions = {
    storageContextId: contextId,
    chatUserId: actorUserId,
    mode: 'normal',
    contextType,
  }
  const toolset =
    provider === null ? await buildProviderlessToolDescriptors(options) : await buildToolDescriptors(provider, options)
  return Object.keys(toolset).filter((name) => getToolMetadata(name) !== undefined)
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
  const segmentMap = activePluginSegmentMap()
  return [...grouped.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([domain, domainTools]) => ({
      domain,
      summary: getDomainSummary(prefs, domain, domainTools),
      tools: [...domainTools].toSorted().map((name) => {
        const meta = getToolMetadata(name)
        const group = deriveToolGroup(name, segmentMap)
        return {
          name,
          permission: resolveToolPermission(prefs, name),
          risk: meta?.risk ?? 'read',
          ...(group === undefined ? {} : { group }),
        }
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

/** Apply a bulk group toggle across every exposed tool of the group; null when the group matches no tools. */
function applyGroupToggle(
  prefs: ToolPrefs,
  names: readonly string[],
  domain: ToolDomain,
  group: string,
  permission: Permission,
): { prefs: ToolPrefs; tools: number } | null {
  const groupTools = resolveGroupTools(names, domain, group)
  if (groupTools.length === 0) return null
  let next = prefs
  for (const name of groupTools) next = setToolPermission(next, name, permission)
  return { prefs: next, tools: groupTools.length }
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
    kind: z.literal('group'),
    permission: z.enum(['allow', 'ask', 'deny']),
    domain: z.string(),
    group: z.string(),
    contextId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('preset'),
    preset: z.enum(['allow-all', 'non-destructive', 'read-only']),
    contextId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('unset'),
    contextId: z.string().optional(),
  }),
])

type ToggleBody = z.infer<typeof ToggleBodySchema>

/** Applies one toggle request to `prefs` and persists it; returns the 422 response on a validation failure. */
function applyToggle(data: ToggleBody, prefs: ToolPrefs, names: readonly string[], contextId: string): Response | null {
  if (data.kind === 'unset') {
    clearToolPrefs(contextId)
    log.info({ contextId }, 'Tool prefs unset')
    return null
  }
  if (data.kind === 'domain') {
    if (!isToolDomain(data.domain)) return settingsJson(422, { error: 'unknown tool domain' })
    setToolPrefs(contextId, setDomainPermission(prefs, data.domain, data.permission))
    log.info({ contextId, domain: data.domain, permission: data.permission }, 'Settings tool domain permission set')
    return null
  }
  if (data.kind === 'tool') {
    const meta = getToolMetadata(data.tool)
    if (meta === undefined || !names.includes(data.tool)) return settingsJson(422, { error: 'unknown tool' })
    setToolPrefs(contextId, setToolPermission(prefs, data.tool, data.permission))
    log.info({ contextId, tool: data.tool, permission: data.permission }, 'Settings tool permission set')
    return null
  }
  if (data.kind === 'group') {
    if (!isToolDomain(data.domain)) return settingsJson(422, { error: 'unknown tool domain' })
    const result = applyGroupToggle(prefs, names, data.domain, data.group, data.permission)
    if (result === null) return settingsJson(422, { error: 'unknown tool group' })
    setToolPrefs(contextId, result.prefs)
    log.info(
      { contextId, domain: data.domain, group: data.group, tools: result.tools, permission: data.permission },
      'Settings tool group permission set',
    )
    return null
  }
  setToolPrefs(contextId, applyPreset(data.preset))
  log.info({ contextId, preset: data.preset }, 'Settings tool preset applied')
  return null
}

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

  const errorResponse = applyToggle(body.data, prefs, names, scope.scope.contextId)
  if (errorResponse !== null) return errorResponse

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
