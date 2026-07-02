// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sanitizeServerId } from '../../mcp/types.js'
import { sanitizePluginId } from '../../plugins/contribution-names.js'
import { pluginRegistry } from '../../plugins/registry.js'
import { getToolMetadata, type ToolDomain } from '../../tools/tool-metadata.js'

const NAMESPACED_TOOL_RE = /^(plugin|mcp)_(.+?)__/u

/**
 * Map from every sanitized form of an active plugin id to the real plugin id.
 * Native plugin tools sanitize with '-' → '_' (`sanitizePluginId`), while
 * plugin-declared MCP tools sanitize via `sanitizeServerId` (kebab-case), so
 * both forms are registered.
 */
export function activePluginSegmentMap(): Map<string, string> {
  const map = new Map<string, string>()
  for (const plugin of pluginRegistry.getActivePlugins()) {
    const id = plugin.manifest.id
    map.set(sanitizePluginId(id), id)
    map.set(sanitizeServerId(id), id)
  }
  return map
}

/**
 * Display group for a namespaced tool name: the real plugin id (when the
 * sanitized segment matches an active plugin) or the MCP server id.
 * Undefined for builtin tool names.
 */
export function deriveToolGroup(name: string, segmentMap: ReadonlyMap<string, string>): string | undefined {
  const match = NAMESPACED_TOOL_RE.exec(name)
  if (match === null) return undefined
  const prefix = match[1]
  const segment = match[2]
  if (prefix === undefined || segment === undefined) return undefined
  if (prefix === 'plugin') return segmentMap.get(segment) ?? segment
  return segment
}

/** All names whose tool-metadata domain and derived group both match. */
export function resolveGroupTools(names: readonly string[], domain: ToolDomain, group: string): string[] {
  const segmentMap = activePluginSegmentMap()
  return names.filter((name) => {
    const meta = getToolMetadata(name)
    return meta !== undefined && meta.domain === domain && deriveToolGroup(name, segmentMap) === group
  })
}
