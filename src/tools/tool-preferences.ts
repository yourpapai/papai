// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { clearCachedConfig, clearCachedToolsByPrefix, getCachedConfig, setCachedConfig } from '../cache.js'
import { logger } from '../logger.js'
import { getToolMetadata, TOOL_DOMAINS, type ToolDomain, type ToolRisk } from './tool-metadata.js'

const log = logger.child({ scope: 'tools:preferences' })

/** Reserved, non-user-visible config key holding the per-context tool denylist JSON. */
export const TOOL_PREFS_CONFIG_KEY = 'tool_prefs'

export type Permission = 'allow' | 'ask' | 'deny'

export type ToolPreset = 'allow-all' | 'non-destructive' | 'read-only'

/** Per-preset risk-default maps in pruned form ('allow' entries omitted). */
export const PRESET_RISK_DEFAULTS: Readonly<Record<ToolPreset, Partial<Record<ToolRisk, Permission>>>> = {
  'allow-all': {},
  'non-destructive': { destructive: 'ask', 'open-world': 'ask' },
  'read-only': { write: 'ask', destructive: 'ask', 'open-world': 'ask' },
}

export const PRESET_KEYS: readonly ToolPreset[] = ['allow-all', 'non-destructive', 'read-only']

export interface ToolPrefs {
  /** Per-risk default permission applied by presets. Resolved below domainDefaults. Missing entry = 'allow'. */
  riskDefaults?: Partial<Record<ToolRisk, Permission>>
  /** Per-domain default permission. Missing entry = 'allow'. */
  domainDefaults: Partial<Record<ToolDomain, Permission>>
  /** Per-tool override that wins over the domain default. */
  toolOverrides: Record<string, Permission>
}

function emptyPrefs(): ToolPrefs {
  return { riskDefaults: {}, domainDefaults: {}, toolOverrides: {} }
}

const PERMISSIONS: ReadonlySet<Permission> = new Set(['allow', 'ask', 'deny'])

/** Returns true if value is a valid Permission string ('allow' | 'ask' | 'deny'). */
export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as ReadonlySet<string>).has(value)
}

const TOOL_DOMAIN_SET: ReadonlySet<string> = new Set(TOOL_DOMAINS)

function isToolDomain(value: string): value is ToolDomain {
  return TOOL_DOMAIN_SET.has(value)
}

const TOOL_RISK_SET: ReadonlySet<string> = new Set<ToolRisk>(['read', 'write', 'destructive', 'open-world'])

function isToolRisk(value: string): value is ToolRisk {
  return TOOL_RISK_SET.has(value)
}

export function resolveToolPermission(prefs: ToolPrefs, toolName: string): Permission {
  const override = prefs.toolOverrides[toolName]
  if (override !== undefined) return override
  const meta = getToolMetadata(toolName)
  if (meta === undefined) return 'allow'
  return prefs.domainDefaults[meta.domain] ?? (prefs.riskDefaults ?? {})[meta.risk] ?? 'allow'
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

function parseRiskDefaults(parsed: Record<string, unknown>): Partial<Record<ToolRisk, Permission>> {
  const out: Partial<Record<ToolRisk, Permission>> = {}
  const raw = parsed['riskDefaults']
  if (isStringRecord(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (isToolRisk(key) && isPermission(value)) out[key] = value
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
      riskDefaults: parseRiskDefaults(parsed),
      domainDefaults: parseDomainDefaults(parsed),
      toolOverrides: parseToolOverrides(parsed),
    }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Corrupt tool_prefs; using empty prefs')
    return emptyPrefs()
  }
}

export function serializeToolPrefs(prefs: ToolPrefs): string {
  return JSON.stringify({
    riskDefaults: prefs.riskDefaults ?? {},
    domainDefaults: prefs.domainDefaults,
    toolOverrides: prefs.toolOverrides,
  })
}

export function getToolPrefs(contextId: string): ToolPrefs {
  return parseToolPrefs(getCachedConfig(contextId, TOOL_PREFS_CONFIG_KEY))
}

/** True when a tool_prefs row exists for the context (distinct from an empty/allow-all prefs object). */
export function hasStoredToolPrefs(contextId: string): boolean {
  return getCachedConfig(contextId, TOOL_PREFS_CONFIG_KEY) !== null
}

/** Persist prefs for a context and invalidate the context's cached tool sets. */
export function setToolPrefs(contextId: string, prefs: ToolPrefs): void {
  setCachedConfig(contextId, TOOL_PREFS_CONFIG_KEY, serializeToolPrefs(prefs))
  clearCachedToolsByPrefix(contextId)
  log.info({ contextId, configuredDomains: Object.keys(prefs.domainDefaults).length }, 'Tool prefs updated')
}

export function clearToolPrefs(contextId: string): void {
  clearCachedConfig(contextId, TOOL_PREFS_CONFIG_KEY)
  clearCachedToolsByPrefix(contextId)
}

export function partitionToolNames(
  prefs: ToolPrefs,
  names: readonly string[],
): { exposed: Set<string>; denied: Set<string> } {
  const exposed = new Set<string>()
  const denied = new Set<string>()
  for (const name of names) {
    if (resolveToolPermission(prefs, name) === 'deny') denied.add(name)
    else exposed.add(name)
  }
  return { exposed, denied }
}

const CYCLE_ORDER: readonly Permission[] = ['allow', 'ask', 'deny']

function nextPermission(current: Permission): Permission {
  const index = CYCLE_ORDER.indexOf(current)
  return CYCLE_ORDER[(index + 1) % CYCLE_ORDER.length] ?? 'allow'
}

function domainDefault(prefs: ToolPrefs, domain: ToolDomain): Permission {
  return prefs.domainDefaults[domain] ?? 'allow'
}

function pruneRedundantOverrides(prefs: ToolPrefs): ToolPrefs {
  const toolOverrides: Record<string, Permission> = {}
  for (const [name, value] of Object.entries(prefs.toolOverrides)) {
    const meta = getToolMetadata(name)
    const def: Permission =
      meta === undefined
        ? 'allow'
        : (prefs.domainDefaults[meta.domain] ?? (prefs.riskDefaults ?? {})[meta.risk] ?? 'allow')
    if (value !== def) toolOverrides[name] = value
  }
  return { riskDefaults: prefs.riskDefaults ?? {}, domainDefaults: { ...prefs.domainDefaults }, toolOverrides }
}

function pruneRedundantDomainDefaults(prefs: ToolPrefs): ToolPrefs {
  const domainDefaults: Partial<Record<ToolDomain, Permission>> = {}
  for (const [domain, value] of Object.entries(prefs.domainDefaults)) {
    if (value !== 'allow' && isToolDomain(domain)) domainDefaults[domain] = value
  }
  return { riskDefaults: prefs.riskDefaults ?? {}, domainDefaults, toolOverrides: prefs.toolOverrides }
}

export type DomainSummary = 'allow' | 'ask' | 'deny' | 'partial'

export function getDomainSummary(
  prefs: ToolPrefs,
  domain: ToolDomain,
  domainToolNames: readonly string[],
): DomainSummary {
  if (domainToolNames.length === 0) return domainDefault(prefs, domain)
  const set = new Set(domainToolNames.map((name) => resolveToolPermission(prefs, name)))
  if (set.size === 1) {
    const only = [...set][0]
    if (only !== undefined) return only
  }
  return 'partial'
}

export function cycleDomain(prefs: ToolPrefs, domain: ToolDomain, domainToolNames: readonly string[]): ToolPrefs {
  const current = getDomainSummary(prefs, domain, domainToolNames)
  const base: Permission = current === 'partial' ? 'allow' : current
  const next = nextPermission(base)
  const domainDefaults = { ...prefs.domainDefaults, [domain]: next }
  // Clear any per-tool override inside the domain so the bulk action wins cleanly.
  const toolOverrides: Record<string, Permission> = {}
  for (const [name, value] of Object.entries(prefs.toolOverrides)) {
    const meta = getToolMetadata(name)
    if (meta !== undefined && meta.domain === domain) continue
    toolOverrides[name] = value
  }
  return pruneRedundantDomainDefaults(
    pruneRedundantOverrides({ riskDefaults: prefs.riskDefaults ?? {}, domainDefaults, toolOverrides }),
  )
}

export function cycleTool(prefs: ToolPrefs, toolName: string): ToolPrefs {
  const current = resolveToolPermission(prefs, toolName)
  const next = nextPermission(current)
  const toolOverrides = { ...prefs.toolOverrides, [toolName]: next }
  return pruneRedundantOverrides({
    riskDefaults: prefs.riskDefaults ?? {},
    domainDefaults: { ...prefs.domainDefaults },
    toolOverrides,
  })
}

function pruneRiskDefaults(rd: Partial<Record<ToolRisk, Permission>>): Partial<Record<ToolRisk, Permission>> {
  const out: Partial<Record<ToolRisk, Permission>> = {}
  for (const [key, value] of Object.entries(rd)) {
    if (value !== undefined && value !== 'allow' && isToolRisk(key)) out[key] = value
  }
  return out
}

function riskDefaultsEqual(
  a: Partial<Record<ToolRisk, Permission>>,
  b: Partial<Record<ToolRisk, Permission>>,
): boolean {
  const pa = pruneRiskDefaults(a)
  const pb = pruneRiskDefaults(b)
  const keysA = Object.keys(pa)
  if (keysA.length !== Object.keys(pb).length) return false
  return keysA.every((key) => {
    if (!isToolRisk(key)) return false
    return pb[key] === pa[key]
  })
}

/** Build prefs for a preset: writes the risk-default layer and clears domain/tool customization. */
export function applyPreset(preset: ToolPreset): ToolPrefs {
  return { riskDefaults: { ...PRESET_RISK_DEFAULTS[preset] }, domainDefaults: {}, toolOverrides: {} }
}

/** The preset whose state matches prefs exactly, or null ("Custom") if customized / unmatched. */
export function detectActivePreset(prefs: ToolPrefs): ToolPreset | null {
  if (Object.keys(prefs.domainDefaults).length > 0) return null
  if (Object.keys(prefs.toolOverrides).length > 0) return null
  const riskDefaults = prefs.riskDefaults ?? {}
  for (const preset of PRESET_KEYS) {
    if (riskDefaultsEqual(riskDefaults, PRESET_RISK_DEFAULTS[preset])) return preset
  }
  return null
}
