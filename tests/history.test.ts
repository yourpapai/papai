// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ModelMessage } from 'ai'
import { eq } from 'drizzle-orm'

import { getCachedHistory, userCachesForTesting } from '../src/cache.js'
import { conversationHistory } from '../src/db/schema.js'
import * as schema from '../src/db/schema.js'
import { appendHistory, clearHistory, loadHistory, saveHistory } from '../src/history.js'
import { createTrackedLoggerMock, type LogCall, type TrackedLoggerMock } from './utils/logger-mock.js'
import { flushMicrotasks, mockLogger, setupTestDb } from './utils/test-helpers.js'

type HistoryModule = typeof import('../src/history.js')

const isHistoryModule = (value: unknown): value is HistoryModule =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'clearHistory') === 'function'

// src/history.ts binds `logger.child({ scope: 'history' })` at module-eval time.
// A static import would capture the real logger before the per-test mock is
// registered, so install the mock and force a fresh evaluation with a
// cache-busting query (mirrors tests/startup-helpers.test.ts).
async function loadHistoryModule(tracked: TrackedLoggerMock): Promise<HistoryModule> {
  void mock.module('../src/logger.js', () => ({
    getLogLevel: tracked.getLogLevel,
    logger: tracked.logger,
  }))
  const loaded: unknown = await import(`../src/history.js?t=${crypto.randomUUID()}`)
  if (!isHistoryModule(loaded)) {
    throw new Error('history module did not export expected shape')
  }
  return loaded
}

function findCall(tracked: TrackedLoggerMock, level: LogCall['level'], message: string): LogCall | undefined {
  return tracked.getCallsByLevel(level).find((call) => call.args[1] === message)
}

const makeUserMsg = (messageId: string, text: string): ModelMessage =>
  ({
    role: 'user',
    content: text,
    providerOptions: {
      papai: {
        messageIds: [messageId],
        segments: [{ messageId, text, username: null }],
        isThread: false,
        isDm: true,
      },
    },
  }) as ModelMessage

describe('history log contracts and clearHistory', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('clearHistory clears the cache, deletes the DB row, and logs both lines', async () => {
    const tracked = createTrackedLoggerMock()
    const history = await loadHistoryModule(tracked)
    history.appendHistory('ctx-clear', [makeUserMsg('m1', 'hello')])
    await Promise.resolve()

    const before = db.select().from(conversationHistory).where(eq(conversationHistory.userId, 'ctx-clear')).get()
    expect(before).toBeDefined()

    history.clearHistory('ctx-clear')

    expect(history.loadHistory('ctx-clear')).toEqual([])
    // Assert before the queued setCachedHistory microtask re-inserts an empty row.
    const after = db.select().from(conversationHistory).where(eq(conversationHistory.userId, 'ctx-clear')).get()
    expect(after).toBeUndefined()

    const debugCall = findCall(tracked, 'debug', 'clearHistory called')
    expect(debugCall?.args[0]).toEqual({ userId: 'ctx-clear' })
    const infoCall = findCall(tracked, 'info', 'History cleared')
    expect(infoCall?.args[0]).toEqual({ userId: 'ctx-clear' })
  })

  test('loadHistory logs the lookup with userId', async () => {
    const tracked = createTrackedLoggerMock()
    const history = await loadHistoryModule(tracked)

    history.loadHistory('ctx-load')

    const call = findCall(tracked, 'debug', 'loadHistory called')
    expect(call?.args[0]).toEqual({ userId: 'ctx-load' })
  })

  test('saveHistory logs debug and info with the message count', async () => {
    const tracked = createTrackedLoggerMock()
    const history = await loadHistoryModule(tracked)

    history.saveHistory('ctx-save', [makeUserMsg('m1', 'hello')])

    const debugCall = findCall(tracked, 'debug', 'saveHistory called')
    expect(debugCall?.args[0]).toEqual({ userId: 'ctx-save', messageCount: 1 })
    const infoCall = findCall(tracked, 'info', 'History saved to cache (DB sync in background)')
    expect(infoCall?.args[0]).toEqual({ userId: 'ctx-save', messageCount: 1 })
  })

  test('appendHistory logs the append count', async () => {
    const tracked = createTrackedLoggerMock()
    const history = await loadHistoryModule(tracked)

    history.appendHistory('ctx-append', [makeUserMsg('m1', 'hello')])

    const call = findCall(tracked, 'debug', 'appendHistory called')
    expect(call?.args[0]).toEqual({ userId: 'ctx-append', appendCount: 1 })
  })

  test('binds the history child logger with its scope', async () => {
    const tracked = createTrackedLoggerMock()
    await loadHistoryModule(tracked)

    expect(tracked.logger.child).toHaveBeenCalledWith({ scope: 'history' })
  })

  test('applyEditToHistory logs the rewrite on a hit', async () => {
    const tracked = createTrackedLoggerMock()
    const history = await loadHistoryModule(tracked)
    history.appendHistory('ctx-edit-hit', [makeUserMsg('m1', 'hello')])

    expect(history.applyEditToHistory('ctx-edit-hit', 'm1', 'hello (edited)')).toBe(true)

    const call = findCall(tracked, 'info', 'applyEditToHistory: user turn rewritten')
    expect(call?.args[0]).toEqual({ contextId: 'ctx-edit-hit', messageId: 'm1' })
  })

  test('applyEditToHistory logs the miss when no turn carries the messageId', async () => {
    const tracked = createTrackedLoggerMock()
    const history = await loadHistoryModule(tracked)

    expect(history.applyEditToHistory('ctx-edit-miss', 'missing', 'x')).toBe(false)

    const call = findCall(tracked, 'debug', 'applyEditToHistory: messageId not found in any user turn')
    expect(call?.args[0]).toEqual({ contextId: 'ctx-edit-miss', messageId: 'missing' })
  })

  test('trimTurnForRegeneration logs the removed count on a hit', async () => {
    const tracked = createTrackedLoggerMock()
    const history = await loadHistoryModule(tracked)
    history.appendHistory('ctx-trim-hit', [
      makeUserMsg('m0', 'earlier turn'),
      { role: 'assistant', content: 'earlier answer' } as ModelMessage,
      makeUserMsg('m1', 'hello'),
      { role: 'assistant', content: 'old answer' } as ModelMessage,
      { role: 'tool', content: [] } as ModelMessage,
    ])

    expect(history.trimTurnForRegeneration('ctx-trim-hit', 'm1')).toBe(true)

    const call = findCall(tracked, 'info', 'trimTurnForRegeneration: trailing turn removed for regeneration')
    expect(call?.args[0]).toEqual({ contextId: 'ctx-trim-hit', messageId: 'm1', removedCount: 3 })
  })

  test('trimTurnForRegeneration logs the miss when no turn carries the messageId', async () => {
    const tracked = createTrackedLoggerMock()
    const history = await loadHistoryModule(tracked)

    expect(history.trimTurnForRegeneration('ctx-trim-miss', 'missing')).toBe(false)

    const call = findCall(tracked, 'debug', 'trimTurnForRegeneration: originating user message not found')
    expect(call?.args[0]).toEqual({ contextId: 'ctx-trim-miss', messageId: 'missing' })
  })
})

describe('history cache + DB persistence behavior', () => {
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
          content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'list_tasks', input: {} }],
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
      expect(assistantContent[0]).toMatchObject({
        type: 'tool-call',
        toolCallId: 'tc1',
        toolName: 'list_tasks',
      })

      // Verify tool message has tool-result content
      const toolMsg = result[2]
      expect(toolMsg).toBeDefined()
      const toolContent = toolMsg?.content
      assert(Array.isArray(toolContent))
      expect(toolContent).toHaveLength(1)
      // Verify structure of first item in array content
      expect(toolContent[0]).toMatchObject({
        type: 'tool-result',
        toolCallId: 'tc1',
        toolName: 'list_tasks',
      })
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
      userCachesForTesting.clear()
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
          content: [
            {
              type: 'tool-result',
              toolCallId: 'tc1',
              toolName: 'test',
              output: { type: 'text', value: 'ok' },
            },
          ],
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
      userCachesForTesting.clear()
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
      userCachesForTesting.clear()

      // Simulate new session: load history
      const loadedMessages = loadHistory(userId)

      // Verify history is preserved across sessions
      expect(loadedMessages).toHaveLength(2)
      expect(loadedMessages[0]).toEqual(messages[0])
      expect(loadedMessages[1]).toEqual(messages[1])
    })
  })
})
