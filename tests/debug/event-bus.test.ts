// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, mock, test } from 'bun:test'

import { emitGlobal, emitUser, subscribe, unsubscribe, type DebugEvent } from '../../src/debug/event-bus.js'

describe('event-bus', () => {
  const listeners: Array<(event: DebugEvent) => void> = []

  afterEach(() => {
    for (const fn of listeners) unsubscribe(fn)
    listeners.length = 0
  })

  const track = (fn: (event: DebugEvent) => void): typeof fn => {
    listeners.push(fn)
    return fn
  }

  test('emitGlobal with no listeners is a no-op', () => {
    expect(() => emitGlobal('test', { key: 'value' })).not.toThrow()
  })

  test('subscribe + emitGlobal delivers event to listener', () => {
    let received: DebugEvent | null = null
    subscribe(
      track((e) => {
        received = e
      }),
    )

    emitGlobal('test:event', { foo: 'bar' })

    expect(received).not.toBeNull()
    expect(received!.type).toBe('test:event')
    expect(received!.data).toEqual({ foo: 'bar' })
    expect(received!.__scope).toEqual({ kind: 'global' })
  })

  test('event has correct shape with auto-populated timestamp', () => {
    let captured: DebugEvent | null = null
    subscribe(
      track((e) => {
        captured = e
      }),
    )

    const before = Date.now()
    emitGlobal('shape:test', { x: 1 })
    const after = Date.now()

    expect(captured).not.toBeNull()
    expect(captured!.type).toBe('shape:test')
    expect(captured!.timestamp).toBeGreaterThanOrEqual(before)
    expect(captured!.timestamp).toBeLessThanOrEqual(after)
    expect(captured!.data).toEqual({ x: 1 })
  })

  test('multiple listeners all receive the event', () => {
    const listener1 = mock(() => {})
    const listener2 = mock(() => {})
    subscribe(track(listener1))
    subscribe(track(listener2))

    emitGlobal('multi', {})

    expect(listener1).toHaveBeenCalledTimes(1)
    expect(listener2).toHaveBeenCalledTimes(1)
  })

  test('unsubscribe stops delivery', () => {
    const listener = mock(() => {})
    subscribe(listener)

    emitGlobal('before', {})
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe(listener)
    emitGlobal('after', {})
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('emitUser creates user-scoped event', () => {
    let received: DebugEvent | null = null
    subscribe(
      track((e) => {
        received = e
      }),
    )

    emitUser('identity:set', 'user-123', { provider: 'test' })

    expect(received).not.toBeNull()
    expect(received!.type).toBe('identity:set')
    expect(received!.__scope).toEqual({ kind: 'user', userId: 'user-123' })
  })

  test('emitUser includes turnId when provided', () => {
    let received: DebugEvent | null = null
    subscribe(
      track((e) => {
        received = e
      }),
    )

    emitUser('test:event', 'user-1', { x: 1 }, 'turn-abc')

    expect(received).not.toBeNull()
    expect(received!.turnId).toBe('turn-abc')
    expect(received!.__scope).toEqual({ kind: 'user', userId: 'user-1' })
  })
})
