// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { contributionRegistry } from './contributions.js'

const log = logger.child({ scope: 'plugins:prompt-contributions' })

/** Maximum prompt fragment length per plugin (characters). */
export const MAX_FRAGMENT_LENGTH_PER_PLUGIN = 2000

/** Maximum total plugin prompt budget (characters). */
export const MAX_TOTAL_PLUGIN_PROMPT_LENGTH = 8000

/**
 * Build prompt fragment text for the active plugin IDs.
 * Enforces per-plugin and total length budgets.
 */
export function buildPluginPromptSection(activePluginIds: string[]): string {
  const sections: string[] = []
  let totalLength = 0

  for (const pluginId of activePluginIds) {
    const contributions = contributionRegistry.getContributions(pluginId)
    if (contributions === undefined || contributions.promptFragments.length === 0) continue

    for (const fragment of contributions.promptFragments) {
      if (totalLength >= MAX_TOTAL_PLUGIN_PROMPT_LENGTH) {
        log.warn({ pluginId }, 'Total plugin prompt budget exceeded — stopping')
        break
      }

      let rawContent: string
      try {
        rawContent = typeof fragment.content === 'function' ? fragment.content() : fragment.content
      } catch (error) {
        log.warn(
          { pluginId, fragmentName: fragment.name, error: error instanceof Error ? error.message : String(error) },
          'Plugin prompt fragment threw — skipping',
        )
        continue
      }
      const truncated =
        rawContent.length > MAX_FRAGMENT_LENGTH_PER_PLUGIN
          ? rawContent.slice(0, MAX_FRAGMENT_LENGTH_PER_PLUGIN - '[truncated]'.length) + '[truncated]'
          : rawContent

      const section = `<!-- plugin:${pluginId}:${fragment.name} -->\n${truncated}\n<!-- /plugin:${pluginId}:${fragment.name} -->`
      sections.push(section)
      totalLength += section.length
    }

    if (totalLength >= MAX_TOTAL_PLUGIN_PROMPT_LENGTH) break
  }

  return sections.join('\n\n')
}
