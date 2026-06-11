// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { estimateMessagesTokens, estimateTokens, resolveMaxTokens } from '../src/model-context.js'

describe('resolveMaxTokens', () => {
  test('resolves known model families by prefix', () => {
    expect(resolveMaxTokens('gpt-4o-mini')).toBe(128_000)
    expect(resolveMaxTokens('claude-opus-4-8')).toBe(200_000)
  })

  test('returns null for unknown models', () => {
    expect(resolveMaxTokens('some-unknown-model')).toBeNull()
  })
})

describe('estimateTokens', () => {
  test('returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0)
  })

  test('approximates at roughly four characters per token', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100)
  })
})

describe('estimateMessagesTokens', () => {
  test('counts serialized string content', () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'a'.repeat(396) }]
    // "user: " (6) + 396 chars = 402 → ceil(402 / 4) = 101
    expect(estimateMessagesTokens(messages)).toBe(101)
  })

  test('serializes structured (non-string) content', () => {
    const messages: ModelMessage[] = [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'x', toolName: 'get_task', input: {} }] },
    ]
    expect(estimateMessagesTokens(messages)).toBeGreaterThan(0)
  })
})
