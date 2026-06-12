// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { DISCLOSURE_INJECTED_TOOL_NAMES } from './tools/disclosure/core.js'
import { getToolMetadata, TOOL_METADATA } from './tools/tool-metadata.js'
import { resolveToolPermission, type ToolPrefs } from './tools/tool-preferences.js'

/**
 * Safety-net: list tools that are disabled by prefs but whose domain still has at least
 * one enabled tool (a "partial" disable). Whole-domain disables are already handled by
 * fragment exclusion, so they are intentionally not repeated here.
 */
export function buildUnavailableLine(prefs: ToolPrefs, enabled: ReadonlySet<string>): string | null {
  const enabledDomains = new Set<string>()
  for (const name of enabled) {
    const meta = getToolMetadata(name)
    if (meta !== undefined) enabledDomains.add(meta.domain)
  }
  const names = new Set<string>()
  const candidateNames = new Set([...Object.keys(TOOL_METADATA), ...Object.keys(prefs.toolOverrides)])
  for (const name of candidateNames) {
    const meta = getToolMetadata(name)
    if (meta === undefined || !enabledDomains.has(meta.domain) || enabled.has(name)) continue
    if (resolveToolPermission(prefs, name) === 'deny') names.add(name)
  }
  if (names.size === 0) return null
  return `Unavailable tools — do not use or mention: ${[...names].toSorted().join(', ')}.`
}

export function buildAskToolsLine(prefs: ToolPrefs, exposed: ReadonlySet<string>): string | null {
  const askNames = [...exposed]
    .filter((name) => !DISCLOSURE_INJECTED_TOOL_NAMES.has(name))
    .filter((name) => resolveToolPermission(prefs, name) === 'ask')
    .toSorted()
  if (askNames.length === 0) return null
  return [
    'Some tools require user permission before each call. Listed tools must include',
    '`_permission_reason` (one sentence, present tense) describing why the call is needed:',
    askNames.map((n) => `  - ${n}`).join('\n'),
  ].join('\n')
}
