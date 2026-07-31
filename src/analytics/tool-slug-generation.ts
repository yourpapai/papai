// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Analytics tool slug descriptors: collects the closed set of first-party tool
 * slugs (core builtins, disclosure/compaction meta tools, and bundled plugin
 * tools declared in plugin manifests) and renders the checked-in generated
 * module. User MCP and external plugin tools are never collected — they map to
 * `external_other` at the analytics boundary.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { z } from 'zod'

import { namespacedToolName } from '../plugins/contribution-names.js'
import { BUILTIN_TOOL_NAMES } from '../tools/builtin-names.js'
import { META_TOOL_NAMES } from '../tools/disclosure/core.js'

const PluginManifestSchema = z.looseObject({
  id: z.string().min(1),
  contributes: z
    .looseObject({
      tools: z.array(z.string().min(1)).optional(),
    })
    .optional(),
})

const pluginsDirPath = (): string => fileURLToPath(new URL('../../plugins/', import.meta.url))

const collectPluginToolSlugs = (): string[] => {
  const slugs: string[] = []
  for (const entry of readdirSync(pluginsDirPath(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    let raw: string
    try {
      raw = readFileSync(join(pluginsDirPath(), entry.name, 'plugin.json'), 'utf8')
    } catch {
      continue
    }
    const parsed = PluginManifestSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) continue
    for (const toolName of parsed.data.contributes?.tools ?? []) {
      slugs.push(namespacedToolName(parsed.data.id, toolName))
    }
  }
  return slugs
}

/** Sorted, duplicate-free slug list for core + meta + bundled first-party plugin tools. */
export const collectAnalyticsToolSlugs = (): readonly string[] => {
  const all = new Set<string>([...BUILTIN_TOOL_NAMES, ...META_TOOL_NAMES, ...collectPluginToolSlugs()])
  return [...all].sort((left, right) => left.localeCompare(right))
}

const GENERATED_HEADER = `// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// GENERATED FILE — do not edit. Regenerate with: bun scripts/generate-analytics-tool-slugs.ts
`

/** Render the checked-in generated module byte-for-byte. */
export const renderToolSlugsModule = (slugs: readonly string[]): string => {
  const entries = slugs.map((slug) => `  '${slug}',`).join('\n')
  return `${GENERATED_HEADER}
export const EXTERNAL_OTHER_TOOL_SLUG = 'external_other'

export const KNOWN_TOOL_SLUGS = [
${entries}
] as const

export type KnownToolSlugName = (typeof KNOWN_TOOL_SLUGS)[number]

export const KNOWN_TOOL_SLUG_SET: ReadonlySet<string> = new Set(KNOWN_TOOL_SLUGS)
`
}

/** Map a registered tool name to its analytics slug; external/dynamic names collapse. */
export const resolveAnalyticsToolSlug = (toolName: string, knownSlugs: ReadonlySet<string>): string =>
  knownSlugs.has(toolName) ? toolName : 'external_other'
