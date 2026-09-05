// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { estimateMessagesTokens, estimateTokens, resolveMaxTokens } from '../src/model-context.js'
import { prewarmModelsDevSnapshot, resetModelsDevSnapshotForTest } from '../src/models-dev/client.js'

describe('resolveMaxTokens', () => {
  test('resolves known model families by prefix', () => {
    expect(resolveMaxTokens('gpt-4o-mini')).toBe(128_000)
    expect(resolveMaxTokens('claude-opus-4-8')).toBe(200_000)
  })

  test('returns null for unknown models', () => {
    expect(resolveMaxTokens('some-unknown-model')).toBeNull()
  })
})

describe('resolveMaxTokens with the catalogue snapshot', () => {
  afterEach(() => {
    resetModelsDevSnapshotForTest()
  })

  const seedSnapshot = async (providers: unknown): Promise<void> => {
    resetModelsDevSnapshotForTest()
    await prewarmModelsDevSnapshot({
      fetchImpl: () => Promise.resolve(JSON.stringify(providers)),
      cachePath: `/tmp/opencode/model-context-${crypto.randomUUID()}/models.json`,
      now: () => 1,
    })
  }

  test('uses the catalogue context window for a unique model name', async () => {
    await seedSnapshot({ acme: { models: { 'acme-ultra': { limit: { context: 123_456 } } } } })

    expect(resolveMaxTokens('acme-ultra')).toBe(123_456)
  })

  test('prefers the catalogue over the prefix table when both know the name', async () => {
    await seedSnapshot({ openai: { models: { 'gpt-4o-pro': { limit: { context: 999_999 } } } } })

    expect(resolveMaxTokens('gpt-4o-pro')).toBe(999_999)
  })

  test('uses the agreed window when several providers carry the same name', async () => {
    await seedSnapshot({
      alpha: { models: { 'shared-model': { limit: { context: 100_000 } } } },
      beta: { models: { 'shared-model': { limit: { context: 100_000 } } } },
    })

    expect(resolveMaxTokens('shared-model')).toBe(100_000)
  })

  test('falls back to the prefix table when catalogue matches disagree', async () => {
    await seedSnapshot({
      alpha: { models: { 'gpt-4o': { limit: { context: 111_111 } } } },
      beta: { models: { 'gpt-4o': { limit: { context: 222_222 } } } },
    })

    expect(resolveMaxTokens('gpt-4o')).toBe(128_000)
  })

  test('an empty snapshot leaves the prefix table unchanged', async () => {
    await seedSnapshot({})

    expect(resolveMaxTokens('gpt-4o')).toBe(128_000)
    expect(resolveMaxTokens('some-unknown-model')).toBeNull()
  })

  test('a catalogue entry without a context limit falls back to the prefix table', async () => {
    await seedSnapshot({ acme: { models: { 'gpt-4o-pro': {} } } })

    expect(resolveMaxTokens('gpt-4o-pro')).toBe(128_000)
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
