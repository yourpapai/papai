// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('consumeWebFetchQuota', () => {
  let consumeWebFetchQuota: typeof import('../../src/web/rate-limit.js').consumeWebFetchQuota

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    ;({ consumeWebFetchQuota } = await import('../../src/web/rate-limit.js'))
  })

  test('allows the first 20 requests in a window', () => {
    for (let index = 0; index < 20; index += 1) {
      expect(consumeWebFetchQuota('actor-1', 0)).toEqual({
        allowed: true,
        remaining: 19 - index,
      })
    }
  })

  test('blocks the 21st request in the same window', () => {
    for (let index = 0; index < 20; index += 1) {
      consumeWebFetchQuota('actor-1', 0)
    }

    expect(consumeWebFetchQuota('actor-1', 0)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSec: 300,
    })
  })

  test('reports the remaining time for a blocked mid-window request', () => {
    for (let index = 0; index < 20; index += 1) {
      consumeWebFetchQuota('actor-1', 0)
    }

    expect(consumeWebFetchQuota('actor-1', 60_000)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSec: 240,
    })
  })

  test('resets quota after the window rolls over', () => {
    for (let index = 0; index < 20; index += 1) {
      consumeWebFetchQuota('actor-1', 0)
    }

    expect(consumeWebFetchQuota('actor-1', 301_000)).toEqual({ allowed: true, remaining: 19 })
  })
})
