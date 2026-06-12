// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildAskToolsLine, buildUnavailableLine } from '../src/system-prompt-prefs.js'
import type { ToolPrefs } from '../src/tools/tool-preferences.js'

const prefs = (overrides: ToolPrefs['toolOverrides']): ToolPrefs => ({ domainDefaults: {}, toolOverrides: overrides })

describe('buildAskToolsLine', () => {
  test('lists ask-gated exposed tools sorted', () => {
    const line = buildAskToolsLine(
      prefs({ create_task: 'ask', web_fetch: 'ask' }),
      new Set(['create_task', 'web_fetch']),
    )
    expect(line).toContain('- create_task')
    expect(line).toContain('- web_fetch')
  })

  test('returns null when nothing is ask-gated', () => {
    expect(buildAskToolsLine(prefs({}), new Set(['create_task']))).toBeNull()
  })

  test('excludes injected disclosure meta-tools even with explicit ask overrides', () => {
    const line = buildAskToolsLine(
      prefs({ search_tools: 'ask', load_tool: 'ask', expand_result: 'ask' }),
      new Set(['search_tools', 'load_tool', 'expand_result']),
    )
    expect(line).toContain('- expand_result')
    expect(line).not.toContain('- search_tools')
    expect(line).not.toContain('- load_tool')
  })
})

describe('buildUnavailableLine', () => {
  test('lists partially-disabled domain tools', () => {
    const line = buildUnavailableLine(prefs({ delete_task: 'deny' }), new Set(['create_task', 'update_task']))
    expect(line).toContain('delete_task')
  })

  test('returns null when no partial disables', () => {
    expect(buildUnavailableLine(prefs({}), new Set(['create_task']))).toBeNull()
  })
})
