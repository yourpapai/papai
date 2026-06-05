// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { renderMattermostContext } from '../../../plugins/chat-provider-mattermost/context-renderer.js'
import { standardContextSnapshot } from '../fixtures/context-snapshot.js'

describe('renderMattermostContext', () => {
  test('returns a formatted method result', () => {
    const result = renderMattermostContext(standardContextSnapshot)
    expect(result.method).toBe('formatted')
  })

  test('contains bold header with model and usage', () => {
    const result = renderMattermostContext(standardContextSnapshot)
    assert(result.method === 'formatted')
    expect(result.content).toContain('**Context**')
    expect(result.content).toContain('gpt-4o')
    expect(result.content).toContain('6,770')
    expect(result.content).toContain('128,000')
  })

  test('contains a markdown table', () => {
    const result = renderMattermostContext(standardContextSnapshot)
    assert(result.method === 'formatted')
    expect(result.content).toContain('| Section')
    expect(result.content).toContain('| ------ | ------')
  })

  test('table rows use section emojis', () => {
    const result = renderMattermostContext(standardContextSnapshot)
    assert(result.method === 'formatted')
    expect(result.content).toContain('| 🟦 **System prompt**')
    expect(result.content).toContain('| 🟩 **Memory context**')
    expect(result.content).toContain('| 🟨 **Conversation history**')
    expect(result.content).toContain('| 🟪 **Tools**')
  })

  test('contains the emoji grid', () => {
    const result = renderMattermostContext(standardContextSnapshot)
    assert(result.method === 'formatted')
    expect(result.content).toContain('🟦')
    expect(result.content).toContain('⬜')
  })

  test('notes approximate counts when applicable', () => {
    const result = renderMattermostContext({ ...standardContextSnapshot, approximate: true })
    assert(result.method === 'formatted')
    expect(result.content).toMatch(/_token counts are approximate_/iu)
  })
})
