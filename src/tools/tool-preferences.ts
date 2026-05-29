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

const PERMISSIONS: ReadonlySet<Permission> = new Set(['allow', 'ask', 'deny'])

/** Returns true if value is a valid Permission string ('allow' | 'ask' | 'deny'). */
export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as ReadonlySet<string>).has(value)
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

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseDomainDefaults(parsed: Record<string, unknown>): Partial<Record<ToolDomain, Permission>> {
  const out: Partial<Record<ToolDomain, Permission>> = {}
  // Legacy: disabledDomains: ['task']  → domainDefaults: { task: 'deny' }
  const legacy = parsed['disabledDomains']
  if (Array.isArray(legacy)) {
    for (const item of legacy) {
      if (typeof item === 'string' && isToolDomain(item)) out[item] = 'deny'
    }
  }
  // New shape wins over legacy on conflict.
  const newShape = parsed['domainDefaults']
  if (isStringRecord(newShape)) {
    for (const [key, value] of Object.entries(newShape)) {
      if (isToolDomain(key) && isPermission(value)) out[key] = value
    }
  }
  return out
}

function parseToolOverrides(parsed: Record<string, unknown>): Record<string, Permission> {
  const out: Record<string, Permission> = {}
  const overridesRaw = parsed['toolOverrides']
  if (!isStringRecord(overridesRaw)) return out
  for (const [name, value] of Object.entries(overridesRaw)) {
    if (isPermission(value)) {
      out[name] = value
    } else if (value === true) {
      out[name] = 'allow'
    } else if (value === false) {
      out[name] = 'deny'
    }
  }
  return out
}

export function parseToolPrefs(raw: string | null): ToolPrefs {
  if (raw === null || raw.trim() === '') return emptyPrefs()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isStringRecord(parsed)) return emptyPrefs()
    return {
      domainDefaults: parseDomainDefaults(parsed),
      toolOverrides: parseToolOverrides(parsed),
    }
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
  log.info({ contextId, configuredDomains: Object.keys(prefs.domainDefaults).length }, 'Tool prefs updated')
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
  // Pruning (remove override when it matches the domain default) is deferred to
  // the Task 1.4 cycle implementation; the 2-state stub always writes the override.
  const toolOverrides = { ...prefs.toolOverrides, [toolName]: next }
  return { domainDefaults: { ...prefs.domainDefaults }, toolOverrides }
}
