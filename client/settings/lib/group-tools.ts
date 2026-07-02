// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolDomainSummary, ToolEntry } from '../fetcher-schemas-tools.js'

export type ToolGroup = { group: string | null; tools: ToolEntry[] }

/** Split a domain's tools into an ungrouped bucket (first, when non-empty) plus per-group buckets sorted by label. */
export function groupToolEntries(tools: readonly ToolEntry[]): ToolGroup[] {
  const ungrouped: ToolEntry[] = []
  const grouped = new Map<string, ToolEntry[]>()
  for (const tool of tools) {
    if (tool.group === undefined) {
      ungrouped.push(tool)
      continue
    }
    const list = grouped.get(tool.group)
    if (list === undefined) grouped.set(tool.group, [tool])
    else list.push(tool)
  }
  const groups: ToolGroup[] = [...grouped.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([group, groupTools]) => ({ group, tools: groupTools }))
  return ungrouped.length > 0 ? [{ group: null, tools: ungrouped }, ...groups] : groups
}

/** Uniform permission of a group's tools, or 'partial' when they diverge. */
export function groupSummary(tools: readonly ToolEntry[]): ToolDomainSummary {
  const set = new Set(tools.map((tool) => tool.permission))
  const only = [...set][0]
  if (set.size === 1 && only !== undefined) return only
  return 'partial'
}
