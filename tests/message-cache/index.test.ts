// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import * as messageCache from '../../src/message-cache/index.js'

describe('message-cache index exports', () => {
  test('exposes cache, chain, and types surface', () => {
    expect(typeof messageCache.cacheMessage).toBe('function')
    expect(typeof messageCache.getCachedMessage).toBe('function')
    expect(typeof messageCache.buildReplyChain).toBe('function')
  })

  test('no longer re-exports retired expiry/restore functions', () => {
    expect('initializeMessageCache' in messageCache).toBe(false)
    expect('restoreMessagesFromDb' in messageCache).toBe(false)
  })
})
