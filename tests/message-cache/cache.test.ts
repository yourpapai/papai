// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { cacheMessage, getCachedMessage } from '../../src/message-cache/cache.js'
import { flushPendingWrites, mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('Message Cache', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  // Reads are DB-backed; cacheMessage flushes to SQLite on a queued microtask,
  // so tests await the flush before asserting through getCachedMessage.

  test('should cache and retrieve message', async () => {
    const message = {
      messageId: 'cache-msg-1',
      contextId: 'ctx-cache',
      authorId: 'user-789',
      text: 'Hello',
      timestamp: Date.now(),
    }

    cacheMessage(message)
    await flushPendingWrites()

    const retrieved = getCachedMessage('ctx-cache', 'cache-msg-1')
    expect(retrieved).toBeDefined()
    expect(retrieved?.text).toBe('Hello')
  })

  test('should return undefined for non-existent message', () => {
    const result = getCachedMessage('ctx-noexist', 'non-existent-msg')
    expect(result).toBeUndefined()
  })

  test('should store messages in cache', async () => {
    expect(getCachedMessage('ctx-store', 'store-1')).toBeUndefined()
    cacheMessage({ messageId: 'store-1', contextId: 'ctx-store', timestamp: Date.now() })
    await flushPendingWrites()
    expect(getCachedMessage('ctx-store', 'store-1')).toBeDefined()
  })

  test('should check if message is cached', async () => {
    cacheMessage({ messageId: 'check-1', contextId: 'ctx-check', timestamp: Date.now() })
    await flushPendingWrites()
    expect(getCachedMessage('ctx-check', 'check-1')).toBeDefined()
    expect(getCachedMessage('ctx-check', 'check-2')).toBeUndefined()
  })

  test('should isolate messages by contextId', async () => {
    cacheMessage({
      messageId: 'iso-1',
      contextId: 'ctx-iso-A',
      text: 'From A',
      timestamp: Date.now(),
    })
    cacheMessage({
      messageId: 'iso-1',
      contextId: 'ctx-iso-B',
      text: 'From B',
      timestamp: Date.now(),
    })
    await flushPendingWrites()

    const fromA = getCachedMessage('ctx-iso-A', 'iso-1')
    const fromB = getCachedMessage('ctx-iso-B', 'iso-1')

    expect(fromA?.text).toBe('From A')
    expect(fromB?.text).toBe('From B')
  })

  test('should retain old messages (retention is unlimited)', async () => {
    const oldTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000

    cacheMessage({
      messageId: 'old-msg',
      contextId: 'ctx-old',
      text: 'Old but kept',
      timestamp: oldTimestamp,
    })
    await flushPendingWrites()

    const result = getCachedMessage('ctx-old', 'old-msg')
    expect(result).toBeDefined()
    expect(result?.text).toBe('Old but kept')
  })
})
