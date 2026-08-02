// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ModelMessage } from 'ai'
import { eq } from 'drizzle-orm'

import { conversationHistory } from '../src/db/schema.js'
import { createTrackedLoggerMock, type LogCall, type TrackedLoggerMock } from './utils/logger-mock.js'
import { setupTestDb } from './utils/test-helpers.js'

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
