// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { subscribe, unsubscribe, type DebugEvent } from '../../src/debug/event-bus.js'
import { logBuffer, logBufferStream, LogRingBuffer, type LogEntry } from '../../src/debug/log-buffer.js'

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

describe('search', () => {
  test('filters by minimum level', () => {
    const buf = new LogRingBuffer(10)
    buf.push(makeEntry({ level: 20, msg: 'debug' }))
    buf.push(makeEntry({ level: 30, msg: 'info' }))
    buf.push(makeEntry({ level: 50, msg: 'error' }))

    const results = buf.search({ level: 30 })
    expect(results).toHaveLength(2)
    expect(results[0]!.msg).toBe('info')
    expect(results[1]!.msg).toBe('error')
  })

  test('filters by exact scope', () => {
    const buf = new LogRingBuffer(10)
    buf.push(makeEntry({ scope: 'bot', msg: 'bot msg' }))
    buf.push(makeEntry({ scope: 'llm-orch', msg: 'llm msg' }))

    const results = buf.search({ scope: 'llm-orch' })
    expect(results).toHaveLength(1)
    expect(results[0]!.msg).toBe('llm msg')
  })

  test('filters by text (case-insensitive substring)', () => {
    const buf = new LogRingBuffer(10)
    buf.push(makeEntry({ msg: 'Calling generateText' }))
    buf.push(makeEntry({ msg: 'Task created' }))

    const results = buf.search({ q: 'generatetext' })
    expect(results).toHaveLength(1)
    expect(results[0]!.msg).toBe('Calling generateText')
  })

  test('combines filters with AND', () => {
    const buf = new LogRingBuffer(10)
    buf.push(makeEntry({ level: 30, scope: 'bot', msg: 'received message' }))
    buf.push(makeEntry({ level: 30, scope: 'llm-orch', msg: 'calling generateText' }))
    buf.push(makeEntry({ level: 50, scope: 'llm-orch', msg: 'error in generateText' }))

    const results = buf.search({ level: 40, scope: 'llm-orch' })
    expect(results).toHaveLength(1)
    expect(results[0]!.msg).toBe('error in generateText')
  })

  test('filters by turnId', () => {
    const buf = new LogRingBuffer(10)
    buf.push(makeEntry({ msg: 'msg-a', turnId: 'turn-1' }))
    buf.push(makeEntry({ msg: 'msg-b', turnId: 'turn-2' }))
    buf.push(makeEntry({ msg: 'msg-c', turnId: 'turn-1' }))

    const results = buf.search({ turnId: 'turn-1' })
    expect(results).toHaveLength(2)
    expect(results[0]!.msg).toBe('msg-a')
    expect(results[1]!.msg).toBe('msg-c')
  })

  test('turnId filter combines with other filters', () => {
    const buf = new LogRingBuffer(10)
    buf.push(makeEntry({ level: 30, msg: 'info-a', turnId: 'turn-1' }))
    buf.push(makeEntry({ level: 50, msg: 'error-a', turnId: 'turn-1' }))
    buf.push(makeEntry({ level: 50, msg: 'error-b', turnId: 'turn-2' }))

    const results = buf.search({ level: 40, turnId: 'turn-1' })
    expect(results).toHaveLength(1)
    expect(results[0]!.msg).toBe('error-a')
  })

  test('respects limit (returns last N)', () => {
    const buf = new LogRingBuffer(10)
    for (let i = 0; i < 5; i++) {
      buf.push(makeEntry({ msg: `msg-${i}` }))
    }

    const results = buf.search({ limit: 2 })
    expect(results).toHaveLength(2)
    expect(results[0]!.msg).toBe('msg-3')
    expect(results[1]!.msg).toBe('msg-4')
  })

  test('defaults to limit 100', () => {
    const buf = new LogRingBuffer(200)
    for (let i = 0; i < 150; i++) {
      buf.push(makeEntry({ msg: `msg-${i}` }))
    }

    const results = buf.search({})
    expect(results).toHaveLength(100)
  })

  test('returns empty array on empty buffer', () => {
    const buf = new LogRingBuffer(10)
    expect(buf.search({})).toEqual([])
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
      buf.push(makeEntry({ msg: 'test event' }))

      expect(captured).not.toBeNull()
      expect(captured!.type).toBe('log:entry')
      expect(captured!.data['msg']).toBe('test event')
    } finally {
      unsubscribe(listener)
    }
  })
})
