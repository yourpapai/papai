// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { clearCachedToolsByPrefix, getCachedConfig, setCachedConfig } from '../cache.js'
import { logger } from '../logger.js'
import { getToolMetadata, type ToolDomain } from './tool-metadata.js'

const log = logger.child({ scope: 'tools:preferences' })

/** Reserved, non-user-visible config key holding the per-context tool denylist JSON. */
export const TOOL_PREFS_CONFIG_KEY = 'tool_prefs'

export interface ToolPrefs {
  /** Domains turned off wholesale. */
  disabledDomains: ToolDomain[]
  /** Per-tool overrides that win over the domain default. true = force on, false = force off. */
  toolOverrides: Record<string, boolean>
}

function emptyPrefs(): ToolPrefs {
  return { disabledDomains: [], toolOverrides: {} }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseToolPrefs(raw: string | null): ToolPrefs {
  if (raw === null || raw.trim() === '') return emptyPrefs()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainObject(parsed)) return emptyPrefs()
    const disabledDomains = Array.isArray(parsed['disabledDomains'])
      ? parsed['disabledDomains'].filter((d): d is ToolDomain => typeof d === 'string')
      : []
    const overridesRaw = parsed['toolOverrides']
    const toolOverrides: Record<string, boolean> = {}
    if (isPlainObject(overridesRaw)) {
      for (const [name, value] of Object.entries(overridesRaw)) {
        if (typeof value === 'boolean') toolOverrides[name] = value
      }
    }
    return { disabledDomains, toolOverrides }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Corrupt tool_prefs; using empty prefs')
    return emptyPrefs()
  }
}

export function serializeToolPrefs(prefs: ToolPrefs): string {
  return JSON.stringify({
    disabledDomains: prefs.disabledDomains,
    toolOverrides: prefs.toolOverrides,
  })
}

export function getToolPrefs(contextId: string): ToolPrefs {
  return parseToolPrefs(getCachedConfig(contextId, TOOL_PREFS_CONFIG_KEY))
}

/** Persist prefs for a context and invalidate the context's cached tool sets. */
export function setToolPrefs(contextId: string, prefs: ToolPrefs): void {
  setCachedConfig(contextId, TOOL_PREFS_CONFIG_KEY, serializeToolPrefs(prefs))
  clearCachedToolsByPrefix(contextId)
  log.info({ contextId, disabledDomains: prefs.disabledDomains.length }, 'Tool prefs updated')
}

/** Domain default: true (on) unless the domain is in disabledDomains. */
function domainEnabled(prefs: ToolPrefs, domain: ToolDomain): boolean {
  return !prefs.disabledDomains.includes(domain)
}

export function isToolEnabled(prefs: ToolPrefs, toolName: string): boolean {
  const override = prefs.toolOverrides[toolName]
  if (override !== undefined) return override
  const meta = getToolMetadata(toolName)
  // un-classified tools (e.g. plugin tools) are never grouped/disabled here
  if (meta === undefined) return true
  return domainEnabled(prefs, meta.domain)
}

export function partitionToolNames(
  prefs: ToolPrefs,
  names: readonly string[],
): { enabled: Set<string>; disabled: Set<string> } {
  const enabled = new Set<string>()
  const disabled = new Set<string>()
  for (const name of names) {
    if (isToolEnabled(prefs, name)) enabled.add(name)
    else disabled.add(name)
  }
  return { enabled, disabled }
}

export type DomainStatus = 'on' | 'off' | 'partial'

/**
 * Aggregate on/off/partial status for a domain.
 * When `domainToolNames` is empty, returns status based solely on the domain flag —
 * per-tool overrides are intentionally ignored in that fallback. Callers should pass
 * the domain's actual tool names; names outside `domain` are evaluated by their own
 * metadata and may skew the aggregate (caller-contract, not enforced).
 */
export function getDomainStatus(
  prefs: ToolPrefs,
  domain: ToolDomain,
  domainToolNames: readonly string[],
): DomainStatus {
  if (domainToolNames.length === 0) return domainEnabled(prefs, domain) ? 'on' : 'off'
  const states = domainToolNames.map((name) => isToolEnabled(prefs, name))
  const allOn = states.every(Boolean)
  const allOff = states.every((s) => !s)
  if (allOn) return 'on'
  if (allOff) return 'off'
  return 'partial'
}

/** Remove overrides that now equal the domain default, keeping the blob minimal. */
function pruneRedundantOverrides(prefs: ToolPrefs): ToolPrefs {
  const toolOverrides: Record<string, boolean> = {}
  for (const [name, value] of Object.entries(prefs.toolOverrides)) {
    const meta = getToolMetadata(name)
    const def = meta === undefined ? true : domainEnabled(prefs, meta.domain)
    if (value !== def) toolOverrides[name] = value
  }
  return { disabledDomains: [...prefs.disabledDomains], toolOverrides }
}

/** Toggle a whole domain on/off, dropping per-tool overrides that become redundant. */
export function toggleDomain(prefs: ToolPrefs, domain: ToolDomain, domainToolNames: readonly string[]): ToolPrefs {
  const currentlyOn = getDomainStatus(prefs, domain, domainToolNames) !== 'off'
  const disabledDomains = prefs.disabledDomains.filter((d) => d !== domain)
  if (currentlyOn) disabledDomains.push(domain)
  // Clear per-tool overrides within the domain so the bulk action wins cleanly.
  const toolOverrides: Record<string, boolean> = {}
  for (const [name, value] of Object.entries(prefs.toolOverrides)) {
    const meta = getToolMetadata(name)
    if (meta !== undefined && meta.domain === domain) continue
    toolOverrides[name] = value
  }
  return pruneRedundantOverrides({ disabledDomains, toolOverrides })
}

/**
 * Toggle a single tool, expressed as an override; prunes when it matches the domain default.
 * `_domainToolNames` is accepted only for signature symmetry with `toggleDomain` (uniform
 * toggle callback) and is intentionally unused — only the tool's own domain default matters.
 */
export function toggleTool(prefs: ToolPrefs, toolName: string, _domainToolNames: readonly string[]): ToolPrefs {
  const next = !isToolEnabled(prefs, toolName)
  const toolOverrides = { ...prefs.toolOverrides, [toolName]: next }
  return pruneRedundantOverrides({ disabledDomains: [...prefs.disabledDomains], toolOverrides })
}
