// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import * as realStartAnalytics from '../../src/analytics/start-analytics.js'
import type { ProductionAnalyticsDeps, ProductionAnalyticsRuntime } from '../../src/runtime/production-analytics.js'
import { createTrackedLoggerMock } from '../utils/logger-mock.js'

// Snapshot before any mock.module call: Bun mutates the module namespace in
// place when mocking, so spreading the live namespace later would re-spread
// the mock instead of the real exports.
const realStartAnalyticsExports = { ...realStartAnalytics }

const makeRuntime = (): ProductionAnalyticsRuntime => ({
  observer: {
    observe: (): void => undefined,
    flush: (): Promise<void> => Promise.resolve(),
    stop: (): Promise<void> => Promise.resolve(),
  },
  registry: {
    register: (): void => undefined,
    resolve: (): null => null,
    complete: (): void => undefined,
    noteTerminalEvidence: (): void => undefined,
    setTerminalListener: (): void => undefined,
    clear: (): void => undefined,
  },
})

// The module binds `logger.child({ scope: 'main' })` at load, so each test
// imports a fresh copy (cache-busted) against its own mocks.
let loadCount = 0
const freshModule = (): Promise<typeof import('../../src/runtime/production-analytics.js')> => {
  loadCount++
  return import(`../../src/runtime/production-analytics.ts?case=${loadCount}`)
}

describe('startAnalyticsRuntime', () => {
  let startAnalyticsMock: ReturnType<typeof mock<() => void>>
  let activeRuntime: ProductionAnalyticsRuntime
  let tracked: ReturnType<typeof createTrackedLoggerMock>

  // mock.module is process-wide and mock.restore() does not undo it; without
  // this restore the throwing mock leaks into later files sharing the worker
  // (provision-routes.test.ts calls the real startAnalytics()).
  afterAll(() => {
    void mock.module('../../src/analytics/start-analytics.js', () => ({ ...realStartAnalyticsExports }))
  })

  beforeEach(() => {
    tracked = createTrackedLoggerMock()
    void mock.module('../../src/logger.js', () => ({
      getLogLevel: tracked.getLogLevel,
      logger: tracked.logger,
    }))
    startAnalyticsMock = mock<() => void>(() => undefined)
    activeRuntime = makeRuntime()
    void mock.module('../../src/analytics/start-analytics.js', () => ({
      startAnalytics: startAnalyticsMock,
      getActiveAnalyticsRuntime: (): unknown => activeRuntime,
      stopAnalytics: (): Promise<void> => Promise.resolve(),
    }))
  })

  test('starts analytics and stores the active runtime when none is injected', async () => {
    const { startAnalyticsRuntime } = await freshModule()
    const state: ProductionAnalyticsDeps = { analytics: null }

    startAnalyticsRuntime(state)

    expect(startAnalyticsMock).toHaveBeenCalledTimes(1)
    expect(state.analytics).toBe(activeRuntime)
    expect(tracked.getCallsByLevel('error')).toHaveLength(0)
  })

  test('keeps an injected analytics runtime instead of replacing it', async () => {
    const { startAnalyticsRuntime } = await freshModule()
    const injected = makeRuntime()
    const state: ProductionAnalyticsDeps = { analytics: injected }

    startAnalyticsRuntime(state)

    expect(state.analytics).toBe(injected)
    expect(startAnalyticsMock).toHaveBeenCalledTimes(1)
  })

  test('logs and swallows a failed analytics start without touching state', async () => {
    startAnalyticsMock.mockImplementation(() => {
      throw new Error('boom')
    })
    const { startAnalyticsRuntime } = await freshModule()
    const state: ProductionAnalyticsDeps = { analytics: null }

    startAnalyticsRuntime(state)

    expect(state.analytics).toBeNull()
    const errorCalls = tracked.getCallsByLevel('error')
    expect(errorCalls).toHaveLength(1)
    const call = errorCalls[0]
    expect(call).toBeDefined()
    expect(call?.args[1]).toBe('Analytics runtime start failed')
    expect(call?.args[0]).toEqual({ error: 'boom' })
  })

  test('logs under the production main scope', async () => {
    startAnalyticsMock.mockImplementation(() => {
      throw new Error('boom')
    })
    await freshModule()

    const childCalls: unknown = tracked.logger.child.mock.calls
    assert.ok(Array.isArray(childCalls))
    expect(childCalls).toHaveLength(1)
    const first: unknown = childCalls[0]
    assert.ok(Array.isArray(first))
    expect(first[0]).toEqual({ scope: 'main' })
  })
})
