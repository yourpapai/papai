// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { cacheMessage } from '../../src/message-cache/cache.js'
import { getMessageByContext } from '../../src/message-cache/store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const flushPendingWrites = (): Promise<void> =>
  new Promise<void>((resolve) => {
    queueMicrotask(resolve)
  })

describe('message-cache store: getMessageByContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns a previously cached message by (contextId, messageId)', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'c1', text: 'hello', timestamp: 1000 })
    await flushPendingWrites()
    const got = getMessageByContext('c1', 'm1')
    expect(got?.text).toBe('hello')
    expect(got?.timestamp).toBe(1000)
  })

  test('returns undefined for a missing message', () => {
    expect(getMessageByContext('c1', 'nope')).toBeUndefined()
  })

  test('isolates by contextId (same messageId, different context)', async () => {
    cacheMessage({ messageId: 'm1', contextId: 'A', text: 'in A', timestamp: 1 })
    cacheMessage({ messageId: 'm1', contextId: 'B', text: 'in B', timestamp: 2 })
    await flushPendingWrites()
    expect(getMessageByContext('A', 'm1')?.text).toBe('in A')
    expect(getMessageByContext('B', 'm1')?.text).toBe('in B')
  })
})
