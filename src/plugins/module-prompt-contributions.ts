// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { modulePromptFragmentRegistry } from '../ports/module-contributions.js'
import { moduleEligibilityRegistry } from '../ports/module-eligibility.js'

const log = logger.child({ scope: 'modules:prompt-contributions' })

/** Maximum prompt fragment length per module (characters). */
export const MAX_FRAGMENT_LENGTH_PER_MODULE = 2000

/** Maximum total module prompt budget (characters) — independent of the plugin budget. */
export const MAX_TOTAL_MODULE_PROMPT_LENGTH = 8000

/** Build the system-prompt section for all trusted-module prompt fragments eligible for the given context. */
export function buildModulePromptSection(storageContextId: string): string {
  const sections: string[] = []
  let totalLength = 0

  for (const { moduleId, fragment } of modulePromptFragmentRegistry.list()) {
    if (!moduleEligibilityRegistry.isEligible(moduleId, storageContextId)) continue

    if (totalLength >= MAX_TOTAL_MODULE_PROMPT_LENGTH) {
      log.warn({ moduleId }, 'Total module prompt budget exceeded — stopping')
      break
    }

    let rawContent: string
    try {
      rawContent = typeof fragment.content === 'function' ? fragment.content() : fragment.content
    } catch (error) {
      log.warn(
        { moduleId, fragmentName: fragment.name, error: error instanceof Error ? error.message : String(error) },
        'Module prompt fragment threw — skipping',
      )
      continue
    }
    const truncated =
      rawContent.length > MAX_FRAGMENT_LENGTH_PER_MODULE
        ? rawContent.slice(0, MAX_FRAGMENT_LENGTH_PER_MODULE - '[truncated]'.length) + '[truncated]'
        : rawContent

    const section = `<!-- module:${moduleId}:${fragment.name} -->\n${truncated}\n<!-- /module:${moduleId}:${fragment.name} -->`
    sections.push(section)
    totalLength += section.length
  }

  return sections.join('\n\n')
}

/** Append the module prompt section to a base prompt, or return it unchanged when there is none. */
export function appendModulePromptSection(basePrompt: string, storageContextId: string): string {
  const section = buildModulePromptSection(storageContextId)
  if (section === '') return basePrompt
  return `${basePrompt}\n\n${section}`
}
