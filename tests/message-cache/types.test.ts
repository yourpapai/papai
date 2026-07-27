// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { CachedMessage } from '../../src/message-cache/types.js'

describe('CachedMessage type', () => {
  test('accepts optional groupContextId for group-wide scope', () => {
    const message: CachedMessage = {
      messageId: 'm1',
      contextId: 'c1',
      groupContextId: 'g1',
      timestamp: 1000,
    }
    expect(message.groupContextId).toBe('g1')
    expect(message.timestamp).toBe(1000)
  })

  test('groupContextId is optional', () => {
    const message: CachedMessage = { messageId: 'm2', contextId: 'c2', timestamp: 2000 }
    expect(message.groupContextId).toBeUndefined()
  })
})
