// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  appendModulePromptSection,
  buildModulePromptSection,
  MAX_FRAGMENT_LENGTH_PER_MODULE,
} from '../../src/plugins/module-prompt-contributions.js'
import { modulePromptFragmentRegistry } from '../../src/ports/module-contributions.js'

afterEach(() => {
  modulePromptFragmentRegistry.clear()
})

describe('module prompt contributions', () => {
  test('wraps each fragment in a module: comment section', () => {
    modulePromptFragmentRegistry.register('coding', [{ name: 'acp-hint', content: 'use acp' }])
    const section = buildModulePromptSection()
    expect(section).toBe('<!-- module:coding:acp-hint -->\nuse acp\n<!-- /module:coding:acp-hint -->')
  })

  test('evaluates a thunk fragment', () => {
    modulePromptFragmentRegistry.register('coding', [{ name: 'f', content: (): string => 'dynamic' }])
    expect(buildModulePromptSection()).toContain('dynamic')
  })

  test('truncates an over-length fragment', () => {
    modulePromptFragmentRegistry.register('coding', [
      { name: 'big', content: 'x'.repeat(MAX_FRAGMENT_LENGTH_PER_MODULE + 500) },
    ])
    expect(buildModulePromptSection()).toContain('[truncated]')
  })

  test('appendModulePromptSection returns basePrompt unchanged when there are no fragments', () => {
    expect(appendModulePromptSection('BASE')).toBe('BASE')
  })

  test('appendModulePromptSection appends the section when fragments exist', () => {
    modulePromptFragmentRegistry.register('coding', [{ name: 'acp-hint', content: 'use acp' }])
    expect(appendModulePromptSection('BASE')).toBe(
      'BASE\n\n<!-- module:coding:acp-hint -->\nuse acp\n<!-- /module:coding:acp-hint -->',
    )
  })
})
