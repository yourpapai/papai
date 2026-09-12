// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { emitGlobal } from '../../src/debug/event-bus.js'
import { subscribeCountForTest } from '../../src/debug/event-bus.testing.js'
import {
  addClient,
  pingClientsForTest,
  removeClient,
  resetClientsForTest,
  startEventCollector,
} from '../../src/debug/state-collector.js'
import { setupTestDb } from '../utils/test-helpers.js'

type IntervalTimerPatch = {
  startedDelays: number[]
  clearedHandles: unknown[]
  restore: () => void
}

const patchIntervalTimers = (): IntervalTimerPatch => {
  const originals = {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  }
  const startedDelays: number[] = []
  const clearedHandles: unknown[] = []
  const setIntervalPatch = (_callback: TimerHandler, delay?: number, ..._args: unknown[]): unknown => {
    startedDelays.push(delay ?? 0)
    return {}
  }
  const clearIntervalPatch = (handle?: unknown): void => {
    clearedHandles.push(handle)
  }
  Reflect.set(globalThis, 'setInterval', setIntervalPatch)
  Reflect.set(globalThis, 'clearInterval', clearIntervalPatch)
  return {
    startedDelays,
    clearedHandles,
    restore: (): void => {
      Reflect.set(globalThis, 'setInterval', originals.setInterval)
      Reflect.set(globalThis, 'clearInterval', originals.clearInterval)
    },
  }
}

type MockClient = {
  ctrl: ReadableStreamDefaultController
  enqueueMock: ReturnType<typeof mock<(chunk: unknown) => void>>
}

const createMockClient = (): MockClient => {
  const enqueueMock = mock<(chunk: unknown) => void>(() => {})
  const ctrl: ReadableStreamDefaultController = {
    enqueue: (chunk: unknown): void => enqueueMock(chunk),
    close: (): void => {},
    error: (): void => {},
    desiredSize: 1,
  }
  return { ctrl, enqueueMock }
}

const added: ReadableStreamDefaultController[] = []
const track = (ctrl: ReadableStreamDefaultController): ReadableStreamDefaultController => {
  added.push(ctrl)
  return ctrl
}

beforeEach(async () => {
  await setupTestDb()
  resetClientsForTest()
})

afterEach(() => {
  for (const ctrl of added.splice(0)) removeClient(ctrl)
  resetClientsForTest()
})

describe('state-collector heartbeat', () => {
  test('ping reaches live clients and drops dead ones', () => {
    const enqueued: Uint8Array[] = []
    const live = track({
      enqueue: (c: Uint8Array): void => void enqueued.push(c),
      close: (): void => {},
      error: (): void => {},
      desiredSize: 1,
    } as ReadableStreamDefaultController)

    // sends state:init (1 enqueue), subscribes onEvent, starts heartbeat
    addClient(live, undefined, 'admin')
    pingClientsForTest()

    // The live client received the state:init frame plus a comment-frame ping.
    expect(enqueued.length).toBeGreaterThanOrEqual(2)
  })

  test('ping dead client routes through removeClient, unsubscribing onEvent', () => {
    const enqueueMock = mock<(chunk: unknown) => void>(() => {})
    const controller = track({
      enqueue: (chunk: unknown): void => enqueueMock(chunk),
      close: (): void => {},
      error: (): void => {},
      desiredSize: 1,
    })

    const before = subscribeCountForTest()
    addClient(controller, undefined, 'admin')
    expect(subscribeCountForTest()).toBe(before + 1)

    enqueueMock.mockImplementation(() => {
      throw new Error('closed')
    })
    pingClientsForTest()

    expect(subscribeCountForTest()).toBe(before)
  })
})

describe('state-collector client lifecycle', () => {
  test('last client dying during broadcast unsubscribes onEvent', () => {
    // Succeeds on the initial state:init enqueue (so onEvent subscribes), then throws.
    const enqueueMock = mock<(chunk: unknown) => void>(() => {})
    const controller = track({
      enqueue: (chunk: unknown): void => enqueueMock(chunk),
      close: (): void => {},
      error: (): void => {},
      desiredSize: 1,
    })

    const before = subscribeCountForTest()
    addClient(controller, undefined, 'admin')
    expect(subscribeCountForTest()).toBe(before + 1)

    // Flip the mock so subsequent enqueue throws, then broadcast via emitGlobal.
    // broadcast -> enqueue throws -> removeClient -> unsubscribes onEvent
    enqueueMock.mockImplementation(() => {
      throw new Error('closed')
    })
    emitGlobal('log:entry', { level: 30, time: 't', msg: 'x' })
    expect(subscribeCountForTest()).toBe(before)
  })

  test('addClient and removeClient leave the persistent event-bus subscription unchanged', () => {
    startEventCollector()
    const first = createMockClient()
    const second = createMockClient()

    const before = subscribeCountForTest()
    addClient(track(first.ctrl))
    expect(subscribeCountForTest()).toBe(before)
    addClient(track(second.ctrl))
    expect(subscribeCountForTest()).toBe(before)
    removeClient(first.ctrl)
    expect(subscribeCountForTest()).toBe(before)
    removeClient(second.ctrl)
    expect(subscribeCountForTest()).toBe(before)
  })

  test('heartbeat starts on the first client and stops on the last', () => {
    const timers = patchIntervalTimers()
    try {
      const first = createMockClient()
      const second = createMockClient()

      expect(timers.startedDelays).toHaveLength(0)
      addClient(track(first.ctrl))
      expect(timers.startedDelays).toHaveLength(1)

      addClient(track(second.ctrl))
      expect(timers.startedDelays).toHaveLength(1)

      removeClient(first.ctrl)
      expect(timers.clearedHandles).toHaveLength(0)

      removeClient(second.ctrl)
      expect(timers.clearedHandles).toHaveLength(1)
    } finally {
      timers.restore()
    }
  })

  test('heartbeat restarts when a new first client arrives after stopping', () => {
    const timers = patchIntervalTimers()
    try {
      const firstWave = createMockClient()
      addClient(track(firstWave.ctrl))
      removeClient(firstWave.ctrl)
      expect(timers.startedDelays).toHaveLength(1)
      expect(timers.clearedHandles).toHaveLength(1)

      const secondWave = createMockClient()
      addClient(track(secondWave.ctrl))
      expect(timers.startedDelays).toHaveLength(2)
      removeClient(secondWave.ctrl)
      expect(timers.clearedHandles).toHaveLength(2)
    } finally {
      timers.restore()
    }
  })
})

describe('state-collector dead-client removal', () => {
  test('ping drops dead clients and reaches live ones without touching the subscription', () => {
    startEventCollector()
    const live = createMockClient()
    const dead = createMockClient()

    const before = subscribeCountForTest()
    addClient(track(live.ctrl))
    addClient(track(dead.ctrl))
    expect(subscribeCountForTest()).toBe(before)

    dead.enqueueMock.mockImplementation(() => {
      throw new Error('closed')
    })
    pingClientsForTest()
    expect(live.enqueueMock).toHaveBeenCalledTimes(2)
    expect(subscribeCountForTest()).toBe(before)

    dead.enqueueMock.mockImplementation(() => {})
    pingClientsForTest()
    // state:init + the one throwing ping that triggered the drop; nothing after.
    expect(dead.enqueueMock).toHaveBeenCalledTimes(2)
    expect(live.enqueueMock).toHaveBeenCalledTimes(3)
    expect(subscribeCountForTest()).toBe(before)
  })

  test('last client dying during broadcast is dropped without unsubscribing', () => {
    startEventCollector()
    const timers = patchIntervalTimers()
    try {
      const client = createMockClient()

      const before = subscribeCountForTest()
      addClient(track(client.ctrl))
      expect(subscribeCountForTest()).toBe(before)
      expect(timers.startedDelays).toHaveLength(1)

      client.enqueueMock.mockImplementation(() => {
        throw new Error('closed')
      })
      emitGlobal('log:entry', { level: 30, time: 't', msg: 'x' })
      expect(subscribeCountForTest()).toBe(before)
      expect(timers.clearedHandles).toHaveLength(1)

      client.enqueueMock.mockImplementation(() => {})
      emitGlobal('log:entry', { level: 30, time: 't', msg: 'x' })
      // state:init + the one throwing broadcast enqueue; the drop means no more frames.
      expect(client.enqueueMock).toHaveBeenCalledTimes(2)
      expect(subscribeCountForTest()).toBe(before)
    } finally {
      timers.restore()
    }
  })
})
