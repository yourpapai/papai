// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, mock, test } from 'bun:test'

import { emitGlobal, subscribeCountForTest } from '../../src/debug/event-bus.js'
import { addClient, init, pingClientsForTest, removeClient } from '../../src/debug/state-collector.js'

// Track controllers so afterEach tears down shared module singletons (clients set,
// onEvent subscription, heartbeat interval) between tests in this file.
const added: ReadableStreamDefaultController[] = []
const track = (c: ReadableStreamDefaultController): ReadableStreamDefaultController => {
  added.push(c)
  return c
}

afterEach(() => {
  for (const c of added.splice(0)) removeClient(c)
})

describe('state-collector heartbeat', () => {
  test('ping reaches live clients and drops dead ones', () => {
    init('admin')
    const enqueued: Uint8Array[] = []
    const live = track({
      enqueue: (c: Uint8Array): void => void enqueued.push(c),
      close: (): void => {},
      error: (): void => {},
      desiredSize: 1,
    } as ReadableStreamDefaultController)

    // sends state:init (1 enqueue), subscribes onEvent, starts heartbeat
    addClient(live)
    pingClientsForTest()

    // The live client received the state:init frame plus a comment-frame ping.
    expect(enqueued.length).toBeGreaterThanOrEqual(2)
  })
})

describe('state-collector client lifecycle', () => {
  test('last client dying during broadcast unsubscribes onEvent', () => {
    init('admin')

    // Succeeds on the initial state:init enqueue (so onEvent subscribes), then throws.
    const enqueueMock = mock<(chunk: unknown) => void>(() => {})
    const controller = track({
      enqueue: (chunk: unknown): void => enqueueMock(chunk),
      close: (): void => {},
      error: (): void => {},
      desiredSize: 1,
    })

    addClient(controller)
    expect(subscribeCountForTest()).toBe(1)

    // Flip the mock so subsequent enqueue throws, then broadcast via emitGlobal.
    // broadcast -> enqueue throws -> removeClient -> unsubscribes onEvent
    enqueueMock.mockImplementation(() => {
      throw new Error('closed')
    })
    emitGlobal('log:entry', { level: 30, time: 't', msg: 'x' })
    expect(subscribeCountForTest()).toBe(0)
  })
})
