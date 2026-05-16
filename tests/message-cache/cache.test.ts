// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { cacheMessage, getCachedMessage } from '../../src/message-cache/cache.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000
const ONE_MINUTE_MS = 60 * 1000

describe('Message Cache', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  // Each test uses unique contextId/messageId prefixes to avoid sharing state
  // across tests, since the in-memory Map in cache.ts persists for the process lifetime.

  test('should cache and retrieve message', () => {
    const message = {
      messageId: 'cache-msg-1',
      contextId: 'ctx-cache',
      authorId: 'user-789',
      text: 'Hello',
      timestamp: Date.now(),
    }

    cacheMessage(message)

    const retrieved = getCachedMessage('ctx-cache', 'cache-msg-1')
    expect(retrieved).toBeDefined()
    expect(retrieved?.text).toBe('Hello')
  })

  test('should return undefined for non-existent message', () => {
    const result = getCachedMessage('ctx-noexist', 'non-existent-msg')
    expect(result).toBeUndefined()
  })

  test('should store messages in cache', () => {
    expect(getCachedMessage('ctx-store', 'store-1')).toBeUndefined()
    cacheMessage({ messageId: 'store-1', contextId: 'ctx-store', timestamp: Date.now() })
    expect(getCachedMessage('ctx-store', 'store-1')).toBeDefined()
  })

  test('should check if message is cached', () => {
    cacheMessage({ messageId: 'check-1', contextId: 'ctx-check', timestamp: Date.now() })
    expect(getCachedMessage('ctx-check', 'check-1')).toBeDefined()
    expect(getCachedMessage('ctx-check', 'check-2')).toBeUndefined()
  })

  test('should isolate messages by contextId', () => {
    cacheMessage({ messageId: 'iso-1', contextId: 'ctx-iso-A', text: 'From A', timestamp: Date.now() })
    cacheMessage({ messageId: 'iso-1', contextId: 'ctx-iso-B', text: 'From B', timestamp: Date.now() })

    const fromA = getCachedMessage('ctx-iso-A', 'iso-1')
    const fromB = getCachedMessage('ctx-iso-B', 'iso-1')

    expect(fromA?.text).toBe('From A')
    expect(fromB?.text).toBe('From B')
  })

  test('should expire messages that exceed TTL', () => {
    const expiredTimestamp = Date.now() - ONE_WEEK_MS - 1000

    cacheMessage({ messageId: 'ttl-expired', contextId: 'ctx-ttl', text: 'Expired', timestamp: expiredTimestamp })

    const result = getCachedMessage('ctx-ttl', 'ttl-expired')
    expect(result).toBeUndefined()
  })

  test('should return messages within TTL', () => {
    // 1 minute before expiry
    const freshTimestamp = Date.now() - ONE_WEEK_MS + ONE_MINUTE_MS

    cacheMessage({ messageId: 'ttl-fresh', contextId: 'ctx-ttl', text: 'Fresh', timestamp: freshTimestamp })

    const result = getCachedMessage('ctx-ttl', 'ttl-fresh')
    expect(result).toBeDefined()
    expect(result?.text).toBe('Fresh')
  })
})
