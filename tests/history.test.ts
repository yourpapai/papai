import { describe, expect, test, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import type { ModelMessage } from 'ai'
import { eq } from 'drizzle-orm'

import { getCachedHistory, _userCaches } from '../src/cache.js'
import * as schema from '../src/db/schema.js'
import { appendHistory, loadHistory, saveHistory, clearHistory } from '../src/history.js'
import { flushMicrotasks, mockLogger, setupTestDb } from './utils/test-helpers.js'

beforeEach(() => {
  mockLogger()
})

describe('loadHistory', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    testDb = await setupTestDb()
  })

  test('returns empty array when no row exists', () => {
    const result = loadHistory('999')
    expect(result).toEqual([])
  })

  test('returns deserialised messages for valid row', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]
    testDb
      .insert(schema.conversationHistory)
      .values({ userId: '1', messages: JSON.stringify(messages) })
      .run()

    const result = loadHistory('1')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ role: 'user', content: 'hello' })
    expect(result[1]).toEqual({ role: 'assistant', content: 'hi there' })
  })

  test('returns empty array for corrupt JSON', () => {
    testDb.insert(schema.conversationHistory).values({ userId: '2', messages: 'not-valid-json' }).run()

    const result = loadHistory('2')
    expect(result).toEqual([])
  })

  test('returns empty array when messages lack role field', () => {
    testDb
      .insert(schema.conversationHistory)
      .values({ userId: '3', messages: JSON.stringify([{ content: 'no role' }]) })
      .run()

    const result = loadHistory('3')
    expect(result).toEqual([])
  })

  test('strips unknown fields not in ModelMessage schema', () => {
    // modelMessageSchema uses Zod which strips unrecognised properties — unknown
    // keys like `toolCalls` (not part of AssistantModelMessage in SDK v6) are dropped.
    const messages = [{ role: 'assistant', content: 'hi', unknownField: 'value' }]
    testDb
      .insert(schema.conversationHistory)
      .values({ userId: '4', messages: JSON.stringify(messages) })
      .run()

    const result = loadHistory('4')
    expect(result).toHaveLength(1)
    const first = result[0]
    expect(first).toBeDefined()
    expect(first?.content).toBe('hi')
  })

  test('returns messages when content is an array (tool call / tool result messages)', () => {
    // The Vercel AI SDK uses array content for tool calls and tool results.
    // Regression: the previous custom validator required content to be a string,
    // causing the entire history to be dropped after cache eviction whenever
    // tool-calling had occurred in the conversation.
    const messages = [
      { role: 'user', content: 'what tasks do I have?' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'list_tasks', args: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tc1',
            toolName: 'list_tasks',
            output: { type: 'json', value: [] },
          },
        ],
      },
      { role: 'assistant', content: 'You have no tasks.' },
    ]
    testDb
      .insert(schema.conversationHistory)
      .values({ userId: '5', messages: JSON.stringify(messages) })
      .run()

    const result = loadHistory('5')
    expect(result).toHaveLength(4)

    // Verify assistant message has tool-call content
    const assistantMsg = result[1]
    expect(assistantMsg).toBeDefined()
    const assistantContent = assistantMsg?.content
    assert(Array.isArray(assistantContent))
    expect(assistantContent).toHaveLength(1)
    // Verify structure of first item in array content
    expect(assistantContent[0]).toMatchObject({ type: 'tool-call', toolCallId: 'tc1', toolName: 'list_tasks' })

    // Verify tool message has tool-result content
    const toolMsg = result[2]
    expect(toolMsg).toBeDefined()
    const toolContent = toolMsg?.content
    assert(Array.isArray(toolContent))
    expect(toolContent).toHaveLength(1)
    // Verify structure of first item in array content
    expect(toolContent[0]).toMatchObject({ type: 'tool-result', toolCallId: 'tc1', toolName: 'list_tasks' })
  })

  test('rejects messages where content is neither string nor array', () => {
    const messages = [{ role: 'user', content: 42 }]
    testDb
      .insert(schema.conversationHistory)
      .values({ userId: '6', messages: JSON.stringify(messages) })
      .run()

    const result = loadHistory('6')
    expect(result).toEqual([])
  })
})

describe('saveHistory', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    testDb = await setupTestDb()
  })

  test('persists messages as JSON', async () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'test' }]
    saveHistory('10', messages)

    // Wait for background DB sync
    await flushMicrotasks()

    const row = testDb
      .select()
      .from(schema.conversationHistory)
      .where(eq(schema.conversationHistory.userId, '10'))
      .get()
    expect(row).toBeDefined()
    expect(JSON.parse(row!.messages)).toEqual(messages)
  })

  test('calls INSERT OR REPLACE', async () => {
    const empty: ModelMessage[] = []
    saveHistory('10', empty)

    // Wait for background DB sync
    await flushMicrotasks()

    const row = testDb
      .select()
      .from(schema.conversationHistory)
      .where(eq(schema.conversationHistory.userId, '10'))
      .get()
    expect(row).toBeDefined()
    expect(row!.userId).toBe('10')
  })
})

describe('clearHistory', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    testDb = await setupTestDb()
  })

  test('removes entry from store', () => {
    testDb
      .insert(schema.conversationHistory)
      .values({ userId: '20', messages: JSON.stringify([]) })
      .run()
    clearHistory('20')
    const row = testDb
      .select()
      .from(schema.conversationHistory)
      .where(eq(schema.conversationHistory.userId, '20'))
      .get()
    expect(row).toBeUndefined()
  })

  test('calls DELETE statement', () => {
    clearHistory('20')
    const row = testDb
      .select()
      .from(schema.conversationHistory)
      .where(eq(schema.conversationHistory.userId, '20'))
      .get()
    expect(row).toBeUndefined()
  })
})

describe('appendHistory', () => {
  beforeEach(async () => {
    await setupTestDb()
    _userCaches.clear()
  })

  test('appends messages to empty history', () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'hello' }]
    appendHistory('append-1', messages)
    const result = getCachedHistory('append-1')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ role: 'user', content: 'hello' })
  })

  test('appends to existing history', () => {
    saveHistory('append-2', [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
    ])
    appendHistory('append-2', [{ role: 'user', content: 'third' }])
    const result = getCachedHistory('append-2')
    expect(result).toHaveLength(3)
    expect(result[0]!.content).toBe('first')
    expect(result[1]!.content).toBe('second')
    expect(result[2]!.content).toBe('third')
  })

  test('preserves message types (user, assistant, tool)', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'tc1', toolName: 'test', output: { type: 'text', value: 'ok' } }],
      },
    ]
    appendHistory('append-3', messages)
    const result = getCachedHistory('append-3')
    expect(result).toHaveLength(3)
    expect(result[0]!.role).toBe('user')
    expect(result[1]!.role).toBe('assistant')
    expect(result[2]!.role).toBe('tool')
  })
})

describe('getCachedHistory cold-cache behavior', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    testDb = await setupTestDb()
    // Clear all caches to ensure cold state
    _userCaches.clear()
  })

  test('loads messages from DB when cache is cold and DB has data', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]
    testDb
      .insert(schema.conversationHistory)
      .values({ userId: 'user1', messages: JSON.stringify(messages) })
      .run()

    const result = getCachedHistory('user1')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ role: 'user', content: 'hello' })
    expect(result[1]).toEqual({ role: 'assistant', content: 'hi there' })
  })

  test('returns empty array when cache is cold and DB has no data', () => {
    const result = getCachedHistory('user2')
    expect(result).toEqual([])
  })

  test('does not query DB again on second call after cold load', () => {
    const messages = [{ role: 'user', content: 'test' }]
    testDb
      .insert(schema.conversationHistory)
      .values({ userId: 'user3', messages: JSON.stringify(messages) })
      .run()

    // First call loads from DB
    const result1 = getCachedHistory('user3')
    expect(result1).toHaveLength(1)

    // Update DB directly (bypass cache) - need to update since primary key exists
    const newMessages = [{ role: 'user', content: 'modified' }]
    testDb
      .update(schema.conversationHistory)
      .set({ messages: JSON.stringify(newMessages) })
      .where(eq(schema.conversationHistory.userId, 'user3'))
      .run()

    // Second call should return cached result, not DB update
    const result2 = getCachedHistory('user3')
    expect(result2).toHaveLength(1)
    expect(result2[0]!.content).toBe('test')
  })

  // Story 1 AC Test: "Continuing from previous session"
  test('Story 1: continuing from previous session', async () => {
    const userId = 'story1-user'
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Create a task for the mobile app' },
      { role: 'assistant', content: 'I have created task #42 for the mobile app.' },
    ]

    // Simulate first session: save history
    saveHistory(userId, messages)
    await flushMicrotasks()

    // Simulate session end: clear cache (simulating bot restart)
    _userCaches.clear()

    // Simulate new session: load history
    const loadedMessages = loadHistory(userId)

    // Verify history is preserved across sessions
    expect(loadedMessages).toHaveLength(2)
    expect(loadedMessages[0]).toEqual(messages[0])
    expect(loadedMessages[1]).toEqual(messages[1])
  })
})
