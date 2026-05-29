// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { startSweeper } from '../../src/dashboard-auth/sweeper.js'

describe('startSweeper', () => {
  test('catches errors thrown from sweep and does not propagate', () => {
    const sweepMock = mock((): void => {
      throw new Error('boom')
    })
    let captured: { fn: (() => void) | null; ms: number | null } = { fn: null, ms: null }
    const fakeStop = mock((): void => {})
    const stop = startSweeper({
      intervalMs: 1000,
      sweep: sweepMock,
      scheduleWith: (fn, ms) => {
        captured = { fn, ms }
        return fakeStop
      },
    })
    expect(captured.fn).toBeFunction()
    expect(() => captured.fn?.()).not.toThrow()
    expect(sweepMock).toHaveBeenCalled()
    stop()
  })

  test('schedules sweep at the configured interval and returns stop()', () => {
    const sweepMock = mock((): void => {})
    const captured: { fn: (() => void) | null; ms: number | null } = { fn: null, ms: null }

    const scheduleWith = (fn: () => void, ms: number): (() => void) => {
      captured.fn = fn
      captured.ms = ms
      return (): void => {}
    }

    const stop = startSweeper({ intervalMs: 60_000, sweep: sweepMock, scheduleWith })

    expect(captured.ms).toBe(60_000)
    expect(captured.fn).toBeFunction()
    captured.fn?.()
    expect(sweepMock).toHaveBeenCalledTimes(1)

    stop()
  })
})
