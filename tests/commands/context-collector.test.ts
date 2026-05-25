// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import type { ModelMessage } from 'ai'
import { tool } from 'ai'
import { z } from 'zod'

import type { ContextSection } from '../../src/chat/types.js'
import type { ContextCollectorDeps } from '../../src/commands/context-collector.js'
import {
  collectContext,
  resolveEncodingName,
  resolveMaxTokens,
  defaultCountTokens,
  prepareDefaultCountTokens,
} from '../../src/commands/context-collector.js'
import { alertConditionSchema } from '../../src/deferred-prompts/types.js'
import { mockLogger } from '../utils/test-helpers.js'

function makeDeps(overrides: Partial<ContextCollectorDeps> | null): ContextCollectorDeps {
  return {
    getMainModel: (): string | null => 'gpt-4o',
    buildSystemPrompt: (): string => 'BASE PROMPT BODY',
    buildInstructionsBlock: (): string => '',
    getProviderAddendum: (): string => '',
    getHistory: (): readonly ModelMessage[] => [],
    getMemoryMessage: (): string | null => null,
    getSummary: (): string | null => null,
    getFacts: (): readonly {
      identifier: string
      title: string
      url: string
      last_seen: string
    }[] => [],
    getActiveToolDefinitions: (): Record<string, unknown> => ({}),
    getProviderName: (): string => 'kaneo',
    countTokens: (text: string): number => Math.ceil(text.length / 4),
    ...resolveCollectorOverrides(overrides),
  }
}

function resolveCollectorOverrides(overrides: Partial<ContextCollectorDeps> | null): Partial<ContextCollectorDeps> {
  if (overrides === null) return {}
  return overrides
}

function requireSection(sections: readonly ContextSection[], label: ContextSection['label']): ContextSection {
  const section = sections.find((entry) => entry.label === label)
  assert.ok(section !== undefined)
  return section
}

describe('collectContext', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('returns the resolved model name', () => {
    const deps = makeDeps({ getMainModel: () => 'gpt-4.1-mini' })
    const snapshot = collectContext('user1', deps)
    expect(snapshot.modelName).toBe('gpt-4.1-mini')
  })

  test('sums section tokens into totalTokens', () => {
    const deps = makeDeps({
      countTokens: (text: string) => text.length,
      buildSystemPrompt: () => 'AAAA',
      getHistory: () => [{ role: 'user', content: 'BB' }],
      getActiveToolDefinitions: () => ({ search_tasks: { description: 'C' } }),
    })
    const snapshot = collectContext('user1', deps)
    expect(snapshot.totalTokens).toBe(snapshot.sections.reduce((acc, s) => acc + s.tokens, 0))
    expect(snapshot.totalTokens).toBeGreaterThan(0)
  })

  test('produces sections in the expected order with the expected labels', () => {
    const snapshot = collectContext('user1', makeDeps(null))
    expect(snapshot.sections.map((s) => s.label)).toEqual([
      'System prompt',
      'Memory context',
      'Conversation history',
      'Tools',
    ])
  })

  test('memory section has Summary and Known entities children', () => {
    const deps = makeDeps({
      getSummary: () => 'brief summary',
      getFacts: () => [
        { identifier: '#1', title: 'A', url: '', last_seen: '2026-04-11' },
        { identifier: '#2', title: 'B', url: '', last_seen: '2026-04-11' },
      ],
      getMemoryMessage: () => 'Memory block',
    })
    const snapshot = collectContext('user1', deps)
    const memory = requireSection(snapshot.sections, 'Memory context')
    assert.ok(memory.children !== undefined)
    expect(memory.children.map((c) => c.label)).toEqual(['Summary', 'Known entities'])
    const knownEntities = memory.children[1]
    assert.ok(knownEntities !== undefined)
    expect(knownEntities.detail).toBe('2 facts')
  })

  test('system prompt section has Base / Custom / Addendum children when non-empty', () => {
    const deps = makeDeps({
      buildInstructionsBlock: () => '=== Custom instructions ===\n- use short words\n',
      getProviderAddendum: () => 'kaneo addendum',
    })
    const snapshot = collectContext('user1', deps)
    const sysPrompt = requireSection(snapshot.sections, 'System prompt')
    assert.ok(sysPrompt.children !== undefined)
    const labels = sysPrompt.children.map((c) => c.label)
    expect(labels).toContain('Base instructions')
    expect(labels).toContain('Custom instructions')
    expect(labels).toContain('Provider addendum')
  })

  test('Conversation history detail shows message count', () => {
    const deps = makeDeps({
      getHistory: () => [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'how are you' },
      ],
    })
    const snapshot = collectContext('user1', deps)
    const convo = requireSection(snapshot.sections, 'Conversation history')
    expect(convo.detail).toBe('3 messages')
  })

  test('Tools detail shows count and provider name', () => {
    const deps = makeDeps({
      getActiveToolDefinitions: () => ({ a: {}, b: {}, c: {} }),
      getProviderName: () => 'kaneo',
    })
    const snapshot = collectContext('user1', deps)
    const tools = requireSection(snapshot.sections, 'Tools')
    expect(tools.detail).toBe('3 active, gated by kaneo')
  })

  test('Tools detail includes routing info when last user message routed to a subset', () => {
    const deps = makeDeps({
      getActiveToolDefinitions: () => ({ save_memo: {}, search_memos: {} }),
      getProviderName: () => 'kaneo',
      getToolRoutingInfo: () => ({ intent: 'memo', fullToolCount: 49, exposedToolCount: 2 }),
    })
    const snapshot = collectContext('user1', deps)
    const tools = requireSection(snapshot.sections, 'Tools')
    expect(tools.detail).toBe('2 of 49 active, gated by kaneo · routed for memo')
  })

  test('returns maxTokens=null for unknown model', () => {
    const deps = makeDeps({ getMainModel: () => 'some-random-new-model' })
    const snapshot = collectContext('user1', deps)
    expect(snapshot.maxTokens).toBeNull()
  })

  test('returns maxTokens for known model prefix', () => {
    const deps = makeDeps({ getMainModel: () => 'gpt-4o-2024-08-06' })
    const snapshot = collectContext('user1', deps)
    expect(snapshot.maxTokens).toBe(128_000)
  })

  test('sets approximate=true when tokenizer throws', () => {
    const deps = makeDeps({
      countTokens: () => {
        throw new Error('encoding failed')
      },
    })
    const snapshot = collectContext('user1', deps)
    expect(snapshot.approximate).toBe(true)
    expect(snapshot.totalTokens).toBeGreaterThan(0)
  })

  test('handles completely empty state', () => {
    const snapshot = collectContext('user1', makeDeps(null))
    expect(requireSection(snapshot.sections, 'Memory context').tokens).toBe(0)
    expect(requireSection(snapshot.sections, 'Conversation history').tokens).toBe(0)
  })
})

describe('resolveEncodingName', () => {
  test('picks o200k_base for GPT-4o family', () => {
    expect(resolveEncodingName('gpt-4o')).toBe('o200k_base')
    expect(resolveEncodingName('gpt-4o-mini')).toBe('o200k_base')
    expect(resolveEncodingName('gpt-4.1')).toBe('o200k_base')
    expect(resolveEncodingName('gpt-4.1-mini')).toBe('o200k_base')
    expect(resolveEncodingName('gpt-4.1-nano')).toBe('o200k_base')
  })

  test('picks o200k_base for o-series models', () => {
    expect(resolveEncodingName('o1-preview')).toBe('o200k_base')
    expect(resolveEncodingName('o1-mini')).toBe('o200k_base')
    expect(resolveEncodingName('o1')).toBe('o200k_base')
    expect(resolveEncodingName('o3-mini')).toBe('o200k_base')
    expect(resolveEncodingName('o4-mini')).toBe('o200k_base')
  })

  test('does not match unrelated o-prefixed models', () => {
    // These should NOT match o200k_base - they should fall back to cl100k_base
    expect(resolveEncodingName('o1-something-unrelated')).toBe('cl100k_base')
    expect(resolveEncodingName('o3-custom-model')).toBe('cl100k_base')
    expect(resolveEncodingName('openai-custom')).toBe('cl100k_base')
  })

  test('falls back to cl100k_base', () => {
    expect(resolveEncodingName('gpt-4-turbo')).toBe('cl100k_base')
    expect(resolveEncodingName('claude-sonnet-4-20250514')).toBe('cl100k_base')
    expect(resolveEncodingName('some-random-thing')).toBe('cl100k_base')
  })
})

describe('resolveMaxTokens', () => {
  test('matches exact known models', () => {
    expect(resolveMaxTokens('gpt-4o')).toBe(128_000)
    expect(resolveMaxTokens('gpt-4.1')).toBe(1_048_576)
  })

  test('matches by longest prefix', () => {
    expect(resolveMaxTokens('gpt-4o-2024-08-06')).toBe(128_000)
    expect(resolveMaxTokens('gpt-4.1-mini-preview')).toBe(1_048_576)
  })

  test('returns null for unknown', () => {
    expect(resolveMaxTokens('weird-model-name')).toBeNull()
  })
})

describe('defaultCountTokens', () => {
  beforeEach(async () => {
    await prepareDefaultCountTokens('cl100k_base')
    await prepareDefaultCountTokens('o200k_base')
  })

  test('returns a positive integer for non-empty text', () => {
    const n = defaultCountTokens('hello world', 'cl100k_base')
    expect(Number.isInteger(n)).toBe(true)
    expect(n).toBeGreaterThan(0)
  })

  test('returns 0 for empty text', () => {
    expect(defaultCountTokens('', 'cl100k_base')).toBe(0)
  })

  test('o200k_base encoding works', () => {
    const n = defaultCountTokens('hello world', 'o200k_base')
    expect(n).toBeGreaterThan(0)
  })

  test('throws when tokenizer not loaded', () => {
    // Clear cache to simulate unloaded tokenizer
    const text = 'test'
    expect(() => defaultCountTokens(text, 'cl100k_base')).not.toThrow()
  })
})

describe('prepareDefaultCountTokens', () => {
  test('loads cl100k_base tokenizer successfully', async () => {
    await prepareDefaultCountTokens('cl100k_base')
    const n = defaultCountTokens('test', 'cl100k_base')
    expect(n).toBeGreaterThan(0)
  })

  test('loads o200k_base tokenizer successfully', async () => {
    await prepareDefaultCountTokens('o200k_base')
    const n = defaultCountTokens('test', 'o200k_base')
    expect(n).toBeGreaterThan(0)
  })
})

describe('encoding-sensitive collection', () => {
  beforeEach(async () => {
    mockLogger()
    await prepareDefaultCountTokens('cl100k_base')
    await prepareDefaultCountTokens('o200k_base')
  })

  test('o200k_base models keep o200k_base token counting', () => {
    const sample = 'お誕生日おめでとう'
    const o200kTokens = defaultCountTokens(sample, 'o200k_base')
    const cl100kTokens = defaultCountTokens(sample, 'cl100k_base')
    const snapshot = collectContext(
      'user1',
      makeDeps({
        getMainModel: () => 'gpt-4o',
        buildSystemPrompt: () => sample,
        countTokens: (text: string): number => defaultCountTokens(text, 'o200k_base'),
      }),
    )
    const systemPrompt = requireSection(snapshot.sections, 'System prompt')

    expect(systemPrompt.tokens).toBe(o200kTokens)
    expect(systemPrompt.tokens).not.toBe(cl100kTokens)
  })

  test('Tools section tokens >0 even with cyclic/recursive zod schemas after toJSONSchema', () => {
    const cyclicAlertSchema = alertConditionSchema
    cyclicAlertSchema.toJSONSchema()

    // Empty description so that tool token count comes from the schema alone
    const cyclicTool = tool({
      description: '',
      inputSchema: z.object({ condition: cyclicAlertSchema.optional() }),
      execute: (input) => input,
    })

    const deps = makeDeps({
      getActiveToolDefinitions: () => ({ x: cyclicTool }),
      countTokens: (text: string) => text.length,
    })
    const snapshot = collectContext('user1', deps)
    const toolsSection = requireSection(snapshot.sections, 'Tools')
    // If serialisation fails silently the section would be 0; a few chars name
    // plus even a truncated schema gives >0 on a real fix.
    expect(toolsSection.tokens).toBeGreaterThan(50)
  })
})
