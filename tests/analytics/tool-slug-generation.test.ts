// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  EXTERNAL_OTHER_TOOL_SLUG,
  KNOWN_TOOL_SLUG_SET,
  KNOWN_TOOL_SLUGS,
} from '../../src/analytics/generated/tool-slugs.js'
import {
  collectAnalyticsToolSlugs,
  renderToolSlugsModule,
  resolveAnalyticsToolSlug,
} from '../../src/analytics/tool-slug-generation.js'

describe('analytics tool slug generation', () => {
  test('collects core, meta, and bundled first-party plugin descriptors, sorted and duplicate-free', () => {
    const slugs = collectAnalyticsToolSlugs()
    expect(slugs.length).toBeGreaterThan(50)
    expect(new Set(slugs).size).toBe(slugs.length)
    const sorted = [...slugs].sort((left, right) => left.localeCompare(right))
    expect(slugs).toEqual(sorted)
    // Core builtins
    expect(slugs).toContain('create_task')
    expect(slugs).toContain('web_fetch')
    // Disclosure/compaction meta tools
    expect(slugs).toContain('search_tools')
    expect(slugs).toContain('load_tool')
    expect(slugs).toContain('expand_result')
    // Bundled first-party plugin tools (namespaced)
    expect(slugs).toContain('plugin_acp__start_session')
    expect(slugs).toContain('plugin_synthetic_web_search__search')
    expect(slugs).toContain('plugin_audio_transcribe__transcribe')
    // Dynamic external names are never collected
    expect(slugs.some((slug) => slug.startsWith('mcp_'))).toBe(false)
  })

  test('registry closure: the checked-in generated module matches a fresh generation', () => {
    expect([...KNOWN_TOOL_SLUGS].join('\n')).toBe([...collectAnalyticsToolSlugs()].join('\n'))
    const modulePath = fileURLToPath(new URL('../../src/analytics/generated/tool-slugs.ts', import.meta.url))
    const checkedIn = readFileSync(modulePath, 'utf8')
    expect(checkedIn).toBe(renderToolSlugsModule(collectAnalyticsToolSlugs()))
  })

  test('resolveAnalyticsToolSlug keeps first-party names and maps external names to external_other', () => {
    expect(resolveAnalyticsToolSlug('create_task', KNOWN_TOOL_SLUG_SET)).toBe('create_task')
    expect(resolveAnalyticsToolSlug('plugin_acp__start_session', KNOWN_TOOL_SLUG_SET)).toBe('plugin_acp__start_session')
    expect(resolveAnalyticsToolSlug('mcp_myserver__read_issue', KNOWN_TOOL_SLUG_SET)).toBe(EXTERNAL_OTHER_TOOL_SLUG)
    expect(resolveAnalyticsToolSlug('plugin_unknown__anything', KNOWN_TOOL_SLUG_SET)).toBe(EXTERNAL_OTHER_TOOL_SLUG)
    expect(resolveAnalyticsToolSlug('totally_unregistered', KNOWN_TOOL_SLUG_SET)).toBe(EXTERNAL_OTHER_TOOL_SLUG)
    expect(EXTERNAL_OTHER_TOOL_SLUG).toBe('external_other')
  })
})
