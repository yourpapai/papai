// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ruSystemPrompt } from '../../../src/i18n/locales/ru-system-prompt.js'
import type { Dictionary } from '../../../src/i18n/types.js'

describe('ruSystemPrompt fragment', () => {
  test('satisfies the Dictionary systemPrompt shape', () => {
    const fragment: Dictionary['systemPrompt'] = ruSystemPrompt
    expect(fragment).toBe(ruSystemPrompt)
  })

  test('pins the discovery protocol steps including the turn-expiry line', () => {
    const protocol = ruSystemPrompt.disclosureProtocol
    expect(protocol).toContain('1. Вызови search_tools')
    expect(protocol).toContain('2. Вызови load_tool')
    expect(protocol).toContain('3. Затем вызывай загруженные инструменты как обычно.')
    expect(protocol).toContain('действуют только до конца текущего хода')
    expect(protocol).toContain('вызови load_tool заново')
  })

  test('pins the always-available tool lines', () => {
    expect(ruSystemPrompt.disclosureAlwaysTools).toBe(
      'Всегда доступные инструменты: get_current_time, search_tools, load_tool.',
    )
    expect(ruSystemPrompt.disclosureAlwaysToolsWithExpand).toContain(
      'используй expand_result с его handle, чтобы прочитать продолжение',
    )
  })
})
