// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mock, describe, expect, test, beforeEach, afterEach, spyOn } from 'bun:test'

import type { ModelMessage } from 'ai'

import { enableByokForContext, updateByokLlmConfig } from '../src/byok-llm/store.js'
import * as cacheModule from '../src/cache.js'
import { shouldTriggerTrim, buildMessagesWithMemory, runTrimInBackground } from '../src/conversation.js'
import { logger } from '../src/logger.js'
import * as longTermMemoryStore from '../src/long-term-memory/store.js'
import { saveMemoryProfile, saveMemoryRecord } from '../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../src/long-term-memory/types.js'
import * as systemConfigModule from '../src/system-config.js'
import { flushMicrotasks, resetSystemConfigCacheForTesting, setupTestDb } from './utils/test-helpers.js'

// Helper type for spy instances that need cleanup
type SpyInstance = { mockRestore: () => void }

// Mock lookup helpers — defined outside test blocks to satisfy no-conditional-in-test
function mockConfigLookup(
  mockConfigs: Map<string, Map<string, string | null>>,
): (userId: string, key: string) => string | null {
  return (userId: string, key: string): string | null => mockConfigs.get(userId)?.get(key) ?? null
}

function mockHistoryLookup(mockHistories: Map<string, ModelMessage[]>): (userId: string) => ModelMessage[] {
  return (userId: string): ModelMessage[] => mockHistories.get(userId) ?? []
}

function makeSystemConfigLookup(
  configs: Map<string, Map<string, string | null>>,
  userKey: string,
): (key: string) => string | null {
  return (key: string): string | null => configs.get(userKey)?.get(key) ?? null
}

// Define local type and mutable implementation BEFORE mocking
type GenerateTextResult = { text: string }
const defaultGenerateTextImpl = (): Promise<GenerateTextResult> =>
  Promise.resolve({
    text: JSON.stringify({ keep_indices: [0, 1], summary: 'Updated summary text' }),
  })

const memoryRecordInput = (overrides: Partial<MemoryRecordInput>): MemoryRecordInput => ({
  id: 'mem-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'preference',
  content: 'User prefers concise implementation plans.',
  summary: 'Concise plans',
  tags: ['style'],
  confidence: 0.9,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-12T00:00:00.000Z',
  ...overrides,
})

describe('shouldTriggerTrim', () => {
  const makeMessages = (count: number, userEvery = 2): ModelMessage[] =>
    Array.from({ length: count }, (_, i) => ({
      role: i % userEvery === 0 ? ('user' as const) : ('assistant' as const),
      content: `Message ${i}`,
    }))

  test('returns false for 0, 1, 49 messages', () => {
    expect(shouldTriggerTrim([])).toBe(false)
    expect(shouldTriggerTrim(makeMessages(1))).toBe(false)
    expect(shouldTriggerTrim(makeMessages(49))).toBe(false)
  })

  test('returns false when user message count is exactly divisible by 10 but history length is <= TRIM_MIN (50)', () => {
    const messages = makeMessages(20)
    expect(shouldTriggerTrim(messages)).toBe(false)
  })

  test('returns true when user message count is a multiple of 10 AND history length > 50 (periodic trigger)', () => {
    const messages = makeMessages(60, 2)
    expect(shouldTriggerTrim(messages)).toBe(true)
  })

  test('returns true when history length >= 100 (WORKING_MEMORY_CAP) regardless of user message count', () => {
    const messages = makeMessages(100, 10)
    expect(shouldTriggerTrim(messages)).toBe(true)
  })

  test('returns false for 51 messages that are all assistant (no user messages)', () => {
    const messages = Array.from({ length: 51 }, (_, i) => ({
      role: 'assistant' as const,
      content: `Assistant message ${i}`,
    }))
    expect(shouldTriggerTrim(messages)).toBe(false)
  })

  test('returns false for exactly 50 messages with 25 user messages (boundary)', () => {
    const messages = makeMessages(50)
    // 50 messages with userEvery=2 → 25 user messages
    // 50 > TRIM_MIN(50) is false (strict greater), so periodic cannot trigger
    expect(shouldTriggerTrim(messages)).toBe(false)
  })

  test('returns false for 51 messages with 26 user messages (not divisible by 10)', () => {
    const messages = makeMessages(51)
    // 51 messages with userEvery=2 → 26 user messages
    // 26 % 10 !== 0, so periodic is false. 51 < 100 so hard cap is false.
    expect(shouldTriggerTrim(messages)).toBe(false)
  })

  test('returns true for 51 messages with 20 user messages (periodic trigger at boundary)', () => {
    // Create 51 messages where exactly 20 are 'user' and 31 are 'assistant'
    const messages: ModelMessage[] = []
    for (let i = 0; i < 20; i++) {
      messages.push({ role: 'user', content: `User msg ${i}` })
    }
    for (let i = 0; i < 31; i++) {
      messages.push({ role: 'assistant', content: `Asst msg ${i}` })
    }
    // Verify: 20 user messages, 51 total, 20 % 10 === 0, 51 > 50
    const actualUserCount = messages.filter((m) => m.role === 'user').length
    expect(actualUserCount).toBe(20)
    expect(shouldTriggerTrim(messages)).toBe(true)
  })
})

describe('shouldTriggerTrim — token-based triggering', () => {
  // 55 messages → 28 user (28 % 10 !== 0) and length < 100, so the message-count
  // triggers are all false; only the token budget can fire.
  const sizedMessages = (count: number, contentLen: number): ModelMessage[] =>
    Array.from({ length: count }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: 'x'.repeat(contentLen),
    }))

  test('fires when estimated tokens exceed the model budget', () => {
    // 55 × ~6000 chars ≈ 82k tokens > 0.5 × 128k (gpt-4o) = 64k
    expect(shouldTriggerTrim(sizedMessages(55, 6000), 'gpt-4o')).toBe(true)
  })

  test('does not fire for small histories under the token budget', () => {
    expect(shouldTriggerTrim(sizedMessages(55, 4), 'gpt-4o')).toBe(false)
  })

  test('does not fire without a model name (backwards compatible)', () => {
    expect(shouldTriggerTrim(sizedMessages(55, 6000))).toBe(false)
  })

  test('does not fire for an unknown model with no known context window', () => {
    expect(shouldTriggerTrim(sizedMessages(55, 6000), 'mystery-model')).toBe(false)
  })

  test('does not fire when there are too few messages to shed (<= TRIM_MIN)', () => {
    // 40 huge messages: over budget by tokens, but trimming cannot reduce below them.
    expect(shouldTriggerTrim(sizedMessages(40, 10_000), 'gpt-4o')).toBe(false)
  })
})

describe('buildMessagesWithMemory', () => {
  const mockSummaries = new Map<string, string>()
  const mockFacts = new Map<string, Array<{ identifier: string; title: string; url: string; last_seen: string }>>()
  let getCachedSummarySpy: ReturnType<typeof spyOn<typeof cacheModule, 'getCachedSummary'>>
  let getCachedFactsSpy: ReturnType<typeof spyOn<typeof cacheModule, 'getCachedFacts'>>

  beforeEach(async () => {
    await setupTestDb()
    mockSummaries.clear()
    mockFacts.clear()
    getCachedSummarySpy = spyOn(cacheModule, 'getCachedSummary').mockReturnValue(null)
    getCachedFactsSpy = spyOn(cacheModule, 'getCachedFacts').mockReturnValue([])
  })

  afterEach(() => {
    getCachedSummarySpy.mockRestore()
    getCachedFactsSpy.mockRestore()
  })

  test('returns history unchanged when no summary and no facts', () => {
    const history: ModelMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]

    const result = buildMessagesWithMemory('user1', history)

    expect(result.messages).toEqual(history)
    expect(result.memoryMsg).toBeNull()
  })

  test('prepends system message with summary when summary is present', () => {
    const history: ModelMessage[] = [{ role: 'user', content: 'Hello' }]
    mockSummaries.set('user1', 'User worked on mobile app project')

    getCachedSummarySpy.mockReturnValue(mockSummaries.get('user1')!)

    const result = buildMessagesWithMemory('user1', history)

    expect(result.messages).toHaveLength(2)
    const firstMsg = result.messages[0]!
    expect(firstMsg.role).toBe('system')
    expect(firstMsg.content).toContain('User worked on mobile app project')
  })

  test('prepends system message with facts when facts are present', () => {
    const history: ModelMessage[] = [{ role: 'user', content: 'Hello' }]
    mockFacts.set('user1', [
      { identifier: '#42', title: 'Fix login bug', url: '', last_seen: new Date().toISOString() },
    ])

    getCachedFactsSpy.mockReturnValue(mockFacts.get('user1')!)

    const result = buildMessagesWithMemory('user1', history)

    expect(result.messages).toHaveLength(2)
    const firstMsg = result.messages[0]!
    expect(firstMsg.role).toBe('system')
    expect(firstMsg.content).toContain('#42')
  })

  test('prepends single system message with both summary and facts when both present', () => {
    const history: ModelMessage[] = [{ role: 'user', content: 'Hello' }]
    mockSummaries.set('user1', 'User worked on mobile app project')
    mockFacts.set('user1', [
      { identifier: '#42', title: 'Fix login bug', url: '', last_seen: new Date().toISOString() },
    ])

    getCachedSummarySpy.mockReturnValue(mockSummaries.get('user1')!)
    getCachedFactsSpy.mockReturnValue(mockFacts.get('user1')!)

    const result = buildMessagesWithMemory('user1', history)

    expect(result.messages).toHaveLength(2)
    const systemMsg = result.messages[0]!
    expect(systemMsg.role).toBe('system')
    expect(systemMsg.content).toContain('User worked on mobile app project')
    expect(systemMsg.content).toContain('#42')
  })

  test('prepends one system message containing compacted and long-term memory when both are present', () => {
    const history: ModelMessage[] = []
    const summary = 'User worked on mobile app project'
    getCachedSummarySpy.mockReturnValue(summary)
    saveMemoryProfile(
      { scopeId: 'user-1', scopeType: 'personal' },
      '## Communication\n- Prefer concise answers',
      '2026-06-12T00:00:00.000Z',
    )
    saveMemoryRecord(
      memoryRecordInput({
        id: 'mem-direct',
        content: 'User prefers direct status reports.',
        summary: 'Direct status reports',
      }),
    )

    const result = buildMessagesWithMemory('user-1', history)

    expect(result.messages).toHaveLength(1)
    const systemMsg = result.messages[0]!
    expect(systemMsg.role).toBe('system')
    expect(systemMsg.content).toContain('<memory trust="compacted_low">')
    expect(systemMsg.content).toContain('<long_term_memory trust="profile_and_retrieved_low">')
    expect(systemMsg.content).toContain(summary)
    expect(systemMsg.content).toContain('Prefer concise answers')
    expect(result.memoryMsg).not.toBeNull()
    expect(result.messages[0]).toEqual(result.memoryMsg!)
  })

  test('loads at most three active long-term memory records', () => {
    const listMemoryRecordsSpy = spyOn(longTermMemoryStore, 'listMemoryRecords')

    try {
      buildMessagesWithMemory('user-1', [])

      expect(listMemoryRecordsSpy).toHaveBeenCalledWith({
        scopeId: 'user-1',
        scopeType: 'personal',
        status: 'active',
        limit: 3,
      })
    } finally {
      listMemoryRecordsSpy.mockRestore()
    }
  })

  test('does not mutate original history array', () => {
    const history: ModelMessage[] = [{ role: 'user', content: 'Hello' }]
    mockSummaries.set('user1', 'Summary text')

    getCachedSummarySpy.mockReturnValue(mockSummaries.get('user1')!)

    const originalLength = history.length
    buildMessagesWithMemory('user1', history)

    expect(history).toHaveLength(originalLength)
    expect(history[0]).toEqual({ role: 'user', content: 'Hello' })
  })
})

describe('runTrimInBackground', () => {
  const mockSummaries = new Map<string, string>()
  const mockHistories = new Map<string, ModelMessage[]>()
  const mockConfigs = new Map<string, Map<string, string | null>>()
  const modelBuildCalls: Array<{ apiKey: string; baseUrl: string; modelName: string }> = []
  const spies: SpyInstance[] = []

  const spySystemConfigFromMockConfigs = (): void => {
    const spy = spyOn(systemConfigModule, 'getSystemConfig').mockImplementation(
      makeSystemConfigLookup(mockConfigs, 'user1'),
    )
    spies.push(spy)
  }
  let generateTextImpl = defaultGenerateTextImpl

  function trackSpy<T extends SpyInstance>(spy: T): T {
    spies.push(spy)
    return spy
  }

  beforeEach(async () => {
    await setupTestDb()
    resetSystemConfigCacheForTesting()
    generateTextImpl = defaultGenerateTextImpl
    mockSummaries.clear()
    mockHistories.clear()
    mockConfigs.clear()
    modelBuildCalls.length = 0
    void mock.module('ai', () => ({
      generateText: (..._args: unknown[]): Promise<GenerateTextResult> => generateTextImpl(),
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible:
        (opts: { apiKey: string; baseURL: string }): ((_model: string) => string) =>
        (modelName: string): string => {
          modelBuildCalls.push({ apiKey: opts.apiKey, baseUrl: opts.baseURL, modelName })
          return 'mock-model'
        },
    }))
  })

  afterEach(() => {
    for (const spy of spies) {
      spy.mockRestore()
    }
    spies.length = 0
  })

  test('success path: calls trimWithMemoryModel, saves summary, and updates history', async () => {
    const history: ModelMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'How are you?' },
    ]
    mockHistories.set('user1', [...history])
    mockConfigs.set(
      'user1',
      new Map([
        ['llm_apikey', 'test-key'],
        ['llm_baseurl', 'http://test.com'],
        ['main_model', 'main-model'],
        ['small_model', 'test-model'],
      ]),
    )

    trackSpy(spyOn(cacheModule, 'getCachedConfig').mockImplementation(mockConfigLookup(mockConfigs)))
    spySystemConfigFromMockConfigs()
    trackSpy(spyOn(cacheModule, 'getCachedHistory').mockImplementation(mockHistoryLookup(mockHistories)))
    trackSpy(
      spyOn(cacheModule, 'setCachedHistory').mockImplementation((userId: string, messages: readonly ModelMessage[]) => {
        mockHistories.set(userId, [...messages])
      }),
    )
    trackSpy(
      spyOn(cacheModule, 'setCachedSummary').mockImplementation((userId: string, summary: string) => {
        mockSummaries.set(userId, summary)
      }),
    )
    trackSpy(spyOn(cacheModule, 'getCachedSummary').mockReturnValue(null))

    await runTrimInBackground('user1', history)
    await flushMicrotasks()

    expect(mockSummaries.get('user1')).toBe('Updated summary text')
  })

  test('uses BYOK small model for supplied config context', async () => {
    const history: ModelMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'How are you?' },
    ]
    mockHistories.set('user1', [...history])
    updateByokLlmConfig(
      'ctx-byok-trim',
      {
        llm_apikey: 'sk-byok-trim',
        llm_baseurl: 'https://byok-trim.invalid/v1',
        main_model: 'byok-main-trim',
        small_model: 'byok-small-trim',
      },
      'admin-1',
    )

    trackSpy(spyOn(cacheModule, 'getCachedHistory').mockImplementation(mockHistoryLookup(mockHistories)))
    trackSpy(
      spyOn(cacheModule, 'setCachedHistory').mockImplementation((userId: string, messages: readonly ModelMessage[]) => {
        mockHistories.set(userId, [...messages])
      }),
    )
    trackSpy(
      spyOn(cacheModule, 'setCachedSummary').mockImplementation((userId: string, summary: string) => {
        mockSummaries.set(userId, summary)
      }),
    )
    trackSpy(spyOn(cacheModule, 'getCachedSummary').mockReturnValue(null))

    await runTrimInBackground('user1', history, undefined, 'ctx-byok-trim')
    await flushMicrotasks()

    expect(modelBuildCalls).toEqual([
      {
        apiKey: 'sk-byok-trim',
        baseUrl: 'https://byok-trim.invalid/v1',
        modelName: 'byok-small-trim',
      },
    ])
    expect(mockSummaries.get('user1')).toBe('Updated summary text')
  })

  test('skips incomplete BYOK without falling back to global config or mutating history', async () => {
    const history: ModelMessage[] = [{ role: 'user', content: 'Hello' }]
    mockHistories.set('user1', [...history])
    enableByokForContext('ctx-byok-incomplete-trim', 'admin-1')
    resetSystemConfigCacheForTesting()
    systemConfigModule.setSystemConfig('llm_apikey', 'sk-global-trim', 'env')
    systemConfigModule.setSystemConfig('llm_baseurl', 'https://global-trim.invalid/v1', 'env')
    systemConfigModule.setSystemConfig('main_model', 'global-main-trim', 'env')
    systemConfigModule.setSystemConfig('small_model', 'global-small-trim', 'env')
    let historyWrites = 0

    trackSpy(spyOn(cacheModule, 'getCachedHistory').mockImplementation(mockHistoryLookup(mockHistories)))
    trackSpy(
      spyOn(cacheModule, 'setCachedHistory').mockImplementation((userId: string, messages: readonly ModelMessage[]) => {
        historyWrites += 1
        mockHistories.set(userId, [...messages])
      }),
    )
    trackSpy(spyOn(cacheModule, 'setCachedSummary').mockImplementation(() => {}))

    await runTrimInBackground('user1', history, undefined, 'ctx-byok-incomplete-trim')
    await flushMicrotasks()

    expect(modelBuildCalls).toHaveLength(0)
    expect(historyWrites).toBe(0)
    expect(mockHistories.get('user1')).toEqual(history)
  })

  test('preserves new messages added during async trim', async () => {
    const history: ModelMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]
    mockHistories.set('user1', [...history])
    mockConfigs.set(
      'user1',
      new Map([
        ['llm_apikey', 'test-key'],
        ['llm_baseurl', 'http://test.com'],
        ['main_model', 'main-model'],
        ['small_model', 'test-model'],
      ]),
    )

    // Inject the new message unconditionally on the first (and only) generateText call
    mockHistories.set('user1', [...history, { role: 'user', content: 'New message during trim' }])
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ text: JSON.stringify({ keep_indices: [0], summary: 'Trimmed' }) })

    trackSpy(spyOn(cacheModule, 'getCachedConfig').mockImplementation(mockConfigLookup(mockConfigs)))
    spySystemConfigFromMockConfigs()
    trackSpy(spyOn(cacheModule, 'getCachedHistory').mockImplementation(mockHistoryLookup(mockHistories)))
    trackSpy(
      spyOn(cacheModule, 'setCachedHistory').mockImplementation((userId: string, messages: readonly ModelMessage[]) => {
        mockHistories.set(userId, [...messages])
      }),
    )
    trackSpy(spyOn(cacheModule, 'setCachedSummary').mockImplementation(() => {}))
    trackSpy(spyOn(cacheModule, 'getCachedSummary').mockReturnValue(null))

    await runTrimInBackground('user1', history)
    await flushMicrotasks()

    const finalHistory = mockHistories.get('user1')
    expect(finalHistory).toBeDefined()
    expect(finalHistory!.length).toBeGreaterThanOrEqual(1)
  })

  test('config-missing path: logs warning and returns without calling trim', async () => {
    const history: ModelMessage[] = [{ role: 'user', content: 'Hello' }]
    mockHistories.set('user1', [...history])

    trackSpy(spyOn(cacheModule, 'getCachedConfig').mockReturnValue(null))
    trackSpy(spyOn(systemConfigModule, 'getSystemConfig').mockReturnValue(null))
    trackSpy(spyOn(logger, 'warn').mockImplementation(() => {}))

    await runTrimInBackground('user1', history)
    await flushMicrotasks()
  })

  test('handles trimWithMemoryModel failure gracefully', async () => {
    const history: ModelMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]
    mockHistories.set('user1', [...history])
    mockConfigs.set(
      'user1',
      new Map([
        ['llm_apikey', 'test-key'],
        ['llm_baseurl', 'http://test.com'],
        ['main_model', 'main-model'],
        ['small_model', 'test-model'],
      ]),
    )

    generateTextImpl = (): Promise<GenerateTextResult> => Promise.reject(new Error('LLM API error'))

    trackSpy(spyOn(cacheModule, 'getCachedConfig').mockImplementation(mockConfigLookup(mockConfigs)))
    spySystemConfigFromMockConfigs()
    trackSpy(spyOn(cacheModule, 'getCachedHistory').mockImplementation(mockHistoryLookup(mockHistories)))
    trackSpy(spyOn(cacheModule, 'setCachedHistory').mockImplementation(() => {}))
    trackSpy(spyOn(cacheModule, 'getCachedSummary').mockReturnValue(null))
    trackSpy(spyOn(logger, 'warn').mockImplementation(() => {}))

    await runTrimInBackground('user1', history)
    await flushMicrotasks()

    expect(mockHistories.get('user1')).toEqual(history)
  })

  test('concurrent calls for same user — both complete without corruption', async () => {
    const history1: ModelMessage[] = [
      { role: 'user', content: 'First conversation' },
      { role: 'assistant', content: 'Response 1' },
    ]
    const history2: ModelMessage[] = [
      { role: 'user', content: 'Second conversation' },
      { role: 'assistant', content: 'Response 2' },
    ]

    const concurrentHistories = new Map<string, ModelMessage[]>()
    const concurrentConfigs = new Map<string, Map<string, string | null>>()
    concurrentHistories.set('user1', [...history1])
    concurrentConfigs.set(
      'user1',
      new Map([
        ['llm_apikey', 'test-key'],
        ['llm_baseurl', 'http://test.com'],
        ['main_model', 'main-model'],
        ['small_model', 'test-model'],
      ]),
    )

    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({
        text: JSON.stringify({ keep_indices: [0], summary: 'Concurrent trim summary' }),
      })

    trackSpy(spyOn(cacheModule, 'getCachedConfig').mockImplementation(mockConfigLookup(concurrentConfigs)))
    trackSpy(
      spyOn(systemConfigModule, 'getSystemConfig').mockImplementation(
        makeSystemConfigLookup(concurrentConfigs, 'user1'),
      ),
    )
    trackSpy(spyOn(cacheModule, 'getCachedHistory').mockImplementation(mockHistoryLookup(concurrentHistories)))
    trackSpy(
      spyOn(cacheModule, 'setCachedHistory').mockImplementation((userId: string, messages: readonly ModelMessage[]) => {
        concurrentHistories.set(userId, [...messages])
      }),
    )
    trackSpy(spyOn(cacheModule, 'setCachedSummary').mockImplementation(() => {}))
    trackSpy(spyOn(cacheModule, 'getCachedSummary').mockReturnValue(null))

    // Fire both concurrently
    await Promise.all([runTrimInBackground('user1', history1), runTrimInBackground('user1', history2)])
    await flushMicrotasks()

    // Neither should throw; final history is valid
    const finalHistory = concurrentHistories.get('user1')
    expect(finalHistory).toBeDefined()
    expect(Array.isArray(finalHistory)).toBe(true)
  })

  test('concurrency guard: skips a second trim while one is in flight, then releases', async () => {
    const history: ModelMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]
    const histories = new Map<string, ModelMessage[]>([['user1', [...history]]])
    const configs = new Map<string, Map<string, string | null>>([
      [
        'user1',
        new Map([
          ['llm_apikey', 'test-key'],
          ['llm_baseurl', 'http://test.com'],
          ['main_model', 'main-model'],
          ['small_model', 'test-model'],
        ]),
      ],
    ])

    let releaseFirst: (value: GenerateTextResult) => void = () => {}
    const gate = new Promise<GenerateTextResult>((resolve) => {
      releaseFirst = resolve
    })
    const done = Promise.resolve({ text: JSON.stringify({ keep_indices: [0], summary: 's' }) })
    // First model call blocks on the gate; the later (post-release) call resolves immediately.
    const queued: Array<Promise<GenerateTextResult>> = [gate, done, done, done]
    generateTextImpl = (): Promise<GenerateTextResult> => queued.shift()!

    trackSpy(spyOn(cacheModule, 'getCachedConfig').mockImplementation(mockConfigLookup(configs)))
    trackSpy(spyOn(systemConfigModule, 'getSystemConfig').mockImplementation(makeSystemConfigLookup(configs, 'user1')))
    trackSpy(spyOn(cacheModule, 'getCachedHistory').mockImplementation(mockHistoryLookup(histories)))
    trackSpy(
      spyOn(cacheModule, 'setCachedHistory').mockImplementation((userId: string, messages: readonly ModelMessage[]) => {
        histories.set(userId, [...messages])
      }),
    )
    trackSpy(spyOn(cacheModule, 'setCachedSummary').mockImplementation(() => {}))
    trackSpy(spyOn(cacheModule, 'getCachedSummary').mockReturnValue(null))

    // First trim starts and blocks on the gated model call.
    const first = runTrimInBackground('user1', history)
    await flushMicrotasks()
    // Second trim while the first is in flight is skipped (no second model build).
    await runTrimInBackground('user1', history)
    expect(modelBuildCalls).toHaveLength(1)

    // Release the first; once it finishes the guard is released and a later trim runs.
    releaseFirst({ text: JSON.stringify({ keep_indices: [0], summary: 's' }) })
    await first
    await flushMicrotasks()

    await runTrimInBackground('user1', history)
    await flushMicrotasks()
    expect(modelBuildCalls).toHaveLength(2)
  })
})

describe('Story 3: Context retained at message 50+', () => {
  const makeMessagePairs = (count: number): ModelMessage[] =>
    Array.from({ length: count * 2 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `Message ${i}`,
    }))

  test('shouldTriggerTrim returns true at 55 message pairs (110 messages)', () => {
    const history = makeMessagePairs(55)
    expect(history).toHaveLength(110)
    expect(shouldTriggerTrim(history)).toBe(true)
  })

  test('shouldTriggerTrim returns false at 49 message pairs (98 messages)', () => {
    const history = makeMessagePairs(49)
    expect(history).toHaveLength(98)
    expect(shouldTriggerTrim(history)).toBe(false)
  })
})

describe('Story 5: Summary injected into context', () => {
  const mockSummaries = new Map<string, string>()
  const mockFacts = new Map<string, Array<{ identifier: string; title: string; url: string; last_seen: string }>>()
  let getCachedSummarySpy: ReturnType<typeof spyOn<typeof cacheModule, 'getCachedSummary'>>
  let getCachedFactsSpy: ReturnType<typeof spyOn<typeof cacheModule, 'getCachedFacts'>>

  beforeEach(async () => {
    await setupTestDb()
    mockSummaries.clear()
    mockFacts.clear()
    getCachedSummarySpy = spyOn(cacheModule, 'getCachedSummary').mockReturnValue(null)
    getCachedFactsSpy = spyOn(cacheModule, 'getCachedFacts').mockReturnValue([])
  })

  afterEach(() => {
    getCachedSummarySpy.mockRestore()
    getCachedFactsSpy.mockRestore()
  })

  test('buildMessagesWithMemory includes summary in system message for LLM context', () => {
    const history: ModelMessage[] = [{ role: 'user', content: 'What were we working on?' }]
    const summary = 'User worked on mobile app project'
    mockSummaries.set('user1', summary)

    getCachedSummarySpy.mockReturnValue(summary)

    const result = buildMessagesWithMemory('user1', history)

    expect(result.messages).toHaveLength(2)
    const systemMsg = result.messages[0]!
    expect(systemMsg.role).toBe('system')
    expect(systemMsg.content).toContain(summary)
    expect(result.memoryMsg).toBeDefined()
    expect(result.memoryMsg!.content).toContain(summary)
  })

  test('LLM would have access to summary when responding to "what were we working on?"', () => {
    const history: ModelMessage[] = [{ role: 'user', content: 'What were we working on?' }]
    mockSummaries.set('user1', 'User was working on task #42: Fix login bug in the mobile app')

    getCachedSummarySpy.mockReturnValue(mockSummaries.get('user1')!)

    const result = buildMessagesWithMemory('user1', history)

    const systemMsg = result.messages[0]!
    expect(systemMsg.content).toContain('Fix login bug')
    expect(systemMsg.content).toContain('#42')
  })
})
