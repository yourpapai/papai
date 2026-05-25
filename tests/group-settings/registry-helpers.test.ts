// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { isWithinThrottleWindow } from '../../src/group-settings/registry-helpers.js'

describe('isWithinThrottleWindow', () => {
  test('returns true when last seen is within the throttle window', () => {
    // 1 minute ago — well within the 5-minute window
    const recentIso = new Date(Date.now() - 60_000).toISOString()
    expect(isWithinThrottleWindow(recentIso)).toBe(true)
  })

  test('returns false when last seen is outside the throttle window', () => {
    // 10 minutes ago — past the 5-minute window
    const oldIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    expect(isWithinThrottleWindow(oldIso)).toBe(false)
  })
})
