// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getNotifyToken, resetNotifyTokenCacheForTesting } from '../src/notify-token.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('notify-token', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetNotifyTokenCacheForTesting()
    delete process.env['NOTIFY_TOKEN']
  })

  afterEach(() => {
    delete process.env['NOTIFY_TOKEN']
    resetNotifyTokenCacheForTesting()
  })

  test('returns null when neither db nor env has a token', () => {
    expect(getNotifyToken()).toBeNull()
  })

  test('lazily seeds from NOTIFY_TOKEN env and caches it', () => {
    process.env['NOTIFY_TOKEN'] = 'super-secret'
    expect(getNotifyToken()).toBe('super-secret')
    delete process.env['NOTIFY_TOKEN']
    expect(getNotifyToken()).toBe('super-secret')
  })

  test('persists the seeded token to system_config (survives cache reset)', () => {
    process.env['NOTIFY_TOKEN'] = 'persisted'
    expect(getNotifyToken()).toBe('persisted')
    resetNotifyTokenCacheForTesting()
    delete process.env['NOTIFY_TOKEN']
    expect(getNotifyToken()).toBe('persisted')
  })

  test('returns null when NOTIFY_TOKEN is whitespace only', () => {
    process.env['NOTIFY_TOKEN'] = '   '
    expect(getNotifyToken()).toBeNull()
  })
})
