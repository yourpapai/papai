// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, mock, test } from 'bun:test'

import { emit, subscribe, unsubscribe, type DebugEvent } from '../../src/debug/event-bus.js'

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

  test('emit with no listeners is a no-op', () => {
    expect(() => emit('test', { key: 'value' })).not.toThrow()
  })

  test('subscribe + emit delivers event to listener', () => {
    let received: DebugEvent | null = null
    subscribe(
      track((e) => {
        received = e
      }),
    )

    emit('test:event', { foo: 'bar' })

    expect(received).not.toBeNull()
    expect(received!.type).toBe('test:event')
    expect(received!.data).toEqual({ foo: 'bar' })
  })

  test('event has correct shape with auto-populated timestamp', () => {
    let captured: DebugEvent | null = null
    subscribe(
      track((e) => {
        captured = e
      }),
    )

    const before = Date.now()
    emit('shape:test', { x: 1 })
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

    emit('multi', {})

    expect(listener1).toHaveBeenCalledTimes(1)
    expect(listener2).toHaveBeenCalledTimes(1)
  })

  test('unsubscribe stops delivery', () => {
    const listener = mock(() => {})
    subscribe(listener)

    emit('before', {})
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe(listener)
    emit('after', {})
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
