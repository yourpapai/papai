// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { consumeSettingsQuota } from '../../src/settings/rate-limit.js'
import { mockLogger, setupSettingsAuthTestDb } from '../utils/test-helpers.js'

describe('consumeSettingsQuota', () => {
  beforeEach(async () => {
    mockLogger()
    await setupSettingsAuthTestDb()
  })

  test('allows up to the limit in a window', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(consumeSettingsQuota('issue', 'a-1', 3, 60_000, 0)).toEqual({ allowed: true, remaining: 2 - i })
    }
  })

  test('blocks once the limit is reached and reports retry-after', () => {
    for (let i = 0; i < 3; i += 1) consumeSettingsQuota('issue', 'a-1', 3, 60_000, 0)
    expect(consumeSettingsQuota('issue', 'a-1', 3, 60_000, 0)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSec: 60,
    })
  })

  test('buckets are independent', () => {
    for (let i = 0; i < 3; i += 1) consumeSettingsQuota('issue', 'a-1', 3, 60_000, 0)
    expect(consumeSettingsQuota('exchange', 'a-1', 3, 60_000, 0)).toEqual({ allowed: true, remaining: 2 })
  })

  test('actors are independent within a bucket', () => {
    for (let i = 0; i < 3; i += 1) consumeSettingsQuota('issue', 'a-1', 3, 60_000, 0)
    expect(consumeSettingsQuota('issue', 'a-2', 3, 60_000, 0)).toEqual({ allowed: true, remaining: 2 })
  })

  test('quota resets after the window rolls over', () => {
    for (let i = 0; i < 3; i += 1) consumeSettingsQuota('issue', 'a-1', 3, 60_000, 0)
    expect(consumeSettingsQuota('issue', 'a-1', 3, 60_000, 60_000)).toEqual({ allowed: true, remaining: 2 })
  })
})
