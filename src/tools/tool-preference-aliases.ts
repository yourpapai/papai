// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type ToolPreferenceWireAlias = Readonly<{
  legacyPrefix: string
  canonicalPrefix: string
}>

/**
 * Wire aliases that represent the same user-configurable tool preference. Keeping this mapping
 * at the preference boundary means every permission consumer treats a renamed wire tool
 * consistently.
 */
const TOOL_PREFERENCE_WIRE_ALIASES: readonly ToolPreferenceWireAlias[] = [
  { legacyPrefix: 'plugin_acp__', canonicalPrefix: 'module_coding__' },
]

export function equivalentToolPreferenceNames(toolName: string): readonly string[] {
  const alias = TOOL_PREFERENCE_WIRE_ALIASES.find(
    ({ legacyPrefix, canonicalPrefix }) => toolName.startsWith(legacyPrefix) || toolName.startsWith(canonicalPrefix),
  )
  if (alias === undefined) return [toolName]
  if (toolName.startsWith(alias.legacyPrefix)) {
    return [`${alias.canonicalPrefix}${toolName.slice(alias.legacyPrefix.length)}`, toolName]
  }
  return [toolName, `${alias.legacyPrefix}${toolName.slice(alias.canonicalPrefix.length)}`]
}
