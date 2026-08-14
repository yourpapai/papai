// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createStopController, type StopHost, type StopSignal } from '../../review-loop/src/stop-controller.js'

/** A host with no clock and no signals of its own, so a test can fire both by hand. */
function fakeHost(): StopHost & { fire: () => void; raise: (signal: StopSignal) => void; armed: () => number | null } {
  let scheduled: { fn: () => void; ms: number } | null = null
  const handlers = new Map<StopSignal, Array<() => void>>()

  return {
    schedule: (fn, ms) => {
      scheduled = { fn, ms }
      return (): void => {
        scheduled = null
      }
    },
    on: (signal, handler) => {
      handlers.set(signal, [...(handlers.get(signal) ?? []), handler])
    },
    off: (signal, handler) => {
      handlers.set(
        signal,
        (handlers.get(signal) ?? []).filter((entry) => entry !== handler),
      )
    },
    fire: () => {
      scheduled?.fn()
    },
    raise: (signal) => {
      for (const handler of handlers.get(signal) ?? []) handler()
    },
    armed: () => scheduled?.ms ?? null,
  }
}

describe('createStopController', () => {
  test('lets the run carry on while nothing has asked it to stop', () => {
    const stop = createStopController({ runTimeoutMs: 60_000, host: fakeHost() })

    expect(stop.requested()).toBeNull()
  })

  test('asks for a stop when the run budget elapses', () => {
    const host = fakeHost()
    const seen: string[] = []
    const stop = createStopController({
      runTimeoutMs: 90_000,
      host,
      onStop: (reason) => {
        seen.push(reason)
      },
    })

    expect(host.armed()).toBe(90_000)
    host.fire()

    expect(stop.requested()).toBe('budget')
    expect(seen).toEqual(['budget'])
  })

  test('arms no budget at all when there is none configured', () => {
    const host = fakeHost()
    createStopController({ runTimeoutMs: 0, host })

    expect(host.armed()).toBeNull()
  })

  test('asks for a stop on SIGTERM, which is how a caller reclaims its runner', () => {
    const host = fakeHost()
    const stop = createStopController({ runTimeoutMs: 0, host })

    host.raise('SIGTERM')

    expect(stop.requested()).toBe('signal')
  })

  test('keeps the first reason, because the second one changes nothing', () => {
    const host = fakeHost()
    const seen: string[] = []
    const stop = createStopController({
      runTimeoutMs: 1_000,
      host,
      onStop: (reason) => {
        seen.push(reason)
      },
    })

    host.fire()
    host.raise('SIGINT')

    expect(stop.requested()).toBe('budget')
    expect(seen).toEqual(['budget'])
  })

  test('escalates a repeated signal, so Ctrl-C twice still means now', () => {
    const host = fakeHost()
    let escalations = 0
    const stop = createStopController({
      runTimeoutMs: 0,
      host,
      onRepeatedSignal: () => {
        escalations += 1
      },
    })

    host.raise('SIGINT')
    host.raise('SIGINT')

    expect(escalations).toBe(1)
    expect(stop.requested()).toBe('signal')
  })

  test('disposes its timer and its handlers, so the process may exit', () => {
    const host = fakeHost()
    const stop = createStopController({ runTimeoutMs: 1_000, host })

    stop.dispose()
    host.raise('SIGTERM')

    expect(host.armed()).toBeNull()
    expect(stop.requested()).toBeNull()
  })
})
