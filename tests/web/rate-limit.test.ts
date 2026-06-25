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

describe('consumeQuota (generic primitive)', () => {
  let consumeQuota: typeof import('../../src/web/rate-limit.js').consumeQuota
  let consumeWebFetchQuota: typeof import('../../src/web/rate-limit.js').consumeWebFetchQuota

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    ;({ consumeQuota, consumeWebFetchQuota } = await import('../../src/web/rate-limit.js'))
  })

  test('honors a custom limit and window', () => {
    for (let index = 0; index < 3; index += 1) {
      expect(consumeQuota('bucket-a', 3, 60_000, 0)).toEqual({ allowed: true, remaining: 2 - index })
    }
    expect(consumeQuota('bucket-a', 3, 60_000, 0)).toEqual({ allowed: false, remaining: 0, retryAfterSec: 60 })
  })

  test('distinct actor keys do not share a bucket', () => {
    // Exhaust one actor key entirely.
    for (let index = 0; index < 2; index += 1) consumeQuota('bucket-x', 2, 60_000, 0)
    expect(consumeQuota('bucket-x', 2, 60_000, 0).allowed).toBe(false)
    // A different actor key is unaffected.
    expect(consumeQuota('bucket-y', 2, 60_000, 0)).toEqual({ allowed: true, remaining: 1 })
  })

  test('web-fetch quota does not collide with a same-named generic bucket via prefix', () => {
    // web_fetch consumes its raw actor id; a generic caller prefixes its key, so they are independent.
    for (let index = 0; index < 20; index += 1) consumeWebFetchQuota('user-1', 0)
    expect(consumeWebFetchQuota('user-1', 0).allowed).toBe(false)
    // A prefixed key for the same underlying actor still has full quota.
    expect(consumeQuota('plugin:audio-transcribe:user-1', 5, 60_000, 0)).toEqual({ allowed: true, remaining: 4 })
  })
})
