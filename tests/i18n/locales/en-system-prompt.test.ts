// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { enSystemPrompt } from '../../../src/i18n/locales/en-system-prompt.js'
import type { Dictionary } from '../../../src/i18n/types.js'

describe('enSystemPrompt fragment', () => {
  test('satisfies the Dictionary systemPrompt shape', () => {
    const fragment: Dictionary['systemPrompt'] = enSystemPrompt
    expect(fragment).toBe(enSystemPrompt)
  })

  test('pins the discovery protocol steps including the turn-expiry line', () => {
    const protocol = enSystemPrompt.disclosureProtocol
    expect(protocol).toContain('1. Call search_tools')
    expect(protocol).toContain('2. Call load_tool')
    expect(protocol).toContain('3. Then call the loaded tool(s) normally.')
    expect(protocol).toContain('Tool activations expire with the turn')
    expect(protocol).toContain('call load_tool again')
  })

  test('pins the always-available tool lines', () => {
    expect(enSystemPrompt.disclosureAlwaysTools).toBe(
      'Always-available tools: get_current_time, search_tools, load_tool.',
    )
    expect(enSystemPrompt.disclosureAlwaysToolsWithExpand).toContain('expand_result with its handle to read more')
  })
})
