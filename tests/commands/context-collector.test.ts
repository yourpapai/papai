import { describe, expect, test, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import type { ModelMessage } from 'ai'

import type { ContextCollectorDeps } from '../../src/commands/context-collector.js'
import {
  collectContext,
  resolveEncodingName,
  resolveMaxTokens,
  defaultCountTokens,
  prepareDefaultCountTokens,
} from '../../src/commands/context-collector.js'
import { mockLogger } from '../utils/test-helpers.js'

const makeDeps = (overrides: Partial<ContextCollectorDeps> = {}): ContextCollectorDeps => ({
  getMainModel: (): string | null => 'gpt-4o',
  buildSystemPrompt: (): string => 'BASE PROMPT BODY',
  buildInstructionsBlock: (): string => '',
  getProviderAddendum: (): string => '',
  getHistory: (): readonly ModelMessage[] => [],
  getMemoryMessage: (): string | null => null,
  getSummary: (): string | null => null,
  getFacts: (): readonly { identifier: string; title: string; url: string; last_seen: string }[] => [],
  getActiveToolDefinitions: (): Record<string, unknown> => ({}),
  getProviderName: (): string => 'kaneo',
  countTokens: (text: string): number => Math.ceil(text.length / 4),
  ...overrides,
})

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
    const snapshot = collectContext('user1', makeDeps())
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
    const memory = snapshot.sections.find((s) => s.label === 'Memory context')
    expect(memory).toBeDefined()
    expect(memory?.children?.map((c) => c.label)).toEqual(['Summary', 'Known entities'])
    expect(memory?.children?.[1]?.detail).toBe('2 facts')
  })

  test('system prompt section has Base / Custom / Addendum children when non-empty', () => {
    const deps = makeDeps({
      buildInstructionsBlock: () => '=== Custom instructions ===\n- use short words\n',
      getProviderAddendum: () => 'kaneo addendum',
    })
    const snapshot = collectContext('user1', deps)
    const sysPrompt = snapshot.sections.find((s) => s.label === 'System prompt')
    assert(sysPrompt !== undefined)
    assert(sysPrompt.children !== undefined)
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
    const convo = snapshot.sections.find((s) => s.label === 'Conversation history')
    expect(convo).toBeDefined()
    expect(convo?.detail).toBe('3 messages')
  })

  test('Tools detail shows count and provider name', () => {
    const deps = makeDeps({
      getActiveToolDefinitions: () => ({ a: {}, b: {}, c: {} }),
      getProviderName: () => 'kaneo',
    })
    const snapshot = collectContext('user1', deps)
    const tools = snapshot.sections.find((s) => s.label === 'Tools')
    expect(tools).toBeDefined()
    expect(tools?.detail).toBe('3 active, gated by kaneo')
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
    const snapshot = collectContext('user1', makeDeps())
    expect(snapshot.sections.find((s) => s.label === 'Memory context')?.tokens).toBe(0)
    expect(snapshot.sections.find((s) => s.label === 'Conversation history')?.tokens).toBe(0)
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
