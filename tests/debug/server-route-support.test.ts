// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleDeferred, handleIdentity, handleMemos, handleRecurring } from '../../src/debug/server-route-support.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('server-route-support', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('handleRecurring', () => {
    test('returns 400 when userId is missing', () => {
      const res = handleRecurring(new URL('http://localhost/recurring'))
      expect(res.status).toBe(400)
    })

    test('returns 400 when userId is empty string', () => {
      const res = handleRecurring(new URL('http://localhost/recurring?userId='))
      expect(res.status).toBe(400)
    })

    test('returns 200 with empty array for unknown userId', async () => {
      const res = handleRecurring(new URL('http://localhost/recurring?userId=nobody'))
      expect(res.status).toBe(200)
      const body: unknown = await res.json()
      expect(Array.isArray(body)).toBe(true)
    })
  })

  describe('handleDeferred', () => {
    test('returns 400 when userId is missing', () => {
      const res = handleDeferred(new URL('http://localhost/deferred'))
      expect(res.status).toBe(400)
    })

    test('returns 200 with empty array for unknown userId', async () => {
      const res = handleDeferred(new URL('http://localhost/deferred?userId=nobody'))
      expect(res.status).toBe(200)
      const body: unknown = await res.json()
      expect(Array.isArray(body)).toBe(true)
    })
  })

  describe('handleMemos', () => {
    test('returns 400 when userId is missing', () => {
      const res = handleMemos(new URL('http://localhost/memos'))
      expect(res.status).toBe(400)
    })

    test('returns 200 with empty array for unknown userId', async () => {
      const res = handleMemos(new URL('http://localhost/memos?userId=nobody'))
      expect(res.status).toBe(200)
      const body: unknown = await res.json()
      expect(Array.isArray(body)).toBe(true)
    })
  })

  describe('handleIdentity', () => {
    test('returns 400 when userId is missing', () => {
      const res = handleIdentity(new URL('http://localhost/identity'))
      expect(res.status).toBe(400)
    })

    test('returns 404 when no mapping found', () => {
      const res = handleIdentity(new URL('http://localhost/identity?userId=nobody'))
      expect(res.status).toBe(404)
    })
  })
})
