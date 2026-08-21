// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ProductionAnalyticsDeps, ProductionAnalyticsRuntime } from '../../src/runtime/production-analytics.js'

describe('startAnalyticsRuntime', () => {
  test('keeps an injected analytics runtime instead of replacing it', async () => {
    const { startAnalyticsRuntime } = await import('../../src/runtime/production-analytics.js')
    const injected: ProductionAnalyticsRuntime = {
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
    }
    const state: ProductionAnalyticsDeps = { analytics: injected }

    startAnalyticsRuntime(state)

    expect(state.analytics).toBe(injected)
  })
})
