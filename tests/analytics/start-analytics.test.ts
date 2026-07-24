// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { startAnalytics, stopAnalytics } from '../../src/analytics/start-analytics.js'

describe('start-analytics', () => {
  test('stop without start is an idempotent no-op', async () => {
    await expect(stopAnalytics()).resolves.toBeUndefined()
    expect(typeof startAnalytics).toBe('function')
  })
})
