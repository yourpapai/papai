// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { subscribe, unsubscribe, type DebugEvent } from '../../src/debug/event-bus.js'
import { logBuffer, logBufferStream, LogRingBuffer, shapeLogEntry, type LogEntry } from '../../src/debug/log-buffer.js'

const makeEntry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
  level: 30,
  time: new Date().toISOString(),
  msg: 'test message',
  ...overrides,
})

describe('LogRingBuffer', () => {
  test('push and retrieve single entry', () => {
    const buf = new LogRingBuffer(10)
    const entry = makeEntry()
    buf.push(entry)

    expect(buf.entries()).toHaveLength(1)
    expect(buf.entries()[0]).toEqual(entry)
  })

  test('entries returns chronological order', () => {
    const buf = new LogRingBuffer(10)
    const e1 = makeEntry({ msg: 'first' })
    const e2 = makeEntry({ msg: 'second' })
    buf.push(e1)
    buf.push(e2)

    const all = buf.entries()
    expect(all[0]!.msg).toBe('first')
    expect(all[1]!.msg).toBe('second')
  })

  test('wraps around when capacity exceeded', () => {
    const buf = new LogRingBuffer(3)
    buf.push(makeEntry({ msg: 'a' }))
    buf.push(makeEntry({ msg: 'b' }))
    buf.push(makeEntry({ msg: 'c' }))
    buf.push(makeEntry({ msg: 'd' }))

    const all = buf.entries()
    expect(all).toHaveLength(3)
    expect(all[0]!.msg).toBe('b')
    expect(all[1]!.msg).toBe('c')
    expect(all[2]!.msg).toBe('d')
  })

  test('wraps around multiple times', () => {
    const buf = new LogRingBuffer(3)
    for (let i = 0; i < 10; i++) {
      buf.push(makeEntry({ msg: `msg-${i}` }))
    }

    const all = buf.entries()
    expect(all).toHaveLength(3)
    expect(all[0]!.msg).toBe('msg-7')
    expect(all[1]!.msg).toBe('msg-8')
    expect(all[2]!.msg).toBe('msg-9')
  })

  test('clear resets buffer', () => {
    const buf = new LogRingBuffer(10)
    buf.push(makeEntry())
    buf.push(makeEntry())
    buf.clear()

    expect(buf.entries()).toHaveLength(0)
    expect(buf.stats().count).toBe(0)
  })
})

describe('stats', () => {
  test('returns zeros and nulls for empty buffer', () => {
    const buf = new LogRingBuffer(10)
    expect(buf.stats()).toEqual({ count: 0, capacity: 10, oldest: null, newest: null })
  })

  test('returns correct metadata', () => {
    const buf = new LogRingBuffer(10)
    buf.push(makeEntry({ time: '2026-03-28T10:00:00.000Z' }))
    buf.push(makeEntry({ time: '2026-03-28T10:00:01.000Z' }))

    const s = buf.stats()
    expect(s.count).toBe(2)
    expect(s.capacity).toBe(10)
    expect(s.oldest).toBe('2026-03-28T10:00:00.000Z')
    expect(s.newest).toBe('2026-03-28T10:00:01.000Z')
  })

  test('reflects wrap-around correctly', () => {
    const buf = new LogRingBuffer(3)
    buf.push(makeEntry({ time: '2026-03-28T10:00:00.000Z' }))
    buf.push(makeEntry({ time: '2026-03-28T10:00:01.000Z' }))
    buf.push(makeEntry({ time: '2026-03-28T10:00:02.000Z' }))
    buf.push(makeEntry({ time: '2026-03-28T10:00:03.000Z' }))

    const s = buf.stats()
    expect(s.count).toBe(3)
    expect(s.oldest).toBe('2026-03-28T10:00:01.000Z')
    expect(s.newest).toBe('2026-03-28T10:00:03.000Z')
  })
})

describe('logBufferStream', () => {
  afterEach(() => {
    logBuffer.clear()
  })

  test('write parses JSON and pushes to default buffer', () => {
    const entry = { level: 30, time: '2026-03-28T10:00:00.000Z', msg: 'hello' }
    logBufferStream.write(JSON.stringify(entry) + '\n')

    const all = logBuffer.entries()
    expect(all).toHaveLength(1)
    expect(all[0]!.msg).toBe('hello')
  })

  test('write skips malformed JSON silently', () => {
    logBufferStream.write('not json\n')
    expect(logBuffer.entries()).toHaveLength(0)
  })
})

describe('SSE emission', () => {
  test('push emits log:entry on event bus', () => {
    let captured: DebugEvent | null = null
    const listener = (event: DebugEvent): void => {
      captured = event
    }
    subscribe(listener)

    try {
      const buf = new LogRingBuffer(10)
      buf.push(makeEntry({ msg: 'Message received from user' }))

      expect(captured).not.toBeNull()
      expect(captured!.type).toBe('log:entry')
      expect(captured!.data['msg']).toBe('Message received from user')
    } finally {
      unsubscribe(listener)
    }
  })
})

describe('log:entry emit (unredacted)', () => {
  test('emits the full entry verbatim and keeps it in the buffer', () => {
    const buf = new LogRingBuffer(10)
    const events: DebugEvent[] = []
    const listener = (e: DebugEvent): void => {
      events.push(e)
    }
    subscribe(listener)
    try {
      buf.push(
        makeEntry({
          msg: 'searchTasks called',
          userText: 'secret',
          scope: 'bot',
          messageLength: 6,
        }),
      )
    } finally {
      unsubscribe(listener)
    }

    expect(events).toHaveLength(1)
    expect(events[0]!.data['userText']).toBe('secret')
    expect(events[0]!.data['msg']).toBe('searchTasks called')
    expect(events[0]!.data['messageLength']).toBe(6)
    // Buffer still retains the full entry
    expect(buf.entries()[0]).toHaveProperty('userText', 'secret')
  })
})

describe('LogRingBuffer filtering', () => {
  const at = (t: string, o: Partial<LogEntry> = {}): LogEntry => ({ level: 30, time: t, msg: 'm', ...o })

  test('distinctScopes returns sorted scope + counts, skips scope-less', () => {
    const buf = new LogRingBuffer(10)
    buf.push(at('t1', { scope: 'b' }))
    buf.push(at('t2', { scope: 'a' }))
    buf.push(at('t3', { scope: 'a' }))
    buf.push(at('t4'))
    expect(buf.distinctScopes()).toEqual([
      { scope: 'a', count: 2 },
      { scope: 'b', count: 1 },
    ])
  })
})

describe('shapeLogEntry', () => {
  test('keeps level, time, msg, scope and turnId', () => {
    const entry = makeEntry({
      scope: 'bot',
      turnId: 'turn-1',
      userText: 'find my tasks',
      chatUserId: 'user-7',
      err: { message: 'boom' },
    })

    expect(shapeLogEntry(entry)).toEqual({
      level: 30,
      time: entry.time,
      msg: 'test message',
      scope: 'bot',
      turnId: 'turn-1',
    })
  })

  test('keeps additional keys with number or boolean values', () => {
    const entry = makeEntry({ durationMs: 42, retried: true, attempt: 2, cached: false })

    expect(shapeLogEntry(entry)).toEqual({
      level: 30,
      time: entry.time,
      msg: 'test message',
      durationMs: 42,
      retried: true,
      attempt: 2,
      cached: false,
    })
  })

  test('drops additional keys with string, object, array or null values', () => {
    const entry = makeEntry({
      scope: 'llm-orch',
      userText: 'secret',
      chatUserId: 'user-7',
      err: { message: 'boom' },
      toolNames: ['searchTasks', 'createTask'],
      lastPrompt: null,
    })

    expect(shapeLogEntry(entry)).toEqual({
      level: 30,
      time: entry.time,
      msg: 'test message',
      scope: 'llm-orch',
    })
  })

  test('does not invent missing optional fields', () => {
    const shaped = shapeLogEntry(makeEntry({ durationMs: 5 }))

    expect('scope' in shaped).toBe(false)
    expect('turnId' in shaped).toBe(false)
  })

  test('does not mutate the input entry', () => {
    const entry = makeEntry({ userText: 'secret', err: { message: 'boom' }, durationMs: 3 })
    const snapshot = structuredClone(entry)

    shapeLogEntry(entry)

    expect(entry).toEqual(snapshot)
  })

  test('is idempotent on already-shaped entries', () => {
    const entry = makeEntry({
      scope: 'bot',
      turnId: 'turn-9',
      userText: 'secret',
      durationMs: 7,
      cached: false,
      err: { message: 'boom' },
    })

    const shapedOnce = shapeLogEntry(entry)
    const shapedTwice = shapeLogEntry(shapedOnce)

    expect(shapedTwice).toEqual(shapedOnce)
  })
})
