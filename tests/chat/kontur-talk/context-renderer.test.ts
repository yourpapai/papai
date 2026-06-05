// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { renderKonturTalkContext } from '../../../plugins/chat-provider-kontur-talk/context-renderer.js'
import type { ContextSnapshot } from '../../../src/chat/types.js'

const makeSnapshot = (overrides?: Partial<ContextSnapshot>): ContextSnapshot => ({
  modelName: 'gpt-4',
  totalTokens: 1000,
  maxTokens: 8000,
  approximate: false,
  sections: [],
  ...overrides,
})

describe('renderKonturTalkContext', () => {
  test('returns formatted method', () => {
    const result = renderKonturTalkContext(makeSnapshot())
    expect(result.method).toBe('formatted')
  })

  test('includes model name and token count', () => {
    const result = renderKonturTalkContext(makeSnapshot())
    assert(result.method === 'formatted')
    expect(result.content).toContain('gpt-4')
    expect(result.content).toContain('1,000')
  })

  test('includes percentage when maxTokens is set', () => {
    const result = renderKonturTalkContext(makeSnapshot({ totalTokens: 4000, maxTokens: 8000 }))
    assert(result.method === 'formatted')
    expect(result.content).toContain('50.0%')
  })

  test('handles null maxTokens', () => {
    const result = renderKonturTalkContext(makeSnapshot({ maxTokens: null }))
    assert(result.method === 'formatted')
    expect(result.content).not.toContain('undefined')
  })
})
