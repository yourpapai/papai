// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { clearCachedToolsByPrefix, getCachedConfig, setCachedConfig } from '../cache.js'
import { logger } from '../logger.js'
import { getToolMetadata, TOOL_METADATA, type ToolDomain } from './tool-metadata.js'

const log = logger.child({ scope: 'tools:preferences' })

/** Reserved, non-user-visible config key holding the per-context tool denylist JSON. */
export const TOOL_PREFS_CONFIG_KEY = 'tool_prefs'

export type Permission = 'allow' | 'ask' | 'deny'

export interface ToolPrefs {
  /** Per-domain default permission. Missing entry = 'allow'. */
  domainDefaults: Partial<Record<ToolDomain, Permission>>
  /** Per-tool override that wins over the domain default. */
  toolOverrides: Record<string, Permission>
}

function emptyPrefs(): ToolPrefs {
  return { domainDefaults: {}, toolOverrides: {} }
}

const PERMISSIONS = new Set<string>(['allow', 'ask', 'deny'])

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && PERMISSIONS.has(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const TOOL_DOMAINS: ReadonlySet<string> = new Set(Object.values(TOOL_METADATA).map((m) => m.domain))

function isToolDomain(value: string): value is ToolDomain {
  return TOOL_DOMAINS.has(value)
}

export function resolveToolPermission(prefs: ToolPrefs, toolName: string): Permission {
  const override = prefs.toolOverrides[toolName]
  if (override !== undefined) return override
  const meta = getToolMetadata(toolName)
  if (meta === undefined) return 'allow'
  return prefs.domainDefaults[meta.domain] ?? 'allow'
}

export function parseToolPrefs(raw: string | null): ToolPrefs {
  if (raw === null || raw.trim() === '') return emptyPrefs()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainObject(parsed)) return emptyPrefs()
    const domainDefaults: Partial<Record<ToolDomain, Permission>> = {}
    const defaultsRaw = parsed['domainDefaults']
    if (isPlainObject(defaultsRaw)) {
      for (const [key, value] of Object.entries(defaultsRaw)) {
        if (isToolDomain(key) && isPermission(value)) domainDefaults[key] = value
      }
    }
    const toolOverrides: Record<string, Permission> = {}
    const overridesRaw = parsed['toolOverrides']
    if (isPlainObject(overridesRaw)) {
      for (const [name, value] of Object.entries(overridesRaw)) {
        if (isPermission(value)) toolOverrides[name] = value
      }
    }
    return { domainDefaults, toolOverrides }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Corrupt tool_prefs; using empty prefs')
    return emptyPrefs()
  }
}

export function serializeToolPrefs(prefs: ToolPrefs): string {
  return JSON.stringify({ domainDefaults: prefs.domainDefaults, toolOverrides: prefs.toolOverrides })
}

export function getToolPrefs(contextId: string): ToolPrefs {
  return parseToolPrefs(getCachedConfig(contextId, TOOL_PREFS_CONFIG_KEY))
}

/** Persist prefs for a context and invalidate the context's cached tool sets. */
export function setToolPrefs(contextId: string, prefs: ToolPrefs): void {
  setCachedConfig(contextId, TOOL_PREFS_CONFIG_KEY, serializeToolPrefs(prefs))
  clearCachedToolsByPrefix(contextId)
  log.info({ contextId, disabledDomains: Object.keys(prefs.domainDefaults).length }, 'Tool prefs updated')
}

// Legacy boolean-shaped helper kept for callers not yet migrated.
export function isToolEnabled(prefs: ToolPrefs, toolName: string): boolean {
  return resolveToolPermission(prefs, toolName) !== 'deny'
}

export function partitionToolNames(
  prefs: ToolPrefs,
  names: readonly string[],
): { enabled: Set<string>; disabled: Set<string> } {
  const enabled = new Set<string>()
  const disabled = new Set<string>()
  for (const name of names) {
    if (resolveToolPermission(prefs, name) === 'deny') disabled.add(name)
    else enabled.add(name)
  }
  return { enabled, disabled }
}

export type DomainStatus = 'on' | 'off' | 'partial'

export function getDomainStatus(
  prefs: ToolPrefs,
  domain: ToolDomain,
  domainToolNames: readonly string[],
): DomainStatus {
  if (domainToolNames.length === 0) {
    return (prefs.domainDefaults[domain] ?? 'allow') === 'deny' ? 'off' : 'on'
  }
  const states = domainToolNames.map((name) => resolveToolPermission(prefs, name) !== 'deny')
  const allOn = states.every(Boolean)
  const allOff = states.every((s) => !s)
  if (allOn) return 'on'
  if (allOff) return 'off'
  return 'partial'
}

// Domain toggle: flips the domain default between 'allow' and 'deny' (two-state, legacy contract).
export function toggleDomain(prefs: ToolPrefs, domain: ToolDomain, _domainToolNames: readonly string[]): ToolPrefs {
  const currentlyOn = (prefs.domainDefaults[domain] ?? 'allow') !== 'deny'
  const nextDefault: Permission = currentlyOn ? 'deny' : 'allow'
  const domainDefaults = { ...prefs.domainDefaults, [domain]: nextDefault }
  // Drop per-tool overrides within the domain so bulk action wins cleanly.
  const toolOverrides: Record<string, Permission> = {}
  for (const [name, value] of Object.entries(prefs.toolOverrides)) {
    const meta = getToolMetadata(name)
    if (meta !== undefined && meta.domain === domain) continue
    toolOverrides[name] = value
  }
  return { domainDefaults, toolOverrides }
}

// Per-tool toggle: flips override between 'allow' and 'deny' (two-state, legacy contract).
export function toggleTool(prefs: ToolPrefs, toolName: string, _domainToolNames: readonly string[]): ToolPrefs {
  const next: Permission = resolveToolPermission(prefs, toolName) === 'deny' ? 'allow' : 'deny'
  const toolOverrides = { ...prefs.toolOverrides, [toolName]: next }
  return { domainDefaults: { ...prefs.domainDefaults }, toolOverrides }
}
